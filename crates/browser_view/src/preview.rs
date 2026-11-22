//! Previews of a file beside its source: HTML in a native page served from the project, SVG drawn
//! by GPUI, markdown through the editor's renderer and CSV through the table viewer. Each follows
//! the file and shows it again when it is saved; HTML and SVG follow the open editor's text as it
//! changes.
//!
//! Ported from Athas's `editor/components/html/html-preview.tsx` and `svg/svg-preview.tsx`; the
//! markdown and CSV kinds reuse `editor::MarkdownPreview` and `viewer::FileViewer`.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use athas_browser::BrowserEvent;
use futures::{StreamExt, channel::mpsc};
use ui::scale::px;
use gpui::{
    AnyView, App, ClickEvent, Context, Entity, FocusHandle, Focusable, Image, ImageFormat, ObjectFit, Window, div, img, prelude::*,
};
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, IconName, PaneTitle, pane_actions, pane_header, prelude::*};

use crate::{
    host::{Content, Host, HostRef, NativeEvent, NavigationAction},
    key_bindings::{browser_key_bindings, is_page_command},
    page_state::step_zoom,
    preview_protocol,
    slot::webview_slot,
};

/// How often a preview looks whether its file was saved.
const WATCH_INTERVAL: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewKind {
    Html,
    Svg,
    Markdown,
    Csv,
}

impl PreviewKind {
    pub fn for_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        Some(match extension.as_str() {
            "html" | "htm" | "xhtml" => Self::Html,
            "svg" => Self::Svg,
            "md" | "markdown" | "mdx" => Self::Markdown,
            "csv" | "tsv" => Self::Csv,
            _ => return None,
        })
    }

    fn icon(self) -> IconName {
        match self {
            Self::Html => IconName::Globe,
            Self::Svg => IconName::Image,
            Self::Markdown => IconName::FileText,
            Self::Csv => IconName::Table,
        }
    }
}

/// Whether a file has a preview.
pub fn can_preview(path: &Path) -> bool {
    PreviewKind::for_path(path).is_some()
}

/// The tab title of a file's preview: "Preview index.html".
pub fn preview_title(path: &Path) -> String {
    format!("Preview {}", path.file_name().map_or_else(|| path.display().to_string(), |name| name.to_string_lossy().into_owned()))
}

/// Opens the preview of `path` among the tabs in front.
pub fn open_preview(path: &Path, cx: &mut App) {
    workbench_api::open_resource(cx, crate::PREVIEW_KIND, &path.to_string_lossy(), &preview_title(path));
}

enum Body {
    Html { host: HostRef },
    Svg { image: Option<Arc<Image>>, zoom: Option<f64> },
    Markdown(Entity<editor::MarkdownPreview>),
    Csv(Entity<viewer::FileViewer>),
}

pub struct PreviewView {
    path: PathBuf,
    kind: PreviewKind,
    body: Body,
    modified: Option<SystemTime>,
    /// The open editor's text of the file (`workbench_api::buffer_text`), shown before it is saved.
    unsaved: Option<String>,
    error: Option<String>,
    focus_handle: FocusHandle,
}

impl Focusable for PreviewView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

#[cfg(not(target_family = "wasm"))]
fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|metadata| metadata.modified()).ok()
}

#[cfg(not(target_family = "wasm"))]
fn read(path: &Path) -> std::io::Result<Vec<u8>> {
    std::fs::read(path)
}

/// The project's files on the web: the workspace server's, through the workbench's file access.
#[cfg(target_family = "wasm")]
static WEB_FILES: std::sync::OnceLock<Arc<dyn editor::FileBackend>> = std::sync::OnceLock::new();

/// Reads previews' files through `files` (the workspace server's) on the web.
#[cfg(target_family = "wasm")]
pub fn set_web_files(files: Arc<dyn editor::FileBackend>) {
    let _ = WEB_FILES.set(files);
    viewer::set_web_reader(Arc::new(read));
}

#[cfg(target_family = "wasm")]
fn web_files() -> Arc<dyn editor::FileBackend> {
    WEB_FILES.get().cloned().unwrap_or_else(|| Arc::new(editor::LocalFs))
}

