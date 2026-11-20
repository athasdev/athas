//! Sessions worth starting in a project right now (`project-suggestions-section.tsx`), drawn from
//! its own state: uncommitted work, an unpushed branch and the newest open issues. Picking one
//! starts a session with its prompt.

use ui::IconName;

/// Issues listed before the rest are left out.
const SHOWN_ISSUES: usize = 3;

/// What the project holds now.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProjectState {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub changed_files: usize,
    pub additions: usize,
    pub deletions: usize,
    /// Open issues as (number, title, url, updated at in RFC 3339).
    pub issues: Vec<(u64, String, String, String)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Suggestion {
    pub id: String,
    pub icon: IconName,
    pub title: String,
    /// A short reading at the end of the row, such as a count.
    pub meta: Option<String>,
    pub prompt: String,
}

fn count(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

pub fn suggestions(state: &ProjectState) -> Vec<Suggestion> {
    let mut suggestions = Vec::new();
    if state.changed_files > 0 {
        suggestions.push(Suggestion {
            id: "review-changes".into(),
            icon: IconName::Eye,
            title: "Review my uncommitted changes".into(),
            meta: Some(count(state.changed_files, "file")),
            prompt: "Review my uncommitted changes. Point out bugs, risky edits and anything that needs a test.".into(),
        });
    }
    if state.ahead > 0 {
        suggestions.push(Suggestion {
            id: "describe-branch".into(),
            icon: IconName::GitCommit,
            title: format!("Write a pull request for {}", state.branch),
            meta: Some(count(state.ahead, "commit")),
            prompt: format!("Write a pull request title and description for the commits on {} that are not on its upstream yet.", state.branch),
        });
    }
    let mut issues = state.issues.clone();
    issues.sort_by(|left, right| right.3.cmp(&left.3));
    suggestions.extend(issues.into_iter().take(SHOWN_ISSUES).map(|(number, title, url, _)| Suggestion {
        id: format!("issue-{number}"),
        icon: IconName::CircleDot,
        meta: Some(format!("#{number}")),
        prompt: format!("Work on GitHub issue #{number}: {title}\n{url}\n\nRead the issue first, then propose a plan before changing code."),
        title,
    }));
    suggestions
}

/// The project's branch with how far it is ahead and behind (`↑2 ↓1`).
pub fn branch_label(state: &ProjectState) -> String {
    let mut label = state.branch.clone();
    if state.ahead > 0 {
        label.push_str(&format!(" ↑{}", state.ahead));
    }
    if state.behind > 0 {
        label.push_str(&format!(" ↓{}", state.behind));
    }
    label
}

/// `formatCompactRelativeDate` for an RFC 3339 time: "just now", "5m ago", "2h ago",
/// "yesterday", "3d ago", then `M/D/YYYY`; the text itself when it is not a time.
pub fn compact_relative_date(text: &str, now_ms: u64) -> String {
    let Ok(then) = chrono::DateTime::parse_from_rfc3339(text) else { return text.to_string() };
    let millis = now_ms as i64 - then.timestamp_millis();
    let (minutes, hours, days) = (millis.div_euclid(60_000), millis.div_euclid(3_600_000), millis.div_euclid(86_400_000));
    if minutes < 1 {
        "just now".into()
    } else if minutes < 60 {
        format!("{minutes}m ago")
    } else if hours < 24 {
        format!("{hours}h ago")
    } else if days == 1 {
        "yesterday".into()
    } else if days < 7 {
        format!("{days}d ago")
    } else {
        then.with_timezone(&chrono::Local).format("%-m/%-d/%Y").to_string()
    }
}

/// `formatFileSize`: "0 B", "512.0 B", "1.5 KB", up to GB.
pub fn format_file_size(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".into();
    }
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let unit = ((bytes as f64).ln() / 1024f64.ln()).floor().min(3.) as i32;
    format!("{:.1} {}", bytes as f64 / 1024f64.powi(unit), UNITS[unit as usize])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_from_changes_commits_and_the_newest_issues() {
        let state = ProjectState {
            branch: "feature".into(),
            ahead: 2,
            behind: 1,
            changed_files: 1,
            issues: (1..=5).map(|number| (number, format!("Issue {number}"), format!("https://x/{number}"), format!("2026-01-0{number}"))).collect(),
            ..Default::default()
        };
        let suggestions = suggestions(&state);
        let titles: Vec<&str> = suggestions.iter().map(|suggestion| suggestion.title.as_str()).collect();
        assert_eq!(titles, ["Review my uncommitted changes", "Write a pull request for feature", "Issue 5", "Issue 4", "Issue 3"]);
        assert_eq!(suggestions[0].meta.as_deref(), Some("1 file"));
        assert_eq!(suggestions[1].meta.as_deref(), Some("2 commits"));
        assert!(suggestions[2].prompt.starts_with("Work on GitHub issue #5: Issue 5\nhttps://x/5"));
        assert_eq!(branch_label(&state), "feature ↑2 ↓1");
        assert!(super::suggestions(&ProjectState::default()).is_empty());
    }

    #[test]
    fn dates_and_sizes_read_as_in_lists() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-13T12:00:00Z").unwrap().timestamp_millis() as u64;
        assert_eq!(compact_relative_date("2026-11-13T11:59:30Z", now), "just now");
        assert_eq!(compact_relative_date("2026-11-13T11:15:00Z", now), "45m ago");
        assert_eq!(compact_relative_date("2026-11-12T10:00:00Z", now), "yesterday");
        assert_eq!(compact_relative_date("2026-11-09T12:00:00Z", now), "4d ago");
        assert_eq!(compact_relative_date("soon", now), "soon");
        assert_eq!(format_file_size(0), "0 B");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(3 * 1024 * 1024 * 1024 * 1024), "3072.0 GB");
    }
}
