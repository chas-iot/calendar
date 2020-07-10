/**
 * calendar.js - calendar adapter
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const HOUR = 60 * 60 * 1000;

const getAPIdates = require('./calandarific');

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

function normaliseDatesArray(dates, dateStr) {
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
    } else if (a.dateType < b.dateType) {
      changed = true;
      return -1;
    } else if (a.dateType > b.dateType) {
      changed = true;
      return +1;
    }
    changed = true;
    return 0;
  });
  while (dates[0].date < dateStr) {
    dates.shift();
    changed = true;
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
  setTo(value) {
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
      title: 'Reason',
      type: 'string',
      readOnly: true,
    }));
    this.properties.set('tag', new CalendarProperty(this, 'tag', {
      title: 'Rules Tag',
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

    this.db = new Database(manifest.id);
    this.db.open()
      .then(() => {
        return this.db.loadConfig();
      })
      .then((config) => {
        this.config = config;

        // use a default 'Western' working week
        if (!config.workWeek) {
          // eslint-disable-next-line max-len
          config.workWeek = {day0: false, day1: true, day2: true, day3: true, day4: true, day5: true, day6: false};
        }
        if (!config.dateList) {
          config.dateList = [{date: '2099-01-01'}];
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
        this.dateList = config.dateList;

        // sort, and remove expired dates
        // the date checks depend on these invariants
        // would be nice to deal with duplicates too
        const dateStr = getTodayStr();
        if (this.DateList && this.DateList.length > 0) {
          normaliseDatesArray(this.DateList, dateStr);

          // fixme - remove in a later version
          this.dateList.forEach((item) => {
            if (typeof item.dateType === 'number') {
            // the format has changed
            /* eslint-disable curly */
              if (item.dateType === 0) item.dateType = 'holiday';
              if (item.dateType === 1) item.dateType = 'other';
              if (item.dateType === 2) item.dateType = 'working';
            /* eslint-enable curly */
            }
            if (item.rulesTag) {
              item.tag = item.rulesTag;
              delete item.rulesTag;
            }
          });
        }
      })
      .then(() => {
        this.updateCalendar();

        // at 1 second past the next hour, kick off an hourly job to check is the day a holiday
        // or other special date this is to handle local timezone and daylight savings
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

    // if calandarific is configured
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
    if (dateStr === this.dateList[0].date) {
      this.holiday.setTo(this.dateList[0].dateType === 'holiday');

      // working day calculations :)
      this.workingDay.setTo(
        this.dateList[0].dateType !== 'holiday' &&
        (this.dateList[0].dateType === 'working' ||
          this.workWeek[new Date().getDay()]));

      this.reason.setTo(this.dateList[0].reason);
      this.tag.setTo(this.dateList[0].tag);
    } else {
      this.holiday.setTo(false);
      this.workingDay.setTo(this.workWeek[new Date().getDay()]);
      this.reason.setTo('');
      this.tag.setTo('');
    }
  }

  merge(apiDates, that) {
    if (!that) {
      that = this;
    }
    const dateStr = getTodayStr();
    normaliseDatesArray(apiDates, dateStr);

    // get a temporary list of only the dates marked as holidays, otherwise it becomes too confusing
    const holidays = [];
    that.dateList.forEach((item, i) => {
      if (item.dateType === 'holiday') {
        holidays.push({date: item.date,
                       source: item.source,
                       reason: item.reason,
                       index: i});
      }
    });

    if (apiDates.length > 0 && holidays.length > 0) {
      let apiPos = 0;
      let holPos = 0;
      let changed = false;
      while (apiPos < apiDates.length && holPos < holidays.length) {
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
          if (holidays[holPos].source === '' || !holidays[holPos].source) {
            console.log('skipping manually entered holiday');
            holPos += 1;
          } else {
            // we need to delete from the dateList & rebuild, and restart the loop
            // this may be related to the hoiday date being brought forward, so it is complicated
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

          apiPos += 1;
          holPos += 1;
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
