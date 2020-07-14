/**
 * holidayAPI.js - provide access to holiday API providers
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const fetch = require('node-fetch');

function getAPIdates(api, merge, context) {
  if (api.provider === 'calendarific.com') {
    return getCalendarificDates(api, merge, context);
  } else if (api.provider === 'date.nager.at') {
    return getNagerDates(api, merge, context);
  }
  return {};
}

function getCalendarificDates(api, merge, context) {
  const ENDPOINT = 'https://calendarific.com/api/v2/holidays?&api_key=';
  const apiDates = [];
  if (!api.key) {
    api.status = `no Key configured for ${api.provider}`;
    throw new Error(`no Key configured for ${api.provider}`);
  }
  if (!api.country) {
    api.status = `no Country configured for ${api.provider}`;
    throw new Error(`no Country configured for ${api.provider}`);
  }
  const reqStr = applyParams(`${ENDPOINT}${api.key}`,
                             {type: 'national',
                              country: api.country,
                              year: new Date().getFullYear()});
  console.log(reqStr);
  fetch(reqStr)
    .then((response) => {
      if (!response.ok) {
        api.status = `api response status: ${response.status} - ${response.statusText}`;
        throw new Error(`api response status: ${response.status} - ${response.statusText}`);
      }
      return response.json();
    })
    .then((json) => {
      if (json.response && json.response.holidays) {
        json.response.holidays.forEach((item) => {
          apiDates.push({date: item.date.iso,
                         dateType: 'holiday',
                         source: api.provider,
                         reason: item.name});
        });
      } else {
        console.error(JSON.stringify(json, null, 2));
        api.status = 'missing dates in response';
        throw new Error('missing dates in response');
      }
    })
    .then(() => {
      const reqStr = applyParams(`${ENDPOINT}${api.key}`,
                                 {type: 'national',
                                  country: api.country,
                                  year: new Date().getFullYear() + 1});
      console.log(reqStr);
      return fetch(reqStr);
    })
    .then((response) => {
      if (!response.ok) {
        api.status = `api response status: ${response.status} - ${response.statusText}`;
        throw new Error(`api response status: ${response.status} - ${response.statusText}`);
      }
      return response.json();
    })
    .then((json) => {
      if (json.response && json.response.holidays) {
        json.response.holidays.forEach((item) => {
          apiDates.push({date: item.date.iso,
                         dateType: 'holiday',
                         source: api.provider,
                         reason: item.name});
        });
      } else {
        console.error(JSON.stringify(json, null, 2));
        api.status = 'missing dates in response';
        throw new Error('missing dates in response');
      }
      api.status = 'ok';
      merge(apiDates, context);
    })
    .catch((e) => console.error(e));
}

function getNagerDates(api, merge, context) {
  const ENDPOINT = 'https://date.nager.at/api/v2/publicholidays';
  const apiDates = [];
  if (!api.country) {
    api.status = `no country configured for ${api.provider}`;
    throw new Error(`no country configured for ${api.provider}`);
  }
  if (!api.region) {
    api.status = `no region configured for ${api.provider}`;
    throw new Error(`no region configured for ${api.provider}`);
  }
  const reqStr = `${ENDPOINT}/${new Date().getFullYear()}/${api.country.toUpperCase()}`;
  console.log(reqStr);
  fetch(reqStr)
    .then((response) => {
      if (!response.ok) {
        api.status = `api response status: ${response.status} - ${response.statusText}`;
        throw new Error(`api response status: ${response.status} - ${response.statusText}`);
      }
      return response.json();
    })
    .then((json) => {
      json.forEach((item) => {
        let add = item.type === 'Public';
        add = add &&
              ((!item.counties || item.counties === []) ||
               (item.counties &&
                item.counties.indexOf(api.region.toUpperCase()) > -1));
        if (add) {
          apiDates.push({date: item.date,
                         dateType: 'holiday',
                         source: api.provider,
                         reason: item.localName});
        }
      });
    })
    .then(() => {
      const reqStr = `${ENDPOINT}/${new Date().getFullYear() + 1}/${api.country.toUpperCase()}`;
      console.log(reqStr);
      return fetch(reqStr);
    })
    .then((response) => {
      if (!response.ok) {
        api.status = `api response status: ${response.status} - ${response.statusText}`;
        throw new Error(`api response status: ${response.status} - ${response.statusText}`);
      }
      return response.json();
    })
    .then((json) => {
      json.forEach((item) => {
        let add = item.type === 'Public';
        add = add &&
              ((!item.counties || item.counties === []) ||
               (item.counties &&
                item.counties.indexOf(api.region.toUpperCase()) > -1));
        if (add) {
          apiDates.push({date: item.date,
                         dateType: 'holiday',
                         source: api.provider,
                         reason: item.localName});
        }
      });
      api.status = 'ok';
      merge(apiDates, context);
    })
    .catch((e) => console.error(e));
}

function applyParams(req, params) {
  let result = req;
  for (const p in params) {
    result = `${result}&${p}=${params[p]}`;
  }
  return result;
}

module.exports = getAPIdates;
