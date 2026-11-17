//! Viewers for files that are not text (`features/viewer`): images, PDFs, CSV tables and binary
//! files.

mod binary;
mod csv;
mod image_edit;
mod image_editor;
mod pdf;

use std::{
    cell::Cell,
    collections::{HashSet, VecDeque},
    ops::Range,
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use gpui::{
    AnyElement, App, Bounds, ClipboardItem, Context, DismissEvent, Entity, FocusHandle, Focusable, IntoElement, ListAlignment, ListState,
    MouseButton, MouseDownEvent, MouseMoveEvent, ObjectFit, Pixels, Point, Render, RenderImage, ScrollEvent,
    ScrollHandle, SharedString, Subscription, Task, UniformListScrollHandle, Window, canvas, deferred, div, img, list, prelude::*, px,
    uniform_list,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, EmptyState, IconName, PathBreadcrumb, WithScrollbar, metrics, pane_actions, pane_header, typography};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];
/// Zoom levels the zoom buttons step through.
const ZOOM_STEPS: &[f32] = &[0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1., 1.25, 1.5, 2., 3., 4., 6., 8., 12., 16.];
const MIN_ZOOM: f32 = 0.05;
const MAX_ZOOM: f32 = 16.;
/// The most of a binary file read: its WebAssembly sections, the first bytes for the preview.
const HEX_LIMIT: usize = 16 * 1024 * 1024;
/// Rendered PDF pages kept in memory.
const PDF_CACHE: usize = 12;
const PDF_GAP: Pixels = px(12.);
const TABLE_ROW: Pixels = px(26.);
/// Width of one character of the monospace table text at `TEXT_SM`.
const MONO_CHAR: f32 = 7.3;

/// Whether `path` opens in a viewer instead of the editor.
pub fn can_view(path: &Path) -> bool {
    Kind::of(path).is_some()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Image,
    Pdf,
    Csv,
    Binary,
}

impl Kind {
    fn of(path: &Path) -> Option<Kind> {
        let extension = extension(path);
        if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
            Some(Kind::Image)
        } else if extension == "pdf" {
            Some(Kind::Pdf)
        } else if extension == "csv" || extension == "tsv" {
            Some(Kind::Csv)
        } else if binary::is_binary(path) {
            Some(Kind::Binary)
        } else {
            None
        }
    }
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// The next zoom step above (`up`) or below the current zoom.
fn step_zoom(zoom: f32, up: bool) -> f32 {
    let next = if up {
        ZOOM_STEPS.iter().copied().find(|step| *step > zoom + 0.001)
    } else {
        ZOOM_STEPS.iter().rev().copied().find(|step| *step < zoom - 0.001)
    };
    next.unwrap_or(zoom).clamp(MIN_ZOOM, MAX_ZOOM)
}

/// The scale that fits an image of `size` inside `bounds`, never above 1:1.
fn fit_scale(size: (f32, f32), bounds: (f32, f32)) -> f32 {
    if size.0 <= 0. || size.1 <= 0. || bounds.0 <= 0. || bounds.1 <= 0. {
        return 1.;
    }
    (bounds.0 / size.0).min(bounds.1 / size.1).min(1.)
}

fn percent(zoom: f32) -> String {
    format!("{}%", (zoom * 100.).round() as i32)
}

enum Loaded {
    Image { size: Option<(u32, u32)>, bytes: u64 },
    Csv { text: String, bytes: u64 },
    Pdf { document: pdf::Document, bytes: u64 },
    Binary { data: Vec<u8>, bytes: u64 },
}

/// Reads a file of the workspace server's on the web, where there is no local disk.
pub type WebReader = std::sync::Arc<dyn Fn(&Path) -> std::io::Result<Vec<u8>> + Send + Sync>;

#[cfg(target_family = "wasm")]
static WEB_READER: std::sync::OnceLock<WebReader> = std::sync::OnceLock::new();

/// Lets the viewer read the workspace server's files on the web.
#[cfg(target_family = "wasm")]
pub fn set_web_reader(reader: WebReader) {
    let _ = WEB_READER.set(reader);
}

#[cfg(target_family = "wasm")]
fn load(kind: Kind, path: &Path) -> anyhow::Result<Loaded> {
    let reader = WEB_READER.get().ok_or_else(|| anyhow::anyhow!("Files can't be read here."))?;
    let data = reader(path)?;
    let bytes = data.len() as u64;
    Ok(match kind {
        Kind::Image => Loaded::Image { size: image::ImageReader::new(std::io::Cursor::new(&data)).with_guessed_format()?.into_dimensions().ok(), bytes },
        Kind::Csv => Loaded::Csv { text: String::from_utf8_lossy(&data).into_owned(), bytes },
        Kind::Pdf => Loaded::Pdf { document: pdf::open(data)?, bytes },
        Kind::Binary => Loaded::Binary { data: data.into_iter().take(HEX_LIMIT).collect(), bytes },
    })
}

#[cfg(not(target_family = "wasm"))]
fn load(kind: Kind, path: &Path) -> anyhow::Result<Loaded> {
    let bytes = std::fs::metadata(path)?.len();
    Ok(match kind {
        Kind::Image => Loaded::Image { size: image::image_dimensions(path).ok(), bytes },
        Kind::Csv => {
            let data = std::fs::read(path)?;
            Loaded::Csv { text: String::from_utf8_lossy(&data).into_owned(), bytes }
        }
        Kind::Pdf => Loaded::Pdf { document: pdf::open(std::fs::read(path)?)?, bytes },
        Kind::Binary => {
            use std::io::Read as _;
            let mut data = Vec::new();
            std::fs::File::open(path)?.take(HEX_LIMIT as u64).read_to_end(&mut data)?;
            Loaded::Binary { data, bytes }
        }
    })
}

