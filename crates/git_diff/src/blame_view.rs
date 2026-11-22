//! A file with who last changed each line beside it. Each run of lines from one commit shows the
//! commit once; clicking it opens the commit, clicking a line opens the file there.

use ui::TooltipExt as _;
use std::path::{Path, PathBuf};

use gpui::{AnyElement, App, Context, EventEmitter, FocusHandle, Focusable, ListAlignment, ListState, Render, SharedString, Window, div, list, prelude::*, px, relative};
use theme::{ActiveTheme, ThemeColors};
use ui::{Avatar, Button, ButtonSize, IconName, typography};

use crate::{
    blame::{BlameLine, blame_lines},
    git,
    target::short_hash,
    widgets::{display_text, fill_message},
};

fn plural(count: usize, word: &str) -> String {
    format!("{count} {word}{}", if count == 1 { "" } else { "s" })
}

const GUTTER_WIDTH: gpui::Pixels = px(300.);

enum State {
    Loading,
    Failed(SharedString),
    Ready,
}

pub struct BlameView {
    root: PathBuf,
    /// Relative to `root`.
    path: String,
    focus_handle: FocusHandle,
    state: State,
    lines: Vec<BlameLine>,
    text: Vec<String>,
    /// Syntax colours by 1-based line number.
    syntax: std::collections::HashMap<u32, crate::highlight::LineSpans>,
    /// Which run of commits each line is in, to shade every other run.
    runs: Vec<usize>,
    list: ListState,
    /// Blame follows the file: it is read again whenever the window comes to the front.
    _subscription: gpui::Subscription,
}

impl EventEmitter<()> for BlameView {}

impl Focusable for BlameView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl BlameView {
    pub fn new(root: PathBuf, path: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe_window_activation(window, |this, window, cx| {
            if window.is_window_active() {
                this.load(cx);
            }
        });
        let mut view = Self {
            root,
            path,
            focus_handle: cx.focus_handle(),
            state: State::Loading,
            lines: Vec::new(),
            text: Vec::new(),
            syntax: Default::default(),
            runs: Vec::new(),
            list: ListState::new(0, ListAlignment::Top, px(800.)),
            _subscription: subscription,
        };
        view.load(cx);
        view
    }

