//! The markdown preview (`features/editor/markdown` in Athas): the buffer drawn by the app's
//! shared markdown renderer, and editable where it is drawn. Clicking a paragraph, heading, list
//! or table opens the markdown it was written as in a field with the same `/` block commands and
//! formatting keys the GitHub composer has; ticking a task box writes the tick straight back to
//! the buffer. Every edit goes through the editor's document, so undo, save, git and the language
//! server see it as any other typing.
//!
//! It is its own view, so the workbench can open it in a tab beside the editor; the editor also
//! shows it in place of the text, or next to it, as the preview mode asks.

use std::{
    cell::Cell,
    collections::HashMap,
    ops::Range,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use gpui::{
    AnyElement, App, AppContext as _, Context, Entity, FocusHandle, Font, Hsla, ImageSource, IntoElement, ParentElement as _, Render, ScrollHandle,
    SharedString, StatefulInteractiveElement as _, Styled as _, Subscription, TextRun, Window, div, prelude::FluentBuilder as _, relative,
    InteractiveElement as _, KeyDownEvent,
};
use markdown::{Block, BlockKind, Handlers, MarkdownField, MarkdownStyle, Renderer, extension_for_language};
use theme::{ActiveTheme, Theme};
use ui::scale::px;
use ui::{Button, ButtonVariant, IconName, InputAppearance, TextInput, TextInputEvent, WithScrollbar, metrics, typography};

use crate::{
    Editor,
    document::Target,
    history::EditKind,
    remote_image::{RemoteImage, remote_image},
    syntax::{self, SyntaxState},
};

/// Text runs for a code block, highlighted with the editor's grammars.
pub(crate) fn code_runs(language: Option<&str>, code: &str, mono: &Font, foreground: Hsla, theme: &Theme) -> Vec<TextRun> {
    let extension = extension_for_language(language.unwrap_or_default());
    let config = syntax::language_for_path(Path::new(&format!("snippet.{extension}")));
    let rope = ropey::Rope::from_str(code);
    let mut state = SyntaxState::new(config.clone());
    if let Some(language) = config.ts_language() {
        state.tree = syntax::parse(&language, &rope, None);
    }
    let spans = state.highlights(&rope, 0..code.len());
    let run = |len: usize, font: Font, color: Hsla| TextRun { len, font, color, background_color: None, underline: None, strikethrough: None };
    let mut runs = Vec::new();
    let mut at = 0;
    for (range, kind) in spans {
        if range.start < at || range.end > code.len() {
            continue;
        }
        if range.start > at {
            runs.push(run(range.start - at, mono.clone(), foreground));
        }
        runs.push(run(range.len(), Font { weight: kind.weight(), style: kind.style(false), ..mono.clone() }, kind.color(theme)));
        at = range.end;
    }
    if at < code.len() {
        runs.push(run(code.len() - at, mono.clone(), foreground));
    }
    runs
}

/// Highlights code fences with the editor's grammars, for the shared renderer.
fn code_highlighter(cx: &App) -> Rc<dyn Fn(Option<&str>, &str, &Font, Hsla) -> Vec<TextRun>> {
    let theme = cx.theme().clone();
    Rc::new(move |language, code, mono, foreground| code_runs(language, code, mono, foreground, &theme))
}

/// The document's style, with the mono family the editor is set to.
fn preview_style(cx: &App) -> MarkdownStyle {
    MarkdownStyle { mono_font: SharedString::from(settings::get(cx).font_family.clone()), ..MarkdownStyle::document() }
}

/// A block opened for editing: where its markdown was in the buffer, and the field holding it.
struct BlockEdit {
    /// The block this field stands in for, as the document was parsed: what the page draws the
    /// field in place of.
    anchor: Range<usize>,
    /// The buffer range the field replaces when it is committed: the block without the blank
    /// line that follows it.
    source: Range<usize>,
    field: Entity<MarkdownField>,
    /// The text the field opened with; an unchanged block writes nothing back.
    original: String,
    /// What a block appended past the last one needs before it: written only with the block, so
    /// one opened and left empty leaves the buffer as it was.
    lead: &'static str,
    _subscriptions: Vec<Subscription>,
}

pub struct MarkdownPreview {
    editor: Entity<Editor>,
    /// Blocks for a buffer version and length (a loaded file starts again at version 0).
    cache: Option<((usize, usize), Arc<Vec<Block>>)>,
    scroll: ScrollHandle,
    focus_handle: FocusHandle,
    find: Option<PreviewFind>,
    /// A block to bring into view (an `#anchor` link, the current match), and where the last
    /// frame drew it.
    reveal: Option<usize>,
    reveal_bounds: Rc<Cell<Option<gpui::Bounds<gpui::Pixels>>>>,
    /// Frames waited for the block to reveal to be drawn; a block that no longer exists (the
    /// document shrank, the query changed) is given up on instead of redrawing forever.
    reveal_frames: u8,
    /// The block being written in, if any.
    editing: Option<BlockEdit>,
    /// Draws the document without letting it be written in, whatever the buffer allows.
    read_only: bool,
    /// A write made since the document was last drawn: where it ended, in the coordinates the
    /// drawn blocks were parsed in, and how many bytes it added or removed. A click that arrives
    /// against those blocks -- the one that moved focus out of a field and committed it -- is
    /// carried over the write before it is used.
    shift: Option<(usize, isize)>,
}

/// Find in the preview (`SearchPopover` over `markdown-preview.tsx`): matches of the query in the
/// rendered text, case-insensitive, with the current one marked and scrolled to.
struct PreviewFind {
    input: Entity<TextInput>,
    current: usize,
    _subscription: Subscription,
}

impl MarkdownPreview {
    /// A preview of `editor`'s buffer that follows its edits.
    pub fn new(editor: Entity<Editor>, cx: &mut Context<Self>) -> Self {
        cx.observe(&editor, |_, _, cx| cx.notify()).detach();
        Self {
            editor,
            cache: None,
            scroll: ScrollHandle::new(),
            focus_handle: cx.focus_handle(),
            find: None,
            reveal: None,
            reveal_bounds: Rc::default(),
            reveal_frames: 0,
            editing: None,
            read_only: false,
            shift: None,
        }
    }

    /// Whether clicking a block opens it for editing.
    fn editable(&self, cx: &App) -> bool {
        !self.read_only && !self.editor.read(cx).document.read_only
    }

    /// Draws the document without letting it be written in (a preview of someone else's file).
    pub fn read_only(mut self) -> Self {
        self.read_only = true;
        self
    }

    /// Opens Find over the preview, or focuses it again with its text selected.
    pub fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.is_none() {
            let input = cx.new(|cx| TextInput::new(window, cx).appearance(InputAppearance::Field).placeholder("Find in Markdown preview"));
            let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => {
                    if let Some(find) = &mut this.find {
                        find.current = 0;
                    }
                    this.reveal_current(cx);
                }
                TextInputEvent::Confirmed => {
                    let back = window.modifiers().shift;
                    this.step_find(if back { -1 } else { 1 }, cx);
                }
                TextInputEvent::Cancelled => this.close_find(window, cx),
                _ => {}
            });
            self.find = Some(PreviewFind { input, current: 0, _subscription: subscription });
        }
        if let Some(find) = &self.find {
            find.input.update(cx, |input, cx| {
                input.focus(window, cx);
                input.select_all_text(cx);
            });
        }
        cx.notify();
    }

    fn close_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.find = None;
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }

    fn query(&self, cx: &App) -> String {
        self.find.as_ref().map(|find| find.input.read(cx).text().to_string()).unwrap_or_default()
    }

    /// Matches per block, in the order the blocks draw them.
    fn match_counts(&mut self, cx: &App) -> Vec<usize> {
        let query = self.query(cx);
        self.blocks(cx).iter().map(|block| markdown::block_matches(block, &query)).collect()
    }

    fn step_find(&mut self, direction: isize, cx: &mut Context<Self>) {
        let total: usize = self.match_counts(cx).iter().sum();
        if total == 0 {
            return;
        }
        if let Some(find) = &mut self.find {
            find.current = (find.current as isize + direction).rem_euclid(total as isize) as usize;
        }
        self.reveal_current(cx);
    }

    /// Scrolls the current match's block into view.
    fn reveal_current(&mut self, cx: &mut Context<Self>) {
        let current = self.find.as_ref().map_or(0, |find| find.current);
        let mut seen = 0;
        for (index, count) in self.match_counts(cx).into_iter().enumerate() {
            if current < seen + count {
                self.reveal = Some(index);
                self.reveal_frames = 0;
                break;
            }
            seen += count;
        }
        cx.notify();
    }

    /// Follows an `#anchor` link: the heading whose slug (GitHub's, as `#setup` for "Setup") it
    /// names.
    fn follow_anchor(&mut self, anchor: &str, cx: &mut Context<Self>) {
        let anchor = anchor.trim_start_matches('#').to_lowercase();
        let blocks = self.blocks(cx);
        let mut seen: HashMap<String, usize> = HashMap::new();
        let target = blocks.iter().position(|block| {
            let BlockKind::Heading { text, .. } = &block.kind else { return false };
            let base = markdown::slug(&text.text);
            let count = seen.entry(base.clone()).or_insert(0);
            let id = if *count == 0 { base } else { format!("{base}-{count}") };
            *count += 1;
            id == anchor
        });
        if let Some(index) = target {
            self.reveal = Some(index);
            self.reveal_frames = 0;
            cx.notify();
        }
    }

    pub fn editor(&self) -> &Entity<Editor> {
        &self.editor
    }

    /// The tab title: "Preview README.md".
    pub fn title(&self, cx: &gpui::App) -> String {
        let path = self.editor.read(cx).path();
        format!("Preview {}", path.file_name().and_then(|name| name.to_str()).unwrap_or("markdown"))
    }

    fn blocks(&mut self, cx: &gpui::App) -> Arc<Vec<Block>> {
        let editor = self.editor.read(cx);
        let version = (editor.buffer_version(), editor.document.buffer.len());
        if let Some((cached, blocks)) = &self.cache
            && *cached == version
        {
            return blocks.clone();
        }
        let blocks = Arc::new(markdown::parse(&editor.text()));
        self.cache = Some((version, blocks.clone()));
        blocks
    }

    // Writing.

    /// Carries a range taken from the blocks last drawn over a write made since.
    fn moved(&self, range: Range<usize>) -> Range<usize> {
        moved(self.shift, range)
    }

    /// Replaces `range` in the buffer, as one undo step.
    fn write(&mut self, range: Range<usize>, text: String, cx: &mut Context<Self>) {
        let end = range.start + text.len();
        self.shift = Some((range.end, text.len() as isize - range.len() as isize));
        self.editor.update(cx, |editor, cx| {
            editor.update_document(cx, |document| {
                let len = document.buffer.len();
                let range = range.start.min(len)..range.end.min(len);
                document.apply_edits(vec![(range, text)], vec![Target::Exact { anchor: end, head: end }], EditKind::Other);
            });
        });
        self.cache = None;
        cx.notify();
    }

    /// Opens the markdown a block was written as, in a field where it sits.
    fn edit_block(&mut self, source: Range<usize>, window: &mut Window, cx: &mut Context<Self>) {
        if !self.editable(cx) {
            return;
        }
        // Finishing the block that was open -- which clicking this one did, by moving focus out
        // of its field -- can have moved this one further down the buffer.
        self.commit_edit(cx);
        let source = self.moved(source);
        self.open_block(source, "", window, cx);
    }

    /// Opens a field over `source`, a range of the buffer as it is now rather than as the blocks
    /// last drawn had it.
    fn open_block(&mut self, source: Range<usize>, lead: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.editor.read(cx).text();
        let anchor = source.start.min(text.len())..source.end.min(text.len());
        // The trailing newlines a block's range carries belong between blocks, not in the field.
        let source = block_text(&text, anchor.clone());
        let original = text[source.clone()].to_string();
        let rows = original.lines().count().max(1);
        let field = cx.new(|cx| {
            let field = MarkdownField::new("markdown-block", "Write markdown…", rows.min(20), None, cx);
            field.area().update(cx, |area, cx| area.set_text(original.clone(), cx));
            field
        });
        let subscriptions = vec![
            cx.subscribe_in(&field, window, |this, _, event: &markdown::FieldEvent, window, cx| match event {
                markdown::FieldEvent::Submit => {
                    this.commit_edit(cx);
                    window.focus(&this.focus_handle, cx);
                }
                markdown::FieldEvent::Cancel => {
                    this.editing = None;
                    window.focus(&this.focus_handle, cx);
                    cx.notify();
                }
                markdown::FieldEvent::Changed => cx.notify(),
            }),
            // Clicking away is as good as finishing: the field is the block, not a dialog.
            cx.on_focus_out(&gpui::Focusable::focus_handle(&field, cx), window, |this, _, _, cx| {
                this.commit_edit(cx);
            }),
        ];
        self.editing = Some(BlockEdit { anchor, source, field: field.clone(), original, lead, _subscriptions: subscriptions });
        field.update(cx, |field, cx| field.focus_at_end(window, cx));
        cx.notify();
    }

    /// Writes what was typed back where the block was.
    fn commit_edit(&mut self, cx: &mut Context<Self>) {
        let Some(edit) = self.editing.take() else { return };
        let Some(text) = block_write(edit.lead, &edit.original, edit.field.read(cx).text(cx)) else {
            cx.notify();
            return;
        };
        if text.is_empty() {
            let range = removal(&self.editor.read(cx).text(), edit.source);
            self.write(range, String::new(), cx);
        } else {
            self.write(edit.source, text, cx);
        }
    }

    /// Ticks or clears a task box, rewriting the `[ ]` it was drawn from.
    fn toggle_task(&mut self, source: Range<usize>, checked: bool, cx: &mut Context<Self>) {
        if !self.editable(cx) {
            return;
        }
        self.commit_edit(cx);
        let source = self.moved(source);
        let text = self.editor.read(cx).text();
        let Some((at, box_text)) = task_box(&text, source, checked) else { return };
        self.write(at, box_text.to_string(), cx);
    }

    /// Adds a paragraph at the end of the document and opens it (clicking the page below the
    /// last block, as a Notion page starts a new line).
    fn append_block(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.editable(cx) || self.editing.is_some() {
            self.commit_edit(cx);
            return;
        }
        let (at, lead) = append_point(&self.editor.read(cx).text());
        self.open_block(at..at, lead, window, cx);
    }

    /// What the renderer can call back into: links, images, task boxes and opening a block.
    fn handlers(&self, base_dir: PathBuf, remote: HashMap<String, RemoteImage>, cx: &mut Context<Self>) -> Handlers {
        let weak = cx.weak_entity();
        let anchors = weak.clone();
        let links_dir = base_dir.clone();
        let on_link = Rc::new(move |url: &str, _: &mut Window, cx: &mut App| {
            if markdown::is_web(url) {
                cx.open_url(url);
            } else if let Some(anchor) = url.strip_prefix('#') {
                let anchor = anchor.to_string();
                anchors.update(cx, |this, cx| this.follow_anchor(&anchor, cx)).ok();
            } else {
                // A file link opens in Athas (`handleFileSelect`), trying `.md` after it.
                let root = workbench_api::projects(cx).active.map(PathBuf::from);
                if let Some(path) = resolve_link(url, &links_dir, root.as_deref()) {
                    workbench_api::open_file(cx, path, None);
                }
            }
        });
        let images_dir = base_dir;
        let image = Rc::new(move |url: &str| -> Option<ImageSource> {
            if url.contains("://") {
                return match remote.get(url) {
                    Some(RemoteImage::Ready(image)) => Some(ImageSource::Image(image.clone())),
                    _ => None,
                };
            }
            Some(ImageSource::from(images_dir.join(url)))
        });
        let tasks = weak.clone();
        let on_toggle_task = Rc::new(move |source: Range<usize>, checked: bool, _: &mut Window, cx: &mut App| {
            tasks.update(cx, |this, cx| this.toggle_task(source, checked, cx)).ok();
        });
        let editable = self.editable(cx);
        let blocks = weak;
        let on_activate_block = editable.then(|| {
            Rc::new(move |source: Range<usize>, window: &mut Window, cx: &mut App| {
                blocks.update(cx, |this, cx| this.edit_block(source, window, cx)).ok();
            }) as Rc<dyn Fn(Range<usize>, &mut Window, &mut App)>
        });
        Handlers {
            on_link: Some(on_link),
            code_runs: Some(code_highlighter(cx)),
            image: Some(image),
            on_toggle_task: editable.then_some(on_toggle_task as Rc<dyn Fn(Range<usize>, bool, &mut Window, &mut App)>),
            on_activate_block,
        }
    }

    fn render_find_bar(&self, total: usize, current: usize, query: &str, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        let find = self.find.as_ref()?;
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let label = if query.is_empty() {
            None
        } else if total == 0 {
            Some("No results".to_string())
        } else {
            Some(format!("{} of {total}", current + 1))
        };
        let weak = cx.weak_entity();
        let step = move |direction: isize| {
            let weak = weak.clone();
            move |_: &gpui::ClickEvent, _: &mut Window, cx: &mut App| {
                weak.update(cx, |this, cx| this.step_find(direction, cx)).ok();
            }
        };
        let weak = cx.weak_entity();
        Some(
            div()
                .absolute()
                .top(px(8.))
                .right(px(8.))
                .w(px(320.))
                .p(px(8.))
                .flex()
                .flex_col()
                .gap(px(6.))
                .rounded(metrics::radius_lg())
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(div().flex_1().min_w_0().child(find.input.clone()))
                        .children(label.map(|label| div().flex_none().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(label)))
                        .child(Button::icon("markdown-find-close", IconName::X).variant(ButtonVariant::Ghost).tooltip("Close search").on_click(
                            move |_, window, cx| {
                                weak.update(cx, |this, cx| this.close_find(window, cx)).ok();
                            },
                        )),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_end()
                        .gap(px(4.))
                        .child(
                            Button::icon("markdown-find-previous", IconName::ArrowUp)
                                .variant(ButtonVariant::Ghost)
                                .tooltip("Previous match")
                                .disabled(total == 0)
                                .on_click(step(-1)),
                        )
                        .child(
                            Button::icon("markdown-find-next", IconName::ArrowDown)
                                .variant(ButtonVariant::Ghost)
                                .tooltip("Next match")
                                .disabled(total == 0)
                                .on_click(step(1)),
                        ),
                ),
        )
    }

    /// The field that stands in for the block being written in.
    fn render_block_edit(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(edit) = &self.editing else { return div().into_any_element() };
        let field = edit.field.clone();
        let bar = field.update(cx, |field, cx| field.format_bar(cx).map(IntoElement::into_any_element));
        div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .mx(px(-8.))
            .px(px(8.))
            .py(px(4.))
            .rounded(metrics::radius_md())
            .bg(colors.field)
            .border_1()
            .border_color(colors.focus_ring)
            .children(bar.map(|bar| div().flex().justify_end().child(bar)))
            .child(field.update(cx, |field, cx| field.bare(cx).into_any_element()))
            .into_any_element()
    }
}

