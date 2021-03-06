/**
 * calendar.js - calendar adapter
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const HOUR = 60 * 60 * 1000;

const manifest = require('../manifest.json');
const {
  Adapter,
  Database,
  Device,
  Event,
  Property,
} = require('gateway-addon');
const getAPIdates = require('./holidayAPI');


// get the milliseconds to 1 second past the next hour
function getOffsetToHour() {
  const NOW = Date.now();
  return ((Math.floor(NOW / HOUR) + 1) * HOUR) - NOW + 1000;
}


// get the local date in ISO format
function getTodayStr() {
  const now = new Date();
  // eslint-disable-next-line max-len
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}


// sort, remove duplicates and other transformations required to handle dates
function normaliseDatesArray(dates, dateStr) {
  // eslint-disable-next-line curly
  if (dates.length === 0) return;

  let changed = false;

  // take a temporary copy of the dates array to check what what, if anything, changed
  const t = [];
  dates.forEach((val) => t.push({date: val.date, dateType: val.dateType}));

  dates.sort((a, b) => {
    if (a.date === b.date && a.dateType === b.dateType) {
      return 0;
    } else if (a.date < b.date) {
      return -1;
    } else if (a.date > b.date) {
      return +1;

    // note reversal of comparison, so sorting is 'working' first, then 'holiday', and 'event' last
    } else if (a.dateType > b.dateType) {
      return -1;
    } else if (a.dateType < b.dateType) {
      return +1;
    }
    return 0;
  });

  // remove expired dates
  while (dates.length > 0 && dates[0].date < dateStr) {
    if (dates[0].dateType === 'event - annual') {
      // increment the year and add a modified copy to the end of the array
      dates[0].date =
        `${Number.parseInt(dates[0].date.substr(0, 4)) + 1}${dates[0].date.substr(4, 6)}`;
      dates.push(dates[0]);
      // while this may unorder the dates, it will be fixed within an hour
    }
    dates.shift();
    changed = true;
  }

  // remove duplicates, fix values
  if (dates.length > 1) {
    for (let i = dates.length - 2; i >= 0; i--) {
      const a = dates[i];
      const b = dates[i + 1];
      if (a.date === b.date && a.dateType === b.dateType) {
        changed = true;
        /* eslint-disable curly */
        if (!a.reason || (a.reason && a.reason === '')) a.reason = b.reason;
        if (!a.source || (a.source && a.source === '')) a.source = b.source;
        if (!a.tag || (a.tag && a.tag === '')) a.tag = b.tag;
        /* eslint-enable curly */
        dates.splice(i + 1, 1);
      }
    }
  }

  // check for changes, with the least expensive checks first
  changed = changed || t.length !== dates.length;
  if (!changed) {
    for (let i = 0; i < t.length; i++) {
      if (t[i].date !== dates[i].date || t[i].dateType !== dates[i].dateType) {
        changed = true;
        i = t.length + 1;
      }
    }
  }

  return changed;
}


class CalendarProperty extends Property {
  get() {
    return this.value;
  }

  set(value) {
    this.setCachedValueAndNotify(value);
  }
}


class CalendarDevice extends Device {
  constructor(adapter, id) {
    super(adapter, id);
    this.name = 'Today';
    this['@type'] = ['BinarySensor'];
    this.description = 'Today';
    this.properties.set('isHoliday', new CalendarProperty(this, 'isHoliday', {
      '@type': 'BooleanProperty',
      title: 'Holiday',
      type: 'boolean',
      readOnly: true,
    }));
    this.properties.set('isWorkingDay', new CalendarProperty(this, 'isWorkingDay', {
      title: 'Working Day',
      type: 'boolean',
      readOnly: true,
    }));
    this.properties.set('reason', new CalendarProperty(this, 'reason', {
      title: 'Description',
      type: 'string',
      readOnly: true,
    }));
    this.properties.set('tag', new CalendarProperty(this, 'tag', {
      title: 'Rules Tag',
      type: 'string',
      readOnly: true,
    }));
    this.properties.set('source', new CalendarProperty(this, 'source', {
      title: 'Source',
      type: 'string',
      readOnly: true,
    }));
    this.addEvent('APIerror',
                  {title: 'API error',
                   description: 'Details of an error encountered while using the Holiday API',
                   type: 'string'});
  }

