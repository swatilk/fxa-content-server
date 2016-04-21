/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tells the server to emit the `flow.begin` activity event.

define(function (require, exports, module) {
  'use strict';

  var $ = require('jquery');

  module.exports = {
    afterRender: function () {
      var flowId = this.user.get('flowId');
      var flowBeginTime = parseInt($('body').attr('data-flow-begin'), 10);

      if (! flowBeginTime) {
        flowBeginTime = undefined;
        this.sentryMetrics.captureException(new Error('Invalid data-flow-begin attribute'));
      }

      this.metrics.logFlowBegin(flowId, flowBeginTime);
    }
  };
});