#[cfg(target_family = "wasm")]
fn modified(path: &Path) -> Option<SystemTime> {
    web_files().modified(path)
}

#[cfg(target_family = "wasm")]
fn read(path: &Path) -> std::io::Result<Vec<u8>> {
    match web_files().load(path) {
        Ok(editor::Loaded::Text { text, .. }) => Ok(text.into_bytes()),
        Ok(_) => Err(std::io::Error::other("not a text file")),
        Err(error) => Err(std::io::Error::other(error.to_string())),
    }
}

impl PreviewView {
    pub fn new(path: PathBuf, project: Option<PathBuf>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let kind = PreviewKind::for_path(&path).unwrap_or(PreviewKind::Html);
        let mut error = None;
        let body = match kind {
            PreviewKind::Html => {
                let (events, mut receiver) = mpsc::unbounded();
                let host = Host::new(events, 1.0);
                let root = preview_protocol::preview_root(&path, project.as_deref()).unwrap_or_else(|| PathBuf::from("/"));
                {
                    let mut host = host.borrow_mut();
                    host.key_bindings = cx.try_global::<keymap::ActiveKeymap>().map(|active| browser_key_bindings(&active.bindings)).unwrap_or_default();
                    #[cfg(not(target_family = "wasm"))]
                    let url = preview_protocol::preview_url(&root, &path);
                    #[cfg(target_family = "wasm")]
                    let url = crate::native::preview_address(&path);
                    match url {
                        Some(url) => host.pending = Some(Content::Preview { root, url }),
                        None => error = Some("This file can't be previewed".to_string()),
                    }
                }
                cx.spawn_in(window, async move |this, cx| {
                    while let Some(event) = receiver.next().await {
                        if this.update_in(cx, |this, window, cx| this.handle_native(event, window, cx)).is_err() {
                            break;
                        }
                    }
                })
                .detach();
                Body::Html { host }
            }
            PreviewKind::Svg => Body::Svg { image: None, zoom: None },
            PreviewKind::Markdown => {
                #[cfg(not(target_family = "wasm"))]
                let editor = cx.new(|cx| editor::Editor::open(path.clone(), window, cx));
                #[cfg(target_family = "wasm")]
                let editor = cx.new(|cx| editor::Editor::open_with(path.clone(), web_files(), window, cx));
                Body::Markdown(cx.new(|cx| editor::MarkdownPreview::new(editor, cx)))
            }
            PreviewKind::Csv => Body::Csv(cx.new(|cx| viewer::FileViewer::open(path.clone(), window, cx))),
        };
        let mut this = Self { path, kind, body, modified: None, unsaved: None, error, focus_handle: cx.focus_handle() };
        this.load(cx);
        this.watch(cx);
        this
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn kind(&self) -> PreviewKind {
        self.kind
    }

    /// Reads the file again for the kinds GPUI draws: the editor's unsaved text when it has some.
    fn load(&mut self, cx: &mut Context<Self>) {
        self.modified = modified(&self.path);
        let unsaved = self.unsaved.clone();
        if let Body::Svg { image, .. } = &mut self.body {
            match unsaved.map(|text| Ok(text.into_bytes())).unwrap_or_else(|| read(&self.path)) {
                Ok(bytes) => {
                    *image = Some(Arc::new(Image::from_bytes(ImageFormat::Svg, bytes)));
                    self.error = None;
                }
                Err(read) => self.error = Some(format!("Could not read {}: {read}", self.path.display())),
            }
        }
        cx.notify();
    }

    /// Shows the file again each time it is saved.
    fn watch(&self, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(WATCH_INTERVAL).await;
                let Ok(path) = this.read_with(cx, |this, _| this.path.clone()) else { break };
                let stamp = cx.background_executor().spawn(async move { modified(&path) }).await;
                let Ok(()) = this.update(cx, |this, cx| {
                    // HTML and SVG follow the editor's text as it changes, not only on save.
                    let mut changed = false;
                    if matches!(this.kind, PreviewKind::Html | PreviewKind::Svg) {
                        let text = workbench_api::buffer_text(&this.path, cx);
                        if text != this.unsaved {
                            #[cfg(not(target_family = "wasm"))]
                            crate::preview_protocol::set_unsaved(&this.path, text.clone().map(String::into_bytes));
                            this.unsaved = text;
                            changed = true;
                        }
                    }
                    if changed || (stamp.is_some() && stamp != this.modified) {
                        this.reload(cx);
                    }
                }) else {
                    break;
                };
            }
        })
        .detach();
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        self.load(cx);
        if let Body::Html { host, .. } = &self.body
            && let Some(Err(error)) = host.borrow().native.as_ref().map(|native| native.perform(NavigationAction::Reload))
        {
            self.error = Some(error);
        }
        cx.notify();
    }

    fn handle_native(&mut self, event: NativeEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Body::Html { host, .. } = &self.body else { return };
        let host = host.clone();
        if crate::host::handle_occlusion(&host, &event, cx) {
            return;
        }
        match event {
            NativeEvent::Page(BrowserEvent::Focused) => {
                host.borrow_mut().native_focused = true;
                window.focus(&self.focus_handle, cx);
            }
            NativeEvent::Page(BrowserEvent::Shortcut { command }) => {
                if !is_page_command(&command) {
                    let mut host = host.borrow_mut();
                    host.native_focused = false;
                    if let Some(native) = &host.native {
                        native.focus_parent();
                    }
                }
                if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action(&command)) {
                    window.focus(&self.focus_handle, cx);
                    window.dispatch_action(action, cx);
                }
            }
            NativeEvent::Page(BrowserEvent::OpenInNewTab { url }) => crate::page::open_browser_tab(Some(&url), cx),
            NativeEvent::OpenExternally(url) => cx.open_url(&url),
            NativeEvent::Failed(error) => {
                self.error = Some(error);
                cx.notify();
            }
            _ => {}
        }
    }

    fn zoom_svg(&mut self, direction: Option<i32>, cx: &mut Context<Self>) {
        if let Body::Svg { zoom, .. } = &mut self.body {
            *zoom = direction.map(|direction| step_zoom(zoom.unwrap_or(1.0), direction));
            cx.notify();
        }
    }

    fn open_devtools(&mut self, cx: &mut Context<Self>) {
        if let Body::Html { host, .. } = &self.body
            && let Some(Err(error)) = host.borrow().native.as_ref().map(|native| native.open_devtools())
        {
            notifications::error(cx, error, None);
        }
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let name = self.path.file_name().map_or_else(|| self.path.display().to_string(), |name| name.to_string_lossy().into_owned());
        let actions = pane_actions().child(
            Button::icon("preview-reload", IconName::ArrowClockwise)
                .size(ButtonSize::Small)
                .tooltip("Reload Preview")
                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.reload(cx))),
        );
        let actions = match &self.body {
            Body::Html { .. } => {
                let path = self.path.clone();
                actions
                    .child(
                        Button::icon("preview-devtools", IconName::Bug)
                            .size(ButtonSize::Small)
                            .tooltip("Developer Tools")
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.open_devtools(cx))),
                    )
                    .child(
                        Button::icon("preview-open-external", IconName::OpenExternal)
                            .size(ButtonSize::Small)
                            .tooltip("Open in System Browser")
                            .on_click(move |_, _, cx| {
                                #[cfg(not(target_family = "wasm"))]
                                cx.open_url(&format!("file://{}", path.display()));
                                #[cfg(target_family = "wasm")]
                                if let Some(url) = crate::native::preview_address(&path) {
                                    cx.open_url(&url);
                                }
                            }),
                    )
            }
            Body::Svg { zoom, .. } => {
                let label = zoom.map_or("Fit".to_string(), |zoom| format!("{}%", (zoom * 100.0).round()));
                actions
                    .child(
                        Button::icon("preview-zoom-out", IconName::ZoomOut)
                            .size(ButtonSize::Small)
                            .tooltip("Zoom Out")
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.zoom_svg(Some(-1), cx))),
                    )
                    .child(
                        Button::new("preview-zoom-fit", label)
                            .size(ButtonSize::Small)
                            .variant(ButtonVariant::Ghost)
                            .tooltip("Fit to Pane")
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.zoom_svg(None, cx))),
                    )
                    .child(
                        Button::icon("preview-zoom-in", IconName::ZoomIn)
                            .size(ButtonSize::Small)
                            .tooltip("Zoom In")
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.zoom_svg(Some(1), cx))),
                    )
            }
            _ => actions,
        };
        pane_header(cx).child(PaneTitle::new(name).icon(self.kind.icon()).detail("Preview")).child(actions)
    }

    fn render_body(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = cx.theme().colors.clone();
        if let Some(error) = &self.error {
            return div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("Could not show the preview").icon(IconName::WarningCircle).message(error.clone()))
                .into_any_element();
        }
        match &self.body {
            Body::Html { host, .. } => {
                let unavailable = host.borrow().unavailable || !crate::NATIVE_PAGES;
                let snapshot = host.borrow().snapshot.clone();
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .px(px(6.))
                    .pb(px(6.))
                    .child(
                        div()
                            .id("preview-slot")
                            .relative()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .items_center()
                            .justify_center()
                            .overflow_hidden()
                            .rounded(metrics::radius_lg())
                            .bg(gpui::white())
                            .shadow(cx.theme().shadows.raised.clone())
                            .children(snapshot.map(|picture| img(picture).absolute().top_0().left_0().size_full().object_fit(ObjectFit::Fill)))
                            .when(unavailable, |this| {
                                this.bg(colors.surface).child(crate::page::page_placeholder(&self.path.display().to_string(), cx))
                            })
                            .child(webview_slot(host.clone(), 8.0)),
                    )
                    .into_any_element()
            }
            Body::Svg { image, zoom } => {
                let name = self.path.display().to_string();
                let image = image.clone().map(|image| {
                    let image = img(image).with_fallback(move || {
                        EmptyState::new("Could not draw this SVG").icon(IconName::Image).message(name.clone()).into_any_element()
                    });
                    match zoom {
                        Some(zoom) => image.w(px(320. * *zoom as f32)).h(px(320. * *zoom as f32)).object_fit(ObjectFit::Contain).flex_none(),
                        None => image.size_full().object_fit(ObjectFit::ScaleDown),
                    }
                });
                div()
                    .id("svg-preview")
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .items_center()
                    .justify_center()
                    .overflow_scroll()
                    .p(px(16.))
                    .bg(colors.background)
                    .children(image)
                    .into_any_element()
            }
            Body::Markdown(preview) => div().flex().flex_col().flex_1().min_h_0().child(preview.clone()).into_any_element(),
            Body::Csv(viewer) => div().flex().flex_col().flex_1().min_h_0().child(viewer.clone()).into_any_element(),
        }
    }
}

