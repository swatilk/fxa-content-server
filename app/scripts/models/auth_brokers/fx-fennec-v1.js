/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The auth broker to coordinate authenticating for Sync when
 * embedded in Firefox for Android.
 */

define(function (require, exports, module) {
  'use strict';

  var _ = require('underscore');
  var Constants = require('lib/constants');
  var Environment = require('lib/environment');
  var FxSyncWebChannelAuthenticationBroker = require('models/auth_brokers/fx-sync-web-channel');
  var NavigateBehavior = require('views/behaviors/navigate');

  var proto = FxSyncWebChannelAuthenticationBroker.prototype;

  var FxFennecV1AuthenticationBroker = FxSyncWebChannelAuthenticationBroker.extend({
    initialize: function (options) {
      proto.initialize.call(this, options);

      var environment = new Environment(this.window);
      if (environment.isFramed()) {
        this.setCapability('pushState', false);
      }
    },

    defaultBehaviors: _.extend({}, proto.defaultBehaviors, {
      afterForceAuth: new NavigateBehavior('force_auth_complete'),
      afterSignIn: new NavigateBehavior('signin_complete'),
      afterSignUpConfirmationPoll: new NavigateBehavior('signup_complete')
    }),

    defaultCapabilities: _.extend({}, proto.defaultCapabilities, {
      chooseWhatToSyncCheckbox: false,
      chooseWhatToSyncWebV1: {
        engines: Constants.DEFAULT_DECLINED_ENGINES
      },
      emailVerificationMarketingSnippet: false,
      syncPreferencesNotification: true
    }),

    type: 'fx-fennec-v1'
  });

  module.exports = FxFennecV1AuthenticationBroker;
});
