//! A step's own change in a tab of its own (`openAcpDiffOutput`): the diffs one tool call
//! recorded, not the files against HEAD, which would mix in every other edit.

use ui::WithScrollbar as _;
use std::{collections::HashMap, path::PathBuf};

use ui::scale::px;
use gpui::{App, Context, FocusHandle, Focusable, Global, IntoElement, ParentElement, Render, Styled, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, typography};

use crate::{
    diff::{self, LineKind},
    session_view::SessionView,
};

pub const RESOURCE_KIND: &str = "agent-tool-diff";

#[derive(Clone, Debug, PartialEq)]
pub struct FileChange {
    pub path: PathBuf,
    pub old: Option<String>,
    pub new: String,
}

/// The changes opened so far, by resource id; a tab restored after a restart finds none.
#[derive(Default)]
struct ToolDiffs(HashMap<String, (Option<PathBuf>, Vec<FileChange>)>);

impl Global for ToolDiffs {}

/// `{file}.diff` for one file, `ACP changes (N)` for several.
pub fn title(changes: &[FileChange]) -> String {
    match changes {
        [one] => format!("{}.diff", one.path.file_name().map_or_else(|| "changes".to_string(), |name| name.to_string_lossy().into_owned())),
        many => format!("ACP changes ({})", many.len()),
    }
}

impl SessionView {
    /// Open diff on a step: its recorded changes in a centre tab.
    pub(crate) fn open_tool_diff(&mut self, call_id: &str, cx: &mut Context<Self>) {
        let Some(call) = self.transcript.entries.iter().find_map(|entry| match entry {
            crate::thread::Entry::ToolCall(call) if call.id == call_id => Some(call),
            _ => None,
        }) else {
            return;
        };
        let changes: Vec<FileChange> = call.diffs().map(|(path, old, new)| FileChange { path: path.clone(), old: old.map(str::to_string), new: new.to_string() }).collect();
        self.open_changes(call_id, changes, cx);
    }

    /// A Changes row: the file's net change over the session, from its state before the first
    /// edit to after the last (`openAgentSessionReview([change])`).
    pub(crate) fn open_net_diff(&mut self, path: &std::path::Path, cx: &mut Context<Self>) {
        let mut net: Option<FileChange> = None;
        for entry in &self.transcript.entries {
            let crate::thread::Entry::ToolCall(call) = entry else { continue };
            for (changed, old, new) in call.diffs() {
                if changed.as_path() != path {
                    continue;
                }
                match &mut net {
                    Some(change) => change.new = new.to_string(),
                    None => net = Some(FileChange { path: changed.clone(), old: old.map(str::to_string), new: new.to_string() }),
                }
            }
        }
        let Some(change) = net else { return };
        let key: String = path.to_string_lossy().chars().map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' }).collect();
        self.open_changes(&format!("net-{key}"), vec![change], cx);
    }

    fn open_changes(&mut self, call_id: &str, changes: Vec<FileChange>, cx: &mut Context<Self>) {
        if changes.is_empty() {
            return;
        }
        let id = format!("{}/{call_id}", self.info.id);
        let title = title(&changes);
        // One file opens in the Source Control diff tab, as the original's multi-file diff
        // buffer shows it (layout, find, hunk keys, syntax colours).
        if let [change] = changes.as_slice()
            && let Some(target) = files_target(&id, &title, change)
        {
            git_diff::open_diff(cx, None, &target);
            return;
        }
        // Several files open as the Source Control multi-file diff, read-only; the browser build
        // cannot show in-memory diffs there yet and keeps the step's own diff view.
        #[cfg(not(target_family = "wasm"))]
        {
            let root = self.info.cwd.clone();
            let files = changes
                .iter()
                .map(|change| git_diff::MemoryFile {
                    path: root.as_deref().and_then(|root| change.path.strip_prefix(root).ok()).map_or_else(|| change.path.clone(), PathBuf::from),
                    old: change.old.clone().unwrap_or_default(),
                    new: change.new.clone(),
                })
                .collect();
            git_diff::open_file_set(cx, root.as_deref(), &format!("{}-{call_id}", self.info.id), &title, files);
            return;
        }
        #[allow(unreachable_code)]
        cx.default_global::<ToolDiffs>().0.insert(id.clone(), (self.info.cwd.clone(), changes));
        workbench_api::open_resource(cx, RESOURCE_KIND, &id, &title);
    }
}

