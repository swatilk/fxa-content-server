/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Saves state about an in-progress task in sessionStorage, and allows
// multiple tabs to coordinate on its completion.
// saved to sessionStorage and automatically loaded from sessionStorage on startup.

'use strict';

define([
  'underscore',
  'crosstab',
  'lib/promise'
], function (_, crosstab, p) {

  var NAMESPACE = '__fxa_pending_tasks';

  function waitForCrossTabInit() {
    return new p(function(resolve) {
      crosstab(resolve);
    });
  }

  var PendingTasks = {

    create: function (id, data) {
      return waitForCrossTabInit().then(function () {
        var key = NAMESPACE + '.' + id;
        localStorage.setItem(key, JSON.stringify({
          id: id,
          data: data,
          owner: crosstab.id
        }));
      });
    },

    retrieve: function (id) {
      return waitForCrossTabInit().then(function () {
        var key = NAMESPACE + '.' + id;
        var taskStr = localStorage.getItem(key);
        // If there's no task, bail out.
        if (! taskStr) {
          return p(null);
        }
        var task = JSON.parse(taskStr);
        // If the task is unowned, claim it.
        // Local storage is allegedly thread-safe so there's no chance
        // another tab as claimed it since the read above.  Allegedly...
        // XXX TODO: must wait for tabs list to populate
        if (! task.owner || ! (task.owner in crosstab.util.tabs)) {
          task.owner = crosstab.id;
          localStorage.setItem(key, JSON.stringify(task));
        }
        // If this tab owns the task, return it for processing.
        if (task.owner === crosstab.id) {
          return p(task);
        }
        // Wait for the task to complete, or the owning tab to expire.
        return p().delay(500).then(function () {
          return PendingTasks.retrieve(id);
        });
      });
    },

    update: function (id, data) {
      return waitForCrossTabInit().then(function () {
        var key = NAMESPACE + '.' + id;
        // XXX TODO: assert that it exists
        var task = JSON.parse(localStorage.getItem(key));
        task.data = _.extend(task.data, data);
        localStorage.setItem(key, JSON.stringify(task));
      });
    },

    clear: function (id) {
      return waitForCrossTabInit().then(function () {
        var key = NAMESPACE + '.' + id;
        localStorage.removeItem(key);
      });
    }

  };

  return PendingTasks;
});