impl Render for MarkdownPreview {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // The blocks below are parsed from the buffer as it is now, so nothing drawn from here on
        // needs carrying over an earlier write.
        self.shift = None;
        let blocks = self.blocks(cx);
        let colors = cx.theme().colors.clone();
        let base_dir = self.editor.read(cx).path().parent().map(Path::to_path_buf).unwrap_or_default();
        let mut remote = HashMap::new();
        for block in blocks.iter() {
            if let BlockKind::Image { src, .. } = &block.kind
                && src.starts_with("http")
                && src.contains("://")
            {
                remote.insert(src.clone(), remote_image(src, cx));
            }
        }
        let query = self.query(cx);
        let total: usize = if query.is_empty() { 0 } else { self.match_counts(cx).iter().sum() };
        if let Some(find) = &mut self.find {
            find.current = find.current.min(total.saturating_sub(1));
        }
        let current = self.find.as_ref().map_or(0, |find| find.current);
        // A block to reveal is measured on one frame and scrolled to the top on the next.
        if self.reveal.is_some() {
            if let Some(bounds) = self.reveal_bounds.take() {
                let viewport = self.scroll.bounds();
                let offset = self.scroll.offset();
                let top = (bounds.top() - viewport.top() - offset.y - px(12.)).max(px(0.));
                self.scroll.set_offset(gpui::point(offset.x, -top));
                self.reveal = None;
                self.reveal_frames = 0;
            } else if self.reveal_frames < 3 {
                self.reveal_frames += 1;
                window.request_animation_frame();
            } else {
                self.reveal = None;
                self.reveal_frames = 0;
            }
        }
        let reveal = self.reveal;
        let reveal_bounds = self.reveal_bounds.clone();
        let editing = self.editing.as_ref().map(|edit| edit.anchor.clone());
        let handlers = self.handlers(base_dir, remote, cx);
        let renderer = Renderer::new("markdown-preview", preview_style(cx))
            .with(handlers)
            .finding((!query.is_empty()).then(|| markdown::Find::new(query.clone(), current)));
        let edit_field = editing.is_some().then(|| self.render_block_edit(cx));
        let find_bar = self.render_find_bar(total, current, &query, cx).map(IntoElement::into_any_element);
        let mut edit_field = edit_field;
        let page = div()
            .flex()
            .flex_col()
            .gap(px(14. * markdown::PREVIEW_FLOW))
            .max_w(px(markdown::PAGE_WIDTH))
            .px(px(24.))
            .py(px(20.))
            .children(blocks.iter().enumerate().map(|(index, block)| {
                // The block being written in is drawn as the field that holds it.
                if editing.as_ref() == Some(&block.source)
                    && let Some(field) = edit_field.take()
                {
                    return field;
                }
                let element = renderer.block(block, cx);
                if reveal != Some(index) {
                    return element;
                }
                let bounds = reveal_bounds.clone();
                div()
                    .relative()
                    .child(element)
                    .child(gpui::canvas(move |area, _, _| bounds.set(Some(area)), |_, _, _, _| {}).absolute().size_full())
                    .into_any_element()
            }))
            // A block opened past the last one (an empty document, a new paragraph) draws there.
            .children(edit_field)
            .when(self.editable(cx), |this| {
                this.child(
                    div()
                        .id("markdown-append")
                        .h(px(80.))
                        .cursor_text()
                        .on_click(cx.listener(|this, _, window, cx| this.append_block(window, cx))),
                )
            });
        div()
            .id("markdown-preview-root")
            .relative()
            .size_full()
            .key_context("MarkdownPreview")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(|this, _: &crate::Find, window, cx| this.open_find(window, cx)))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "escape" && this.find.is_some() {
                    this.close_find(window, cx);
                    cx.stop_propagation();
                }
            }))
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    if !this.focus_handle.contains_focused(window, cx) && this.editing.is_none() {
                        window.focus(&this.focus_handle, cx);
                    }
                }),
            )
            .child(
                div()
                    .id("markdown-preview")
                    .size_full()
                    .overflow_y_scroll()
                    .bg(colors.background)
                    .text_color(colors.foreground)
                    .font_family(typography::ui_font())
                    .text_size(px(14.))
                    .line_height(relative(markdown::PREVIEW_LEADING))
                    .child(page)
                    .scrollbar_with(&self.scroll),
            )
            .children(find_bar)
    }
}

