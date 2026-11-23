//! Jupyter notebooks (`features/editor/notebook`): an `.ipynb` file opens as its cells instead of
//! its JSON. Markdown cells show rendered and code cells highlighted until edited; code cells run
//! in a fresh `python3` and keep their outputs. Every change is written back to the buffer as the
//! whole notebook, so saving, dirty state and undo are the editor's own.

mod model;
mod script_cells;
mod script_lenses;

use ui::WithScrollbar;
use std::{
    collections::{BTreeSet, HashMap},
    future::Future,
    hash::{Hash as _, Hasher as _},
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::Engine as _;
use ui::scale::px;
use gpui::{
    AnyElement, AppContext as _, Context, Entity, Focusable as _, ImageFormat, ImageSource, InteractiveElement as _, IntoElement, KeyDownEvent,
    MouseButton, ParentElement as _, Render, ScrollHandle, SharedString, StatefulInteractiveElement as _, Styled as _, StyledText, Subscription, Task, TextRun,
    Window, div, font, img, prelude::FluentBuilder as _,
};
use serde_json::Value;
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, IconName, TextArea, TextAreaEvent, typography};

pub(crate) use model::CellRun;
use model::CellType;
use script_cells::{ChunkOutput, apply_chunk_options, clear_chunk_output, format_chunk_output, python_script_cells, rmarkdown_chunks, update_chunk_output};

use crate::{Editor, Status, document::Target, history::EditKind, markdown_preview};

const MAX_WIDTH: f32 = 980.;

#[derive(Default)]
pub(crate) struct NotebookState {
    /// The notebook for a buffer version, or why it cannot be read.
    parsed: Option<(usize, Result<Value, String>)>,
    editing: BTreeSet<usize>,
    selected: usize,
    running: Option<usize>,
    inputs: HashMap<usize, (Entity<TextArea>, Subscription)>,
    images: HashMap<u64, Arc<gpui::Image>>,
    scroll: ScrollHandle,
    run_task: Option<Task<()>>,
}

/// A cell being dragged by its handle.
#[derive(Clone)]
struct CellDrag(usize);

struct CellDragPreview(SharedString);

impl Render for CellDragPreview {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .px(px(8.))
            .py(px(2.))
            .rounded(ui::metrics::radius())
            .bg(colors.overlay)
            .border_1()
            .border_color(colors.border)
            .font_family(typography::ui_font())
            .text_size(typography::text_caption())
            .text_color(colors.muted_foreground)
            .child(self.0.clone())
    }
}

/// The folder a cell runs in: the notebook's, for a file on this machine.
pub(crate) fn working_directory(path: &Path, local: bool) -> Option<PathBuf> {
    local.then(|| path.parent().filter(|parent| !parent.as_os_str().is_empty()).map(Path::to_path_buf)).flatten()
}

#[cfg(not(target_family = "wasm"))]
fn run_cell(r: bool, code: String, cwd: Option<PathBuf>, setup_code: Option<String>) -> impl Future<Output = Result<CellRun, String>> + 'static {
    let cwd = cwd.map(|cwd| cwd.to_string_lossy().into_owned());
    let run = if r { futures::future::Either::Left(tooling::run_r_cell(code, cwd, setup_code)) } else { futures::future::Either::Right(tooling::run_python_cell(code, cwd, setup_code)) };
    async move { run.await.map(|result| CellRun::from_json(&result)) }
}

#[cfg(target_family = "wasm")]
fn run_cell(_: bool, _: String, _: Option<PathBuf>, _: Option<String>) -> impl Future<Output = Result<CellRun, String>> + 'static {
    async { Err("Running cells needs the desktop app.".to_string()) }
}

/// Runs Python `code` in a fresh `python3` in `cwd`, after `setup_code` (its output dropped).
pub(crate) fn run_python_cell(code: String, cwd: Option<PathBuf>, setup_code: Option<String>) -> impl Future<Output = Result<CellRun, String>> + 'static {
    run_cell(false, code, cwd, setup_code)
}

