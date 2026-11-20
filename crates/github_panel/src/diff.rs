//! A pull request's unified diff (`application/vnd.github.v3.diff`), split per file into the
//! rows the Changes tab draws.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineKind {
    Hunk,
    Context,
    Added,
    Removed,
    /// "\ No newline at end of file" and other notes.
    Note,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: LineKind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub binary: bool,
    pub lines: Vec<DiffLine>,
}

/// Splits a whole-PR diff into its files, in order.
pub fn parse(diff: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = Vec::new();
    let (mut old_line, mut new_line) = (0u32, 0u32);
    let mut in_hunk = false;
    for line in diff.lines() {
        if let Some(header) = line.strip_prefix("diff --git ") {
            let (old_path, new_path) = split_header(header);
            files.push(FileDiff {
                status: if old_path != new_path { FileStatus::Renamed } else { FileStatus::Modified },
                old_path: (old_path != new_path).then(|| old_path.clone()),
                path: new_path,
                binary: false,
                lines: Vec::new(),
            });
            in_hunk = false;
            continue;
        }
        let Some(file) = files.last_mut() else { continue };
        if !in_hunk {
            if line.starts_with("new file mode") {
                file.status = FileStatus::Added;
            } else if line.starts_with("deleted file mode") {
                file.status = FileStatus::Deleted;
            } else if line.starts_with("Binary files") || line.starts_with("GIT binary patch") {
                file.binary = true;
            } else if let Some(from) = line.strip_prefix("rename from ") {
                file.status = FileStatus::Renamed;
                file.old_path = Some(from.to_string());
            } else if let Some(to) = line.strip_prefix("rename to ") {
                file.path = to.to_string();
            }
        }
        if line.starts_with("@@") {
            in_hunk = true;
            let (old, new) = hunk_starts(line);
            (old_line, new_line) = (old, new);
            file.lines.push(DiffLine { kind: LineKind::Hunk, old: None, new: None, text: line.to_string() });
            continue;
        }
        if !in_hunk {
            continue;
        }
        let (kind, text) = match line.as_bytes().first() {
            Some(b'+') => (LineKind::Added, &line[1..]),
            Some(b'-') => (LineKind::Removed, &line[1..]),
            Some(b'\\') => (LineKind::Note, line),
            Some(b' ') => (LineKind::Context, &line[1..]),
            _ => (LineKind::Context, line),
        };
        let (old, new) = match kind {
            LineKind::Added => (None, Some(next(&mut new_line))),
            LineKind::Removed => (Some(next(&mut old_line)), None),
            LineKind::Context => (Some(next(&mut old_line)), Some(next(&mut new_line))),
            _ => (None, None),
        };
        file.lines.push(DiffLine { kind, old, new, text: text.to_string() });
    }
    files
}

fn next(counter: &mut u32) -> u32 {
    let value = *counter;
    *counter += 1;
    value
}

/// `a/old b/new`, where either path may hold spaces; the split is the ` b/` that leaves two
/// paths of equal length when nothing was renamed.
fn split_header(header: &str) -> (String, String) {
    let header = header.trim();
    let candidates: Vec<usize> = header.match_indices(" b/").map(|(index, _)| index).collect();
    let pick = candidates
        .iter()
        .copied()
        .find(|&index| header[..index].strip_prefix("a/") == Some(&header[index + 3..]))
        .or_else(|| candidates.first().copied());
    match pick {
        Some(index) => {
            let old = header[..index].strip_prefix("a/").unwrap_or(&header[..index]);
            (old.to_string(), header[index + 3..].to_string())
        }
        None => (header.to_string(), header.to_string()),
    }
}

/// The first old and new line numbers of `@@ -a,b +c,d @@`.
fn hunk_starts(line: &str) -> (u32, u32) {
    let mut parts = line.split_whitespace().skip(1);
    let start = |part: Option<&str>, sign: char| {
        part.and_then(|part| part.strip_prefix(sign))
            .and_then(|range| range.split(',').next())
            .and_then(|start| start.parse().ok())
            .unwrap_or(1)
    };
    (start(parts.next(), '-'), start(parts.next(), '+'))
}

pub fn counts(file: &FileDiff) -> (usize, usize) {
    file.lines.iter().fold((0, 0), |(added, removed), line| match line.kind {
        LineKind::Added => (added + 1, removed),
        LineKind::Removed => (added, removed + 1),
        _ => (added, removed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFF: &str = "diff --git a/src/main.rs b/src/main.rs
index 1111111..2222222 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,4 +1,5 @@ fn main() {
 fn main() {
-    println!(\"old\");
+    println!(\"new\");
+    println!(\"more\");
 }
\\ No newline at end of file
diff --git a/docs/new file.md b/docs/new file.md
new file mode 100644
--- /dev/null
+++ b/docs/new file.md
@@ -0,0 +1,2 @@
+# Title
+text
diff --git a/old.txt b/renamed.txt
similarity index 90%
rename from old.txt
rename to renamed.txt
diff --git a/gone.bin b/gone.bin
deleted file mode 100644
Binary files a/gone.bin and /dev/null differ
";

    #[test]
    fn splits_files_and_statuses() {
        let files = parse(DIFF);
        let summary: Vec<_> = files.iter().map(|file| (file.path.as_str(), file.status, file.binary)).collect();
        assert_eq!(
            summary,
            [
                ("src/main.rs", FileStatus::Modified, false),
                ("docs/new file.md", FileStatus::Added, false),
                ("renamed.txt", FileStatus::Renamed, false),
                ("gone.bin", FileStatus::Deleted, true),
            ]
        );
        assert_eq!(files[2].old_path.as_deref(), Some("old.txt"));
        assert_eq!(files[0].old_path, None);
    }

    #[test]
    fn numbers_lines() {
        let files = parse(DIFF);
        let main = &files[0];
        assert_eq!(counts(main), (2, 1));
        let rows: Vec<_> = main.lines.iter().map(|line| (line.kind, line.old, line.new)).collect();
        assert_eq!(
            rows,
            [
                (LineKind::Hunk, None, None),
                (LineKind::Context, Some(1), Some(1)),
                (LineKind::Removed, Some(2), None),
                (LineKind::Added, None, Some(2)),
                (LineKind::Added, None, Some(3)),
                (LineKind::Context, Some(3), Some(4)),
                (LineKind::Note, None, None),
            ]
        );
        assert_eq!(main.lines[2].text, "    println!(\"old\");");
        assert_eq!(files[1].lines[1].new, Some(1));
    }

    #[test]
    fn reads_headers_with_spaces() {
        assert_eq!(split_header("a/a b/c b/a b/c"), ("a b/c".to_string(), "a b/c".to_string()));
        assert_eq!(split_header("a/x b/y"), ("x".to_string(), "y".to_string()));
        assert_eq!(hunk_starts("@@ -10,7 +12 @@"), (10, 12));
    }
}
