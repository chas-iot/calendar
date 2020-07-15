# calendar
An addon for the Mozilla IoT Gateway that provides calendar management of the working week, holidays, and other event dates.
This is to support rules such as not switching on a wakeup alarm on public or personal holidays, or triggering an automatic light display on a birthday.

Currently, this has optional use of the holiday APIs from calendarific.com or from date.nager.at.

Please treat free API sources as an input aid rather than a reliable source of holiday data. Some governments change public holidays at short notice.
The API provider may not be able to keep up with these changes or may choose to not publish these changes to their free tier users.

## Functionality
- Provides a single device with a default name of today. The Properties for the current date are:
- - a Holiday indicator
- - a Working day indicator
- - a Description or Reason for anything special about the date or weekday name if there's nothing more specific
- - a Tag that may be useful in rules
- - the Source of the holiday (eg. API website)
- Configuration of
- - the working / non-working days of the week
- - connection details for a Holiday API provider, with a Status (readonly) to help detect and resolve mis-configuration
- - a list of future Dates
- Each date may be configured with
- - the Date in ISO format 20YY-MM-DD (required). Yes, this supports only 80 years of holidays. Invalid dates such as 2020-02-31  or 2020-99-99 will be stored and ignored and eventually expire.
- - the Date Type (required). The types are one of Working, Event, or Holiday
- - a Reason or Description (optional). Why this date is of interest, in human readable form.
- - a Tag (optional). Designed more for machine-readable processing, might be most useful with Event dates
- - the Source (readonly). Shows where the date was input from, eg. a Holiday API website
- Date Types
- - Holiday
- - Working, i.e. a reverse holiday that marks a date that is usually a non-working day to be a working day
- - Event, any other date that might need rules processing. Recommend that this is used in combination with a Tag
- Properties updated every hour to allow for different timezones and daylight savings
- - expired dates are rolled off the configuration list
- - if there are multiple entries for the same Date and Type, then the duplicates are merged
- - if there are multiple entries for the same Date with different Types, then sorted so Working is most important, then Holiday, and finally Event
- - on the Thing display, if there are multiple dates, then the Reason and Tag are filled from the most important non-blank entry.
- Supported Holiday API providers
- - https://calendarific.com/
- - https://date.nager.at/
- Criteria for further Holiday API providers
- - have completely free access or a free access tier with at least 100 requests per month
- - able to provide a rolling 12 months of holiday dates or the current calendar year and the next calendar year
- - have a reasonable selection of countries and or regions