impl Render for PreviewView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        div()
            .id("file-preview")
            .key_context("Browser")
            .track_focus(&self.focus_handle)
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .bg(colors.background)
            .when(self.kind != PreviewKind::Csv, |this| this.child(self.render_header(cx)))
            .child(self.render_body(cx))
    }
}

/// The view of a file's preview tab.
pub fn preview_view(path: PathBuf, project: Option<PathBuf>, window: &mut Window, cx: &mut App) -> (AnyView, FocusHandle) {
    let view = cx.new(|cx| PreviewView::new(path, project, window, cx));
    let focus = view.focus_handle(cx);
    (view.into(), focus)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_web_pages_pictures_documents_and_tables() {
        assert_eq!(PreviewKind::for_path(Path::new("site/index.HTML")), Some(PreviewKind::Html));
        assert_eq!(PreviewKind::for_path(Path::new("logo.svg")), Some(PreviewKind::Svg));
        assert_eq!(PreviewKind::for_path(Path::new("README.md")), Some(PreviewKind::Markdown));
        assert_eq!(PreviewKind::for_path(Path::new("data.tsv")), Some(PreviewKind::Csv));
        assert_eq!(PreviewKind::for_path(Path::new("main.rs")), None);
        assert_eq!(preview_title(Path::new("/a/index.html")), "Preview index.html");
    }
}