impl gpui::Focusable for MarkdownPreview {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// A range taken from the blocks last drawn, carried over a write made since: `shift` is where
/// that write ended, in those blocks' coordinates, and how many bytes it added or removed.
fn moved(shift: Option<(usize, isize)>, range: Range<usize>) -> Range<usize> {
    match shift {
        Some((at, difference)) if range.start >= at => range.start.saturating_add_signed(difference)..range.end.saturating_add_signed(difference),
        _ => range,
    }
}

/// The `[ ]` inside a task marker's source, and what ticking or clearing it writes there. The
/// marker a parser reports is `[ ]` or `[x]`, sometimes with the space after it.
fn task_box(text: &str, source: Range<usize>, checked: bool) -> Option<(Range<usize>, &'static str)> {
    if source.end > text.len() {
        return None;
    }
    let marker = text.get(source.clone())?;
    let open = marker.find('[')?;
    let close = marker[open..].find(']').map(|at| open + at)?;
    Some((source.start + open..source.start + close + 1, if checked { "[x]" } else { "[ ]" }))
}

/// What committing a field writes over its block, or nothing when it is as it opened. Newlines at
/// either end are dropped: a block opens without them (`block_text`), so blank lines typed there
/// would land in the file but never show in the field again.
fn block_write(lead: &str, original: &str, typed: String) -> Option<String> {
    let typed = typed.trim_matches('\n');
    if typed == original {
        return None;
    }
    Some(format!("{lead}{typed}"))
}

// The newlines that end the file belong to the file, not to its last block: a block appended
// goes in before them and an emptied last block leaves them, so the two undo each other.

/// Where a block appended past the last one goes, and the blank line it needs before it.
fn append_point(text: &str) -> (usize, &'static str) {
    let content_end = text.trim_end_matches('\n').len();
    (content_end, if content_end == 0 { "" } else { "\n\n" })
}

/// What emptying a block removes: the block with the blank lines that set it apart, the ones
/// after it or, for the last block, the ones before it.
fn removal(text: &str, source: Range<usize>) -> Range<usize> {
    let bytes = text.as_bytes();
    let mut end = source.end.min(text.len());
    while end < text.len() && bytes[end] == b'\n' {
        end += 1;
    }
    if end < text.len() {
        return source.start..end;
    }
    let mut start = source.start.min(source.end);
    while start > 0 && bytes[start - 1] == b'\n' {
        start -= 1;
    }
    start..source.end.min(text.len())
}

/// The markdown a block opens for writing: its source without the blank line after it.
fn block_text(text: &str, source: Range<usize>) -> Range<usize> {
    let source = source.start.min(text.len())..source.end.min(text.len());
    let trimmed = text[source.clone()].trim_end_matches('\n');
    source.start..source.start + trimmed.len()
}

/// Where the preview is drawn for a markdown file's editor.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PreviewMode {
    /// In place of the text: what a markdown file opens as.
    #[default]
    Full,
    /// Beside the text, following it as it is typed.
    Split,
}

