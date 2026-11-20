//! GitHub Actions job logs: timestamps, `##[group]`/`::error::` markers and ANSI colours, and
//! which lines belong to which step (`github-workflow-logs.ts`).

use crate::gh::WorkflowRunStep;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogColor {
    Red,
    Green,
    Yellow,
    Blue,
    Magenta,
    Cyan,
    Gray,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogLevel {
    Error,
    Warning,
    Notice,
    Debug,
    Command,
    Group,
    EndGroup,
}

impl LogLevel {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "error" => LogLevel::Error,
            "warning" => LogLevel::Warning,
            "notice" => LogLevel::Notice,
            "debug" => LogLevel::Debug,
            "command" => LogLevel::Command,
            "group" => LogLevel::Group,
            "endgroup" => LogLevel::EndGroup,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            LogLevel::Error => "error",
            LogLevel::Warning => "warning",
            LogLevel::Notice => "notice",
            LogLevel::Debug => "debug",
            LogLevel::Command => "command",
            LogLevel::Group => "group",
            LogLevel::EndGroup => "endgroup",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub text: String,
    pub color: Option<LogColor>,
    pub bold: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogLine {
    pub index: usize,
    pub timestamp: Option<String>,
    /// The line without its timestamp, markers or escape codes.
    pub text: String,
    pub level: Option<LogLevel>,
    pub segments: Vec<Segment>,
}

pub fn parse(raw: &str) -> Vec<LogLine> {
    // GitHub starts the file with a byte order mark.
    raw.trim_start_matches('\u{feff}')
        .lines()
        .enumerate()
        .map(|(index, line)| {
            let (timestamp, body) = split_timestamp(line);
            let plain = strip_ansi(body);
            let (level, text) = detect_level(&plain);
            let segments = match level {
                None => ansi_segments(body),
                Some(_) => vec![Segment { text: text.clone(), color: None, bold: false }],
            };
            LogLine { index, timestamp: timestamp.map(str::to_string), text, level, segments }
        })
        .collect()
}

/// GitHub prefixes every line with `2024-01-02T03:04:05.1234567Z `.
fn split_timestamp(line: &str) -> (Option<&str>, &str) {
    let bytes = line.as_bytes();
    let looks_like = bytes.len() >= 20
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[10] == b'T';
    if !looks_like {
        return (None, line);
    }
    match line.find('Z') {
        Some(end) if line[..end].bytes().all(|byte| byte.is_ascii_digit() || b"-T:.".contains(&byte)) => {
            let rest = &line[end + 1..];
            (Some(&line[..=end]), rest.strip_prefix(' ').unwrap_or(rest))
        }
        _ => (None, line),
    }
}

fn detect_level(text: &str) -> (Option<LogLevel>, String) {
    if let Some(rest) = text.strip_prefix("##[")
        && let Some((name, message)) = rest.split_once(']')
        && let Some(level) = LogLevel::parse(name)
    {
        return (Some(level), message.trim().to_string());
    }
    if let Some(rest) = text.strip_prefix("::")
        && let Some((head, message)) = rest.split_once("::")
        && let Some(level) = LogLevel::parse(head.split_whitespace().next().unwrap_or_default())
        && matches!(level, LogLevel::Error | LogLevel::Warning | LogLevel::Notice | LogLevel::Debug)
    {
        return (Some(level), message.trim().to_string());
    }
    if let Some(command) = text.strip_prefix("[command]") {
        return (Some(LogLevel::Command), command.to_string());
    }
    (None, text.to_string())
}

/// Splits an escape sequence `ESC [ params final` off the front of `text`.
fn escape_sequence(text: &str) -> Option<(&str, char, &str)> {
    let rest = text.strip_prefix("\x1b[")?;
    let end = rest.find(|c: char| !(c.is_ascii_digit() || c == ';' || c == '?'))?;
    let terminator = rest[end..].chars().next()?;
    Some((&rest[..end], terminator, &rest[end + terminator.len_utf8()..]))
}

pub fn strip_ansi(text: &str) -> String {
    ansi_segments(text).into_iter().map(|segment| segment.text).collect()
}

fn ansi_color(code: u32) -> Option<Option<LogColor>> {
    Some(match code {
        30 | 90 => Some(LogColor::Gray),
        31 | 91 => Some(LogColor::Red),
        32 | 92 => Some(LogColor::Green),
        33 | 93 => Some(LogColor::Yellow),
        34 | 94 => Some(LogColor::Blue),
        35 | 95 => Some(LogColor::Magenta),
        36 | 96 => Some(LogColor::Cyan),
        37 | 97 | 39 => None,
        _ => return None,
    })
}

fn ansi_segments(text: &str) -> Vec<Segment> {
    let mut segments: Vec<Segment> = Vec::new();
    let (mut color, mut bold) = (None, false);
    let mut rest = text;
    let mut push = |text: &str, color: Option<LogColor>, bold: bool| {
        if text.is_empty() {
            return;
        }
        match segments.last_mut() {
            Some(last) if last.color == color && last.bold == bold => last.text.push_str(text),
            _ => segments.push(Segment { text: text.to_string(), color, bold }),
        }
    };
    while let Some(start) = rest.find('\x1b') {
        push(&rest[..start], color, bold);
        rest = &rest[start..];
        match escape_sequence(rest) {
            Some((params, terminator, after)) => {
                if terminator == 'm' {
                    let codes: Vec<u32> = if params.is_empty() { vec![0] } else { params.split(';').filter_map(|code| code.parse().ok()).collect() };
                    for code in codes {
                        match code {
                            0 => (color, bold) = (None, false),
                            1 => bold = true,
                            22 => bold = false,
                            code => {
                                if let Some(next) = ansi_color(code) {
                                    color = next;
                                }
                            }
                        }
                    }
                }
                rest = after;
            }
            None => rest = &rest[1..],
        }
    }
    push(rest, color, bold);
    if segments.is_empty() {
        segments.push(Segment { text: String::new(), color: None, bold: false });
    }
    segments
}

fn normalize_title(value: &str) -> String {
    let mut text = value.trim().to_lowercase();
    while let Some(rest) = text.strip_prefix("run ") {
        text = rest.trim_start().to_string();
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn titles_match(group: &str, step: &str) -> bool {
    let (group, step) = (normalize_title(group), normalize_title(step));
    !group.is_empty() && !step.is_empty() && (group == step || group.starts_with(&step) || step.starts_with(&group))
}

/// The range of lines each step wrote, found by its `##[group]` header; `None` for steps that
/// left no marker.
pub fn step_ranges(lines: &[LogLine], steps: &[WorkflowRunStep]) -> Vec<Option<std::ops::Range<usize>>> {
    let mut starts: Vec<Option<usize>> = vec![None; steps.len()];
    let mut search_from = 0;
    for (step_index, step) in steps.iter().enumerate() {
        let marker = lines[search_from.min(lines.len())..]
            .iter()
            .find(|line| line.level == Some(LogLevel::Group) && titles_match(&line.text, &step.name));
        if let Some(marker) = marker {
            starts[step_index] = Some(marker.index);
            search_from = marker.index + 1;
        }
    }
    let mut ranges: Vec<Option<std::ops::Range<usize>>> = starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let start = (*start)?;
            let end = starts[index + 1..].iter().flatten().next().copied().unwrap_or(lines.len());
            Some(start..end)
        })
        .collect();
    // Lines before the first marker belong to the first step ("Set up job").
    if let (Some(None), Some(first)) = (ranges.first(), starts.iter().flatten().next())
        && *first > 0
    {
        ranges[0] = Some(0..*first);
    }
    ranges
}

/// The first error line, else the first warning: where a failed step's log opens.
pub fn first_problem(lines: &[LogLine]) -> Option<usize> {
    lines
        .iter()
        .position(|line| line.level == Some(LogLevel::Error))
        .or_else(|| lines.iter().position(|line| line.level == Some(LogLevel::Warning)))
}

/// Error and warning counts as the toolbar shows them: `2 errors · 1 warning`.
pub fn problem_label(errors: usize, warnings: usize) -> String {
    let plural = |count: usize, word: &str| format!("{count} {word}{}", if count == 1 { "" } else { "s" });
    [(errors > 0).then(|| plural(errors, "error")), (warnings > 0).then(|| plural(warnings, "warning"))].into_iter().flatten().collect::<Vec<_>>().join(" · ")
}

/// The next (or previous) problem after `current`, wrapping around (`findAdjacentProblemLine`).
pub fn adjacent_problem(problems: &[usize], current: Option<usize>, forward: bool) -> Option<usize> {
    let (first, last) = (*problems.first()?, *problems.last()?);
    let Some(current) = current else { return Some(if forward { first } else { last }) };
    let next = if forward { problems.iter().find(|line| **line > current) } else { problems.iter().rev().find(|line| **line < current) };
    Some(next.copied().unwrap_or(if forward { first } else { last }))
}

/// Whether a line matches the log filter; "error" also finds lines marked as errors.
pub fn line_matches(line: &LogLine, query: &str) -> bool {
    query.is_empty()
        || line.text.to_lowercase().contains(query)
        || line.level.is_some_and(|level| !matches!(level, LogLevel::Group | LogLevel::EndGroup) && level.name().contains(query))
}

pub fn format_text<'a>(lines: impl IntoIterator<Item = &'a LogLine>, timestamps: bool) -> String {
    lines
        .into_iter()
        .map(|line| {
            let stamp = if timestamps { line.timestamp.as_deref().map(|stamp| format!("{stamp} ")).unwrap_or_default() } else { String::new() };
            let level = match line.level {
                Some(LogLevel::Group | LogLevel::EndGroup) | None => String::new(),
                Some(level) => format!("[{}] ", level.name()),
            };
            format!("{stamp}{level}{}", line.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The `##[group]` line each line sits under, by line index (`None` outside a group or for a group
/// line itself). GitHub never nests groups: a new group ends the previous one, `##[endgroup]`
/// ends it too.
fn group_owners(lines: &[LogLine]) -> Vec<Option<usize>> {
    let mut current = None;
    lines
        .iter()
        .map(|line| match line.level {
            Some(LogLevel::Group) => {
                current = Some(line.index);
                None
            }
            Some(LogLevel::EndGroup) => current.take(),
            _ => current,
        })
        .collect()
}

/// The group lines that fold something (`foldRanges`): a header with at least one line under it.
pub fn foldable_groups(lines: &[LogLine]) -> Vec<usize> {
    let owners = group_owners(lines);
    let mut groups: Vec<usize> = Vec::new();
    for (line, owner) in lines.iter().zip(&owners) {
        if line.level != Some(LogLevel::EndGroup) && let Some(owner) = owner && groups.last() != Some(owner) {
            groups.push(*owner);
        }
    }
    groups
}

/// The visible lines left once `##[endgroup]` markers (never drawn) and the bodies of collapsed
/// groups are taken out.
pub fn fold(lines: &[LogLine], visible: &[usize], collapsed: &std::collections::HashSet<usize>) -> Vec<usize> {
    let owners = group_owners(lines);
    visible
        .iter()
        .copied()
        .filter(|index| {
            let Some(line) = lines.get(*index) else { return false };
            line.level != Some(LogLevel::EndGroup) && !owners.get(*index).copied().flatten().is_some_and(|owner| collapsed.contains(&owner))
        })
        .collect()
}

/// A log file name for a run and its job or step (`run-<number>-<subject>.log`, anything but
/// letters, digits, `_` and `-` folded to `_`).
pub fn export_file_name(run: &str, subject: &str) -> String {
    let mut name = String::new();
    let mut in_run = false;
    for character in subject.chars() {
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            name.push(character);
            in_run = false;
        } else if !in_run {
            name.push('_');
            in_run = true;
        }
    }
    format!("run-{run}-{name}.log")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_groups() {
        let lines = parse(LOG);
        assert_eq!(foldable_groups(&lines), [1, 4]);
        let all: Vec<usize> = (0..lines.len()).collect();
        assert_eq!(fold(&lines, &all, &Default::default()), [0, 1, 2, 4, 5, 6, 7]);
        let collapsed = [4].into_iter().collect();
        assert_eq!(fold(&lines, &all, &collapsed), [0, 1, 2, 4]);
        assert_eq!(export_file_name("12", "Run cargo test / build"), "run-12-Run_cargo_test_build.log");
    }

    const LOG: &str = "2026-11-11T10:00:00.0000000Z Current runner version: '2.320.0'
2026-11-11T10:00:01.0000000Z ##[group]Run actions/checkout@v4
2026-11-11T10:00:01.1000000Z with:
2026-11-11T10:00:02.0000000Z ##[endgroup]
2026-11-11T10:00:03.0000000Z ##[group]Run cargo test
2026-11-11T10:00:04.0000000Z \x1b[1m\x1b[92m   Compiling\x1b[0m athas v0.1.0
2026-11-11T10:00:05.0000000Z ##[error]Process completed with exit code 101.
2026-11-11T10:00:06.0000000Z ::warning file=a.rs,line=1::unused import
";

    fn step(name: &str) -> WorkflowRunStep {
        WorkflowRunStep { name: name.to_string(), status: None, conclusion: None, number: None, started_at: None, completed_at: None }
    }

    #[test]
    fn parses_timestamps_levels_and_colours() {
        let lines = parse(&format!("\u{feff}{LOG}"));
        assert_eq!(lines.len(), 8);
        assert_eq!(lines[0].timestamp.as_deref(), Some("2026-11-11T10:00:00.0000000Z"));
        assert_eq!(lines[0].text, "Current runner version: '2.320.0'");
        assert_eq!(lines[1].level, Some(LogLevel::Group));
        assert_eq!(lines[1].text, "Run actions/checkout@v4");
        assert_eq!(lines[5].text, "   Compiling athas v0.1.0");
        assert_eq!(
            lines[5].segments,
            [
                Segment { text: "   Compiling".into(), color: Some(LogColor::Green), bold: true },
                Segment { text: " athas v0.1.0".into(), color: None, bold: false },
            ]
        );
        assert_eq!(lines[6].level, Some(LogLevel::Error));
        assert_eq!(lines[7].level, Some(LogLevel::Warning));
        assert_eq!(lines[7].text, "unused import");
        assert_eq!(first_problem(&lines), Some(6));
    }

    #[test]
    fn maps_lines_to_steps() {
        let lines = parse(LOG);
        let ranges = step_ranges(&lines, &[step("Set up job"), step("Run actions/checkout@v4"), step("cargo test"), step("Post")]);
        assert_eq!(ranges, [Some(0..1), Some(1..4), Some(4..8), None]);
    }

    #[test]
    fn steps_through_problems() {
        assert_eq!(problem_label(2, 1), "2 errors · 1 warning");
        assert_eq!(problem_label(0, 3), "3 warnings");
        assert_eq!(problem_label(1, 0), "1 error");
        let problems = [3, 7, 9];
        assert_eq!(adjacent_problem(&problems, None, true), Some(3));
        assert_eq!(adjacent_problem(&problems, None, false), Some(9));
        assert_eq!(adjacent_problem(&problems, Some(3), true), Some(7));
        assert_eq!(adjacent_problem(&problems, Some(9), true), Some(3));
        assert_eq!(adjacent_problem(&problems, Some(3), false), Some(9));
        assert_eq!(adjacent_problem(&problems, Some(8), false), Some(7));
        assert_eq!(adjacent_problem(&[], Some(1), true), None);
    }

    #[test]
    fn filters_and_formats() {
        let lines = parse(LOG);
        let errors: Vec<_> = lines.iter().filter(|line| line_matches(line, "error")).map(|line| line.index).collect();
        assert_eq!(errors, [6]);
        assert_eq!(format_text(&lines[6..7], false), "[error] Process completed with exit code 101.");
        assert_eq!(format_text(&lines[0..1], true), "2026-11-11T10:00:00.0000000Z Current runner version: '2.320.0'");
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m \x1b[2Kplain"), "red plain");
    }
}
