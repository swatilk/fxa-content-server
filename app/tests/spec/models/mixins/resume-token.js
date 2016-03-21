/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

define(function (require, exports, module) {
  'use strict';

  var Backbone = require('backbone');
  var chai = require('chai');
  var Cocktail = require('cocktail');
  var ResumeToken = require('models/resume-token');
  var ResumeTokenMixin = require('models/mixins/resume-token');
  var vat = require('lib/vat');

  var assert = chai.assert;

  describe('models/mixins/resume-token', function () {
    var model;
    var CAMPAIGN = 'deadbeef';
    var RESUME_SCHEMA = {
      campaign: vat.hex().len(8)
    };
    var VALID_RESUME_DATA = {
      campaign: CAMPAIGN,
      notResumeable: 'this should not be picked'
    };
    var INVALID_RESUME_DATA = {
      campaign: 'foo'
    };

    var Model = Backbone.Model.extend({
      initialize: function (options) {
        this.window = options.window;
      },

      resumeTokenFields: ['campaign'],

      resumeTokenSchema: RESUME_SCHEMA
    });

    Cocktail.mixin(
      Model,
      ResumeTokenMixin
    );

    beforeEach(function () {
      model = new Model({});
    });

    describe('pickResumeTokenInfo', function () {
      it('returns an object with info to be passed along with email verification links', function () {
        model.set(VALID_RESUME_DATA);

        assert.deepEqual(model.pickResumeTokenInfo(), {
          campaign: CAMPAIGN
        });
      });
    });

    describe('populateFromResumeToken with valid data', function () {
      beforeEach(function () {
        var resumeToken = new ResumeToken(VALID_RESUME_DATA);
        model.populateFromResumeToken(resumeToken);
      });

      it('populates the model with data from the ResumeToken', function () {
        assert.equal(model.get('campaign'), CAMPAIGN);
        assert.isFalse(model.has('notResumeable'), 'only allow specific resume token values');
      });
    });

    describe('populateFromResumeToken with invalid data', function () {
      beforeEach(function () {
        var resumeToken = new ResumeToken(INVALID_RESUME_DATA);
        model.populateFromResumeToken(resumeToken);
      });

      it('does not populate the model', function () {
        assert.isFalse(model.has('campaign'));
      });
    });

    describe('populateFromStringifiedResumeToken with valid data', function () {
      beforeEach(function () {
        var stringifiedResumeToken = ResumeToken.stringify(VALID_RESUME_DATA);
        model.populateFromStringifiedResumeToken(stringifiedResumeToken);
      });

      it('parses the resume param into an object', function () {
        assert.equal(model.get('campaign'), CAMPAIGN);
        assert.isFalse(model.has('notResumeable'), 'only allow specific resume token values');
      });
    });

    describe('populateFromStringifiedResumeToken with invalid data', function () {
      beforeEach(function () {
        var stringifiedResumeToken = ResumeToken.stringify(INVALID_RESUME_DATA);
        model.populateFromStringifiedResumeToken(stringifiedResumeToken);
      });

      it('does not populate the model', function () {
        assert.isFalse(model.has('campaign'));
      });
    });
  });
});
