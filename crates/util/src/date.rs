//! Dates as the workbench prints them (`date.ts`). Each takes the current time so it can be
//! tested; callers pass `Local::now()`.

use chrono::{DateTime, Datelike, Local};

/// `formatRelativeTime` (`Intl.RelativeTimeFormat` with `numeric: "auto"`): "now",
/// "5 minutes ago", "yesterday", "last month".
pub fn format_relative_time(then: DateTime<Local>, now: DateTime<Local>) -> String {
    let seconds = (now - then).num_milliseconds() as f64 / 1000.;
    let (amount, unit) = if seconds < 60. {
        (seconds.round(), "second")
    } else if seconds < 3600. {
        ((seconds / 60.).round(), "minute")
    } else if seconds < 86_400. {
        ((seconds / 3600.).round(), "hour")
    } else if seconds < 2_592_000. {
        ((seconds / 86_400.).round(), "day")
    } else {
        ((seconds / 2_592_000.).round(), "month")
    };
    let amount = amount as i64;
    match (amount, unit) {
        (0, "second") => "now".into(),
        (1, "day") => "yesterday".into(),
        (1, "month") => "last month".into(),
        (1, unit) => format!("1 {unit} ago"),
        (amount, unit) => format!("{amount} {unit}s ago"),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AfterWeek {
    /// The date, `11/12/2026`.
    #[default]
    Date,
    Days,
    Weeks,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactRelativeOptions {
    pub after_week: AfterWeek,
    pub just_now: String,
    pub include_ago: bool,
}

impl Default for CompactRelativeOptions {
    fn default() -> Self {
        Self { after_week: AfterWeek::Date, just_now: "just now".into(), include_ago: true }
    }
}

/// `formatCompactRelativeDate`: "just now", "5m ago", "2h ago", "yesterday", "3d ago", then the
/// date (or days or weeks).
pub fn format_compact_relative_date(then: DateTime<Local>, now: DateTime<Local>, options: &CompactRelativeOptions) -> String {
    let millis = (now - then).num_milliseconds();
    let minutes = millis.div_euclid(60_000);
    let hours = millis.div_euclid(3_600_000);
    let days = millis.div_euclid(86_400_000);
    let ago = if options.include_ago { " ago" } else { "" };
    if minutes < 1 {
        options.just_now.clone()
    } else if minutes < 60 {
        format!("{minutes}m{ago}")
    } else if hours < 24 {
        format!("{hours}h{ago}")
    } else if days == 1 && options.after_week != AfterWeek::Days {
        "yesterday".into()
    } else if days < 7 || options.after_week == AfterWeek::Days {
        format!("{days}d{ago}")
    } else if options.after_week == AfterWeek::Weeks {
        format!("{}w{ago}", days / 7)
    } else {
        then.format("%-m/%-d/%Y").to_string()
    }
}

/// `formatShortDate`: "Jan 20, 2024".
pub fn format_short_date(date: DateTime<Local>) -> String {
    date.format("%b %-d, %Y").to_string()
}

/// `formatShortDateTime`: "Jan 20, 03:45 PM".
pub fn format_short_date_time(date: DateTime<Local>) -> String {
    date.format("%b %-d, %I:%M %p").to_string()
}

/// `formatTimeOfDay`: "03:45 PM".
pub fn format_time_of_day(date: DateTime<Local>) -> String {
    date.format("%I:%M %p").to_string()
}

/// `formatCalendarDateGroup`: "Today", "Yesterday", "Mar 4", or "Mar 4, 2024" in another year.
pub fn format_calendar_date_group(date: DateTime<Local>, now: DateTime<Local>) -> String {
    let (day, today) = (date.date_naive(), now.date_naive());
    if day == today {
        "Today".into()
    } else if today.pred_opt() == Some(day) {
        "Yesterday".into()
    } else if day.year() == today.year() {
        date.format("%b %-d").to_string()
    } else {
        date.format("%b %-d, %Y").to_string()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};

    use super::*;

    fn now() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 12, 15, 45, 0).unwrap()
    }

    #[test]
    fn relative_time_reads_like_intl() {
        let now = now();
        assert_eq!(format_relative_time(now, now), "now");
        assert_eq!(format_relative_time(now - Duration::seconds(30), now), "30 seconds ago");
        assert_eq!(format_relative_time(now - Duration::minutes(1), now), "1 minute ago");
        assert_eq!(format_relative_time(now - Duration::hours(3), now), "3 hours ago");
        assert_eq!(format_relative_time(now - Duration::days(1), now), "yesterday");
        assert_eq!(format_relative_time(now - Duration::days(40), now), "last month");
        assert_eq!(format_relative_time(now - Duration::days(100), now), "3 months ago");
    }

    #[test]
    fn compact_dates() {
        let now = now();
        let options = CompactRelativeOptions::default();
        let compact = |then| format_compact_relative_date(then, now, &options);
        assert_eq!(compact(now - Duration::seconds(10)), "just now");
        assert_eq!(compact(now - Duration::minutes(5)), "5m ago");
        assert_eq!(compact(now - Duration::hours(2)), "2h ago");
        assert_eq!(compact(now - Duration::hours(30)), "yesterday");
        assert_eq!(compact(now - Duration::days(3)), "3d ago");
        assert_eq!(compact(now - Duration::days(20)), "10/23/2026");
        let weeks = CompactRelativeOptions { after_week: AfterWeek::Weeks, include_ago: false, just_now: "Just now".into() };
        assert_eq!(format_compact_relative_date(now - Duration::days(20), now, &weeks), "2w");
        assert_eq!(format_compact_relative_date(now, now, &weeks), "Just now");
        let days = CompactRelativeOptions { after_week: AfterWeek::Days, ..Default::default() };
        assert_eq!(format_compact_relative_date(now - Duration::days(1), now, &days), "1d ago");
    }

    #[test]
    fn calendar_formats() {
        let now = now();
        assert_eq!(format_short_date(now), "Nov 12, 2026");
        assert_eq!(format_short_date_time(now), "Nov 12, 03:45 PM");
        assert_eq!(format_time_of_day(now), "03:45 PM");
        assert_eq!(format_calendar_date_group(now - Duration::hours(1), now), "Today");
        assert_eq!(format_calendar_date_group(now - Duration::days(1), now), "Yesterday");
        assert_eq!(format_calendar_date_group(now - Duration::days(10), now), "Nov 2");
        assert_eq!(format_calendar_date_group(now - Duration::days(400), now), "Oct 8, 2025");
    }
}