/// The change's two sides written to the temporary folder, as the diff tab compares two files
/// outside git; `None` when they cannot be written.
fn files_target(id: &str, title: &str, change: &FileChange) -> Option<git_diff::DiffTarget> {
    let safe: String = id.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' }).collect();
    let dir = std::env::temp_dir().join("athas-tool-diffs").join(safe);
    std::fs::create_dir_all(&dir).ok()?;
    let name = change.path.file_name().map_or_else(|| "file".to_string(), |name| name.to_string_lossy().into_owned());
    let (old, new) = (dir.join(format!("before-{name}")), dir.join(format!("after-{name}")));
    std::fs::write(&old, change.old.as_deref().unwrap_or("")).ok()?;
    std::fs::write(&new, &change.new).ok()?;
    Some(git_diff::DiffTarget::Files {
        title: title.to_string(),
        path: change.path.to_string_lossy().into_owned(),
        old: old.to_string_lossy().into_owned(),
        new: new.to_string_lossy().into_owned(),
    })
}

pub struct ToolDiffView {
    focus_handle: FocusHandle,
    root: Option<PathBuf>,
    changes: Vec<FileChange>,
}

impl ToolDiffView {
    pub fn new(id: &str, cx: &mut Context<Self>) -> Self {
        let (root, changes) = cx.try_global::<ToolDiffs>().and_then(|diffs| diffs.0.get(id).cloned()).unwrap_or_default();
        Self { focus_handle: cx.focus_handle(), root, changes }
    }
}

impl Focusable for ToolDiffView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

fn number_width() -> gpui::Pixels { px(44.) }
fn line_height() -> gpui::Pixels { px(20.) }