/// The preview shown inside the editor pane.
pub(crate) struct PreviewPane {
    pub preview: Entity<MarkdownPreview>,
    pub mode: PreviewMode,
}

/// The file a relative link in the preview points at (`resolvePath`): beside the document, or
/// from the project's root for a link starting with `/`; `name.md` when `name` is missing.
fn resolve_link(url: &str, base: &std::path::Path, root: Option<&std::path::Path>) -> Option<std::path::PathBuf> {
    let href = url.split(['#', '?']).next().unwrap_or_default();
    if href.is_empty() {
        return None;
    }
    let decoded = href.replace("%20", " ");
    let target = match decoded.strip_prefix('/') {
        Some(rooted) => root.map_or_else(|| std::path::PathBuf::from(&decoded), |root| root.join(rooted)),
        None => base.join(&decoded),
    };
    if target.exists() {
        return Some(target);
    }
    let with_md = if decoded.ends_with(".md") { target } else { std::path::PathBuf::from(format!("{}.md", target.display())) };
    with_md.exists().then_some(with_md)
}

impl Editor {
    /// A preview of this editor's buffer, for the workbench to open beside it (in a tab).
    pub fn markdown_preview(&self, cx: &mut Context<Self>) -> Entity<MarkdownPreview> {
        let editor = cx.entity();
        cx.new(|cx| MarkdownPreview::new(editor, cx))
    }