struct ImageState {
    size: Option<(u32, u32)>,
    bytes: u64,
    /// `None` fits the image to the view.
    zoom: Option<f32>,
    offset: Point<Pixels>,
    drag: Option<Point<Pixels>>,
    bounds: Rc<Cell<Bounds<Pixels>>>,
    edits: image_editor::ImageEdits,
}

impl ImageState {
    /// The size of the image as edited, else as opened.
    fn shown_size(&self) -> Option<(u32, u32)> {
        self.edits.current().map(|image| image.size).or(self.size)
    }

    fn fit(&self) -> f32 {
        let Some((width, height)) = self.shown_size() else { return 1. };
        let bounds = self.bounds.get().size;
        fit_scale((width as f32, height as f32), (f32::from(bounds.width) - 48., f32::from(bounds.height) - 48.))
    }

    fn effective_zoom(&self) -> f32 {
        self.zoom.unwrap_or_else(|| self.fit())
    }
}

struct CsvState {
    text: String,
    bytes: u64,
    delimiter: csv::Delimiter,
    /// "Auto": the delimiter is the detected one.
    auto_delimiter: bool,
    has_header: bool,
    table: csv::Table,
    widths: Vec<Pixels>,
    scroll: UniformListScrollHandle,
    /// The Delimiter select (`csv-preview.tsx`): Auto, Comma, Tab, Semicolon, Pipe.
    delimiter_select: Option<Entity<ui::Select>>,
    _delimiter_changed: Option<gpui::Subscription>,
}

const AUTO_DELIMITER: &str = "auto";

impl CsvState {
    fn new(text: String, bytes: u64, delimiter: csv::Delimiter) -> Self {
        let mut state = Self {
            text,
            bytes,
            delimiter,
            auto_delimiter: true,
            has_header: true,
            table: csv::Table::default(),
            widths: Vec::new(),
            scroll: UniformListScrollHandle::new(),
            delimiter_select: None,
            _delimiter_changed: None,
        };
        state.reparse();
        state
    }

    fn reparse(&mut self) {
        self.table = csv::parse(&self.text, self.delimiter, self.has_header);
        self.widths = csv::column_widths(&self.table, 200, 4, 40)
            .into_iter()
            // 20px of padding, the right border and a little slack so a column as wide as its
            // widest value does not cut it.
            .map(|chars| px(chars as f32 * MONO_CHAR + 24.))
            .collect();
    }

    fn row_number_width(&self) -> Pixels {
        px(self.table.rows.len().max(1).to_string().len() as f32 * MONO_CHAR + 24.)
    }
}

struct PdfState {
    document: Arc<pdf::Document>,
    bytes: u64,
    /// `None` fits pages to the view's width.
    zoom: Option<f32>,
    list: ListState,
    /// Rendered pages, most recent last: (page, pixel scale, image).
    cache: VecDeque<(usize, f32, Arc<RenderImage>)>,
    rendering: HashSet<usize>,
    tasks: Vec<Task<()>>,
    /// The width pages fit to, measured each frame (the list's own bounds can't be read while it lays out).
    viewport_width: Rc<Cell<Pixels>>,
    /// The width the list's page heights were measured at.
    laid_out_width: Pixels,
}

impl PdfState {
    fn page_zoom(&self, page: usize) -> f32 {
        if let Some(zoom) = self.zoom {
            return zoom;
        }
        let width = f32::from(self.viewport_width.get());
        let available = if width > 0. { width - 48. } else { 760. };
        let page_width = self.document.pages.get(page).map(|page| page.0).unwrap_or(612.).max(1.);
        (available / page_width).clamp(MIN_ZOOM, MAX_ZOOM)
    }

    fn cached(&self, page: usize, scale: f32) -> Option<Arc<RenderImage>> {
        self.cache.iter().rev().find(|(index, at, _)| *index == page && (at - scale).abs() < 0.01).map(|entry| entry.2.clone())
    }

    /// The best image of `page` there is, at any scale, while the right one renders.
    fn any_cached(&self, page: usize) -> Option<Arc<RenderImage>> {
        self.cache.iter().rev().find(|(index, _, _)| *index == page).map(|entry| entry.2.clone())
    }
}

struct BinaryState {
    /// The first bytes, for the hex preview.
    data: Vec<u8>,
    bytes: u64,
    wasm: Option<binary::WasmModule>,
    scroll: ScrollHandle,
}

enum Content {
    Loading,
    Failed(String),
    Image(ImageState),
    Csv(CsvState),
    Pdf(PdfState),
    Binary(BinaryState),
}

pub struct FileViewer {
    path: PathBuf,
    focus_handle: FocusHandle,
    content: Content,
    notice: Option<SharedString>,
    menu: Option<ui::OpenMenu>,
    link_prompt: Option<(Entity<ui::AlertDialog>, Subscription)>,
    _load: Option<Task<()>>,
    /// Modification time and length when last loaded; a change on disk reloads the view.
    stamp: Option<(std::time::SystemTime, u64)>,
    _watch: Option<Task<()>>,
}

/// How often an open viewer checks its file for changes.
const WATCH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

fn file_stamp(path: &Path) -> Option<(std::time::SystemTime, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    Some((metadata.modified().ok()?, metadata.len()))
}

