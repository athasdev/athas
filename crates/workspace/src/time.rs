use web_time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// How long ago `then` was, as the sidebar prints it: `now`, `3m`, `5h`, `2d`, `3w`, `4mo`, `1y`.
pub fn relative_time(then: u64, now: u64) -> String {
    let seconds = now.saturating_sub(then) / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;
    match () {
        _ if minutes < 1 => "now".to_string(),
        _ if hours < 1 => format!("{minutes}m"),
        _ if days < 1 => format!("{hours}h"),
        _ if days < 7 => format!("{days}d"),
        _ if days < 30 => format!("{}w", days / 7),
        _ if days < 365 => format!("{}mo", days / 30),
        _ => format!("{}y", days / 365),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_the_sidebar() {
        let now = 10_000_000_000;
        assert_eq!(relative_time(now - 20_000, now), "now");
        assert_eq!(relative_time(now - 3 * 60_000, now), "3m");
        assert_eq!(relative_time(now - 5 * 3_600_000, now), "5h");
        assert_eq!(relative_time(now - 26 * 3_600_000, now), "1d");
    }
}
