//! The references list: the places find references (or several definitions) returned, grouped
//! by file with the line each is on.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
};

use gpui::{App, Context, EventEmitter, FocusHandle, Focusable, IntoElement, Render, SharedString, Task, Window, div, prelude::*, px};
use lsp_client::FileLocation;
use theme::ActiveTheme;
use ui::{Button, ButtonSize, EmptyState, Icon, IconName, IconSize, PaneTitle, SidebarListItem, WithScrollbar as _, metrics, pane_header, typography};

use crate::{PanelEvent, display_path};

/// One file's references with their line text.
#[derive(Clone, Debug, PartialEq)]
pub struct ReferenceGroup {
    pub path: PathBuf,
    /// The location and the trimmed text of its line.
    pub items: Vec<(FileLocation, String)>,
}

/// Groups locations by file (sorted), reading each file once for the line previews.
pub fn group_locations(locations: &[FileLocation], read: impl Fn(&Path) -> Option<String>) -> Vec<ReferenceGroup> {
    let mut by_file: BTreeMap<PathBuf, Vec<FileLocation>> = BTreeMap::new();
    for location in locations {
        by_file.entry(location.path.clone()).or_default().push(location.clone());
    }
    by_file
        .into_iter()
        .map(|(path, mut items)| {
            items.sort_by_key(|location| (location.range.start.line, location.range.start.character));
            items.dedup();
            let text = read(&path).unwrap_or_default();
            let lines: Vec<&str> = text.lines().collect();
            let items = items
                .into_iter()
                .map(|location| {
                    let preview = lines.get(location.range.start.line as usize).map(|line| line.trim().to_string()).unwrap_or_default();
                    (location, preview)
                })
                .collect();
            ReferenceGroup { path, items }
        })
        .collect()
}

pub struct ReferencesView {
    focus_handle: FocusHandle,
    project_root: Option<PathBuf>,
    title: String,
    groups: Vec<ReferenceGroup>,
    loading: bool,
    /// Whether a search has filled the list since it was last cleared.
    searched: bool,
    /// Files whose references are folded away (the original's accordion).
    collapsed: HashSet<PathBuf>,
    /// The pane fills the workbench; the header's toggle says so.
    full_screen: bool,
    _load: Option<Task<()>>,
}

/// What the references pane asks of its host besides opening a location.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferencesEvent {
    /// The header's Fullscreen / Exit fullscreen button.
    ToggleFullScreen,
}

impl EventEmitter<PanelEvent> for ReferencesView {}
impl EventEmitter<ReferencesEvent> for ReferencesView {}

