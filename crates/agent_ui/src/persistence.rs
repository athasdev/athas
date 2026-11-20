//! Each session's transcript is saved as JSON in `<data dir>/dev.athas.gpui/sessions/<id>.json`
//! and read back when the session's view opens again.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

use crate::thread::Transcript;

/// The folder session transcripts live in.
pub fn sessions_dir() -> Option<PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    {
        dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("sessions"))
    }
    #[cfg(target_family = "wasm")]
    {
        None
    }
}

/// A session id as a file name: only characters that are safe in one.
pub(crate) fn file_name(session_id: &str) -> String {
    let safe: String = session_id.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' }).collect();
    format!("{safe}.json")
}

pub fn load(dir: &Path, session_id: &str) -> Option<Transcript> {
    let path = dir.join(file_name(session_id));
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&text) {
        Ok(transcript) => Some(transcript),
        Err(_) => {
            // The session would start empty and its next save would replace the file: keep
            // what could not be read beside it (not as `.json`, which the history would list).
            let _ = std::fs::rename(&path, path.with_extension(format!("json.unreadable-{}", crate::thread::now_ms())));
            None
        }
    }
}

/// Orders saves of the same session: each takes a number when it is asked for, and a write
/// that finishes after a newer one (a background save overtaken by a save on close) is dropped.
static SAVE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static WRITTEN: std::sync::Mutex<Option<std::collections::HashMap<String, u64>>> = std::sync::Mutex::new(None);

/// A number for a save about to be made; pass it to [`save_numbered`].
pub fn next_save() -> u64 {
    SAVE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

/// [`save`] unless a newer save of the session was already written. Writes of one session
/// never overlap.
pub fn save_numbered(dir: &Path, session_id: &str, transcript: &Transcript, number: u64) -> Result<()> {
    let mut written = WRITTEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let written = written.get_or_insert_with(Default::default);
    if written.get(session_id).is_some_and(|newest| *newest > number) {
        return Ok(());
    }
    save(dir, session_id, transcript)?;
    written.insert(session_id.to_string(), number);
    Ok(())
}

/// Writes the transcript, replacing the file in one step so a crash never leaves half of it.
pub fn save(dir: &Path, session_id: &str, transcript: &Transcript) -> Result<()> {
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let path = dir.join(file_name(session_id));
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec(transcript)?).with_context(|| format!("writing {}", temp.display()))?;
    std::fs::rename(&temp, &path).with_context(|| format!("replacing {}", path.display()))?;
    Ok(())
}

/// Deletes every `.json` file in `dir` (and half-written `.json.tmp` ones); how many went.
pub(crate) fn remove_json_files(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path.to_string_lossy();
            path.is_file() && (name.ends_with(".json") || name.ends_with(".json.tmp"))
        })
        .filter(|path| std::fs::remove_file(path).is_ok())
        .count()
}

/// Clear chat history (`clearAllChats`): every session leaves the workspace and its transcript
/// and checkpoints are deleted. Views closing with their tabs may save once more, so the files
/// are swept again once the workbench has taken the sessions away.
pub fn clear_chat_history(cx: &mut gpui::App) {
    fn sweep() {
        if let Some(dir) = sessions_dir() {
            remove_json_files(&dir);
        }
        crate::review::Store::global().forget_all();
    }
    workbench_api::clear_chat_history(cx);
    sweep();
    cx.spawn(async move |cx| {
        cx.background_executor().timer(std::time::Duration::from_secs(1)).await;
        sweep();
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_only_json_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a.json", "b.json", "c.json.tmp", "notes.txt"] {
            std::fs::write(dir.path().join(name), "{}").unwrap();
        }
        assert_eq!(remove_json_files(dir.path()), 3);
        assert!(dir.path().join("notes.txt").exists());
        assert_eq!(remove_json_files(&dir.path().join("missing")), 0);
    }
    use crate::thread::{Entry, NoticeKind, ToolCall, ToolContent, ToolKind, ToolStatus};

    #[test]
    fn transcripts_round_trip_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let mut transcript = Transcript { agent_session_id: Some("acp-1".into()), browser_auto_opened: true, ..Default::default() };
        transcript.push_user("Add a test".into(), vec!["/p/src/lib.rs".into()]);
        transcript.entries.push(Entry::ToolCall(ToolCall {
            id: "t1".into(),
            title: "Edit lib.rs".into(),
            kind: ToolKind::Edit,
            status: ToolStatus::Completed,
            content: vec![ToolContent::Diff { path: "/p/src/lib.rs".into(), old_text: None, new_text: "fn a() {}".into() }],
            ..Default::default()
        }));
        transcript.push_notice(NoticeKind::Stopped, "Stopped");
        save(dir.path(), "s/1", &transcript).unwrap();
        assert!(dir.path().join("s_1.json").exists());
        assert_eq!(load(dir.path(), "s/1"), Some(transcript));
        assert_eq!(load(dir.path(), "missing"), None);
    }

    #[test]
    fn reads_transcripts_missing_newer_fields() {
        let transcript: Transcript = serde_json::from_str(r#"{"entries":[{"type":"user","text":"hi"}]}"#).unwrap();
        assert_eq!(transcript.first_prompt(), Some("hi"));
    }
}
