/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * List of reasons to verify emails
 */

define(function (require, exports, module) {
  'use strict';

  return {
    ACCOUNT_UNLOCK: 'account_unlock',
    PASSWORD_RESET: 'password_reset',
    SIGN_IN: 'sign_in',
    SIGN_UP: 'sign_up',

    /**
     * Check if the value matches the given type
     * @param {string} value
     * @param {string} type
     * @returns {boolean} true if type matches, false otw.
     */
    is: function (value, type) {
      return value === this[type];
    }
  };
});