impl Focusable for FileViewer {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl FileViewer {
    pub fn open(path: PathBuf, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        let kind = Kind::of(&path);
        let load_path = path.clone();
        let task = kind.map(|kind| {
            cx.spawn(async move |this, cx| {
                let loaded = cx.background_spawn(async move { load(kind, &load_path) }).await;
                this.update(cx, |this, cx| this.loaded(loaded, cx)).ok();
            })
        });
        let content = if kind.is_some() { Content::Loading } else { Content::Failed("This file has no viewer.".into()) };
        let stamp = file_stamp(&path);
        let watch = kind.map(|_| {
            let watch_path = path.clone();
            cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(WATCH_INTERVAL).await;
                    let probe = watch_path.clone();
                    let stamp = cx.background_spawn(async move { file_stamp(&probe) }).await;
                    if this.update(cx, |this, cx| this.file_changed(stamp, cx)).is_err() {
                        break;
                    }
                }
            })
        });
        Self {
            path,
            focus_handle: cx.focus_handle(),
            content,
            notice: None,
            menu: None,
            link_prompt: None,
            _load: task,
            stamp,
            _watch: watch,
        }
    }

    /// Reloads the view when the file changed on disk, unless an image has unsaved edits.
    fn file_changed(&mut self, stamp: Option<(std::time::SystemTime, u64)>, cx: &mut Context<Self>) {
        if stamp.is_none() || stamp == self.stamp || matches!(self.content, Content::Loading) {
            return;
        }
        if let Content::Image(state) = &self.content
            && state.edits.current().is_some()
        {
            return;
        }
        let Some(kind) = Kind::of(&self.path) else { return };
        self.stamp = stamp;
        if kind == Kind::Image {
            let resource = gpui::Resource::Path(self.path.clone().into());
            cx.remove_asset::<gpui::ImgResourceLoader>(&resource);
        }
        let load_path = self.path.clone();
        self._load = Some(cx.spawn(async move |this, cx| {
            let loaded = cx.background_spawn(async move { load(kind, &load_path) }).await;
            this.update(cx, |this, cx| this.reloaded(loaded, cx)).ok();
        }));
    }

    /// Takes a reloaded file, keeping the image's zoom and position.
    fn reloaded(&mut self, loaded: anyhow::Result<Loaded>, cx: &mut Context<Self>) {
        if let (Content::Image(state), Ok(Loaded::Image { size, bytes })) = (&mut self.content, &loaded) {
            state.size = *size;
            state.bytes = *bytes;
            cx.notify();
            return;
        }
        self.loaded(loaded, cx);
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn loaded(&mut self, loaded: anyhow::Result<Loaded>, cx: &mut Context<Self>) {
        self.content = match loaded {
            Err(error) => Content::Failed(error.to_string()),
            Ok(Loaded::Image { size, bytes }) => Content::Image(ImageState {
                size,
                bytes,
                zoom: None,
                offset: Point::default(),
                drag: None,
                bounds: Rc::new(Cell::new(Bounds::default())),
                edits: Default::default(),
            }),
            Ok(Loaded::Csv { text, bytes }) => {
                let delimiter = if extension(&self.path) == "tsv" { csv::Delimiter::Tab } else { csv::detect_delimiter(&text) };
                let mut state = CsvState::new(text, bytes, delimiter);
                let options = std::iter::once(ui::SelectOption::new(AUTO_DELIMITER, "Auto"))
                    .chain(csv::Delimiter::ALL.into_iter().map(|delimiter| ui::SelectOption::new(delimiter.label(), delimiter.label())))
                    .collect();
                let select = cx.new(|cx| ui::Select::new(options, AUTO_DELIMITER, cx).tooltip("Change delimiter"));
                state._delimiter_changed = Some(cx.subscribe(&select, |this, _, event: &ui::SelectEvent, cx| {
                    if let ui::SelectEvent::Changed(value) = event {
                        let value = value.clone();
                        this.with_csv(cx, |state| {
                            match csv::Delimiter::ALL.into_iter().find(|delimiter| delimiter.label() == value.as_ref()) {
                                Some(delimiter) => {
                                    state.auto_delimiter = false;
                                    state.delimiter = delimiter;
                                }
                                None => {
                                    state.auto_delimiter = true;
                                    state.delimiter = csv::detect_delimiter(&state.text);
                                }
                            }
                            state.reparse();
                        });
                    }
                }));
                state.delimiter_select = Some(select);
                Content::Csv(state)
            }
            Ok(Loaded::Pdf { document, bytes }) => {
                let count = document.pages.len();
                Content::Pdf(PdfState {
                    document: Arc::new(document),
                    bytes,
                    zoom: None,
                    list: ListState::new(count, ListAlignment::Top, px(800.)),
                    cache: VecDeque::new(),
                    rendering: HashSet::new(),
                    tasks: Vec::new(),
                    viewport_width: Rc::new(Cell::new(px(0.))),
                    laid_out_width: px(0.),
                })
            }
            Ok(Loaded::Binary { mut data, bytes }) => {
                let wasm = binary::parse_wasm(&data);
                data.truncate(binary::PREVIEW_BYTES);
                Content::Binary(BinaryState { data, bytes, wasm, scroll: ScrollHandle::new() })
            }
        };
        cx.notify();
    }

    fn open_externally(&mut self, cx: &mut Context<Self>) {
        cx.open_with_system(&self.path);
    }

    fn set_notice(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.notice = Some(message.into());
        cx.notify();
    }

    // Images

    fn zoom_image(&mut self, zoom: Option<f32>, cx: &mut Context<Self>) {
        if let Content::Image(state) = &mut self.content {
            state.zoom = zoom.map(|zoom| zoom.clamp(MIN_ZOOM, MAX_ZOOM));
            if zoom.is_none() {
                state.offset = Point::default();
            }
            cx.notify();
        }
    }

    fn step_image_zoom(&mut self, up: bool, cx: &mut Context<Self>) {
        if let Content::Image(state) = &self.content {
            let zoom = step_zoom(state.effective_zoom(), up);
            self.zoom_image(Some(zoom), cx);
        }
    }

    fn image_scroll(&mut self, event: &ScrollEvent, _: &mut Window, cx: &mut Context<Self>) {
        let Content::Image(state) = &mut self.content else { return };
        let delta = event.delta.pixel_delta(px(16.));
        if event.modifiers.control || event.modifiers.platform {
            let factor = (1. + f32::from(delta.y) * 0.01).clamp(0.5, 2.);
            state.zoom = Some((state.effective_zoom() * factor).clamp(MIN_ZOOM, MAX_ZOOM));
        } else if state.zoom.is_some() {
            state.offset = state.offset + delta;
        } else {
            return;
        }
        cx.stop_propagation();
        cx.notify();
    }

    fn render_image(&self, state: &ImageState, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let zoom = state.effective_zoom();
        let source: gpui::ImageSource = match state.edits.current() {
            Some(edited) => edited.render.clone().into(),
            None => self.path.clone().into(),
        };
        let image = img(source).flex_none().with_fallback(|| {
            EmptyState::new("Could not load this image").icon(IconName::Image).into_any_element()
        });
        let image = match (state.zoom, state.shown_size()) {
            (Some(zoom), Some((width, height))) => image
                .w(px(width as f32 * zoom))
                .h(px(height as f32 * zoom))
                .relative()
                .left(state.offset.x)
                .top(state.offset.y),
            (None, Some((width, height))) => image.w(px(width as f32 * zoom)).h(px(height as f32 * zoom)),
            _ => image.size_full().object_fit(ObjectFit::ScaleDown),
        };
        let bounds = state.bounds.clone();
        let dragging = state.drag.is_some();
        let edit_controls = self.edit_controls(cx);
        let has_edit_controls = !edit_controls.is_empty();
        let toolbar = self
            .toolbar(Some(extension(&self.path).to_ascii_uppercase()), cx)
            .children(edit_controls)
            .when(has_edit_controls, |this| this.child(chrome_separator(&colors)))
            .child(self.zoom_controls("viewer", zoom, cx, |this, step, cx| match step {
                Some(up) => this.step_image_zoom(up, cx),
                None => this.zoom_image(None, cx),
            }))
            .child(self.open_button(cx));
        let (format, bytes) = match state.edits.current() {
            Some(edited) => (edited.format.label().to_ascii_uppercase(), edited.bytes.len() as u64),
            None => (extension(&self.path).to_ascii_uppercase(), state.bytes),
        };
        // `Zoom: 100%  Type: PNG  320 × 200px`, the size on the right, and how much an edit
        // changed it.
        let mut info = vec![format!("Zoom: {}", percent(zoom))];
        if !format.is_empty() {
            info.push(format!("Type: {format}"));
        }
        if let Some((width, height)) = state.shown_size() {
            info.push(format!("{width} × {height}px"));
        }
        if state.edits.current().is_some() && state.bytes > 0 && bytes != state.bytes {
            let change = ((bytes as f64 - state.bytes as f64) / state.bytes as f64 * 100.).round().abs() as i64;
            info.push(format!("{}{change}%", if bytes < state.bytes { "↓" } else { "↑" }));
        }
        let info = StatusText { start: info, end: Some(format!("Size: {}", binary::format_size(bytes))) };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(toolbar)
            .child(
                div()
                    .id("viewer-image-stage")
                    .relative()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .items_center()
                    .justify_center()
                    .overflow_hidden()
                    .bg(colors.background)
                    .when(state.zoom.is_some(), |this| this.cursor(if dragging { gpui::CursorStyle::ClosedHand } else { gpui::CursorStyle::OpenHand }))
                    .on_scroll(cx.listener(Self::image_scroll))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &MouseDownEvent, _, cx| {
                            if let Content::Image(state) = &mut this.content {
                                if state.zoom.is_some() {
                                    state.drag = Some(event.position);
                                    cx.notify();
                                }
                            }
                        }),
                    )
                    .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                        if let Content::Image(state) = &mut this.content {
                            if let Some(start) = state.drag {
                                if event.pressed_button == Some(MouseButton::Left) {
                                    state.offset = state.offset + (event.position - start);
                                    state.drag = Some(event.position);
                                } else {
                                    state.drag = None;
                                }
                                cx.notify();
                            }
                        }
                    }))
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(|this, _, _, cx| {
                            if let Content::Image(state) = &mut this.content {
                                state.drag = None;
                                cx.notify();
                            }
                        }),
                    )
                    .on_mouse_down(MouseButton::Right, cx.listener(Self::image_context_menu))
                    .child(
                        canvas(move |stage, _, _| bounds.set(stage), |_, _, _, _| {})
                            .absolute()
                            .size_full(),
                    )
                    .child(image)
                    .children(self.render_image_overlays(cx)),
            )
            .child(self.status_bar(info, cx))
            .into_any_element()
    }

    // CSV

    fn with_csv(&mut self, cx: &mut Context<Self>, update: impl FnOnce(&mut CsvState)) {
        if let Content::Csv(state) = &mut self.content {
            update(state);
            cx.notify();
        }
    }

    fn copy_table(&mut self, json: bool, cx: &mut Context<Self>) {
        let Content::Csv(state) = &self.content else { return };
        let text = if json { csv::to_json(&state.table) } else { csv::to_delimited(&state.table, state.delimiter, state.has_header) };
        let rows = state.table.rows.len();
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        self.set_notice(format!("Copied {rows} {} as {}", if rows == 1 { "row" } else { "rows" }, if json { "JSON" } else { "CSV" }), cx);
    }

    fn render_csv(&self, state: &CsvState, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        // `csv-preview.tsx`: Delimiter [select], Header On/Off, CSV and JSON copies.
        let toolbar = self
            .toolbar(Some(format!("{} columns", state.table.headers.len())), cx)
            .child(div().mr(px(4.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("Delimiter"))
            .children(state.delimiter_select.clone())
            .child(
                Button::new("viewer-header-row", if state.has_header { "Header On" } else { "Header Off" })
                    .leading_icon(IconName::Rows)
                    .size(ButtonSize::Small)
                    .tooltip("Toggle header row")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.with_csv(cx, |state| {
                            state.has_header = !state.has_header;
                            state.reparse();
                        })
                    })),
            )
            .child(
                Button::new("viewer-copy-csv", "CSV")
                    .leading_icon(IconName::Download)
                    .size(ButtonSize::Small)
                    .tooltip("Copy as CSV")
                    .on_click(cx.listener(|this, _, _, cx| this.copy_table(false, cx))),
            )
            .child(
                Button::new("viewer-copy-json", "JSON")
                    .leading_icon(IconName::FileCode)
                    .size(ButtonSize::Small)
                    .tooltip("Copy as JSON")
                    .on_click(cx.listener(|this, _, _, cx| this.copy_table(true, cx))),
            )
            .child(self.open_button(cx));

        let rows = state.table.rows.len();
        let columns = state.table.headers.len();
        let info = format!(
            "{rows} {}  ·  {columns} {}  ·  {} delimited  ·  {}",
            if rows == 1 { "row" } else { "rows" },
            if columns == 1 { "column" } else { "columns" },
            state.delimiter.label(),
            binary::format_size(state.bytes),
        );
        let number_width = state.row_number_width();
        let total_width = number_width + state.widths.iter().copied().fold(px(0.), |sum, width| sum + width);
        let cell = |width: Pixels| {
            div()
                .flex_none()
                .w(width)
                .h_full()
                .flex()
                .items_center()
                .px(px(10.))
                .border_r_1()
                .border_color(colors.divider)
                .overflow_hidden()
        };
        let header = div()
            .flex()
            .flex_none()
            .h(TABLE_ROW)
            .bg(colors.surface)
            .border_b_1()
            .border_color(colors.border)
            .text_size(typography::TEXT_SM)
            .font_weight(typography::MEDIUM)
            .text_color(colors.foreground)
            .child(cell(number_width).justify_end().text_color(colors.subtle_foreground).child("#"))
            .children(
                state
                    .table
                    .headers
                    .iter()
                    .zip(&state.widths)
                    .map(|(header, width)| cell(*width).child(div().truncate().child(header.clone()))),
            );
        let body = if rows == 0 {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("No rows").icon(IconName::Table).message("This file has no data rows."))
                .into_any_element()
        } else {
            uniform_list("viewer-csv-rows", rows, cx.processor(Self::render_csv_rows))
                .track_scroll(&state.scroll)
                .flex_1()
                .min_h_0()
                .into_any_element()
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(toolbar)
            .child(
                div()
                    .id("viewer-csv-scroll")
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .overflow_x_scroll()
                    .child(div().flex().flex_col().flex_none().h_full().min_w(total_width).w(total_width).child(header).child(body)),
            )
            .child(self.status_bar(info, cx))
            .into_any_element()
    }

    fn render_csv_rows(&mut self, range: Range<usize>, _: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Content::Csv(state) = &self.content else { return Vec::new() };
        let colors = &cx.theme().colors;
        let number_width = state.row_number_width();
        range
            .filter_map(|index| {
                let row = state.table.rows.get(index)?;
                let cell = |width: Pixels| {
                    div()
                        .flex_none()
                        .w(width)
                        .h_full()
                        .flex()
                        .items_center()
                        .px(px(10.))
                        .border_r_1()
                        .border_color(colors.divider)
                        .overflow_hidden()
                };
                Some(
                    div()
                        .id(("viewer-csv-row", index))
                        .flex()
                        .h(TABLE_ROW)
                        .border_b_1()
                        .border_color(colors.divider)
                        .when(index % 2 == 1, |this| this.bg(colors.surface.opacity(0.5)))
                        .hover(|style| style.bg(colors.accent))
                        .font_family(typography::MONO_FONT)
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.foreground)
                        .child(cell(number_width).justify_end().text_color(colors.subtle_foreground).child((index + 1).to_string()))
                        .children(
                            row.iter()
                                .zip(&state.widths)
                                .map(|(value, width)| cell(*width).child(div().truncate().child(value.replace(['\n', '\r'], " ")))),
                        )
                        .into_any_element(),
                )
            })
            .collect()
    }

    // PDF

    fn zoom_pdf(&mut self, zoom: Option<f32>, cx: &mut Context<Self>) {
        if let Content::Pdf(state) = &mut self.content {
            state.zoom = zoom.map(|zoom| zoom.clamp(MIN_ZOOM, MAX_ZOOM));
            let count = state.document.pages.len();
            let top = state.list.logical_scroll_top();
            state.list.reset(count);
            state.list.scroll_to(top);
            cx.notify();
        }
    }

    fn step_pdf_zoom(&mut self, up: bool, cx: &mut Context<Self>) {
        if let Content::Pdf(state) = &self.content {
            let page = state.list.logical_scroll_top().item_ix;
            let zoom = step_zoom(state.page_zoom(page), up);
            self.zoom_pdf(Some(zoom), cx);
        }
    }

    /// Starts rendering `page` at `scale` pixels per point unless it is cached or under way.
    fn request_page(&mut self, page: usize, scale: f32, cx: &mut Context<Self>) {
        let Content::Pdf(state) = &mut self.content else { return };
        if state.cached(page, scale).is_some() || !state.rendering.insert(page) {
            return;
        }
        let document = state.document.clone();
        let task = cx.spawn(async move |this, cx| {
            let image = cx.background_spawn(async move { pdf::render_page(&document, page, scale) }).await;
            this.update(cx, |this, cx| {
                let Content::Pdf(state) = &mut this.content else { return };
                state.rendering.remove(&page);
                match image {
                    Ok(image) => {
                        state.cache.retain(|(index, _, _)| *index != page);
                        state.cache.push_back((page, scale, image));
                        while state.cache.len() > PDF_CACHE {
                            if let Some((_, _, old)) = state.cache.pop_front() {
                                cx.drop_image(old, None);
                            }
                        }
                    }
                    Err(error) => this.notice = Some(format!("Page {} could not be rendered: {error}", page + 1).into()),
                }
                cx.notify();
            })
            .ok();
        });
        state.tasks.retain(|task| !task.is_ready());
        state.tasks.push(task);
    }

    /// As `pdf-viewer.tsx`: web links ask before opening, links inside the document scroll to their page.
    fn follow_pdf_link(&mut self, target: pdf::LinkTarget, window: &mut Window, cx: &mut Context<Self>) {
        match target {
            pdf::LinkTarget::Url(url) => {
                if !url.starts_with("http") {
                    return;
                }
                let dialog = ui::AlertDialog::confirm(
                    "External Link",
                    format!("Do you want to open this external link?\n\n{url}"),
                    ui::ConfirmOptions { confirm_label: "Open".into(), ..Default::default() },
                    move |_, cx| cx.open_url(&url),
                    cx,
                );
                let subscription = cx.subscribe_in(&dialog, window, |this, _, _: &DismissEvent, window, cx| {
                    this.link_prompt = None;
                    window.focus(&this.focus_handle, cx);
                    cx.notify();
                });
                window.focus(&dialog.focus_handle(cx), cx);
                self.link_prompt = Some((dialog, subscription));
            }
            pdf::LinkTarget::Page { index, top } => {
                let Content::Pdf(state) = &mut self.content else { return };
                let offset = top.map(|top| pdf::destination_top(&state.document, index, top) * state.page_zoom(index)).unwrap_or(0.);
                let gap = if index == 0 { PDF_GAP * 2. } else { PDF_GAP };
                state.list.scroll_to(gpui::ListOffset { item_ix: index, offset_in_item: gap + px(offset) });
            }
        }
        cx.notify();
    }

    fn render_pdf(&self, state: &PdfState, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let count = state.document.pages.len();
        let current = (state.list.logical_scroll_top().item_ix + 1).min(count);
        let zoom = state.page_zoom(current.saturating_sub(1));
        let toolbar = self
            .toolbar(Some("PDF".into()), cx)
            .child(
                div()
                    .px(px(6.))
                    .text_size(typography::TEXT_SM)
                    .text_color(colors.muted_foreground)
                    .child(format!("Page {current} of {count}")),
            )
            .child(self.open_button(cx))
            .child(chrome_separator(&colors))
            .child(self.zoom_controls("viewer-pdf", zoom, cx, |this, step, cx| match step {
                Some(up) => this.step_pdf_zoom(up, cx),
                None => this.zoom_pdf(None, cx),
            }));

        // `Zoom: 129%  Page: 1/1  Size: 612 × 792pt`, the file size on the right.
        let mut start = vec![format!("Zoom: {}", percent(zoom)), format!("Page: {current}/{count}")];
        if let Some((width, height)) = state.document.pages.first() {
            start.push(format!("Size: {} × {}pt", width.round() as i64, height.round() as i64));
        }
        let info = StatusText { start, end: Some(format!("Size: {}", binary::format_size(state.bytes))) };

        let body = if count == 0 {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("No pages").icon(IconName::FileText))
                .into_any_element()
        } else {
            let entity = cx.entity().downgrade();
            list(state.list.clone(), move |index, window, cx| {
                let Some(entity) = entity.upgrade() else { return div().into_any_element() };
                let scale_factor = window.scale_factor();
                let (size, zoom, image, fallback, links) = {
                    let viewer = entity.read(cx);
                    let Content::Pdf(state) = &viewer.content else { return div().into_any_element() };
                    let size = state.document.pages[index];
                    let zoom = state.page_zoom(index);
                    let scale = pdf::render_scale(size, zoom, scale_factor);
                    let links = state.document.links.get(index).cloned().unwrap_or_default();
                    (size, zoom, state.cached(index, scale), state.any_cached(index), links)
                };
                if image.is_none() {
                    let scale = pdf::render_scale(size, zoom, scale_factor);
                    entity.update(cx, |viewer, cx| viewer.request_page(index, scale, cx));
                }
                let (width, height) = (px(size.0 * zoom), px(size.1 * zoom));
                let theme = cx.theme().colors.clone();
                let page = div()
                    .flex_none()
                    .w(width)
                    .h(height)
                    .bg(gpui::white())
                    .border_1()
                    .border_color(theme.border)
                    .shadow_sm()
                    .relative()
                    .overflow_hidden();
                let page = match image.or(fallback) {
                    Some(image) => page.child(img(image).size_full().object_fit(ObjectFit::Fill)),
                    None => page,
                };
                let page = page.children(links.into_iter().enumerate().map(|(position, link)| {
                    let weak = entity.downgrade();
                    let [left, top, right, bottom] = link.rect;
                    div()
                        .id(("viewer-pdf-link", index * 10_000 + position))
                        .absolute()
                        .left(px(left * zoom))
                        .top(px(top * zoom))
                        .w(px((right - left) * zoom))
                        .h(px((bottom - top) * zoom))
                        .on_click(move |_, window, cx| {
                            let target = link.target.clone();
                            weak.update(cx, |viewer, cx| viewer.follow_pdf_link(target, window, cx)).ok();
                        })
                }));
                div()
                    .flex()
                    .justify_center()
                    .min_w(width + px(48.))
                    .pt(if index == 0 { PDF_GAP * 2. } else { PDF_GAP })
                    .when(index + 1 == count, |this| this.pb(PDF_GAP * 2.))
                    .child(page)
                    .into_any_element()
            })
            .flex_1()
            .min_h_0()
            .into_any_element()
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(toolbar)
            .child(
                div()
                    .id("viewer-pdf-scroll")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .bg(colors.background)
                    .overflow_x_scroll()
                    .relative()
                    .child({
                        let width = state.viewport_width.clone();
                        canvas(
                            move |bounds, window, _| {
                                if width.get() != bounds.size.width {
                                    width.set(bounds.size.width);
                                    window.refresh();
                                }
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full()
                    })
                    .child(body),
            )
            .child(self.status_bar(info, cx))
            .into_any_element()
    }

    // Binary

    /// `BinaryFileViewer`: File Information (type, size, extension, path), the WebAssembly
    /// sections of a module, and a hex preview of the first 256 bytes.
    fn render_binary(&self, state: &BinaryState, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let file_type = binary::file_type(&self.path);
        let toolbar = self.toolbar(Some(file_type.to_string()), cx).child(self.open_button(cx));
        let extension = self.path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase();
        let info_row = |label: &'static str, value: String| {
            div()
                .flex()
                .items_baseline()
                .gap(px(8.))
                .min_w_0()
                .text_size(typography::TEXT_SM)
                .child(div().flex_none().text_color(colors.subtle_foreground).child(label))
                .child(div().min_w_0().truncate().text_color(colors.foreground).child(value))
        };
        let grid = |rows: Vec<gpui::Div>| div().grid().grid_cols(2).gap_x(px(24.)).gap_y(px(8.)).children(rows);
        let heading = |title: &'static str| div().mb(px(12.)).text_size(typography::TEXT_SM).text_color(colors.foreground).child(title);
        let section = || div().py(px(16.));
        let information = section().child(heading("File Information")).child(grid(vec![
            info_row("Type", file_type.to_string()),
            info_row("Size", binary::format_size(state.bytes)),
            info_row("Extension", format!(".{extension}")),
            info_row("Path", self.relative_path(cx)),
        ]));
        let wasm = state.wasm.as_ref().map(|wasm| {
            let table = (!wasm.sections.is_empty()).then(|| {
                let count = wasm.sections.len();
                let cell = |text: String, end: bool| {
                    div().flex_1().px(px(12.)).when(end, |this| this.flex_none().text_right()).child(text)
                };
                div()
                    .mt(px(12.))
                    .flex()
                    .flex_col()
                    .border_y_1()
                    .border_color(colors.divider)
                    .text_size(typography::TEXT_SM)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .h(px(32.))
                            .border_b_1()
                            .border_color(colors.divider)
                            .bg(colors.background)
                            .text_color(colors.muted_foreground)
                            .child(cell("Section".into(), false))
                            .child(cell("Size".into(), true)),
                    )
                    .children(wasm.sections.iter().enumerate().map(|(index, wasm_section)| {
                        div()
                            .id(("viewer-wasm-section", index))
                            .flex()
                            .items_center()
                            .py(px(6.))
                            .when(index + 1 < count, |this| this.border_b_1().border_color(colors.divider))
                            .when(index % 2 == 1, |this| this.bg(colors.background))
                            .hover(|style| style.bg(colors.accent))
                            .child(div().flex_1().px(px(12.)).text_color(colors.foreground).child(wasm_section.name.clone()))
                            .child(div().flex_none().px(px(12.)).text_right().text_color(colors.subtle_foreground).child(binary::format_size(wasm_section.size as u64)))
                    }))
            });
            section()
                .child(heading("WebAssembly Module"))
                .child(grid(vec![info_row("WASM Version", wasm.version.to_string()), info_row("Sections", wasm.sections.len().to_string())]))
                .children(table)
        });
        let preview = binary::hex_preview(&state.data, state.bytes);
        let hex = section().child(heading("Hex Preview")).child(
            div()
                .id("viewer-hex-preview")
                .overflow_x_scroll()
                .font_family(typography::MONO_FONT)
                .font_features(gpui::FontFeatures::disable_ligatures())
                .text_size(typography::TEXT_SM)
                .line_height(px(18.))
                .text_color(colors.subtle_foreground)
                .whitespace_nowrap()
                .children(preview.lines().map(|line| div().child(line.to_string()))),
        );
        let mut sections = vec![information.into_any_element()];
        sections.extend(wasm.map(IntoElement::into_any_element));
        sections.push(hex.into_any_element());
        let count = sections.len();
        let sections = sections.into_iter().enumerate().map(|(index, section)| {
            div().when(index + 1 < count, |this| this.border_b_1().border_color(colors.border)).child(section)
        });
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .child(toolbar)
            .child(
                div()
                    .id("viewer-binary")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(16.))
                    .child(div().w_full().max_w(px(672.)).mx_auto().children(sections))
                    .scrollbar_with(&state.scroll),
            )
            .children(self.notice.is_some().then(|| self.status_bar(String::new(), cx)))
            .into_any_element()
    }

    /// The file's path from the open project's folder, or in full outside it (`getRelativePath`).
    fn relative_path(&self, cx: &App) -> String {
        let projects = workbench_api::projects(cx);
        projects
            .active
            .iter()
            .chain(projects.open.iter())
            .find_map(|root| self.path.strip_prefix(root).ok().filter(|relative| !relative.as_os_str().is_empty()))
            .map(|relative| relative.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.path.to_string_lossy().into_owned())
    }

    // Shared chrome

    /// `PaneContentHeader`: the file's name, a muted detail (the format, "PDF", the column count)
    /// and the actions.
    fn toolbar(&self, detail: Option<String>, cx: &mut Context<Self>) -> gpui::Div {
        let colors = &cx.theme().colors;
        // A 28px content bar (`ChromeBar region="content"`) led by `FilePathBreadcrumb`: the
        // path from the project's folder, then the detail.
        let path = self.relative_path(cx);
        pane_header(cx)
            .h(metrics::CONTENT_HEADER)
            .px(metrics::CHROME_PADDING_INLINE)
            .gap(px(8.))
            .border_b_1()
            .border_color(colors.divider)
            .child(div().min_w_0().overflow_hidden().text_size(typography::TEXT_SM).child(PathBreadcrumb::from_path("viewer-breadcrumb", &path)))
            .children(detail.filter(|detail| !detail.is_empty()).map(|detail| div().flex_none().text_color(colors.muted_foreground).child(detail)))
            .child(pane_actions())
    }

    fn open_button(&self, cx: &mut Context<Self>) -> Button {
        Button::icon("viewer-open-external", IconName::OpenExternal)
            .size(ButtonSize::Small)
            .tooltip("Open in Default App")
            .on_click(cx.listener(|this, _, _, cx| this.open_externally(cx)))
    }

    /// `ViewerZoomControls`: zoom out, the zoom, zoom in, and Reset zoom (back to fitting).
    /// `step` is `Some(up)` for a step, `None` for the reset.
    fn zoom_controls(&self, prefix: &'static str, zoom: f32, cx: &mut Context<Self>, step: impl Fn(&mut Self, Option<bool>, &mut Context<Self>) + 'static) -> gpui::Div {
        let colors = cx.theme().colors.clone();
        let step = Rc::new(step);
        let button = |id: &'static str, icon: IconName, tooltip: &'static str, value: Option<bool>, cx: &mut Context<Self>| {
            let step = step.clone();
            Button::icon(SharedString::from(format!("{prefix}-{id}")), icon)
                .size(ButtonSize::Small)
                .tooltip(tooltip)
                .on_click(cx.listener(move |this, _, _, cx| step(this, value, cx)))
        };
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(button("zoom-out", IconName::Minus, "Zoom out", Some(false), cx))
            .child(div().min_w(px(50.)).px(px(8.)).text_center().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(percent(zoom)))
            .child(button("zoom-in", IconName::Plus, "Zoom in", Some(true), cx))
            .child(button("zoom-reset", IconName::ArrowCounterClockwise, "Reset zoom", None, cx))
    }

    fn status_bar(&self, info: impl Into<StatusText>, cx: &mut Context<Self>) -> AnyElement {
        let colors = &cx.theme().colors;
        let info = info.into();
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .h(px(26.))
            .px(px(12.))
            .border_t_1()
            .border_color(colors.divider)
            .text_size(typography::TEXT_CAPTION)
            .text_color(colors.subtle_foreground)
            .whitespace_nowrap()
            .child(div().flex().flex_none().gap(px(12.)).children(info.start))
            .child(div().flex_1().min_w_0())
            .children(info.end.map(|end| div().flex_none().truncate().child(end)))
            .children(self.notice.clone().map(|notice| {
                div()
                    .id("viewer-notice")
                    .flex_none()
                    .text_color(colors.muted_foreground)
                    .child(notice)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.notice = None;
                        cx.notify();
                    }))
            }))
            .into_any_element()
    }
}