    /// Whether the file is markdown (the preview action applies).
    pub fn is_markdown(&self) -> bool {
        self.document.syntax.language.name == "Markdown"
    }

    /// Whether the rendered document is what the pane shows.
    pub fn previewing(&self) -> bool {
        self.preview.as_ref().is_some_and(|pane| pane.mode == PreviewMode::Full)
    }

    pub(crate) fn open_preview_pane(&mut self, mode: PreviewMode, cx: &mut Context<Self>) {
        let preview = self.markdown_preview(cx);
        self.preview = Some(PreviewPane { preview, mode });
        cx.notify();
    }

    /// Swaps the rendered document for the markdown it was written as, and back.
    pub fn toggle_markdown_source(&mut self, cx: &mut Context<Self>) {
        match self.previewing() {
            true => self.preview = None,
            false if self.is_markdown() => self.open_preview_pane(PreviewMode::Full, cx),
            false => {}
        }
        cx.notify();
    }

    /// Shows or hides the rendered markdown to the right of the text. From the full document it
    /// opens the text beside it, rather than closing what the file opened as.
    pub(crate) fn toggle_markdown_preview(&mut self, _: &crate::ToggleMarkdownPreview, _: &mut Window, cx: &mut Context<Self>) {
        let showing = self.preview.take().map(|pane| pane.mode);
        if showing != Some(PreviewMode::Split) && self.is_markdown() {
            self.open_preview_pane(PreviewMode::Split, cx);
        }
        cx.notify();
    }