  addLink(link) {
    this.links.push({rel: 'alternate',
                     mediaType: 'text/html',
                     href: link});
  }

}


class CalendarAdapter extends Adapter {
  constructor(addonManager) {
    super(addonManager, 'CalendarAdapter', manifest.id);
    addonManager.addAdapter(this);

    const device = new CalendarDevice(this, manifest.id);
    this.device = device;

    this.holiday = device.findProperty('isHoliday');
    this.workingDay = device.findProperty('isWorkingDay');
    this.reason = device.findProperty('reason');
    this.tag = device.findProperty('tag');
    this.source = device.findProperty('source');

    this.db = new Database(manifest.id);
    this.db.open()
      .then(() => {
        return this.db.loadConfig();
      })
      .then((config) => {
        this.config = config;
        config.dateList = config.dateList || [];
        this.dateList = config.dateList;

        // use a default 'Western' working week
        if (!config.workWeek) {
          // eslint-disable-next-line max-len
          config.workWeek = {day0: false, day1: true, day2: true, day3: true, day4: true, day5: true, day6: false};
          config.changed = true;
        }
        this.workWeek = [
          config.workWeek.day0,
          config.workWeek.day1,
          config.workWeek.day2,
          config.workWeek.day3,
          config.workWeek.day4,
          config.workWeek.day5,
          config.workWeek.day6,
        ];

        if (!config.api) {
          config.api = {};
          config.changed = true;
        }
        if (config.api.country && config.api.country !== config.api.country.trim()) {
          config.api.country = config.api.country.trim();
          config.changed = true;
        }
        if (config.api.region && config.api.region !== config.api.region.trim()) {
          config.api.region = config.api.region.trim();
          config.changed = true;
        }

        if (config.api.provider) {
          device.addLink(`https://${config.api.provider}`);
        }
        this.handleDeviceAdded(device);

        // sort, and remove expired dates
        // the date checks depend on these invariants
        const dateStr = getTodayStr();
        if (normaliseDatesArray(this.dateList, dateStr)) {
          config.changed = true;
        }
      })
      .then(() => {
        this.updateCalendar();

        // at 1 second past the next hour, kick off an hourly job to check is the day a holiday or
        // other special date. This is to handle the local timezone and daylight savings, if any
        setTimeout(() => {
          setInterval(() => this.updateCalendar(), HOUR);

          this.updateCalendar();
        }
        , getOffsetToHour());
      })
      .catch((e) => {
        console.error(e);
        this.device.eventNotify(new Event(this.device, 'APIerror', e.message));
      });
  }


  // hourly job to expire dates that are in the past
  // when the current date changes, check for updates from the API
  updateCalendar() {
    const dateStr = getTodayStr();

    // if the api is configured and dates have not been requested today
    const api = this.config.api;
    if (api && api.provider &&
        dateStr > (api.lastRetrieved || '1970')) {
      api.lastRetrieved = dateStr;
      this.config.changed = true;
      getAPIdates(api, this, this.merge, this.setStatus);
    }

    if (normaliseDatesArray(this.dateList, dateStr)) {
      this.config.changed = true;
    }

    if (this.config.changed) {
      delete this.config.changed;
      this.db.saveConfig(this.config)
        .then(() => console.log('updateCalendar changed config'))
        .catch((e) => {
          console.error(e);
          this.device.eventNotify(new Event(this.device, 'APIerror', e.message));
        });
    }

    // we don't need to wait for the database save to complete before updating the gateway
    let reason = '';
    let tag = '';
    let source = '';
    if (this.dateList.length > 0 && dateStr === this.dateList[0].date) {
      this.holiday.set(this.dateList[0].dateType === 'holiday');

      // working day calculations :)
      this.workingDay.set(
        this.dateList[0].dateType !== 'holiday' &&
        (this.dateList[0].dateType === 'working' ||
          this.workWeek[new Date().getDay()]));

      let i = 0;
      while (i < this.dateList.length && dateStr === this.dateList[i].date) {
        reason = reason || this.dateList[i].reason;
        tag = tag || this.dateList[i].tag;
        source = source || this.dateList[i].source;
        i++;
      }

      if ((reason || tag) && !source) {
        source = 'manual input';
      }
    } else {
      this.holiday.set(false);
      this.workingDay.set(this.workWeek[new Date().getDay()]);
    }
    if (!reason) {
      reason = this.getDayName();
    }
    this.reason.set(reason);
    this.tag.set(tag);
    this.source.set(source);
  }