/// Runs R `code` with `Rscript --vanilla` in `cwd`, after `setup_code`.
pub(crate) fn run_r_cell(code: String, cwd: Option<PathBuf>, setup_code: Option<String>) -> impl Future<Output = Result<CellRun, String>> + 'static {
    run_cell(true, code, cwd, setup_code)
}

/// The one edit that turns `old` into `new`: everything between their common start and end.
fn minimal_edit(old: &str, new: &str) -> (Range<usize>, String) {
    let mut prefix = old.bytes().zip(new.bytes()).take_while(|(a, b)| a == b).count();
    while !old.is_char_boundary(prefix) || !new.is_char_boundary(prefix) {
        prefix -= 1;
    }
    let mut suffix = old[prefix..].bytes().rev().zip(new[prefix..].bytes().rev()).take_while(|(a, b)| a == b).count();
    while !old.is_char_boundary(old.len() - suffix) || !new.is_char_boundary(new.len() - suffix) {
        suffix -= 1;
    }
    (prefix..old.len() - suffix, new[prefix..new.len() - suffix].to_string())
}

fn image_key(data: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    data.hash(&mut hasher);
    hasher.finish()
}

impl Editor {
    pub fn is_notebook(&self) -> bool {
        self.path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("ipynb"))
    }

    fn parse_notebook(&mut self) {
        let version = self.document.buffer.version();
        if !matches!(&self.notebook.parsed, Some((parsed, _)) if *parsed == version) {
            self.notebook.parsed = Some((version, model::parse(&self.document.buffer.text())));
        }
    }

    fn notebook(&self) -> Option<&Value> {
        match &self.notebook.parsed {
            Some((_, Ok(notebook))) => Some(notebook),
            _ => None,
        }
    }

    fn cell_count(&self) -> usize {
        self.notebook().map(|notebook| model::cells(notebook).len()).unwrap_or(0)
    }

    /// Changes the notebook and writes it back to the buffer.
    fn change_notebook(&mut self, kind: EditKind, cx: &mut Context<Self>, change: impl FnOnce(&mut Value)) {
        self.parse_notebook();
        let Some(mut notebook) = self.notebook().cloned() else { return };
        change(&mut notebook);
        let (range, text) = minimal_edit(&self.document.buffer.text(), &model::serialize(&notebook));
        if range.is_empty() && text.is_empty() {
            return;
        }
        self.update_document(cx, |document| document.apply_edits(vec![(range, text)], vec![Target::Exact { anchor: 0, head: 0 }], kind));
        self.notebook.parsed = Some((self.document.buffer.version(), Ok(notebook)));
    }

    /// The text field of a cell being edited, made on first use.
    fn cell_input(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) -> Option<Entity<TextArea>> {
        let cell = self.notebook().and_then(|notebook| model::cells(notebook).get(index))?;
        let source = model::cell_source(cell);
        let code = model::cell_type(cell) == "code";
        if let Some((input, _)) = self.notebook.inputs.get(&index) {
            if input.read(cx).text() != source {
                input.update(cx, |input, cx| input.set_text(source, cx));
            }
            return Some(input.clone());
        }
        let input = cx.new(|cx| {
            let mut input = TextArea::new(cx).mono().auto_size(if code { 1 } else { 3 }, 4000);
            input.set_text(source, cx);
            input
        });
        let subscription = cx.subscribe_in(&input, window, move |editor, input, event: &TextAreaEvent, window, cx| match event {
            TextAreaEvent::Changed => {
                let text = input.read(cx).text().to_string();
                editor.notebook.selected = index;
                editor.change_notebook(EditKind::Insert, cx, |notebook| model::set_source(notebook, index, &text));
            }
            TextAreaEvent::Submit => editor.run_notebook_cell(index, cx),
            TextAreaEvent::Cancelled => {
                window.focus(&editor.focus_handle, cx);
                cx.notify();
            }
        });
        self.notebook.inputs.insert(index, (input.clone(), subscription));
        Some(input)
    }

    fn toggle_cell_edit(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.notebook.selected = index;
        if self.notebook.editing.remove(&index) {
            self.notebook.inputs.remove(&index);
            window.focus(&self.focus_handle, cx);
        } else {
            self.notebook.editing.insert(index);
            self.focus_cell_input(index, window, cx);
        }
        cx.notify();
    }

    fn focus_cell_input(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(input) = self.cell_input(index, window, cx) {
            let handle = input.read(cx).focus_handle(cx);
            window.focus(&handle, cx);
        }
    }

    fn run_notebook_cell(&mut self, index: usize, cx: &mut Context<Self>) {
        self.notebook.selected = index;
        self.parse_notebook();
        if self.notebook.running.is_some() {
            return;
        }
        let Some(cell) = self.notebook().and_then(|notebook| model::cells(notebook).get(index)) else { return };
        if model::cell_type(cell) != "code" {
            return;
        }
        let previous_count = model::execution_count(cell);
        let run = run_python_cell(model::cell_source(cell), working_directory(&self.path, self.fs.is_local()), Some(String::new()));
        self.notebook.running = Some(index);
        self.notebook.run_task = Some(cx.spawn(async move |this, cx| {
            let result = run.await;
            this.update(cx, |editor, cx| {
                let Some(index) = editor.notebook.running.take() else { return };
                editor.parse_notebook();
                let (outputs, count) = match result {
                    Ok(run) => (model::run_outputs(&run), editor.notebook().map(|notebook| model::max_execution_count(notebook) + 1)),
                    Err(message) => (vec![model::error_output(&message)], previous_count),
                };
                editor.change_notebook(EditKind::Other, cx, |notebook| model::set_outputs(notebook, index, outputs, count));
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    fn insert_notebook_cell(&mut self, at: usize, cell_type: CellType, window: &mut Window, cx: &mut Context<Self>) {
        let at = at.min(self.cell_count());
        self.change_notebook(EditKind::Other, cx, |notebook| model::insert_cell(notebook, at, cell_type));
        self.notebook.editing = self.notebook.editing.iter().map(|index| if *index >= at { index + 1 } else { *index }).collect();
        self.notebook.editing.insert(at);
        if let Some(running) = self.notebook.running.as_mut().filter(|running| **running >= at) {
            *running += 1;
        }
        self.notebook.inputs.clear();
        self.notebook.selected = at;
        self.focus_cell_input(at, window, cx);
        self.notebook.scroll.scroll_to_item(at + 1);
        cx.notify();
    }

    fn delete_notebook_cell(&mut self, at: usize, window: &mut Window, cx: &mut Context<Self>) {
        let count = self.cell_count();
        self.change_notebook(EditKind::Other, cx, |notebook| model::delete_cell(notebook, at));
        let selected = self.notebook.selected;
        self.notebook.selected = (if selected > at { selected - 1 } else { selected }).min(count.saturating_sub(2));
        self.notebook.editing = self.notebook.editing.iter().filter(|index| **index != at).map(|index| if *index > at { index - 1 } else { *index }).collect();
        match self.notebook.running {
            Some(running) if running == at => {
                self.notebook.running = None;
                self.notebook.run_task = None;
            }
            Some(running) if running > at => self.notebook.running = Some(running - 1),
            _ => {}
        }
        self.notebook.inputs.clear();
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }

    fn set_notebook_cell_type(&mut self, at: usize, cell_type: CellType, window: &mut Window, cx: &mut Context<Self>) {
        self.change_notebook(EditKind::Other, cx, |notebook| model::set_type(notebook, at, cell_type));
        self.notebook.selected = at;
        self.notebook.editing.insert(at);
        self.notebook.inputs.remove(&at);
        self.focus_cell_input(at, window, cx);
        cx.notify();
    }

    fn move_notebook_cell(&mut self, from: usize, to: usize, window: &mut Window, cx: &mut Context<Self>) {
        let mut moved = false;
        self.change_notebook(EditKind::Other, cx, |notebook| moved = model::move_cell(notebook, from, to));
        if !moved {
            return;
        }
        self.notebook.selected = to;
        self.notebook.editing = self.notebook.editing.iter().map(|index| model::remap_moved(*index, from, to)).collect();
        self.notebook.running = self.notebook.running.map(|index| model::remap_moved(index, from, to));
        self.notebook.inputs.clear();
        window.focus(&self.focus_handle, cx);
        self.notebook.scroll.scroll_to_item(to + 1);
        cx.notify();
    }

    fn notebook_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if !self.focus_handle.is_focused(window) {
            return;
        }
        let count = self.cell_count();
        if count == 0 {
            return;
        }
        let keystroke = &event.keystroke;
        let selected = self.notebook.selected.min(count - 1);
        match keystroke.key.as_str() {
            "up" | "down" => {
                let next = if keystroke.key == "up" { selected.saturating_sub(1) } else { (selected + 1).min(count - 1) };
                self.notebook.selected = next;
                self.notebook.scroll.scroll_to_item(next + 1);
            }
            "enter" if keystroke.modifiers.platform || keystroke.modifiers.control => {
                let code = self.notebook().and_then(|notebook| model::cells(notebook).get(selected)).is_some_and(|cell| model::cell_type(cell) == "code");
                if !code {
                    return;
                }
                self.run_notebook_cell(selected, cx);
            }
            "enter" => self.toggle_cell_edit(selected, window, cx),
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }

    /// The notebook in place of the text, for `.ipynb` files.
    pub(crate) fn render_notebook(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.is_notebook() || self.status != Status::Ready {
            return None;
        }
        self.parse_notebook();
        let colors = cx.theme().colors.clone();
        let root = div()
            .id("editor-pane")
            .key_context("EditorPane")
            .track_focus(&self.focus_handle)
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .text_color(colors.foreground)
            .font_family(typography::ui_font())
            .text_size(px(settings::get(cx).font_size as f32))
            .on_action(cx.listener(Self::save))
            .on_action(cx.listener(Self::save_as))
            .on_key_down(cx.listener(Self::notebook_key_down))
            .children(self.render_notice(cx));
        let notebook = match &self.notebook.parsed {
            Some((_, Ok(notebook))) => notebook.clone(),
            Some((_, Err(message))) => {
                let message = message.clone();
                return Some(
                    root.child(div().flex().flex_1().items_center().justify_center().child(EmptyState::new("Cannot open notebook").icon(IconName::WarningCircle).message(message)))
                        .into_any_element(),
                );
            }
            None => return None,
        };
        let cells = model::cells(&notebook);
        self.notebook.selected = self.notebook.selected.min(cells.len().saturating_sub(1));
        self.notebook.editing.retain(|index| *index < cells.len());
        let stale: Vec<usize> = self.notebook.inputs.keys().copied().filter(|index| !self.notebook.editing.contains(index)).collect();
        for index in stale {
            self.notebook.inputs.remove(&index);
        }
        let language = model::language(&notebook);
        let editing: Vec<usize> = self.notebook.editing.iter().copied().collect();
        let inputs: HashMap<usize, Entity<TextArea>> = editing.into_iter().filter_map(|index| Some((index, self.cell_input(index, window, cx)?))).collect();
        let base_dir = self.path.parent().map(Path::to_path_buf).unwrap_or_default();

        let toolbar = div()
            .flex()
            .justify_end()
            .gap(px(4.))
            .mb(px(12.))
            .child(
                Button::new("notebook-add-code", "Code")
                    .leading_icon(IconName::Code)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(|editor, _, window, cx| editor.insert_notebook_cell(usize::MAX, CellType::Code, window, cx))),
            )
            .child(
                Button::new("notebook-add-markdown", "Markdown")
                    .leading_icon(IconName::Text)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(|editor, _, window, cx| editor.insert_notebook_cell(usize::MAX, CellType::Markdown, window, cx))),
            );

        let mut items = vec![toolbar.into_any_element()];
        for (index, cell) in cells.iter().enumerate() {
            let element = self.render_cell(index, cell, &language, inputs.get(&index).cloned(), &base_dir, cx);
            items.push(element);
        }
        Some(
            root.child(
                div()
                    .id("notebook")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.notebook.scroll)
                    .flex()
                    .flex_col()
                    .items_center()
                    .px(px(20.))
                    .pt(px(16.))
                    .pb(px(32.))
                    .children(items.into_iter().map(|item| div().w_full().max_w(px(MAX_WIDTH)).child(item)))
                    .scrollbar_with(&self.notebook.scroll),
            )
            .into_any_element(),
        )
    }

    fn render_cell(&mut self, index: usize, cell: &Value, language: &str, input: Option<Entity<TextArea>>, base_dir: &Path, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let cell_type = model::cell_type(cell).to_string();
        let code = cell_type == "code";
        let markdown = cell_type == "markdown";
        let selected = self.notebook.selected == index;
        let running = self.notebook.running == Some(index);
        let editing = input.is_some();
        let source = model::cell_source(cell);
        let mono = font(SharedString::from(settings::get(cx).font_family.clone()));
        let label: SharedString = if code { format!("[{}]", model::execution_count(cell).map(|count| count.to_string()).unwrap_or_default()).into() } else { "".into() };

        let dots = div()
            .grid()
            .grid_cols(2)
            .gap(px(2.))
            .w(px(10.))
            .opacity(0.7)
            .children((0..6).map(|_| div().size(px(4.)).rounded_full().bg(colors.subtle_foreground)));
        let handle = div()
            .id(("notebook-cell-handle", index))
            .flex()
            .items_center()
            .justify_end()
            .gap(px(4.))
            .px(px(4.))
            .py(px(2.))
            .rounded(ui::metrics::radius())
            .cursor_grab()
            .text_color(colors.subtle_foreground)
            .hover(|style| style.bg(colors.accent).text_color(colors.foreground))
            .on_drag(CellDrag(index), {
                let label: SharedString = if code { "Code cell".into() } else { "Markdown cell".into() };
                move |_, _, _, cx| cx.new(|_| CellDragPreview(label.clone()))
            })
            .child(dots)
            .child(div().font(mono.clone()).text_size(typography::text_caption()).child(label));

        let button = |id: &'static str, icon: IconName, tooltip: &'static str| Button::icon((id, index), icon).size(ButtonSize::Small).tooltip(tooltip);
        let mut actions = div().flex().items_center().gap(px(2.));
        if code {
            actions = actions.child(
                button("notebook-run", IconName::Play, if running { "Running cell" } else { "Run cell" })
                    .disabled(running)
                    .on_click(cx.listener(move |editor, _, _, cx| editor.run_notebook_cell(index, cx))),
            );
        }
        let other = if code { CellType::Markdown } else { CellType::Code };
        let same = if code { CellType::Code } else { CellType::Markdown };
        actions = actions
            .child(
                button("notebook-type", if code { IconName::Text } else { IconName::Code }, if code { "Convert to Markdown" } else { "Convert to Code" })
                    .on_click(cx.listener(move |editor, _, window, cx| editor.set_notebook_cell_type(index, other, window, cx))),
            )
            .child(button("notebook-insert", IconName::Plus, "Insert cell below").on_click(cx.listener(move |editor, _, window, cx| editor.insert_notebook_cell(index + 1, same, window, cx))))
            .child(button("notebook-delete", IconName::Trash, "Delete cell").on_click(cx.listener(move |editor, _, window, cx| editor.delete_notebook_cell(index, window, cx))))
            .child(
                button("notebook-edit", if editing { IconName::Eye } else { IconName::Pen }, if editing { "Preview cell" } else { "Edit cell" })
                    .on_click(cx.listener(move |editor, _, window, cx| editor.toggle_cell_edit(index, window, cx))),
            );
        let header = div()
            .id(("notebook-cell-header", index))
            .flex()
            .min_h(px(28.))
            .items_center()
            .justify_between()
            .gap(px(8.))
            .opacity(0.75)
            .hover(|style| style.opacity(1.))
            .child(div().font(mono.clone()).text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(cell_type.clone()))
            .child(actions);

        let block = |content: AnyElement| div().rounded(ui::metrics::radius_md()).bg(colors.surface).p(px(10.)).overflow_hidden().child(content);
        let body = match input {
            Some(input) if code => div()
                .capture_key_down(cx.listener(move |editor, event: &KeyDownEvent, _, cx| {
                    let modifiers = event.keystroke.modifiers;
                    if event.keystroke.key == "enter" && modifiers.shift && !modifiers.platform && !modifiers.control {
                        cx.stop_propagation();
                        editor.run_notebook_cell(index, cx);
                    }
                }))
                .child(input)
                .into_any_element(),
            Some(input) => div().child(input).into_any_element(),
            None if markdown => div().py(px(6.)).child(markdown_preview::markdown_element(&source, base_dir.to_path_buf(), cx)).into_any_element(),
            None => {
                let runs = if code {
                    markdown_preview::code_runs(Some(language), &source, &mono, colors.foreground, cx.theme())
                } else {
                    vec![TextRun { len: source.len(), font: mono.clone(), color: colors.foreground, background_color: None, underline: None, strikethrough: None }]
                };
                block(div().font(mono.clone()).text_size(typography::text_sm()).child(StyledText::new(source.clone()).with_runs(runs)).into_any_element()).into_any_element()
            }
        };
        let outputs: Vec<AnyElement> = model::outputs(cell).iter().filter_map(|output| self.render_output(output, &mono, base_dir, cx)).collect();

        div()
            .id(("notebook-cell", index))
            .relative()
            .flex()
            .gap(px(12.))
            .mb(px(16.))
            .py(px(4.))
            .pr(px(4.))
            .rounded(ui::metrics::radius_md())
            .border_1()
            .border_color(if selected { colors.primary } else { gpui::transparent_black() })
            .when(selected, |this| this.bg(colors.primary_soft))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |editor, _, window, cx| {
                    editor.notebook.selected = index;
                    if !editor.focus_handle.contains_focused(window, cx) {
                        window.focus(&editor.focus_handle, cx);
                    }
                    cx.notify();
                }),
            )
            .drag_over::<CellDrag>(move |style, _, _, _| style.border_color(colors.primary.opacity(0.5)))
            .on_drop(cx.listener(move |editor, drag: &CellDrag, window, cx| editor.move_notebook_cell(drag.0, index, window, cx)))
            .when(selected, |this| this.child(div().absolute().top(px(4.)).bottom(px(4.)).left_0().w(px(2.)).rounded_full().bg(colors.primary)))
            .child(div().flex_none().w(px(58.)).pt(px(32.)).flex().justify_end().child(handle))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(header)
                    .child(body)
                    .when(!outputs.is_empty(), |this| this.child(div().mt(px(8.)).flex().flex_col().gap(px(8.)).children(outputs))),
            )
            .into_any_element()
    }

    fn output_image(&mut self, data: &str, format: ImageFormat) -> Option<Arc<gpui::Image>> {
        let key = image_key(data);
        if let Some(image) = self.notebook.images.get(&key) {
            return Some(image.clone());
        }
        let bytes = if format == ImageFormat::Svg {
            data.as_bytes().to_vec()
        } else {
            let compact: String = data.chars().filter(|ch| !ch.is_whitespace()).collect();
            base64::engine::general_purpose::STANDARD.decode(compact).ok()?
        };
        let image = Arc::new(gpui::Image::from_bytes(format, bytes));
        self.notebook.images.insert(key, image.clone());
        Some(image)
    }

    fn render_output(&mut self, output: &Value, mono: &gpui::Font, base_dir: &Path, cx: &mut Context<Self>) -> Option<AnyElement> {
        let colors = cx.theme().colors.clone();
        let pre = |text: String, color| {
            div()
                .rounded(ui::metrics::radius_md())
                .bg(colors.surface)
                .p(px(10.))
                .font(mono.clone())
                .text_size(typography::text_sm())
                .text_color(color)
                .overflow_hidden()
                .child(text)
                .into_any_element()
        };
        match output.get("output_type").and_then(Value::as_str).unwrap_or_default() {
            "stream" => Some(pre(model::text(output.get("text")), colors.foreground)),
            "error" => {
                let traceback = output.get("traceback").and_then(Value::as_array).filter(|lines| !lines.is_empty());
                let text = match traceback {
                    Some(lines) => lines.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n"),
                    None => [output.get("ename"), output.get("evalue")].into_iter().flatten().filter_map(Value::as_str).filter(|part| !part.is_empty()).collect::<Vec<_>>().join(": "),
                };
                Some(
                    div()
                        .rounded(ui::metrics::radius_md())
                        .border_1()
                        .border_color(colors.destructive)
                        .bg(colors.surface)
                        .p(px(10.))
                        .font(mono.clone())
                        .text_size(typography::text_sm())
                        .text_color(colors.destructive)
                        .child(strip_ansi(&text))
                        .into_any_element(),
                )
            }
            "display_data" | "execute_result" => {
                for (mime, format) in [("image/png", ImageFormat::Png), ("image/jpeg", ImageFormat::Jpeg), ("image/svg+xml", ImageFormat::Svg)] {
                    let data = model::data_text(output, mime);
                    if data.is_empty() {
                        continue;
                    }
                    if let Some(image) = self.output_image(&data, format) {
                        return Some(div().rounded(ui::metrics::radius_md()).bg(colors.surface).p(px(10.)).child(img(ImageSource::from(image)).max_w_full()).into_any_element());
                    }
                }
                if !model::data_text(output, "application/pdf").is_empty() {
                    return Some(pre("PDF output".into(), colors.muted_foreground));
                }
                let plain = model::data_text(output, "text/plain");
                let html = model::data_text(output, "text/html");
                if !html.is_empty() {
                    return Some(pre(if plain.is_empty() { html } else { plain }, colors.foreground));
                }
                let markdown = model::data_text(output, "text/markdown");
                if !markdown.is_empty() {
                    return Some(div().rounded(ui::metrics::radius_md()).bg(colors.surface).p(px(10.)).child(markdown_preview::markdown_element(&markdown, base_dir.to_path_buf(), cx)).into_any_element());
                }
                for (code, language) in [(model::data_json(output), "json"), (model::data_text(output, "application/javascript"), "javascript")] {
                    if !code.is_empty() {
                        let runs = markdown_preview::code_runs(Some(language), &code, mono, colors.foreground, cx.theme());
                        return Some(
                            div().rounded(ui::metrics::radius_md()).bg(colors.surface).p(px(10.)).font(mono.clone()).text_size(typography::text_sm()).child(StyledText::new(code).with_runs(runs)).into_any_element(),
                        );
                    }
                }
                let latex = model::data_text(output, "text/latex");
                if !latex.is_empty() {
                    return Some(pre(latex, colors.foreground));
                }
                (!plain.is_empty()).then(|| pre(plain, colors.foreground))
            }
            _ => None,
        }
    }
}

/// Tracebacks carry terminal colour codes; the output shows plain text.
fn strip_ansi(text: &str) -> String {
    static ANSI: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").unwrap());
    ANSI.replace_all(text, "").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_edits_cover_only_the_change() {
        assert_eq!(minimal_edit("abcdef", "abXYef"), (2..4, "XY".to_string()));
        assert_eq!(minimal_edit("same", "same"), (4..4, String::new()));
        assert_eq!(minimal_edit("aé", "aè"), (1..3, "è".to_string()));
        assert_eq!(minimal_edit("aa", "aaa"), (2..2, "a".to_string()));
    }

    #[test]
    fn cells_run_beside_local_notebooks() {
        assert_eq!(working_directory(Path::new("/a/b.ipynb"), true), Some(PathBuf::from("/a")));
        assert_eq!(working_directory(Path::new("/a/b.ipynb"), false), None);
        assert_eq!(working_directory(Path::new("b.ipynb"), true), None);
    }
}
