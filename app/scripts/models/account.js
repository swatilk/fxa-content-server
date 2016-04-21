/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This model abstracts interaction between the user's account
// and the profile server and also handles (de)serialization.

define(function (require, exports, module) {
  'use strict';

  var _ = require('underscore');
  var AuthErrors = require('lib/auth-errors');
  var Backbone = require('backbone');
  var Constants = require('lib/constants');
  var MarketingEmailPrefs = require('models/marketing-email-prefs');
  var OAuthToken = require('models/oauth-token');
  var p = require('lib/promise');
  var ProfileClient = require('lib/profile-client');
  var ProfileImage = require('models/profile-image');

  var NEWSLETTER_ID = Constants.MARKETING_EMAIL_NEWSLETTER_ID;

  // Account attributes that can be persisted
  var PERSISTENT = {
    displayName: undefined,
    email: undefined,
    grantedPermissions: undefined,
    hadProfileImageSetBefore: undefined,
    lastLogin: undefined,
    needsOptedInToMarketingEmail: undefined,
    // password field intentionally omitted to avoid unintentional leaks
    permissions: undefined,
    profileImageId: undefined,
    profileImageUrl: undefined,
    sessionToken: undefined,
    // Hint for future code spelunkers. sessionTokenContext is a misnomer,
    // what the field is really used for is to indicate whether the
    // sessionToken is shared with Sync. It will be set to `fx_desktop_v1` if
    // the sessionToken is shared. Users cannot sign out of Sync shared
    // sessions from within the content server, instead they must go into the
    // Sync panel and disconnect there. The reason this field has not been
    // renamed is because we cannot gracefully handle rollback without the
    // side effect of users being able to sign out of their Sync based
    // session. Data migration within the client goes one way. It's easy to
    // move forward, very hard to move back.
    sessionTokenContext: undefined,
    uid: undefined,
    verified: undefined
  };

  var DEFAULTS = _.extend({
    accessToken: undefined,
    customizeSync: undefined,
    declinedSyncEngines: undefined,
    keyFetchToken: undefined,
    // password field intentionally omitted to avoid unintentional leaks
    unwrapBKey: undefined
  }, PERSISTENT);

  var ALLOWED_KEYS = Object.keys(DEFAULTS);
  var ALLOWED_PERSISTENT_KEYS = Object.keys(PERSISTENT);

  var PROFILE_SCOPE = 'profile profile:write';

  var PERMISSIONS_TO_KEYS = {
    'profile:avatar': 'profileImageUrl',
    'profile:display_name': 'displayName',
    'profile:email': 'email',
    'profile:uid': 'uid'
  };

  var Account = Backbone.Model.extend({
    defaults: DEFAULTS,

    initialize: function (accountData, options) {
      options = options || {};
      var self = this;

      self._oAuthClientId = options.oAuthClientId;
      self._oAuthClient = options.oAuthClient;
      self._assertion = options.assertion;
      self._profileClient = options.profileClient;
      self._fxaClient = options.fxaClient;
      self._marketingEmailClient = options.marketingEmailClient;
      self._metricsContext = options.metricsContext;

      /**
       * Keeps track of outstanding assertion generation requests, keyed
       * by sessionToken. Used to prevent multiple concurrent assertion
       * requests for the same sessionToken.
       */
      self._assertionPromises = {};

      // upgrade old `grantedPermissions` to the new `permissions`.
      self._upgradeGrantedPermissions();

      self._boundOnChange = self.onChange.bind(self);
      self.on('change', self._boundOnChange);
    },

    // Hydrate the account
    fetch: function () {
      var self = this;
      var promise = p();

      if (! self.get('sessionToken')) {
        return promise;
      }

      // upgrade the credentials with verified state
      if (! self.get('verified')) {
        promise = self.isVerified()
          .then(function (verified) {
            self.set('verified', verified);
          }, function () {
            // Ignore errors; we'll just fetch again when needed
          }); /* HACK: See eslint/eslint#1801 */ // eslint-disable-line indent
      }

      return promise;
    },

    _fetchProfileOAuthToken: function () {
      var self = this;
      return self.createOAuthToken(PROFILE_SCOPE)
        .then(function (accessToken) {
          self.set('accessToken', accessToken.get('token'));
        });
    },

    profileClient: function () {
      var self = this;
      return self.fetch()
        .then(function () {
          // If the account is not verified fail before attempting to fetch a token
          if (! self.get('verified')) {
            throw AuthErrors.toError('UNVERIFIED_ACCOUNT');
          } else if (self._needsAccessToken()) {
            return self._fetchProfileOAuthToken();
          }
        })
        .then(function () {
          return self._profileClient;
        });
    },

    isFromSync: function () {
      return this.get('sessionTokenContext') === Constants.SESSION_TOKEN_USED_FOR_SYNC;
    },

    // returns true if all attributes within ALLOWED_KEYS are defaults
    isDefault: function () {
      var self = this;
      return ! _.find(ALLOWED_KEYS, function (key) {
        return self.get(key) !== DEFAULTS[key];
      });
    },

    // If we're verified and don't have an accessToken, we should
    // go ahead and get one.
    _needsAccessToken: function () {
      return this.get('verified') && ! this.get('accessToken');
    },

    _generateAssertion: function () {
      var self = this;

      var sessionToken = self.get('sessionToken');

      // assertions live for 25 years, they can be cached and reused while
      // this browser tab is open.
      var existingAssertionPromise = self._assertionPromises[sessionToken];

      if (existingAssertionPromise) {
        return existingAssertionPromise;
      }

      var assertionPromise = self._assertion.generate(sessionToken);

      self._assertionPromises[sessionToken] = assertionPromise;

      return assertionPromise;
    },

    createOAuthToken: function (scope) {
      var self = this;

      return self._generateAssertion()
        .then(function (assertion) {
          var params = {
            assertion: assertion,
            client_id: self._oAuthClientId, //eslint-disable-line camelcase
            scope: scope
          };
          return self._oAuthClient.getToken(params);
        })
        .then(function (result) {
          return new OAuthToken({
            oAuthClient: self._oAuthClient,
            token: result.access_token
          });
        });
    },

    isVerified: function () {
      return this._fxaClient.recoveryEmailStatus(this.get('sessionToken'))
        .then(function (results) {
          return results.verified;
        });
    },

    isSignedIn: function () {
      return this._fxaClient.isSignedIn(this.get('sessionToken'));
    },

    toJSON: function () {
      /*
       * toJSON is explicitly disabled because it fetches all attributes
       * on the model, making accidental data exposure easier than it
       * should be. Use the [pick](http:*underscorejs.org/#pick) method
       * instead, which requires a list of attributes to get.
       *
       * e.g.:
       * var accountData = account.pick('email', 'uid');
       */
      throw new Error('toJSON is explicitly disabled, use `.pick` instead');
    },

    toPersistentJSON: function () {
      return this.pick(ALLOWED_PERSISTENT_KEYS);
    },

    setProfileImage: function (profileImage) {
      this.set({
        profileImageId: profileImage.get('id'),
        profileImageUrl: profileImage.get('url')
      });

      if (this.get('profileImageUrl')) {
        // This is a heuristic to let us know if the user has, at some point,
        // had a custom profile image.
        this.set('hadProfileImageSetBefore', true);
      }
    },

    onChange: function () {
      // if any data is set outside of the `fetchProfile` function,
      // clear the cache and force a reload of the profile the next time.
      delete this._profileFetchPromise;
    },

    _profileFetchPromise: null,
    fetchProfile: function () {
      var self = this;

      // Avoid multiple views making profile requests by caching
      // the profile fetch request. Only allow one for a given account,
      // and then re-use the data after that. See #3053
      if (self._profileFetchPromise) {
        return self._profileFetchPromise;
      }

      // ignore change events while populating known good data.
      // Unbinding the change event here ignores the `set` from
      // the call to _fetchProfileOAuthToken made in `getProfile`.
      self.off('change', self._boundOnChange);

      self._profileFetchPromise = self.getProfile()
        .then(function (result) {
          var profileImage = new ProfileImage({ url: result.avatar });

          self.setProfileImage(profileImage);
          self.set('displayName', result.displayName);

          self.on('change', self._boundOnChange);
        });

      return self._profileFetchPromise;
    },

    fetchCurrentProfileImage: function () {
      var self = this;
      var profileImage = new ProfileImage();

      return self.getAvatar()
        .then(function (result) {
          profileImage = new ProfileImage({ id: result.id, url: result.avatar });
          self.setProfileImage(profileImage);
          return profileImage.fetch();
        })
        .then(function () {
          return profileImage;
        });
    },

    /**
     * Sign in an existing user.
     *
     * @param {string} password - The user's password
     * @param {object} relier - Relier being signed in to
     * @param {object} [options]
     * @param {string} [options.resume] - Resume token to send in verification
     * email if user is unverified.
     * @returns {promise} - resolves when complete
     */
    signIn: function (password, relier, options) {
      var self = this;
      options = options || {};

      return p().then(function () {
        var email = self.get('email');
        var sessionToken = self.get('sessionToken');

        if (password) {
          return self._fxaClient.signIn(email, password, relier, {
            metricsContext: self._metricsContext.get()
          });
        } else if (sessionToken) {
          // We have a cached Sync session so just check that it hasn't expired.
          // The result includes the latest verified state
          return self._fxaClient.recoveryEmailStatus(sessionToken);
        } else {
          throw AuthErrors.toError('UNEXPECTED_ERROR');
        }
      })
      .then(function (updatedSessionData) {
        self.set(updatedSessionData);

        if (! self.get('verified')) {
          return self._fxaClient.signUpResend(
            relier,
            self.get('sessionToken'),
            {
              resume: options.resume
            }
          );
        }
      });
    },

    /**
     * Sign up a new user.
     *
     * @param {string} password - The user's password
     * @param {object} relier - Relier being signed in to
     * @param {object} [options]
     * @param {string} [options.resume] - Resume token to send in verification
     * email if user is unverified.
     * @returns {promise} - resolves when complete
     */
    signUp: function (password, relier, options) {
      var self = this;
      options = options || {};

      return self._fxaClient.signUp(
        self.get('email'),
        password,
        relier,
        {
          customizeSync: self.get('customizeSync'),
          metricsContext: self._metricsContext.get(),
          resume: options.resume
        })
        .then(function (updatedSessionData) {
          self.set(updatedSessionData);
        });
    },

    /**
     * Retry a sign up
     *
     * @param {object} relier
     * @param {object} [options]
     * @param {string} [options.resume] resume token
     * @returns {promise} - resolves when complete
     */
    retrySignUp: function (relier, options) {
      options = options || {};

      return this._fxaClient.signUpResend(
        relier,
        this.get('sessionToken'),
        {
          resume: options.resume
        }
      );
    },

    /**
     * Verify the account using the verification code
     *
     * @param {string} code - the verification code
     * @returns {promise} - resolves when complete
     */
    verifySignUp: function (code) {
      var self = this;
      return self._fxaClient.verifyCode(
        self.get('uid'),
        code
      )
      .then(function () {
        self.set('verified', true);

        if (self.get('needsOptedInToMarketingEmail')) {
          self.unset('needsOptedInToMarketingEmail');
          var emailPrefs = self.getMarketingEmailPrefs();
          return emailPrefs.optIn(NEWSLETTER_ID);
        }
      });
    },

    /**
     * Check whether the account's email is registered.
     *
     * @returns {promise} resolves to `true` if email is registered,
     * `false` otw.
     */
    checkEmailExists: function () {
      return this._fxaClient.checkAccountExistsByEmail(this.get('email'));
    },

    /**
     * Check whether the account's UID is registered.
     *
     * @returns {promise} resolves to `true` if the uid is registered,
     * `false` otw.
     */
    checkUidExists: function () {
      return this._fxaClient.checkAccountExists(this.get('uid'));
    },

    /**
     * Sign out the user
     *
     * @returns {promise} - resolves when complete
     */
    signOut: function () {
      return this._fxaClient.signOut(this.get('sessionToken'));
    },

    /**
     * Destroy the account, remove it from the server
     *
     * @param {string} password - The user's password
     * @returns {promise} - resolves when complete
     */
    destroy: function (password) {
      var self = this;
      return self._fxaClient.deleteAccount(
        self.get('email'),
        password
      )
      .then(function () {
        self.trigger('destroy', self);
      });
    },

    /**
     * convert the old `grantedPermissions` field to the new
     * `permissions` field. `grantedPermissions` was only filled
     * with permissions that were granted. `permissions` contains
     * each permission that the user has made a choice for, as
     * well as its status.
     *
     * @private
     */
    _upgradeGrantedPermissions: function () {
      if (this.has('grantedPermissions')) {
        var grantedPermissions = this.get('grantedPermissions');

        for (var clientId in grantedPermissions) {
          var clientPermissions = {};
          grantedPermissions[clientId].forEach(function (permissionName) {
            // if the permission is in grantedPermissions, it's
            // status is `true`
            clientPermissions[permissionName] = true;
          });

          this.setClientPermissions(clientId, clientPermissions);
        }

        this.unset('grantedPermissions');
      }
    },

    /**
     * Return the permissions the client has seen as well as their state.
     *
     * Example returned object:
     * {
     *   'profile:display_name': false,
     *   'profile:email': true
     * }
     *
     * @param {string} clientId
     * @returns {object}
     */
    getClientPermissions: function (clientId) {
      var permissions = this.get('permissions') || {};
      return permissions[clientId] || {};
    },

    /**
     * Get the value of a single permission
     *
     * @param {string} clientId
     * @param {string} permissionName
     * @returns {boolean}
     */
    getClientPermission: function (clientId, permissionName) {
      var clientPermissions = this.getClientPermissions(clientId);
      return clientPermissions[permissionName];
    },

    /**
     * Set the permissions for a client. `permissions`
     * should be an object with the following format:
     * {
     *   'profile:display_name': false,
     *   'profile:email': true
     * }
     *
     * @param {string} clientId
     * @param {object} clientPermissions
     */
    setClientPermissions: function (clientId, clientPermissions) {
      var allPermissions = this.get('permissions') || {};
      allPermissions[clientId] = clientPermissions;
      this.set('permissions', allPermissions);
    },

    /**
     * Check whether all the passed in permissions have been
     * seen previously.
     *
     * @param {string} clientId
     * @param {array of strings} permissions
     * @returns {boolean} `true` if client has seen all the permissions,
     *  `false` otw.
     */
    hasSeenPermissions: function (clientId, permissions) {
      var seenPermissions = Object.keys(this.getClientPermissions(clientId));
      // without's signature is `array, *values)`,
      // *values cannot be an array, so convert to a form without can use.
      var args = [permissions].concat(seenPermissions);
      var notSeen = _.without.apply(_, args);
      return notSeen.length === 0;
    },

    /**
     * Return a list of permissions that have
     * corresponding account values.
     *
     * @param {array of strings} permissionNames
     * @returns {array of strings}
     */
    getPermissionsWithValues: function (permissionNames) {
      var self = this;
      return permissionNames.map(function (permissionName) {
        var accountKey = PERMISSIONS_TO_KEYS[permissionName];

        // filter out permissions we do not know about
        if (! accountKey) {
          return null;
        }

        // filter out permissions for which the account does not have a value
        if (! self.has(accountKey)) {
          return null;
        }

        return permissionName;
      }).filter(function (permissionName) {
        return permissionName !== null;
      });
    },

    getMarketingEmailPrefs: function () {
      var self = this;

      var emailPrefs = new MarketingEmailPrefs({
        account: self,
        marketingEmailClient: self._marketingEmailClient
      });

      return emailPrefs;
    },

    changePassword: function (oldPassword, newPassword, relier) {
      // Try to sign the user in before checking whether the
      // passwords are the same. If the user typed the incorrect old
      // password, they should know that first.
      var self = this;

      var fxaClient = self._fxaClient;
      var email = self.get('email');

      return fxaClient.checkPassword(email, oldPassword)
        .then(function () {
          if (oldPassword === newPassword) {
            throw AuthErrors.toError('PASSWORDS_MUST_BE_DIFFERENT');
          }

          return fxaClient.changePassword(email, oldPassword, newPassword);
        })
        .then(function () {
          // sign the user in, keeping the current sessionTokenContext. This
          // prevents sync users from seeing the `sign out` button on the
          // settings view.
          return fxaClient.signIn(
            email,
            newPassword,
            relier,
            {
              metricsContext: self._metricsContext.get(),
              reason: fxaClient.SIGNIN_REASON.PASSWORD_CHANGE,
              sessionTokenContext: self.get('sessionTokenContext')
            }
          );
        })
        .then(function (updatedSessionData) {
          self.set(updatedSessionData);
        });
    },

    /**
     * Override set to only allow fields listed in ALLOWED_FIELDS
     *
     * @method set
     */
    set: _.wrap(Backbone.Model.prototype.set, function (func, attribute, value, options) {

      var attributes;
      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (_.isObject(attribute)) {
        attributes = attribute;
      } else {
        attributes = {};
        attributes[attribute] = value;
      }

      for (var key in attributes) {
        if (! _.contains(ALLOWED_KEYS, key)) {
          throw new Error(key + ' cannot be set on an Account');
        }
      }

      return func.call(this, attribute, value, options);
    }),

    /**
     * Complete a password reset
     *
     * @param {string} password - the user's new password
     * @param {string} token - email verification token
     * @param {string} code - email verification code
     * @param {object} relier - relier being signed in to.
     * @param {object} relier - relier being signed in to.
     * @returns {promise} - resolves when complete
     */
    completePasswordReset: function (password, token, code, relier) {
      var self = this;

      var fxaClient = self._fxaClient;
      var email = self.get('email');

      return fxaClient.completePasswordReset(email, password, token, code, {
        metricsContext: self._metricsContext.get()
      })
        .then(function () {
          return fxaClient.signIn(
            email,
            password,
            relier,
            {
              metricsContext: self._metricsContext.get(),
              reason: fxaClient.SIGNIN_REASON.PASSWORD_RESET
            }
          );
        })
        .then(function (updatedSessionData) {
          self.set(updatedSessionData);
        });
    },

    /**
     * Fetch the account's device list and populate the `devices` collection.
     *
     * @param {object} devices - Devices collection
     * @returns {promise} - resolves when complete
     */
    fetchDevices: function (devices) {
      var sessionToken = this.get('sessionToken');

      return this._fxaClient.deviceList(sessionToken)
        .then(devices.set.bind(devices));
    },

    /**
     * Delete the device from the account
     *
     * @param {object} device - Device model to remove
     * @returns {promise} - resolves when complete
     *
     * @param {object} devices - Devices collection
     * @returns {promise} - resolves when complete
     */
    destroyDevice: function (device) {
      var deviceId = device.get('id');
      var sessionToken = this.get('sessionToken');

      return this._fxaClient.deviceDestroy(sessionToken, deviceId)
        .then(function () {
          device.destroy();
        });
    },

    /**
     * Initiate a password reset
     *
     * @param {object} relier
     * @param {object} [options]
     * @param {string} [options.resume] resume token
     * @returns {promise}
     */
    resetPassword: function (relier, options) {
      options = options || {};

      return this._fxaClient.passwordReset(
        this.get('email'),
        relier,
        {
          resume: options.resume
        }
      );
    },

    /**
     * Retry a password reset
     *
     * @param {string} passwordForgotToken
     * @param {object} relier
     * @param {object} [options]
     * @param {string} [options.resume] resume token
     * @returns {promise}
     */
    retryResetPassword: function (passwordForgotToken, relier, options) {
      options = options || {};

      return this._fxaClient.passwordResetResend(
        this.get('email'),
        passwordForgotToken,
        relier,
        {
          resume: options.resume
        }
      );
    },

    /**
     * Fetch keys for the account. Requires account to have
     * `keyFetchToken` and `unwrapBKey`
     *
     * @returns {promise} that resolves with the account keys, if they
     *   can be generated, resolves with null otherwise.
     */
    accountKeys: function () {
      if (! this.has('keyFetchToken') || ! this.has('unwrapBKey')) {
        return p(null);
      }

      return this._fxaClient.accountKeys(
          this.get('keyFetchToken'), this.get('unwrapBKey'));
    },

    /**
     * Fetch keys that can be used by a relier.
     *
     * @param {object} relier
     * @returns {promise} that resolves with the relier keys, if they
     *   can be generated, resolves with null otherwise.
     */
    relierKeys: function (relier) {
      var self = this;
      return this.accountKeys()
        .then(function (accountKeys) {
          if (! accountKeys) {
            return null;
          }

          return relier.deriveRelierKeys(accountKeys, self.get('uid'));
        });
    }
  }, {
    ALLOWED_KEYS: ALLOWED_KEYS,
    PERMISSIONS_TO_KEYS: PERMISSIONS_TO_KEYS
  });

  [
    'getProfile',
    'getAvatar',
    'getAvatars',
    'postAvatar',
    'deleteAvatar',
    'uploadAvatar',
    'postDisplayName'
  ]
    .forEach(function (method) {
      Account.prototype[method] = function () {
        var self = this;
        var profileClient;
        var args = Array.prototype.slice.call(arguments, 0);
        return self.profileClient()
          .then(function (client) {
            profileClient = client;
            var accessToken = self.get('accessToken');
            return profileClient[method].apply(profileClient, [accessToken].concat(args));
          })
          .fail(function (err) {
            // If no oauth token existed, or it has gone stale,
            // get a new one and retry.
            if (ProfileClient.Errors.is(err, 'UNAUTHORIZED')) {
              return self._fetchProfileOAuthToken()
                .then(function () {
                  var accessToken = self.get('accessToken');
                  return profileClient[method].apply(profileClient, [accessToken].concat(args));
                })
                .fail(function (err) {
                  if (ProfileClient.Errors.is(err, 'UNAUTHORIZED')) {
                    self.unset('accessToken');
                  }
                  throw err;
                });
            }
            throw err;
          });
      };
    });

  module.exports = Account;
});
