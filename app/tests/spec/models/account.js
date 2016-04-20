/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

define(function (require, exports, module) {
  'use strict';

  var Account = require('models/account');
  var Assertion = require('lib/assertion');
  var AuthErrors = require('lib/auth-errors');
  var chai = require('chai');
  var Constants = require('lib/constants');
  var Device = require('models/device');
  var Devices = require('models/devices');
  var FxaClientWrapper = require('lib/fxa-client');
  var MarketingEmailClient = require('lib/marketing-email-client');
  var OAuthClient = require('lib/oauth-client');
  var OAuthToken = require('models/oauth-token');
  var p = require('lib/promise');
  var ProfileClient = require('lib/profile-client');
  var ProfileErrors = require('lib/profile-errors');
  var Relier = require('models/reliers/relier');
  var sinon = require('sinon');

  var assert = chai.assert;

  describe('models/account', function () {
    var account;
    var assertion;
    var fxaClient;
    var marketingEmailClient;
    var oAuthClient;
    var profileClient;
    var relier;

    var CLIENT_ID = 'client_id';
    var EMAIL = 'user@example.domain';
    var PASSWORD = 'password';
    var PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQYV2P4DwABAQEAWk1v8QAAAABJRU5ErkJggg==';
    var PROFILE_CLIENT_METHODS = [
      'getAvatar',
      'getAvatars',
      'postAvatar',
      'deleteAvatar',
      'uploadAvatar'
    ];
    var SESSION_TOKEN = 'abc123';
    var UID = '6d940dd41e636cc156074109b8092f96';
    var URL = 'http://127.0.0.1:1112/avatar/example.jpg';

    beforeEach(function () {
      assertion = new Assertion();
      fxaClient = new FxaClientWrapper();
      marketingEmailClient = new MarketingEmailClient();
      oAuthClient = new OAuthClient();
      profileClient = new ProfileClient();
      relier = new Relier();

      account = new Account({
        email: EMAIL,
        uid: UID
      }, {
        assertion: assertion,
        fxaClient: fxaClient,
        marketingEmailClient: marketingEmailClient,
        oAuthClient: oAuthClient,
        oAuthClientId: CLIENT_ID,
        profileClient: profileClient
      });
    });

    afterEach(function () {
      account = null;
    });

    describe('set', function () {
      describe('`password` field on an object', function () {
        it('is not allowed', function () {
          assert.throws(function () {
            account.set({
              password: PASSWORD
            });
          });
        });
      });

      describe('`password` attribute', function () {
        it('is not allowed', function () {
          assert.throws(function () {
            account.set('password', PASSWORD);
          });
        });
      });

      describe('all other attributes', function () {
        it('is allowed', function () {
          account.set('email', EMAIL);
          account.set({
            displayName: 'name'
          });
        });
      });
    });

    describe('fetch', function () {
      it('does not fetch without a sessionToken', function () {
        return account.fetch()
          .then(function () {
            assert.isUndefined(account.get('verified'));
            assert.isUndefined(account.get('accessToken'));
            assert.isUndefined(account.get('sessionToken'));
          });
      });

      it('sets verified state', function () {
        account.set('sessionToken', SESSION_TOKEN);
        sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
          return p({ verified: true });
        });

        return account.fetch()
          .then(function () {
            assert.isTrue(account.get('verified'), 'verified');
          });
      });

      it('fails to set verified state with error', function () {
        account.set('sessionToken', SESSION_TOKEN);
        sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
          return p.reject(AuthErrors.toError('UNKNOWN_ACCOUNT'));
        });
        return account.fetch()
          .then(function () {
            assert.isTrue(fxaClient.recoveryEmailStatus.calledWith(SESSION_TOKEN));
            assert.isUndefined(account.get('verified'));
          });
      });

      it('fails to fetch with other errors', function () {
        account.set('sessionToken', SESSION_TOKEN);
        sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
          return p.reject(AuthErrors.toError('UNKNOWN_ACCOUNT'));
        });
        return account.fetch()
          .then(function () {
            assert.isUndefined(account.get('verified'));
          });
      });

    });

    describe('isVerified', function () {
      it('isVerified returns false if account is unverified', function () {
        account.set('sessionToken', SESSION_TOKEN);
        sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
          return p({ verified: false });
        });

        return account.isVerified()
          .then(function (isVerified) {
            assert.isTrue(fxaClient.recoveryEmailStatus.calledWith(SESSION_TOKEN));
            assert.isFalse(isVerified);
          });
      });

      it('isVerified fails if an error occurs', function () {
        account.set('sessionToken', SESSION_TOKEN);
        sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
          return p.reject(AuthErrors.toError('UNKNOWN_ACCOUNT'));
        });

        return account.isVerified()
          .then(assert.fail,
            function (err) {
              assert.isTrue(fxaClient.recoveryEmailStatus.calledWith(SESSION_TOKEN));
              assert.isTrue(AuthErrors.is(err, 'UNKNOWN_ACCOUNT'));
            });
      });

      it('isVerified returns true', function () {
        account.set('sessionToken', SESSION_TOKEN);
        sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
          return p({ verified: true });
        });
        return account.isVerified()
          .then(function (isVerified) {
            assert.isTrue(fxaClient.recoveryEmailStatus.calledWith(SESSION_TOKEN));
            assert.isTrue(isVerified);
          });
      });
    });

    describe('signIn', function () {
      describe('with a password', function () {
        describe('unverified account', function () {
          beforeEach(function () {
            sinon.stub(fxaClient, 'signIn', function () {
              return p({
                challengeMethod: 'email',
                challengeReason: 'signup',
                sessionToken: SESSION_TOKEN,
                verified: false
              });
            });

            sinon.stub(fxaClient, 'signUpResend', function () {
              return p();
            });

            return account.signIn(PASSWORD, relier, { resume: 'resume token' });
          });

          it('delegates to the fxaClient', function () {
            assert.isTrue(fxaClient.signIn.calledWith(EMAIL, PASSWORD, relier));
          });

          it('delegates to the fxaClient to resend a signUp email', function () {
            assert.isTrue(fxaClient.signUpResend.calledWith(
              relier,
              SESSION_TOKEN,
              {
                resume: 'resume token'
              }
            ));
          });

          it('updates the account with the returned data', function () {
            assert.equal(account.get('challengeMethod'), 'email');
            assert.equal(account.get('challengeReason'), 'signup');
            assert.equal(account.get('sessionToken'), SESSION_TOKEN);
            assert.isFalse(account.get('verified'));
          });
        });

        describe('verified account, unverified session', function () {
          beforeEach(function () {
            sinon.stub(fxaClient, 'signIn', function () {
              return p({
                challengeMethod: 'email',
                challengeReason: 'signin',
                sessionToken: SESSION_TOKEN,
                verified: false
              });
            });

            sinon.stub(fxaClient, 'signUpResend', function () {
              return p();
            });

            return account.signIn(PASSWORD, relier, { resume: 'resume token' });
          });

          it('delegates to the fxaClient', function () {
            assert.isTrue(fxaClient.signIn.calledWith(EMAIL, PASSWORD, relier));
          });

          it('does not delegate to the fxaClient to send re-confirmation email', function () {
            assert.isFalse(fxaClient.signUpResend.called);
          });

          it('updates the account with the returned data', function () {
            assert.equal(account.get('challengeMethod'), 'email');
            assert.equal(account.get('challengeReason'), 'signin');
            assert.equal(account.get('sessionToken'), SESSION_TOKEN);
            assert.isFalse(account.get('verified'));
          });
        });

        describe('verified account, verified session', function () {
          beforeEach(function () {
            sinon.stub(fxaClient, 'signIn', function () {
              return p({ sessionToken: SESSION_TOKEN, verified: true });
            });

            return account.signIn(PASSWORD, relier);
          });

          it('delegates to the fxaClient', function () {
            assert.isTrue(fxaClient.signIn.calledWith(EMAIL, PASSWORD, relier));
          });

          it('updates the account with the returned data', function () {
            assert.isTrue(account.get('verified'));
            assert.equal(account.get('sessionToken'), SESSION_TOKEN);
          });
        });

        describe('error', function () {
          var err;

          beforeEach(function () {
            sinon.stub(fxaClient, 'signIn', function () {
              return p.reject(AuthErrors.toError('UNKNOWN_ACCOUNT'));
            });

            return account.signIn(PASSWORD, relier)
              .then(
                assert.fail,
                function (_err) {
                  err = _err;
                });
          });


          it('delegates to the fxaClient', function () {
            assert.isTrue(fxaClient.signIn.calledWith(EMAIL, PASSWORD, relier));
          });

          it('propagates the error', function () {
            assert.isTrue(AuthErrors.is(err, 'UNKNOWN_ACCOUNT'));
          });
        });
      });

      describe('with a sessionToken', function () {
        describe('unverified', function () {
          beforeEach(function () {
            account.set('sessionToken', SESSION_TOKEN);

            sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
              return p({ verified: false });
            });

            sinon.stub(fxaClient, 'signUpResend', function () {
              return p();
            });

            return account.signIn(null, relier);
          });

          it('delegates to the fxaClient', function () {
            assert.isTrue(
              fxaClient.recoveryEmailStatus.calledWith(SESSION_TOKEN));
          });

          it('delegates to the fxaClient to resend a signUp email', function () {
            assert.isTrue(
              fxaClient.signUpResend.calledWith(relier, SESSION_TOKEN));
          });

          it('updates the account with the returned data', function () {
            assert.isFalse(account.get('verified'));
            assert.equal(account.get('sessionToken'), SESSION_TOKEN);
          });
        });

        describe('verified', function () {
          beforeEach(function () {
            account.set('sessionToken', SESSION_TOKEN);
            sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
              return p({ verified: true });
            });

            return account.signIn(null, relier);
          });

          it('delegates to the fxaClient', function () {
            assert.isTrue(
              fxaClient.recoveryEmailStatus.calledWith(SESSION_TOKEN));
          });

          it('updates the account with the returned data', function () {
            assert.isTrue(account.get('verified'));
          });
        });

        describe('error', function () {
          var err;

          beforeEach(function () {
            account.set('sessionToken', SESSION_TOKEN);
            sinon.stub(fxaClient, 'recoveryEmailStatus', function () {
              return p.reject(AuthErrors.toError('UNKNOWN_ACCOUNT'));
            });

            return account.signIn(null, relier)
              .then(
                assert.fail,
                function (_err) {
                  err = _err;
                });
          });

          it('delegates to the fxaClient', function () {
            assert.isTrue(
              fxaClient.recoveryEmailStatus.calledWith(SESSION_TOKEN));
          });

          it('propagates the error', function () {
            assert.isTrue(AuthErrors.is(err, 'UNKNOWN_ACCOUNT'));
          });
        });

        describe('neither password nor sessionToken', function () {
          var err;

          beforeEach(function () {
            account.unset('sessionToken');

            return account.signIn(null, relier)
              .then(
                assert.fail,
                function (_err) {
                  err = _err;
                });
          });

          it('throws an `UNEXPECTED_ERROR`', function () {
            assert.isTrue(AuthErrors.is(err, 'UNEXPECTED_ERROR'));
          });
        });
      });
    });

    describe('signUp', function () {
      beforeEach(function () {
        account.set('customizeSync', true);
        sinon.stub(fxaClient, 'signUp', function () {
          return p({ sessionToken: SESSION_TOKEN, verified: false });
        });

        return account.signUp(PASSWORD, relier, { resume: 'resume token' });
      });

      it('delegates to the fxaClient', function () {
        assert.isTrue(fxaClient.signUp.calledWith(
          EMAIL,
          PASSWORD,
          relier,
          {
            customizeSync: true,
            resume: 'resume token'
          }
        ));
      });

      it('updates the account with the returned data', function () {
        assert.isFalse(account.get('verified'));
        assert.equal(account.get('sessionToken'), SESSION_TOKEN);
      });
    });

    describe('retrySignUp', function () {
      beforeEach(function () {
        account.set('sessionToken', SESSION_TOKEN);
        sinon.stub(fxaClient, 'signUpResend', function () {
          return p();
        });

        return account.retrySignUp(relier, { resume: 'resume token' });
      });

      it('delegates to the fxaClient', function () {
        assert.isTrue(fxaClient.signUpResend.calledWith(
          relier,
          SESSION_TOKEN,
          {
            resume: 'resume token'
          }
        ));
      });
    });

    describe('verifySignUp', function () {
      describe('without email opt-in', function () {
        beforeEach(function () {
          sinon.stub(fxaClient, 'verifyCode', function () {
            return p();
          });

          account.set('uid', UID);
          return account.verifySignUp('CODE');
        });

        it('delegates to the fxaClient', function () {
          assert.isTrue(fxaClient.verifyCode.calledWith(UID, 'CODE'));
        });

        it('sets the `verified` flag', function () {
          assert.isTrue(account.get('verified'));
        });
      });

      describe('with email opt-in', function () {
        var mockEmailPrefs;

        beforeEach(function () {
          sinon.stub(fxaClient, 'verifyCode', function () {
            return p();
          });

          mockEmailPrefs = {
            optIn: sinon.spy()
          };

          sinon.stub(account, 'getMarketingEmailPrefs', function () {
            return mockEmailPrefs;
          });

          account.set({
            needsOptedInToMarketingEmail: true,
            uid: UID
          });

          return account.verifySignUp('CODE');
        });

        it('delegates to the marketing email prefs', function () {
          assert.isTrue(mockEmailPrefs.optIn.called);
        });
      });
    });

    describe('signOut', function () {
      beforeEach(function () {
        sinon.stub(fxaClient, 'signOut', function () {
          return p();
        });

        account.set('sessionToken', SESSION_TOKEN);

        return account.signOut();
      });

      it('calls the correct fxaClient method', function () {
        assert.isTrue(fxaClient.signOut.calledOnce);
        assert.isTrue(fxaClient.signOut.calledWith(SESSION_TOKEN));
      });
    });

    describe('destroy', function () {
      beforeEach(function () {
        sinon.stub(fxaClient, 'deleteAccount', function () {
          return p();
        });

        sinon.spy(account, 'trigger');

        account.set({
          email: EMAIL
        });

        return account.destroy(PASSWORD);
      });

      it('delegates to the fxaClient method', function () {
        assert.isTrue(fxaClient.deleteAccount.calledWith(EMAIL, PASSWORD));
      });

      it('triggers a `destroy` message when complete', function () {
        assert.isTrue(account.trigger.calledWith('destroy', account));
      });
    });

    describe('createOAuthToken', function () {
      var accessToken = 'access token';

      beforeEach(function () {
        account.set('sessionToken', SESSION_TOKEN);
        account.set('verified', true);
        sinon.stub(assertion, 'generate', function () {
          return p('assertion');
        });
        sinon.stub(oAuthClient, 'getToken', function () {
          return p({ 'access_token': accessToken });
        });
      });

      it('can fetch an oauth access token', function () {
        return account.createOAuthToken('scope')
          .then(function (token) {
            assert.equal(token.get('token'), accessToken);
            assert.isTrue(assertion.generate.calledWith(SESSION_TOKEN));
            assert.isTrue(oAuthClient.getToken.calledWith({
              assertion: 'assertion',
              client_id: CLIENT_ID, //eslint-disable-line camelcase
              scope: 'scope'
            }));
          });
      });

      it('multiple concurrent OAuth token fetches for a single sessionToken causes a single assertion to be generated', function () {
        return p.all([
          account.createOAuthToken('scope1'),
          account.createOAuthToken('scope2')
        ]).then(function () {
          assert.equal(assertion.generate.callCount, 1);
        });
      });

      it('multiple sequential OAuth token fetches for a signle sessionToken causes a single assertion to be generated', function () {
        return account.createOAuthToken('scope1')
          .then(function () {
            return account.createOAuthToken('scope2');
          })
          .then(function () {
            assert.equal(assertion.generate.callCount, 1);
          });
      });

      it('multiple sequential OAuth token fetches for different sessionTokens causes 2 assertions to be generated', function () {
        return account.createOAuthToken('scope1')
          .then(function () {
            account.set('sessionToken', 'a different session token');
            return account.createOAuthToken('scope2');
          })
          .then(function () {
            assert.equal(assertion.generate.callCount, 2);
          });
      });


      it('fails to if bad assertion', function () {
        assertion.generate.restore();
        sinon.stub(assertion, 'generate', function () {
          return p.reject(AuthErrors.toError('UNAUTHORIZED'));
        });
        return account.createOAuthToken('scope')
          .then(assert.fail,
            function (err) {
              assert.isTrue(AuthErrors.is(err, 'UNAUTHORIZED'));
            });
      });

      it('fails to fetch when unauthorized', function () {
        oAuthClient.getToken.restore();
        sinon.stub(oAuthClient, 'getToken', function () {
          return p.reject(AuthErrors.toError('UNAUTHORIZED'));
        });
        return account.createOAuthToken('scope')
          .then(assert.fail,
            function (err) {
              assert.isTrue(AuthErrors.is(err, 'UNAUTHORIZED'));
            });
      });
    });

    describe('profileClient', function () {
      var accessToken = 'access token';

      beforeEach(function () {
        account.set('verified', true);
        sinon.stub(account, 'fetch', function () {
          return p();
        });
      });

      it('rejects if not verified', function () {
        account.set('verified', false);

        return account.profileClient()
          .then(assert.fail, function (err) {
            assert.isTrue(account.fetch.called);
            assert.isTrue(AuthErrors.is(err, 'UNVERIFIED_ACCOUNT'));
          });
      });


      it('has a profile client', function () {
        sinon.stub(account, 'createOAuthToken', function () {
          return p(new OAuthToken({ token: accessToken }));
        });
        return account.profileClient()
          .then(function (profileClient) {
            assert.ok(profileClient);
            assert.isTrue(account.createOAuthToken.called);
          });
      });

      it('profile client fails if not authorized', function () {
        sinon.stub(account, 'createOAuthToken', function () {
          return p.reject(ProfileErrors.toError('UNAUTHORIZED'));
        });
        return account.profileClient()
          .then(assert.fail, function (err) {
            assert.isTrue(ProfileErrors.is(err, 'UNAUTHORIZED'));
            assert.isTrue(account.createOAuthToken.called);
          });
      });
    });

    describe('with an access token', function () {
      var accessToken = 'token';
      beforeEach(function () {
        account.set('verified', true);
        account.set('accessToken', accessToken);
        sinon.stub(account, 'fetch', function () {
          return p();
        });
      });

      describe('avatars', function () {
        beforeEach(function () {
          sinon.stub(account, 'profileClient', function () {
            return p(profileClient);
          });
        });

        it('gets an avatar', function () {
          sinon.stub(profileClient, 'getAvatar', function () {
            return p({ avatar: URL, id: 'foo' });
          });
          return account.getAvatar()
            .then(function (result) {
              assert.isTrue(profileClient.getAvatar.calledWith(accessToken));
              assert.equal(result.avatar, URL);
              assert.equal(result.id, 'foo');
            });
        });

        it('gets avatars', function () {
          sinon.stub(profileClient, 'getAvatars', function () {
            return {
              avatars: [
                { id: 'foo', selected: true, url: URL },
                { id: 'bar', selected: false, url: 'barurl' }
              ]
            };
          });

          return account.getAvatars()
            .then(function (result) {
              assert.isTrue(profileClient.getAvatars.calledWith(accessToken));
              assert.ok(result.avatars);
              assert.equal(result.avatars.length, 2);
              assert.equal(result.avatars[0].url, URL);
            });
        });

        it('post an avatar url', function () {
          var IMG_URL = 'https://secure.gravatar.com/deadbeef';
          sinon.stub(profileClient, 'postAvatar', function () {
            return p();
          });

          return account.postAvatar(IMG_URL, true)
            .then(function () {
              assert.isTrue(profileClient.postAvatar.calledWith(accessToken, IMG_URL, true));
            });
        });

        it('delete an avatar', function () {
          var ID = 'deadbeef';
          sinon.stub(profileClient, 'deleteAvatar', function () {
            return p();
          });

          return account.deleteAvatar(ID)
            .then(function () {
              assert.isTrue(profileClient.deleteAvatar.calledWith(accessToken, ID));
            });
        });

        it('upload an image', function () {
          var DATA = 'image data';
          sinon.stub(profileClient, 'uploadAvatar', function () {
            return { url: URL };
          });

          return account.uploadAvatar(DATA)
            .then(function (result) {
              assert.isTrue(profileClient.uploadAvatar.calledWith(accessToken, DATA));
              assert.equal(result.url, URL);
            });
        });

      });
    });

    describe('with a valid sessionToken, without an access token', function () {
      beforeEach(function () {
        var tokens = 0;
        sinon.stub(account, 'fetch', function () {
          return p();
        });
        account.set('verified', true);

        sinon.stub(account, 'createOAuthToken', function () {
          // returns "token1" then "token2", etc.
          return p(new OAuthToken({ token: 'token' + (++tokens) }));
        });

      });

      PROFILE_CLIENT_METHODS.forEach(function (method) {
        it('retries on ' + method, function () {
          sinon.stub(profileClient, method, function () {
            return p.reject(ProfileClient.Errors.toError('UNAUTHORIZED'));
          });
          return account[method]()
            .then(
              assert.fail,
              function (err) {
                assert.isTrue(account.createOAuthToken.calledTwice);
                assert.isTrue(profileClient[method].calledTwice);
                assert.isTrue(ProfileClient.Errors.is(err, 'UNAUTHORIZED'));
                assert.isUndefined(account.get('accessToken'));
              }
            );
        });

        it('retries and succeeds on ' + method, function () {
          sinon.stub(profileClient, method, function (token) {
            if (token === 'token1') {
              return p.reject(ProfileClient.Errors.toError('UNAUTHORIZED'));
            } else {
              return p();
            }
          });
          return account[method]()
            .then(
              function () {
                assert.isTrue(account.createOAuthToken.calledTwice);
                assert.isTrue(profileClient[method].calledTwice);
                assert.equal(account.get('accessToken'), 'token2');
              }
            );
        });

        it('throws other errors on ' + method, function () {
          sinon.stub(profileClient, method, function () {
            return p.reject(ProfileClient.Errors.toError('UNKNOWN_ACCOUNT'));
          });
          return account[method]()
            .then(
              assert.fail,
              function (err) {
                assert.isTrue(ProfileClient.Errors.is(err, 'UNKNOWN_ACCOUNT'));
                assert.isTrue(account.createOAuthToken.calledOnce);
                assert.isTrue(profileClient[method].calledOnce);
                assert.equal(account.get('accessToken'), 'token1');
              }
            );
        });
      });
    });

    describe('without a valid sessionToken, without an access token', function () {
      beforeEach(function () {
        sinon.stub(account, 'fetch', function () {
          return p();
        });
        account.set('verified', true);

        sinon.stub(account, 'createOAuthToken', function () {
          return p.reject(ProfileClient.Errors.toError('UNAUTHORIZED'));
        });
      });

      PROFILE_CLIENT_METHODS.forEach(function (method) {
        it('retries on ' + method, function () {
          var spy = sinon.spy(profileClient, method);
          return account[method]()
            .then(
              assert.fail,
              function (err) {
                assert.isTrue(account.createOAuthToken.calledTwice);
                assert.isFalse(spy.called);
                assert.isTrue(ProfileClient.Errors.is(err, 'UNAUTHORIZED'));
                assert.isUndefined(account.get('accessToken'));
              }
            );
        });
      });
    });

    describe('with an unverified account', function () {
      beforeEach(function () {
        sinon.stub(account, 'profileClient', function () {
          return p.reject(AuthErrors.toError('UNVERIFIED_ACCOUNT'));
        });
      });

      PROFILE_CLIENT_METHODS.forEach(function (method) {
        it('rejects on ' + method, function () {
          sinon.spy(profileClient, method);
          return account[method]()
            .then(
              assert.fail,
              function (err) {
                assert.isTrue(account.profileClient.called);
                assert.isFalse(profileClient[method].called);
                assert.isTrue(AuthErrors.is(err, 'UNVERIFIED_ACCOUNT'));
              }
            );
        });
      });
    });


    it('isFromSync returns true in the right context', function () {
      account.set('sessionTokenContext', Constants.SESSION_TOKEN_USED_FOR_SYNC);
      assert.isTrue(account.isFromSync());
    });

    it('isFromSync returns false in the wrong context', function () {
      account.set('sessionTokenContext', 'foo');
      assert.isFalse(account.isFromSync());
    });

    describe('initialization', function () {
      describe('with all valid keys', function () {
        beforeEach(function () {
          account = new Account({
            email: EMAIL,
            sessionToken: SESSION_TOKEN,
            uid: UID
          });
        });

        it('sets the data', function () {
          assert.ok(account.get('email'));
          assert.isFalse(account.has('foo'));
        });
      });

      describe('with no data', function () {
        beforeEach(function () {
          account = new Account();
        });

        it('is fine', function () {
          assert.isUndefined(account.get('email'));
        });
      });

      describe('with an invalid field', function () {
        var err;

        beforeEach(function () {
          try {
            account = new Account({ foo: 'foo' });
          } catch (_err) {
            err = _err;
          }
        });

        it('throws', function () {
          assert.equal(err.message, 'foo cannot be set on an Account');
        });
      });
    });

    describe('set', function () {
      beforeEach(function () {
        account = new Account({});
      });

      describe('with an object with all valid keys', function () {
        beforeEach(function () {
          account.set({
            displayName: 'fx user',
            email: 'a@a.com'
          });
        });

        it('succeeds', function () {
          assert.equal(account.get('displayName'), 'fx user');
          assert.equal(account.get('email'), 'a@a.com');
        });
      });

      describe('with an object with an invalid keys', function () {
        var err;

        beforeEach(function () {
          try {
            account.set({
              displayName: 'fx user',
              email: 'a@a.com',
              foo: 'foo'
            });
          } catch (_err) {
            err = _err;
          }
        });

        it('throws', function () {
          assert.equal(err.message, 'foo cannot be set on an Account');
        });
      });

      describe('with a valid key/value', function () {
        beforeEach(function () {
          account.set('displayName', 'fx user');
        });

        it('succeeds', function () {
          assert.equal(account.get('displayName'), 'fx user');
        });
      });

      describe('with an invalid key/value', function () {
        var err;

        beforeEach(function () {
          try {
            account.set('foo', 'foo');
          } catch (_err) {
            err = _err;
          }
        });

        it('throws', function () {
          assert.equal(err.message, 'foo cannot be set on an Account');
        });
      });
    });

    describe('toJSON', function () {
      it('is disabled and throws', function () {
        // toJSOn is disabled to avoid unintentional data leaks. Use pick
        assert.throws(function () {
          account.toJSON();
        });
      });
    });

    it('toPersistentJSON returns data for the right keys', function () {
      account = new Account({
        accessToken: 'token',
        email: EMAIL,
        grantedPermissions: {
          'some-client-id': [
            'profile:email',
            'profile:uid'
          ]
        },
        sessionToken: SESSION_TOKEN,
        uid: UID
      }, {
        assertion: 'test'
      });

      var data = account.toPersistentJSON();

      assert.isUndefined(data.accountData);
      assert.isUndefined(data.assertion);
      assert.isUndefined(data.foo);
      assert.isUndefined(data.accessToken);
      assert.ok(data.email);
      // grantedPermissions are converted to permissions
      assert.isUndefined(data.grantedPermissions);
      assert.ok(data.permissions);
      assert.isTrue(data.permissions['some-client-id']['profile:email']);
    });

    describe('isDefault', function () {
      it('true for empty account', function () {
        assert.isTrue(new Account().isDefault());
      });

      it('true for account with data that is not in one of its allowed keys', function () {
        assert.isTrue(new Account({}, { assertion: 'blah' }).isDefault());
      });

      it('not true for account with data', function () {
        assert.isFalse(new Account({ email: 'a@a.com' }).isDefault());
      });
    });

    describe('isSignedIn', function () {
      it('returns `false` if the model has no sessionToken', function () {
        account.unset('sessionToken');
        return account.isSignedIn()
          .then(function (isSignedIn) {
            assert.isFalse(isSignedIn);
          });
      });

      it('returns `false` if the sessionToken is expired', function () {
        account.set('sessionToken', 'exipred token');
        sinon.stub(fxaClient, 'sessionStatus', function () {
          return p.reject(AuthErrors.toError('INVALID_TOKEN'));
        });

        return account.isSignedIn()
          .then(function (isSignedIn) {
            assert.isFalse(isSignedIn);
          });
      });

      it('returns `true` if the sessionToken is valid', function () {
        account.set('sessionToken', 'valid token');
        sinon.stub(fxaClient, 'sessionStatus', function () {
          return p();
        });

        return account.isSignedIn()
          .then(function (isSignedIn) {
            assert.isTrue(isSignedIn);
          });
      });
    });

    describe('fetchCurrentProfileImage', function () {
      it('returns profile image', function () {
        sinon.stub(account, 'getAvatar', function () {
          return p({ avatar: PNG_URL, id: 'foo' });
        });

        sinon.spy(account, 'setProfileImage');

        return account.fetchCurrentProfileImage()
          .then(function (profileImage) {
            assert.equal(profileImage.get('url'), PNG_URL);
            assert.equal(profileImage.get('id'), 'foo');
            assert.isTrue(profileImage.has('img'));
            assert.isTrue(account.get('hadProfileImageSetBefore'));
            assert.isTrue(account.setProfileImage.calledWith(profileImage));
          });
      });

      it('errors on getAvatar returns error', function () {
        sinon.stub(account, 'getAvatar', function () {
          return p.reject(ProfileErrors.toError('UNAUTHORIZED'));
        });

        return account.fetchCurrentProfileImage()
          .then(function () {
            assert.fail('Unexpected success');
          }, function (err) {
            assert.isTrue(ProfileErrors.is(err, 'UNAUTHORIZED'));
          });
      });

      it('errors on profileImage fetch returns error', function () {
        sinon.stub(account, 'getAvatar', function () {
          return p({ avatar: 'bad url', id: 'foo' });
        });

        return account.fetchCurrentProfileImage()
          .then(function () {
            assert.fail('Unexpected success');
          }, function (err) {
            assert.isTrue(ProfileErrors.is(err, 'IMAGE_LOAD_ERROR'));
          });
      });
    });

    describe('fetchProfile', function () {
      it('returns profile', function () {
        var name = 'snoopy';
        sinon.stub(account, 'getProfile', function () {
          return p({ avatar: PNG_URL, displayName: name });
        });

        sinon.spy(account, 'setProfileImage');

        return account.fetchProfile()
          .then(function () {
            assert.equal(account.get('profileImageUrl'), PNG_URL);
            assert.isTrue(account.setProfileImage.called);
            assert.equal(account.setProfileImage.args[0][0].get('url'), PNG_URL);
            assert.isTrue(account.get('hadProfileImageSetBefore'));
            assert.equal(account.get('displayName'), name);
          });
      });

      it('caches requests to avoid multiple XHR requests, as long as no account data was updated', function () {
        sinon.stub(account, 'getProfile', function () {
          return p({ avatar: PNG_URL, displayName: name });
        });

        return account.fetchProfile()
          .then(function () {
            return account.fetchProfile();
          })
          .then(function () {
            assert.equal(account.getProfile.callCount, 1);
          });
      });

      it('avoids returning stale data by re-requesting profile data if any account data was set after the initial fetch', function () {
        sinon.stub(account, 'getProfile', function () {
          return p({ avatar: PNG_URL, displayName: name });
        });

        return account.fetchProfile()
          .then(function () {
            account.set('displayName', 'test user');
            return account.fetchProfile();
          })
          .then(function () {
            assert.equal(account.getProfile.callCount, 2);
          });
      });
    });

    describe('getMarketingEmailPrefs', function () {
      it('returns a MarketingEmailPrefs instance', function () {
        assert.ok(account.getMarketingEmailPrefs());
      });
    });

    describe('changePassword', function () {
      it('returns `INCORRECT_PASSWORD` error if old password is incorrect (event if passwords are the same)', function () {
        sinon.stub(fxaClient, 'checkPassword', function () {
          return p.reject(AuthErrors.toError('INCORRECT_PASSWORD'));
        });

        return account.changePassword('bad_password', 'bad_password', relier)
          .then(assert.fail, function (err) {
            assert.isTrue(AuthErrors.is(err, 'INCORRECT_PASSWORD'));
          });
      });

      it('returns `PASSWORD_MUST_BE_DIFFERENT` error if both passwords are the same and the first password is correct', function () {
        sinon.stub(fxaClient, 'checkPassword', function () {
          return p();
        });

        return account.changePassword('password', 'password', relier)
          .then(assert.fail, function (err) {
            assert.ok(AuthErrors.is(err, 'PASSWORDS_MUST_BE_DIFFERENT'));
          });
      });

      it('changes from old to new password', function () {
        var oldPassword = 'password';
        var newPassword = 'new_password';
        account.set('sessionTokenContext', 'foo');

        sinon.stub(fxaClient, 'checkPassword', function () {
          return p();
        });

        sinon.stub(fxaClient, 'changePassword', function () {
          return p();
        });

        sinon.stub(fxaClient, 'signIn', function () {
          return p({});
        });


        return account.changePassword(oldPassword, newPassword, relier)
          .then(function () {
            assert.isTrue(fxaClient.checkPassword.calledWith(
              EMAIL, oldPassword));
            assert.isTrue(fxaClient.changePassword.calledWith(
              EMAIL, oldPassword, newPassword));
            assert.isTrue(fxaClient.signIn.calledWith(
              EMAIL,
              newPassword,
              relier,
              {
                reason: fxaClient.SIGNIN_REASON.PASSWORD_CHANGE,
                sessionTokenContext: 'foo'
              }
            ));
          });
      });
    });

    describe('completePasswordReset', function () {
      it('completes the password reset, signs the user in', function () {
        account.set('email', EMAIL);
        var token = 'token';
        var code = 'code';

        sinon.stub(fxaClient, 'signIn', function () {
          return p({
            verified: true
          });
        });
        sinon.stub(fxaClient, 'completePasswordReset', function () {
          return p(true);
        });

        return account.completePasswordReset(PASSWORD, token, code, relier)
          .then(function () {
            assert.isTrue(fxaClient.completePasswordReset.calledWith(
              EMAIL, PASSWORD, token, code));
            assert.isTrue(fxaClient.signIn.calledWith(
              EMAIL,
              PASSWORD,
              relier,
              {
                reason: fxaClient.SIGNIN_REASON.PASSWORD_RESET
              }
            ));
            // ensure data returned from fxaClient.signIn updates the account
            assert.isTrue(account.get('verified'));
          });
      });
    });

    describe('fetchDevices', function () {
      var devices;

      beforeEach(function () {
        account.set('sessionToken', SESSION_TOKEN);

        devices = new Devices([], {
          notifier: {
            on: sinon.spy()
          }
        });

        sinon.stub(fxaClient, 'deviceList', function () {
          return p([
            {
              id: 'device-1',
              isCurrentDevice: false,
              name: 'alpha'
            },
            {
              id: 'device-2',
              isCurrentDevice: true,
              name: 'beta'
            }
          ]);
        });

        return account.fetchDevices(devices);
      });

      it('fetches the device list from the back end', function () {
        assert.isTrue(fxaClient.deviceList.calledWith(SESSION_TOKEN));
      });

      it('populates the `devices` collection', function () {
        assert.equal(devices.length, 2);
      });
    });

    describe('destroyDevice', function () {
      var device;

      beforeEach(function () {
        account.set('sessionToken', SESSION_TOKEN);

        device = new Device({
          id: 'device-1',
          isCurrentDevice: true,
          name: 'alpha'
        });

        sinon.stub(fxaClient, 'deviceDestroy', function () {
          return p();
        });

        return account.destroyDevice(device);
      });

      it('tells the backend to destroy the device', function () {
        assert.isTrue(
          fxaClient.deviceDestroy.calledWith(SESSION_TOKEN, 'device-1'));
      });
    });

    describe('resetPassword', function () {
      var relier;

      beforeEach(function () {
        account.set('email', EMAIL);

        relier = {};

        sinon.stub(fxaClient, 'passwordReset', function () {
          return p();
        });

        return account.resetPassword(relier, {
          resume: 'resume token'
        });
      });

      it('delegates to the fxaClient', function () {
        assert.isTrue(fxaClient.passwordReset.calledOnce);
        assert.isTrue(fxaClient.passwordReset.calledWith(
          EMAIL,
          relier,
          {
            resume: 'resume token'
          }
        ));
      });
    });

    describe('retryResetPassword', function () {
      var relier;

      beforeEach(function () {
        account.set('email', EMAIL);

        relier = {};

        sinon.stub(fxaClient, 'passwordResetResend', function () {
          return p();
        });

        return account.retryResetPassword('password forgot token', relier, {
          resume: 'resume token'
        });
      });

      it('delegates to the fxaClient', function () {
        assert.isTrue(fxaClient.passwordResetResend.calledOnce);
        assert.isTrue(fxaClient.passwordResetResend.calledWith(
          EMAIL,
          'password forgot token',
          relier,
          {
            resume: 'resume token'
          }
        ));
      });
    });

    describe('accountKeys', function () {
      function setup(accountData) {
        account.clear();
        account.set(accountData);

        sinon.stub(fxaClient, 'accountKeys', function () {
          return p('account keys');
        });

        return account.accountKeys();
      }

      describe('without a `keyFetchToken`', function () {
        var result;

        beforeEach(function () {
          return setup({ unwrapBKey: 'unwrap b key' })
            .then(function (_result) {
              result = _result;
            });
        });

        it('resolves to null', function () {
          assert.isNull(result);
        });

        it('does not delegate to the fxaClient', function () {
          assert.isFalse(fxaClient.accountKeys.called);
        });
      });

      describe('without an `unwrapBKey`', function () {
        var result;

        beforeEach(function () {
          return setup({ keyFetchToken: 'key fetch token' })
            .then(function (_result) {
              result = _result;
            });
        });

        it('resolves to null', function () {
          assert.isNull(result);
        });

        it('does not delegate to the fxaClient', function () {
          assert.isFalse(fxaClient.accountKeys.called);
        });
      });

      describe('with both a `keyFetchToken` and `unwrapBKey`', function () {
        var result;

        beforeEach(function () {
          return setup({
            keyFetchToken: 'key fetch token',
            unwrapBKey: 'unwrap b key'
          })
          .then(function (_result) {
            result = _result;
          });
        });

        it('delegates to the fxaClient', function () {
          assert.isTrue(
            fxaClient.accountKeys.calledWith('key fetch token', 'unwrap b key'));
        });

        it('resolves to the fxaClient result', function () {
          assert.equal(result, 'account keys');
        });
      });
    });

    describe('relierKeys', function () {
      describe('account keys unavailable', function () {
        var result;

        beforeEach(function () {
          sinon.stub(account, 'accountKeys', function () {
            return p(null);
          });

          return account.relierKeys(relier)
            .then(function (_result) {
              result = _result;
            });
        });

        it('returns null', function () {
          assert.isNull(result);
        });
      });

      describe('account keys available', function () {
        var result;

        beforeEach(function () {
          sinon.stub(account, 'accountKeys', function () {
            return p('account keys');
          });

          sinon.stub(relier, 'deriveRelierKeys', function () {
            return p('relier keys');
          });

          account.set('uid', 'uid');

          return account.relierKeys(relier)
            .then(function (_result) {
              result = _result;
            });
        });

        it('delegates to the relier with the account keys', function () {
          assert.isTrue(
            relier.deriveRelierKeys.calledWith('account keys', 'uid'));
        });

        it('resolves to the relier result', function () {
          assert.equal(result, 'relier keys');
        });
      });
    });

    describe('setClientPermissions/getClientPermissions/getClientPermission', function () {
      var savedPermissions = {
        'profile:display_name': false,
        'profile:email': true
      };

      beforeEach(function () {
        account.setClientPermissions(CLIENT_ID, savedPermissions);
      });

      describe('getClientPermissions', function () {
        var clientPermissions;

        beforeEach(function () {
          clientPermissions = account.getClientPermissions(CLIENT_ID);
        });

        it('returns the permissions for a client', function () {
          assert.deepEqual(clientPermissions, savedPermissions);
        });

        it('returns `{}` if client has no permissions', function () {
          assert.deepEqual(account.getClientPermissions('unknown'), {});
        });
      });

      describe('getClientPermission', function () {
        it('returns the permissions for a client', function () {
          assert.isFalse(account.getClientPermission(
                CLIENT_ID, 'profile:display_name'));
          assert.isTrue(account.getClientPermission(
                CLIENT_ID, 'profile:email'));
        });

        it('returns `undefined` if client has no permissions', function () {
          assert.isUndefined(account.getClientPermission(
                'unknown', 'profile:email'));
        });

        it('returns `undefined` if permissions is not found', function () {
          assert.isUndefined(account.getClientPermission(
                CLIENT_ID, 'unknown'));
        });
      });
    });

    describe('hasSeenPermissions', function () {
      beforeEach(function () {
        var savedPermissions = {
          'profile:display_name': false,
          'profile:email': true
        };
        account.setClientPermissions(CLIENT_ID, savedPermissions);
      });

      describe('if the client has seen all the permissions', function () {
        it('returns true', function () {
          assert.isTrue(account.hasSeenPermissions(CLIENT_ID, ['profile:display_name']));
          assert.isTrue(account.hasSeenPermissions(CLIENT_ID, ['profile:display_name', 'profile:email']));
        });
      });

      describe('if the client has not seen all the permissions', function () {
        it('returns false', function () {
          assert.isFalse(account.hasSeenPermissions(CLIENT_ID, ['profile:display_name', 'profile:email', 'profile:uid']));
        });
      });
    });

    describe('getPermissionsWithValues', function () {
      var permissions;

      beforeEach(function () {
        account.clear();
        account.set({
          displayName: 'Test user',
          email: 'testuser@testuser.com',
          uid: 'users id'
        });
      });

      describe('with known about permissions', function () {
        beforeEach(function () {
          permissions = account.getPermissionsWithValues([
            'profile:email',
            'profile:display_name',
            'profile:avatar',
            'profile:uid'
          ]);
        });

        it('returns requested permissions if the account has a value', function () {
          assert.equal(permissions.length, 3);

          assert.equal(permissions[0], 'profile:email');
          assert.equal(permissions[1], 'profile:display_name');
          assert.equal(permissions[2], 'profile:uid');
        });
      });

      describe('with an unknown permission', function () {
        beforeEach(function () {
          permissions =
            account.getPermissionsWithValues([
              'profile:email',
              'profile:unknown'
            ]);
        });

        it('filters the unknown permission', function () {
          assert.lengthOf(permissions, 1);
          assert.equal(permissions[0], 'profile:email');
        });
      });
    });

    describe('_upgradeGrantedPermissions', function () {
      beforeEach(function () {
        account.set('grantedPermissions', {
          client_id: ['profile:email', 'profile:uid'] //eslint-disable-line camelcase
        });
        account._upgradeGrantedPermissions();
      });

      it('converts `grantedPermissions` to `permissions`', function () {
        var permissions = account.getClientPermissions('client_id');
        assert.lengthOf(Object.keys(permissions), 2);
        assert.isTrue(permissions['profile:email']);
        assert.isTrue(permissions['profile:uid']);
      });

      it('deletes `grantedPermissions`', function () {
        assert.isFalse(account.has('grantedPermissions'));
      });
    });

    describe('checkUidExists', function () {
      beforeEach(function () {
        account.set('uid', UID);

        sinon.stub(fxaClient, 'checkAccountExists', function () {
          return p();
        });

        return account.checkUidExists();
      });

      it('delegates to the fxaClient', function () {
        assert.isTrue(fxaClient.checkAccountExists.calledWith(UID));
      });
    });

    describe('checkEmailExists', function () {
      beforeEach(function () {
        account.set('email', EMAIL);

        sinon.stub(fxaClient, 'checkAccountExistsByEmail', function () {
          return p();
        });

        return account.checkEmailExists();
      });

      it('delegates to the fxaClient', function () {
        assert.isTrue(
            fxaClient.checkAccountExistsByEmail.calledWith(EMAIL));
      });
    });
  });
});