/// A status bar's text: items on the left (`PaneContentStatusBar`'s children, 12px apart) and
/// one on the right (`endContent`).
struct StatusText {
    start: Vec<String>,
    end: Option<String>,
}

impl From<String> for StatusText {
    fn from(text: String) -> Self {
        Self { start: vec![text], end: None }
    }
}

/// `ChromeSeparator`: a 1px divider between toolbar groups.
fn chrome_separator(colors: &theme::ThemeColors) -> gpui::Div {
    div().flex_none().w(px(1.)).h(px(16.)).mx(px(2.)).bg(colors.divider)
}

impl Render for FileViewer {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let background = cx.theme().colors.background;
        if let Content::Pdf(state) = &mut self.content {
            let width = state.viewport_width.get();
            if state.zoom.is_none() && width != state.laid_out_width {
                state.laid_out_width = width;
                let top = state.list.logical_scroll_top();
                state.list.reset(state.document.pages.len());
                state.list.scroll_to(top);
            }
        }
        let content = match &self.content {
            Content::Loading => div().flex().flex_1().into_any_element(),
            Content::Failed(error) => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(
                    EmptyState::new("This file could not be shown")
                        .icon(IconName::WarningCircle)
                        .message(error.clone())
                        .action(
                            Button::new("viewer-failed-open", "Open in Default App")
                                .size(ButtonSize::Small)
                                .on_click(cx.listener(|this, _, _, cx| this.open_externally(cx))),
                        ),
                )
                .into_any_element(),
            Content::Image(state) => self.render_image(state, cx),
            Content::Csv(state) => self.render_csv(state, cx),
            Content::Pdf(state) => self.render_pdf(state, cx),
            Content::Binary(state) => self.render_binary(state, cx),
        };
        div()
            .id("file-viewer")
            .track_focus(&self.focus_handle)
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            .bg(background)
            .child(content)
            .children(self.menu.as_ref().map(|menu| menu.render()))
            .children(self.link_prompt.as_ref().map(|(dialog, _)| {
                let scrim = cx.theme().colors.scrim;
                deferred(div().id("viewer-link-prompt").absolute().inset_0().bg(scrim).flex().items_center().justify_center().occlude().child(dialog.clone())).with_priority(2)
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_between_zoom_levels() {
        assert_eq!(step_zoom(1., true), 1.25);
        assert_eq!(step_zoom(1., false), 0.75);
        assert_eq!(step_zoom(0.8, false), 0.75);
        assert_eq!(step_zoom(16., true), 16.);
        assert_eq!(step_zoom(0.1, false), 0.1);
    }

    #[test]
    fn fits_without_upscaling() {
        assert_eq!(fit_scale((2000., 1000.), (1000., 1000.)), 0.5);
        assert_eq!(fit_scale((100., 100.), (1000., 1000.)), 1.);
        assert_eq!(fit_scale((100., 100.), (0., 0.)), 1.);
    }

    #[test]
    fn picks_a_viewer_by_extension_or_content() {
        let dir = tempfile::tempdir().unwrap();
        let text = dir.path().join("notes.txt");
        std::fs::write(&text, "hello").unwrap();
        let blob = dir.path().join("blob");
        std::fs::write(&blob, [1, 0, 2]).unwrap();
        assert_eq!(Kind::of(Path::new("a/b.PNG")), Some(Kind::Image));
        assert_eq!(Kind::of(Path::new("doc.pdf")), Some(Kind::Pdf));
        assert_eq!(Kind::of(Path::new("data.tsv")), Some(Kind::Csv));
        assert_eq!(Kind::of(&blob), Some(Kind::Binary));
        assert!(!can_view(&text));
    }
}