impl Render for ToolDiffView {
    /// Several files laid out as the Source Control diff draws them: a header per file with its
    /// folder and counts, hunk headers, both line numbers and syntax colours.
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        use crate::diff::NumberedRow;
        let colors = cx.theme().colors.clone();
        let theme = cx.theme().clone();
        let root = self.root.clone();
        let counts = |added: usize, removed: usize| {
            div()
                .flex()
                .flex_none()
                .gap(px(6.))
                .font_family(typography::MONO_FONT)
                .text_size(typography::text_caption())
                .when(added > 0, |this| this.child(div().text_color(colors.git_added).child(format!("+{added}"))))
                .when(removed > 0, |this| this.child(div().text_color(colors.git_deleted).child(format!("\u{2212}{removed}"))))
        };
        let number = |value: Option<usize>| div().flex_none().w(number_width()).pr(px(8.)).text_right().text_color(colors.subtle_foreground).children(value.map(|value| value.to_string()));
        // Collected before the scrollbar asks for `cx` again: the rows read the icon theme.
        let files: Vec<_> = self.changes.iter().enumerate().map(|(file_index, change)| {
            let rows = diff::diff_rows(change.old.as_deref().unwrap_or(""), &change.new);
            let (added, removed) = diff::stats(&rows);
            let numbered = diff::numbered_rows(&rows);
            let shown = root.as_deref().and_then(|root| change.path.strip_prefix(root).ok()).unwrap_or(&change.path).to_path_buf();
            let name = shown.file_name().map_or_else(|| shown.display().to_string(), |name| name.to_string_lossy().into_owned());
            let dir = shown.parent().map(|dir| dir.display().to_string()).unwrap_or_default();
            let status = if change.old.is_none() { ("A", colors.git_added) } else { ("M", colors.git_modified) };
            let language = change.path.extension().map(|extension| extension.to_string_lossy().into_owned());
            let code = numbered.iter().map(|row| if let NumberedRow::Line { text, .. } = row { text.as_str() } else { "" }).collect::<Vec<_>>().join("\n");
            let spans = crate::render::code_line_spans(language.as_deref(), &code);
            let open = change.path.clone();
            let header = div()
                .id(("tool-diff-file", file_index))
                .flex()
                .items_center()
                .gap(px(8.))
                .h(px(36.))
                .px(px(12.))
                .bg(colors.surface)
                .border_b_1()
                .border_color(colors.divider)
                .text_size(typography::text_sm())
                .on_click(move |_, _, cx| workbench_api::open_file(cx, open.clone(), None))
                .child(div().flex_none().w(px(12.)).font_family(typography::MONO_FONT).text_size(typography::text_caption()).text_color(status.1).child(status.0))
                .child(
                    extensions::file_icon(&name, px(14.), cx)
                        .unwrap_or_else(|| Icon::new(IconName::FileCode).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element()),
                )
                .child(div().flex_none().font_weight(typography::MEDIUM).text_color(colors.foreground).child(name))
                .child(div().flex_1().min_w_0().truncate().text_color(colors.subtle_foreground).child(dir))
                .child(counts(added, removed));
            let lines = numbered.iter().enumerate().map(|(row_index, row)| match row {
                NumberedRow::Header(range) => div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(32.))
                    .w_full()
                    .bg(colors.surface)
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(div().flex().flex_none().w(number_width()).justify_center().child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall).color(colors.subtle_foreground)))
                    .child(div().flex_none().child(range.clone()))
                    .into_any_element(),
                NumberedRow::Line { kind, text, old, new } => {
                    let (bg, sign, sign_color) = match kind {
                        LineKind::Added => (Some(colors.git_added.opacity(0.12)), "+", colors.git_added),
                        LineKind::Removed => (Some(colors.git_deleted.opacity(0.12)), "-", colors.git_deleted),
                        LineKind::Context => (None, " ", colors.subtle_foreground),
                    };
                    let line_spans = spans.get(row_index).map(Vec::as_slice).unwrap_or_default();
                    div()
                        .flex()
                        .items_center()
                        .h(line_height())
                        .min_w_full()
                        .font_family(typography::MONO_FONT)
                        .text_size(typography::text_sm())
                        .whitespace_nowrap()
                        .text_color(colors.foreground)
                        .when_some(bg, |this, bg| this.bg(bg))
                        .child(number(*old))
                        .child(number(*new))
                        .child(div().flex_none().w(px(16.)).text_color(sign_color).child(sign))
                        .child(div().pr(px(12.)).child(crate::inline_edit::styled_code_line(text, line_spans, &theme)))
                        .into_any_element()
                }
            });
            div()
                .w_full()
                .min_w_0()
                .flex()
                .flex_col()
                .border_b_1()
                .border_color(colors.divider)
                .child(header)
                .when(numbered.is_empty(), |this| {
                    this.child(div().flex().items_center().justify_center().h(px(56.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("No changes"))
                })
                .children(lines)
        }).collect();
        div()
            .id("agent-tool-diff")
            .track_focus(&self.focus_handle)
            .size_full()
            .overflow_y_scroll()
            .scrollbar(window, cx)
            .bg(colors.background)
            .flex()
            .flex_col()
            .when(self.changes.is_empty(), |this| {
                this.child(div().p(px(16.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("This change is no longer available."))
            })
            .children(files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_name_one_file_or_count_several() {
        let change = |path: &str| FileChange { path: path.into(), old: None, new: String::new() };
        assert_eq!(title(&[change("/p/src/main.rs")]), "main.rs.diff");
        assert_eq!(title(&[change("/p/a.rs"), change("/p/b.rs")]), "ACP changes (2)");
    }
}
