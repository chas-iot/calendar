/**
 * calendar.js - calendar adapter
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const HOUR = 60 * 60 * 1000;

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
        this.dateList.sort((a, b) => {
          if (a.date < b.date) {
            return -1;
          }
          if (a.date > b.date) {
            return +1;
          }
          return 0;
        });
        const dateStr = getTodayStr();
        while (this.dateList[0].date < dateStr) {
          this.dateList.shift();
        }
        // fixme - remove in a later version
        this.dateList.forEach((item) => {
          if (typeof item.dateType === 'number') {
            // the format has changed
            /* eslint-disable curly */
            if (item.dateType === 0) item.dateType = 'holiday';
            if (item.dateType === 1) item.dateType = 'other';
            if (item.dateType === 2) item.dateType = 'working';
            /* eslint-enable curly */
            if (item.rulesTag) {
              item.tag = item.rulesTag;
              delete item.rulesTag;
            }
          }
        });
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
    if (this.dateList[0].date < dateStr) {
      this.dateList.shift();
      this.db.saveConfig(this.config)
        .catch((e) => console.error(e));
    }
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

}

module.exports = CalendarAdapter;