    /// The preview beside the text, when it is shown that way.
    pub(crate) fn render_preview_pane(&self, cx: &Context<Self>) -> Option<AnyElement> {
        let pane = self.preview.as_ref().filter(|pane| pane.mode == PreviewMode::Split)?;
        Some(div().flex_none().w(relative(0.5)).h_full().border_l_1().border_color(cx.theme().colors.border).child(pane.preview.clone()).into_any_element())
    }

    /// The preview in place of the text, when the file opened as a document.
    pub(crate) fn render_full_preview(&self) -> Option<AnyElement> {
        let pane = self.preview.as_ref().filter(|pane| pane.mode == PreviewMode::Full)?;
        Some(div().flex().flex_1().min_h_0().size_full().child(pane.preview.clone()).into_any_element())
    }
}

/// Rendered markdown without the preview's page: notebook cells and outputs.
pub(crate) fn markdown_element(markdown: &str, base_dir: PathBuf, cx: &gpui::App) -> AnyElement {
    let images_dir = base_dir;
    let handlers = Handlers {
        code_runs: Some(code_highlighter(cx)),
        image: Some(Rc::new(move |url: &str| (!url.contains("://")).then(|| ImageSource::from(images_dir.join(url))))),
        ..Handlers::default()
    };
    let blocks = markdown::parse(markdown);
    Renderer::new("markdown-cell", preview_style(cx)).with(handlers).document(&blocks, cx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticking_a_task_rewrites_the_box_it_was_drawn_from() {
        let text = "- [ ] todo\n- [x] done\n";
        let blocks = markdown::parse(text);
        let BlockKind::List { items, .. } = &blocks[0].kind else { panic!("{blocks:?}") };
        let first = items[0].check_source.clone().unwrap();
        assert_eq!(task_box(text, first.clone(), true), Some((2..5, "[x]")));
        assert_eq!(&text[2..5], "[ ]");
        let second = items[1].check_source.clone().unwrap();
        assert_eq!(task_box(text, second, false), Some((13..16, "[ ]")));
        assert_eq!(task_box(text, 100..200, true), None, "a stale range writes nothing");
    }

    #[test]
    fn a_block_opens_without_the_blank_line_after_it() {
        let text = "# Title\n\nA paragraph.\n\n- one\n- two\n";
        let blocks = markdown::parse(text);
        let opened = |index: usize| text[block_text(text, blocks[index].source.clone())].to_string();
        assert_eq!(opened(0), "# Title");
        assert_eq!(opened(1), "A paragraph.");
        assert_eq!(opened(2), "- one\n- two");
    }

    #[test]
    fn a_block_appended_and_left_empty_writes_nothing() {
        assert_eq!(block_write("\n", "", String::new()), None);
        assert_eq!(block_write("\n", "", "More.".into()).as_deref(), Some("\nMore."));
        assert_eq!(block_write("", "A paragraph.", "A paragraph.".into()), None);
    }

    #[test]
    fn blank_lines_typed_at_a_blocks_edges_are_not_written() {
        assert_eq!(block_write("", "A paragraph.", "A paragraph.\n\n".into()), None);
        assert_eq!(block_write("", "A paragraph.", "\nA paragraph.".into()), None);
        assert_eq!(block_write("\n", "", "\n".into()), None);
        assert_eq!(block_write("", "One.", "One.\n\nTwo.\n".into()).as_deref(), Some("One.\n\nTwo."));
        assert_eq!(block_write("", "```\ncode\n```", "```\ncode\n\n```".into()).as_deref(), Some("```\ncode\n\n```"));
    }

    #[test]
    fn an_emptied_block_takes_its_blank_lines_with_it() {
        let emptied = |text: &str, index: usize| {
            let blocks = markdown::parse(text);
            let range = removal(text, block_text(text, blocks[index].source.clone()));
            let mut text = text.to_string();
            text.replace_range(range, "");
            text
        };
        let text = "# Title\n\nA paragraph.\n\n- one\n- two\n";
        assert_eq!(emptied(text, 0), "A paragraph.\n\n- one\n- two\n");
        assert_eq!(emptied(text, 1), "# Title\n\n- one\n- two\n");
        assert_eq!(emptied(text, 2), "# Title\n\nA paragraph.\n");
        assert_eq!(emptied("One.\n\nTwo.", 1), "One.");
        assert_eq!(emptied("Only.\n", 0), "\n");
    }

    #[test]
    fn a_block_appended_then_emptied_leaves_the_file_as_it_was() {
        for original in ["A\n\n", "A\n", "A", "", "\n"] {
            let (at, lead) = append_point(original);
            let mut text = original.to_string();
            text.insert_str(at, &format!("{lead}More."));
            let source = at + lead.len()..at + lead.len() + "More.".len();
            assert_eq!(markdown::parse(&text).last().map(|block| block_text(&text, block.source.clone())), Some(source.clone()), "{original:?}");
            text.replace_range(removal(&text, source), "");
            assert_eq!(text, original, "{original:?}");
        }
    }

    #[test]
    fn a_click_against_the_last_frame_is_carried_over_a_write_since() {
        let shrank = Some((20, -6));
        assert_eq!(moved(shrank, 30..40), 24..34, "a block after the write moves back by what it lost");
        assert_eq!(moved(shrank, 5..10), 5..10, "a block before it stays where it was");
        assert_eq!(moved(Some((20, 4)), 30..40), 34..44, "and forward by what a longer one added");
        assert_eq!(moved(None, 30..40), 30..40, "nothing was written since the blocks were drawn");
    }

    #[test]
    fn links_resolve_beside_the_document_or_from_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let docs = dir.path().join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(docs.join("guide.md"), "").unwrap();
        std::fs::write(dir.path().join("README.md"), "").unwrap();
        assert_eq!(resolve_link("guide.md#setup", &docs, None), Some(docs.join("guide.md")));
        assert_eq!(resolve_link("guide", &docs, None), Some(docs.join("guide.md")), "the .md fallback");
        assert_eq!(resolve_link("/README.md", &docs, Some(dir.path())), Some(dir.path().join("README.md")));
        assert_eq!(resolve_link("missing.md", &docs, None), None);
        assert_eq!(resolve_link("#top", &docs, None), None);
    }
}