  // passed to the dates API requester to merge any received dates into the configured dates
  merge(apiDates, that) {
    that = that || this;
    normaliseDatesArray(apiDates, getTodayStr());

    if (apiDates.length > 0) {
      // get a temporary list of the dates marked as holidays, otherwise it becomes too confusing
      const holidays = [];
      that.dateList && that.dateList.forEach((item, i) => {
        if (item.dateType === 'holiday') {
          holidays.push({date: item.date, index: i});
        }
      });

      let apiPos = 0;
      let holPos = 0;
      while (apiPos < apiDates.length || holPos < holidays.length) {
        // check is the api date > dateList date
        if (holPos >= holidays.length ||
            (apiPos < apiDates.length &&
             apiDates[apiPos].date < holidays[holPos].date)) {
          console.log('adding new holiday',
                      JSON.stringify(apiDates[apiPos], null, 2));
          that.config.changed = true;
          that.dateList.push(apiDates[apiPos]);
          apiPos += 1;

        // check is the api date > dateList date
        } else if (apiPos >= apiDates.length ||
                   (holPos < holidays.length &&
                    apiDates[apiPos].date > holidays[holPos].date)) {
          // ignore manually entered dates
          if (apiPos < apiDates.length &&
              (!that.dateList[holidays[holPos].index].source ||
               that.dateList[holidays[holPos].index].source === '')) {
            holPos += 1;
          } else {
            // we need to delete from the dateList & rebuild, and restart the loop
            // this may be related to the holiday date being brought forward, so it is complicated
            console.log('deleting holiday',
                        JSON.stringify(that.dateList[holidays[holPos].index], null, 2));
            that.config.changed = true;
            that.dateList.splice(holidays[holPos].index, 1);

            // delete all element then re-create
            holidays.splice(0, holidays.length);
            normaliseDatesArray(that.dateList);
            that.dateList.forEach((item, i) => {
              if (item.dateType === 'holiday') {
                holidays.push({date: item.date, index: i});
              }
            });
            apiPos = 0;
            holPos = 0;
          }

        // handle matching date
        } else if (apiDates[apiPos].date === holidays[holPos].date) {
          // check are minor details different
          if (apiDates[apiPos].reason !== that.dateList[holidays[holPos].index].reason) {
            that.config.changed = true;
            that.dateList[holidays[holPos].index].reason = apiDates[apiPos].reason;
            console.log('changing date reason',
                        JSON.stringify(that.dateList[holidays[holPos].index], null, 2));
          }
          if (apiDates[apiPos].source !== that.dateList[holidays[holPos].index].source) {
            that.config.changed = true;
            that.dateList[holidays[holPos].index].source = apiDates[apiPos].source;
            console.log('changing date source',
                        JSON.stringify(that.dateList[holidays[holPos].index], null, 2));
          }
          holPos += 1;
          apiPos += 1;

        // not a good place to be
        } else {
          const message = 'merge from API failed due to programming error';
          console.error(message);
          that.config.api.status = message;
          that.device.eventNotify(new Event(that.device, 'APIerror', message));
          that.config.changed = true;
          holPos = holidays.length;
          apiPos = apiDates.length;
        }
      }
    }

    if (that.config.changed) {
      normaliseDatesArray(that.dateList);
      delete that.config.changed;
      that.db.saveConfig(that.config)
        .then(() => console.log('merge/getAPIdates changed config'))
        .catch((e) => {
          console.error(e);
          that.device.eventNotify(new Event(that.device, 'APIerror', e.message));
        });
    }
  }


  // passed to the dates API requester to allow it to update the status
  setStatus(message, that) {
    if (message) {
      that = that || this;
      if (message.toUpperCase() !== 'OK') {
        that.device.eventNotify(new Event(that.device, 'APIerror', message));
      }
      that.config.api.status = message;
      that.config.changed = true;
    }
  }


  // get the day name
  getDayName() {
    return new Date().toLocaleDateString(this.preferences.language, {weekday: 'long'});
  }


}

module.exports = CalendarAdapter;
