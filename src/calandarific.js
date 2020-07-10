/**
 * calendarific.js - api access to calendarific.com
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const ENDPOINT = 'https://calendarific.com/api/v2/holidays?&api_key=';

const fetch = require('node-fetch');

function applyParams(req, params) {
  let result = req;
  for (const p in params) {
    result = `${result}&${p}=${params[p]}`;
  }
  return result;
}

function getAPIdates(from, key, country, merge, mergeContext) {
  const apiDates = [];
  if (from === 'calendarific') {
    const reqStr = applyParams(`${ENDPOINT}${key}`, {country: country,
                                                     year: new Date().getFullYear(),
                                                     type: 'national'});
    console.log(reqStr);
    fetch(reqStr)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`api response status: ${response.status} - ${response.statusText}`);
        }
        return response.json();
      })
      .then((json) => {
        if (json.response && json.response.holidays) {
          json.response.holidays.forEach((item) => {
            apiDates.push({date: item.date.iso,
                           dateType: 'holiday',
                           source: 'calandarific',
                           reason: item.name});
          });
        } else {
          console.error(JSON.stringify(json, null, 2));
          throw new Error('missing dates in response');
        }
      })
      .then(() => {
        const reqStr = applyParams(`${ENDPOINT}${key}`, {country: country,
                                                         year: new Date().getFullYear() + 1,
                                                         type: 'national'});
        console.log(reqStr);
        return fetch(reqStr);
      })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`api response status: ${response.status} - ${response.statusText}`);
        }
        return response.json();
      })
      .then((json) => {
        if (json.response && json.response.holidays) {
          json.response.holidays.forEach((item) => {
            apiDates.push({date: item.date.iso,
                           dateType: 'holiday',
                           source: 'calandarific',
                           reason: item.name});
          });
        } else {
          console.error(JSON.stringify(json, null, 2));
          throw new Error('missing dates in response');
        }
        if (merge && typeof merge === 'function') {
          merge(apiDates, mergeContext);
        }
      })
      .catch((e) => console.error(e));
  }
  return {};
}

module.exports = getAPIdates;
