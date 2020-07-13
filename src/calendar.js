/**
 * calendar.js - calendar adapter
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const HOUR = 60 * 60 * 1000;

const getAPIdates = require('./calendarific');

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

// get the day name
// fixme - localise the day name
function getDayName() {
  // return new Intl.DateTimeFormat({weekday: 'long'}).format(new Date());
  const t = new Date().getDay();
  /* eslint-disable curly */
  if (t === 0) return 'Sunday';
  if (t === 1) return 'Monday';
  if (t === 2) return 'Tuesday';
  if (t === 3) return 'Wednesday';
  if (t === 4) return 'Thursday';
  if (t === 5) return 'Friday';
  if (t === 6) return 'Saturday';
  /* eslint-enable curly */
}

// sort, remove duplicates and other transformations required to handle dates
function normaliseDatesArray(dates, dateStr) {
  // eslint-disable-next-line curly
  if (dates.length === 0) return;

  let changed = false;

  dates.sort((a, b) => {
    if (a.date === b.date && a.dateType === b.dateType) {
      return 0;
    } else if (a.date < b.date) {
      changed = true;
      return -1;
    } else if (a.date > b.date) {
      changed = true;
      return +1;

    // note reversal of comparison, so sorting is 'working' first, then 'event', and 'holiday' last
    } else if (a.dateType > b.dateType) {
      changed = true;
      return -1;
    } else if (a.dateType < b.dateType) {
      changed = true;
      return +1;
    }
    changed = true;
    return 0;
  });

  // remove expired dates
  while (dates.length > 0 && dates[0].date < dateStr) {
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

  return changed;
}

const {
  Adapter,
  Device,
  Property,
  Database,
} = require('gateway-addon');

const manifest = require('../manifest.json');

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
  }
}

class CalendarAdapter extends Adapter {
  constructor(addonManager) {
    super(addonManager, 'CalendarAdapter', manifest.id);
    addonManager.addAdapter(this);

    const device = new CalendarDevice(this, manifest.id);
    this.handleDeviceAdded(device);

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

        // sort, and remove expired dates
        // the date checks depend on these invariants
        const dateStr = getTodayStr();
        normaliseDatesArray(this.dateList, dateStr);
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
      // save the revised data after everything else is initialised
      .then(() => this.db.saveConfig(this.config))
      .catch((e) => console.error(e));
  }

  updateCalendar() {
    const dateStr = getTodayStr();
    let changed = false;

    // if calendarific is configured and dates have not been requested today
    if (this.config.calendarific &&
      this.config.calendarific.apiKey &&
      this.config.calendarific.location &&
      dateStr > (this.config.calendarific.lastRetrieved || '1970')) {
      changed = true;
      this.config.calendarific.lastRetrieved = dateStr;
      getAPIdates('calendarific',
                  this.config.calendarific.apiKey,
                  this.config.calendarific.location,
                  this.merge,
                  this);
    }
    changed = changed || normaliseDatesArray(this.dateList, dateStr);
    changed &&
      this.db.saveConfig(this.config)
        .catch((e) => console.error(e));

    // we don't need to wait for the database save to complete before updating the gateway
    if (this.dateList.length > 0 && dateStr === this.dateList[0].date) {
      this.holiday.set(this.dateList[0].dateType === 'holiday');

      // working day calculations :)
      this.workingDay.set(
        this.dateList[0].dateType !== 'holiday' &&
        (this.dateList[0].dateType === 'working' ||
          this.workWeek[new Date().getDay()]));

      let i = 0;
      while (i < this.dateList.length && dateStr === this.dateList[i].date) {
        if (!this.reason.get() || this.reason.get() === '') {
          this.reason.set(this.dateList[i].reason || '');
        }
        if (!this.tag.get() || this.tag.get() === '') {
          this.tag.set(this.dateList[i].tag || '');
        }
        if (!this.source.get() || this.source.get() === '') {
          this.source.set(this.dateList[i].source || '');
        }
        i++;
      }
      if (this.source.get() === '') {
        this.source.set('added locally');
      }
      if (this.reason.get() === '') {
        this.reason.set(getDayName());
      }
    } else {
      this.holiday.set(false);
      this.workingDay.set(this.workWeek[new Date().getDay()]);
      this.tag.set('');
      this.source.set('');
      this.reason.set(getDayName());
    }
  }

  // passed to the dates API requester to merge any received dates into the configured dates
  merge(apiDates, that) {
    if (!that) {
      that = this;
    }
    const dateStr = getTodayStr();
    normaliseDatesArray(apiDates, dateStr);

    if (apiDates.length > 0) {
      // get a temporary list of the dates marked as holidays, otherwise it becomes too confusing
      const holidays = [];
      that.dateList && that.dateList.forEach((item, i) => {
        if (item.dateType === 'holiday') {
          holidays.push({date: item.date,
                         source: item.source,
                         reason: item.reason,
                         index: i});
        }
      });

      let apiPos = 0;
      let holPos = 0;
      let changed = false;
      while (apiPos < apiDates.length || holPos < holidays.length) {
        // check is the api date > dateList date
        if (holPos >= holidays.length ||
            apiDates[apiPos].date < holidays[holPos].date) {
          console.log('adding new holiday', JSON.stringify(apiDates[apiPos], null, 2));
          changed = true;
          that.dateList.push(apiDates[apiPos]);
          apiPos += 1;

        // check is the api date > dateList date
        } else if (apiPos > apiDates.length ||
          apiDates[apiPos].date > holidays[holPos].date) {
          // ignore manually entered dates
          if (!holidays[holPos].source || holidays[holPos].source === '') {
            holPos += 1;
          } else {
            // we need to delete from the dateList & rebuild, and restart the loop
            // this may be related to the holiday date being brought forward, so it is complicated
            console.log('deleting holiday', JSON.stringify(that.dateList[holidays[holPos].index]));
            changed = true;
            that.dateList.splice(holidays[holPos].index, 1);
            normaliseDatesArray(that.dateList);
            holidays.splice(0, holidays.length);
            that.dateList.forEach((item, i) => {
              if (item.dateType === 'holiday') {
                holidays.push({date: item.date,
                               source: item.source,
                               reason: item.reason,
                               index: i});
              }
            });
            apiPos = 0;
            holPos = 0;
          }

        // handle matching date
        } else if (apiDates[apiPos].date === holidays[holPos].date) {
          // check are minor details different
          if (apiDates[apiPos].reason !== holidays[holPos].reason ||
              apiDates[apiPos].source !== holidays[holPos].source) {
            console.log('changing date reason and source',
                        JSON.stringify(apiDates[apiPos].source, null, 2));
            changed = true;
            that.dateList[holidays[holPos].index].reason = apiDates[apiPos].reason;
            that.dateList[holidays[holPos].index].source = apiDates[apiPos].source;
          }

          // don't increment the apiPos because there may be duplicate dates in the holidays array
          // these dates may be duplicate but with genuinely different reasons, so this is needed
          holPos += 1;

        // not a good place to be
        } else {
          throw new Error('merge from API failed due to programming error');
        }
      }

      if (changed) {
        normaliseDatesArray(that.dateList);
        that.db.saveConfig(that.config)
          .catch((e) => console.error(e));
      }
    }
  }

}

module.exports = CalendarAdapter;
