// Plus2 only (ESP32 + PSRAM): the C library sits in IRAM there, and the full newlib mktime() (with its
// time-zone tables) does not fit any more. The only caller is M5Unified's RTC_Class::setSystemTimeFromRtc(),
// which sets TZ=GMT0 just before calling it, so a plain UTC mktime() (= timegm) gives the same result.
// The S3 build keeps the normal C library mktime().
#include <sdkconfig.h>
#if CONFIG_IDF_TARGET_ESP32
#include <time.h>

static long long panoDaysFromCivil(long long y, unsigned m, unsigned d) {   // m 1..12, days since 1970-01-01
  y -= m <= 2;
  const long long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (long long)doe - 719468;
}

time_t mktime(struct tm* t) {
  long long mon = t->tm_mon, year = (long long)t->tm_year + 1900;
  year += mon / 12; mon %= 12; if (mon < 0) { mon += 12; --year; }
  const long long days = panoDaysFromCivil(year, (unsigned)mon + 1, 1) + (t->tm_mday - 1);
  const long long secs = days * 86400LL + (long long)t->tm_hour * 3600 + (long long)t->tm_min * 60 + t->tm_sec;
  long long dd = secs >= 0 ? secs / 86400 : (secs - 86399) / 86400;            // normalize the fields like mktime()
  long long rem = secs - dd * 86400;
  t->tm_hour = (int)(rem / 3600); t->tm_min = (int)(rem % 3600 / 60); t->tm_sec = (int)(rem % 60);
  t->tm_wday = (int)((dd % 7 + 11) % 7);                                        // 1970-01-01 was a Thursday
  long long z = dd + 719468, era = (z >= 0 ? z : z - 146096) / 146097;
  unsigned doe = (unsigned)(z - era * 146097), yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long long y = (long long)yoe + era * 400; unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  unsigned mp = (5 * doy + 2) / 153, d = doy - (153 * mp + 2) / 5 + 1, m = mp < 10 ? mp + 3 : mp - 9;
  y += m <= 2;
  t->tm_year = (int)(y - 1900); t->tm_mon = (int)m - 1; t->tm_mday = (int)d;
  t->tm_yday = (int)(dd - panoDaysFromCivil(y, 1, 1));
  t->tm_isdst = 0;
  return (time_t)secs;
}
#endif
