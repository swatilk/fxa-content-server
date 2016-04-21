/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

define([
  'intern',
  'intern!object',
  'tests/lib/helpers',
  'tests/functional/lib/helpers'
], function (intern, registerSuite, TestHelpers, FunctionalHelpers) {
  var config = intern.config;
  var PAGE_URL = config.fxaContentRoot + 'signin?context=fx_fennec_v1&service=sync';

  var email;
  var PASSWORD = '12345678';

  var thenify = FunctionalHelpers.thenify;

  var clearBrowserState = thenify(FunctionalHelpers.clearBrowserState);
  var createUser = FunctionalHelpers.createUser;
  var fillOutSignIn = thenify(FunctionalHelpers.fillOutSignIn);
  var openPage = thenify(FunctionalHelpers.openPage);
  var respondToWebChannelMessage = FunctionalHelpers.respondToWebChannelMessage;
  var testElementExists = FunctionalHelpers.testElementExists;
  var testIsBrowserNotified = FunctionalHelpers.testIsBrowserNotified;


  registerSuite({
    name: 'Fx Fennec Sync v1 sign_in',

    beforeEach: function () {
      email = TestHelpers.createEmail();

      return this.remote
        .then(clearBrowserState(this));
    },

    'verified': function () {
      var self = this;
      return this.remote
        .then(createUser(email, PASSWORD, { preVerified: true }))
        .then(openPage(this, PAGE_URL, '#fxa-signin-header'))
        .then(respondToWebChannelMessage(self, 'fxaccounts:can_link_account', { ok: true } ))

        .then(fillOutSignIn(this, email, PASSWORD))

        // for sync, a user must re-confirm their email address.
        .then(testElementExists('#fxa-confirm-signin-header'))

        // browser should have been notified.
        .then(testIsBrowserNotified(self, 'fxaccounts:can_link_account'))
        .then(testIsBrowserNotified(self, 'fxaccounts:login'));

      /*
         TODO - add tests to re-verify email
      .then(noSuchBrowserNotification(self, 'fxaccounts:sync_preferences'))
      // user should be able to click on a sync preferences button.
      .then(click('#sync-preferences'))

      // browser is notified of desire to open Sync preferences
      .then(testIsBrowserNotified(self, 'fxaccounts:sync_preferences'));
      */
    },

    'unverified': function () {
      var self = this;

      return this.remote
        .then(createUser(email, PASSWORD, { preVerified: false }))
        .then(openPage(this, PAGE_URL, '#fxa-signin-header'))
        .then(respondToWebChannelMessage(self, 'fxaccounts:can_link_account', { ok: true } ))

        .then(fillOutSignIn(self, email, PASSWORD))

        .then(testElementExists('#fxa-confirm-header'))

        .then(testIsBrowserNotified(self, 'fxaccounts:can_link_account'))
        .then(testIsBrowserNotified(self, 'fxaccounts:login'));
    }
  });
});