    pub fn lines(&self) -> &[BlameLine] {
        &self.lines
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let (root, path) = (self.root.clone(), self.path.clone());
        let task = cx.background_spawn(async move {
            let lines = blame_lines(&root, Path::new(&path))?;
            let text = std::fs::read_to_string(root.join(&path))?;
            let text: Vec<String> = text.lines().map(str::to_string).collect();
            let numbered: Vec<(u32, &str)> = text.iter().enumerate().map(|(index, line)| (index as u32 + 1, line.as_str())).collect();
            let syntax = crate::highlight::highlight_lines(Path::new(&path), &numbered);
            anyhow::Ok((lines, text, syntax))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                match result {
                    Ok((lines, text, syntax)) => {
                        if lines != this.lines || text != this.text || !matches!(this.state, State::Ready) {
                            let mut run = 0;
                            this.runs = lines
                                .iter()
                                .enumerate()
                                .map(|(index, line)| {
                                    if index > 0 && line.starts_hunk {
                                        run += 1;
                                    }
                                    run
                                })
                                .collect();
                            this.lines = lines;
                            this.text = text;
                            this.syntax = syntax;
                            this.list.reset(this.lines.len());
                            this.state = State::Ready;
                        }
                    }
                    Err(error) => this.state = State::Failed(format!("{error:#}").into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn render_line(&self, index: usize, colors: &ThemeColors, now: i64, cx: &App) -> AnyElement {
        let Some(line) = self.lines.get(index) else { return div().into_any_element() };
        let text = self.text.get(index).map_or("", String::as_str);
        let shaded = self.runs.get(index).is_some_and(|run| run % 2 == 1);
        let hover = colors.accent;
        let annotation: AnyElement = match (&line.commit, line.starts_hunk) {
            (Some(commit), true) => {
                let (hash, root, summary) = (commit.hash.clone(), self.root.clone(), commit.summary.clone());
                let title = format!("{} {}", short_hash(&commit.hash), commit.summary);
                div()
                    .id(("blame-commit", index))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .w_full()
                    .min_w_0()
                    .px(px(8.))
                    .rounded(ui::metrics::RADIUS)
                    .hover(move |style| style.bg(hover))
                    .child(Avatar::new(&commit.author).size(px(14.)).image(crate::avatar::author_avatar(&commit.email, cx)))
                    .child(div().flex_none().max_w(px(90.)).truncate().text_color(colors.muted_foreground).child(commit.author.clone()))
                    .child(div().flex_1().min_w_0().truncate().text_color(colors.foreground).child(summary))
                    .child(div().flex_none().text_color(colors.subtle_foreground).child(git::relative_time(commit.time, now)))
                    .anchored_tooltip(move || ui::Tooltip::new(title.clone()))
                    .on_click(move |_, _, cx| crate::open_commit(cx, Some(&root), &hash, None))
                    .into_any_element()
            }
            (None, true) => div().px(px(8.)).text_color(colors.subtle_foreground).child("Not committed yet").into_any_element(),
            _ => div().into_any_element(),
        };
        let theme = cx.theme();
        let highlights: Vec<(std::ops::Range<usize>, gpui::Hsla)> = self
            .syntax
            .get(&(index as u32 + 1))
            .map(|spans| {
                spans
                    .iter()
                    .filter_map(|(range, kind)| display_text(text, std::slice::from_ref(range)).1.into_iter().next().map(|range| (range, kind.color(theme))))
                    .collect()
            })
            .unwrap_or_default();
        let highlights = if line.commit.is_none() { Vec::new() } else { crate::highlight::layer(&highlights, &[]) };
        let (text, _) = display_text(text, &[]);
        let (path, line_number) = (self.root.join(&self.path), line.line);
        let number_hover = colors.foreground;
        div()
            .flex()
            .items_center()
            .h(px(20.))
            .w_full()
            .text_size(typography::TEXT_SM)
            .line_height(relative(1.5))
            .whitespace_nowrap()
            .when(shaded, |this| this.bg(colors.surface))
            .when(line.starts_hunk && index > 0, |this| this.border_t_1().border_color(colors.divider))
            .child(div().flex().flex_none().w(GUTTER_WIDTH).items_center().text_size(typography::TEXT_CAPTION).child(annotation))
            .child(div().flex_none().w(px(1.)).h_full().bg(colors.divider))
            .child(
                div()
                    .id(("blame-line", index))
                    .flex_none()
                    .w(px(48.))
                    .pr(px(8.))
                    .text_right()
                    .font_family(typography::MONO_FONT)
                    .text_color(colors.subtle_foreground)
                    .hover(move |style| style.text_color(number_hover))
                    .child(line.line.to_string())
                    .on_click(move |_, _, cx| workbench_api::open_file(cx, path.clone(), Some(line_number))),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .font_family(typography::MONO_FONT)
                    .text_color(if line.commit.is_none() { colors.git_modified } else { colors.foreground })
                    .child(gpui::StyledText::new(if text.is_empty() { " ".to_string() } else { text }).with_highlights(highlights)),
            )
            .into_any_element()
    }
}

impl Render for BlameView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let container = div()
            .id("git-blame-view")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground);
        match &self.state {
            State::Loading => container.child(fill_message("Loading blame…", None, IconName::History, None)),
            State::Failed(error) => container.child(fill_message(
                "Could not blame this file",
                Some(error.clone()),
                IconName::WarningCircle,
                Some(Button::new("blame-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element()),
            )),
            State::Ready => {
                let commits: std::collections::HashSet<&str> = self.lines.iter().filter_map(|line| line.commit.as_ref().map(|commit| commit.hash.as_str())).collect();
                let (name, dir) = match self.path.rsplit_once('/') {
                    Some((dir, name)) => (name.to_string(), dir.to_string()),
                    None => (self.path.clone(), String::new()),
                };
                let header = ui::pane_header(cx)
                    .px(px(12.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .text_size(typography::TEXT_SM)
                    .child(div().flex_none().font_weight(typography::MEDIUM).text_color(colors.foreground).child(name))
                    .when(!dir.is_empty(), |this| this.child(div().min_w_0().truncate().child(dir)))
                    .child(div().flex_none().child(format!("{} · {}", plural(self.lines.len(), "line"), plural(commits.len(), "commit"))))
                    .child(
                        ui::pane_actions().child(
                            Button::icon("blame-reload", IconName::ArrowClockwise)
                                .size(ButtonSize::Small)
                                .tooltip("Reload")
                                .on_click(cx.listener(|this, _, _, cx| this.load(cx))),
                        ),
                    );
                let now = git::now();
                container.child(header).child(
                    ui::with_scrollbar(
                        list(self.list.clone(), cx.processor(move |this, index: usize, _window, cx| {
                            let colors = cx.theme().colors.clone();
                            this.render_line(index, &colors, now, cx)
                        }))
                        .flex_1()
                        .size_full(),
                        ui::Scrollbar::list("blame-scrollbar", &self.list),
                    ),
                )
            }
        }
    }
}
