/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Get metrics context metadata from the relier.
 *
 * Fields:
 *   - context: auth-broker context identifier
 *   - entrypoint: user activity entrypoint
 *   - migration: service migration identifier
 *   - service: service or oauth client identifier
 *   - utmCampaign: campaign identifier
 *   - utmContent: content identifier
 *   - utmMedium: campaign medium
 *   - utmSource: traffic source
 *   - utmTerm: search term
 */

define(function (require, exports, module) {
  'use strict';

  var _ = require('underscore');

  var KEYS = [
    'context',
    'entrypoint',
    'migration',
    'service',
    'utmCampaign',
    'utmContent',
    'utmMedium',
    'utmSource',
    'utmTerm'
  ];

  function MetricsContext (relier) {
    this._data = _.pick(relier.attributes, KEYS);
  }

  MetricsContext.prototype.get = function () {
    return _.clone(this._data);
  };

  module.exports = MetricsContext;
});