impl Focusable for ReferencesView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl ReferencesView {
    pub fn new(project_root: Option<PathBuf>, cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            project_root,
            title: "References".into(),
            groups: Vec::new(),
            loading: false,
            searched: false,
            collapsed: HashSet::new(),
            full_screen: false,
            _load: None,
        }
    }

    pub fn set_project_root(&mut self, root: Option<PathBuf>, cx: &mut Context<Self>) {
        self.project_root = root;
        cx.notify();
    }

    /// Shows `locations` (from `editor::LspEvent::References`); the line previews load in the
    /// background.
    /// Line previews come from the open editor when the file is open, so unsaved edits show
    /// (`navigation-command-actions.ts` reads open buffers first), else from disk.
    pub fn set_references(&mut self, title: String, locations: Vec<FileLocation>, cx: &mut Context<Self>) {
        self.title = title;
        self.loading = true;
        self.searched = true;
        self.collapsed.clear();
        let mut open: HashMap<PathBuf, String> = HashMap::new();
        for location in &locations {
            if !open.contains_key(&location.path)
                && let Some(text) = workbench_api::buffer_text(&location.path, cx)
            {
                open.insert(location.path.clone(), text);
            }
        }
        self._load = Some(cx.spawn(async move |this, cx| {
            let groups = cx
                .background_spawn(async move { group_locations(&locations, |path| open.get(path).cloned().or_else(|| std::fs::read_to_string(path).ok())) })
                .await;
            this.update(cx, |view, cx| {
                view.groups = groups;
                view.loading = false;
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    /// The request is out (`setLoading` with its query): "Finding…" under `title` until
    /// [`Self::set_references`] answers; the old results go.
    pub fn set_finding(&mut self, title: String, cx: &mut Context<Self>) {
        self.title = title;
        self.groups.clear();
        self.collapsed.clear();
        self.loading = true;
        self.searched = true;
        self._load = None;
        cx.notify();
    }

    /// Whether the pane fills the workbench, for the header's toggle.
    pub fn set_full_screen(&mut self, full_screen: bool, cx: &mut Context<Self>) {
        if self.full_screen != full_screen {
            self.full_screen = full_screen;
            cx.notify();
        }
    }

    /// Empties the list (`Clear references`).
    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.groups.clear();
        self.collapsed.clear();
        self.loading = false;
        self.searched = false;
        self.title = "References".into();
        self._load = None;
        cx.notify();
    }

    pub fn count(&self) -> usize {
        self.groups.iter().map(|group| group.items.len()).sum()
    }
}

impl Render for ReferencesView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        // `PaneContentHeader`: "References" with "symbol · count" (or "Finding…") after it.
        let count = if self.loading { "Finding…".to_string() } else { self.count().to_string() };
        let (title, detail) = match self.title.strip_prefix("References to ") {
            Some(symbol) if !symbol.is_empty() => ("References".to_string(), format!("{symbol} · {count}")),
            _ => (self.title.clone(), count),
        };
        let header = pane_header(cx)
            .h(metrics::CONTENT_HEADER)
            .px(metrics::CHROME_PADDING_INLINE)
            .border_b_1()
            .border_color(colors.divider)
            .justify_between()
            .child(PaneTitle::new(title).detail(detail))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(2.))
                    .child(
                        Button::icon("references-full-screen", if self.full_screen { IconName::ArrowsIn } else { IconName::ArrowsOut })
                            .size(ButtonSize::Small)
                            .tooltip(if self.full_screen { "Exit fullscreen" } else { "Fullscreen" })
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(ReferencesEvent::ToggleFullScreen))),
                    )
                    .child(
                        Button::icon("references-clear", IconName::X)
                            .size(ButtonSize::Small)
                            .tooltip("Clear references")
                            .on_click(cx.listener(|this, _, _, cx| this.clear(cx))),
                    ),
            );
        let body = if self.groups.is_empty() {
            // Quiet lines at the top, as `Empty variant="inline"`.
            let message = if self.loading {
                "Finding references"
            } else if self.searched {
                "No references found"
            } else {
                "Use Shift+F12 to find references"
            };
            div().flex().flex_col().flex_1().child(EmptyState::new("").message(message)).into_any_element()
        } else {
            // The original's `Accordion`: a file per item (file icon, name, chevron; the count at
            // the end), its references as `SidebarListItem`s led by the line number, 20px in.
            let mut list = div().id("references-list").flex().flex_col().flex_1().min_h_0().overflow_y_scroll();
            for (group_index, group) in self.groups.iter().enumerate() {
                let name = group.path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| display_path(&group.path, self.project_root.as_deref()));
                let expanded = !self.collapsed.contains(&group.path);
                let toggled = group.path.clone();
                let hover_text = colors.foreground;
                let hover_bg = colors.accent;
                let trigger = div()
                    .id(SharedString::from(format!("references-file-{group_index}")))
                    .flex()
                    .items_center()
                    .gap(metrics::CHROME_GAP_TIGHT)
                    .h(metrics::TAB)
                    .max_w_full()
                    .min_w_0()
                    .px(px(8.))
                    .rounded(metrics::RADIUS_MD)
                    .text_size(typography::TEXT_CHROME)
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .hover(move |style| style.bg(hover_bg).text_color(hover_text))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(metrics::CHROME_GAP)
                            .min_w_0()
                            .child(multibuffer::file_icon(&name, multibuffer::Tone::Subtle, cx))
                            .child(div().min_w_0().truncate().child(name)),
                    )
                    .child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::Custom(px(12.))).color(colors.subtle_foreground))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.collapsed.remove(&toggled) {
                            this.collapsed.insert(toggled.clone());
                        }
                        cx.notify();
                    }));
                list = list.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(metrics::CHROME_GAP_TIGHT)
                        .min_w_0()
                        .bg(colors.background)
                        .child(trigger)
                        .child(div().flex_none().pr(px(8.)).text_size(typography::TEXT_SM).text_color(colors.foreground).child(group.items.len().to_string())),
                );
                if !expanded {
                    continue;
                }
                let mut items = div().flex().flex_col().gap(px(4.)).pl(px(20.));
                for (index, (location, preview)) in group.items.iter().enumerate() {
                    let (path, line, column) = (location.path.clone(), location.line(), location.column());
                    items = items.child(
                        SidebarListItem::new(SharedString::from(format!("reference-{group_index}-{index}")), preview.clone())
                            .leading(div().child(line.to_string()))
                            .on_click(cx.listener(move |_, _, _, cx| cx.emit(PanelEvent::OpenLocation { path: path.clone(), line, column }))),
                    );
                }
                list = list.child(items);
            }
            list.scrollbar(window, cx).into_any_element()
        };
        div().track_focus(&self.focus_handle).flex().flex_col().size_full().min_h_0().child(header).child(body)
    }
}

#[cfg(test)]
mod tests {
    use lsp_client::lsp::{Position, Range};

    use super::*;

    fn location(path: &str, line: u32, character: u32) -> FileLocation {
        FileLocation { path: path.into(), range: Range::new(Position::new(line, character), Position::new(line, character + 1)) }
    }

    #[test]
    fn groups_and_previews() {
        let locations = vec![location("/p/b.rs", 1, 4), location("/p/a.rs", 0, 0), location("/p/b.rs", 0, 2), location("/p/b.rs", 0, 2)];
        let groups = group_locations(&locations, |path| Some(if path.ends_with("a.rs") { "fn a() {}\n".into() } else { "  let x = 1;\n  use_x(x);\n".into() }));
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].path, PathBuf::from("/p/a.rs"));
        assert_eq!(groups[1].items.iter().map(|(location, preview)| (location.line(), preview.as_str())).collect::<Vec<_>>(), [(1, "let x = 1;"), (2, "use_x(x);")]);
    }
}
