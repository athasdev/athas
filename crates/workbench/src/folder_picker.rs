//! Athas's own folder picker (`linux-folder-picker-dialog.tsx`), for Linux desktops where the
//! system's folder dialog fails to open: browse from home, type a path, open the folder shown.

use ui::WithScrollbar;
use std::{path::PathBuf, rc::Rc};

use ui::scale::px;
use gpui::{App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, SharedString, Subscription, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{
    Button, ButtonVariant, Dialog, DialogLayout, DialogSize, EmptyState, IconName, InputAppearance, SidebarListItem, TextInput,
    TextInputEvent, typography,
};

type OnOpen = Rc<dyn Fn(PathBuf, &mut Window, &mut App)>;

/// `~` and `~/…` from home; a relative path is taken from the root; no trailing slash.
pub(crate) fn normalize_linux_path(path: &str, home: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "~" {
        return if home.is_empty() { "/".into() } else { home.into() };
    }
    let joined = if let Some(rest) = trimmed.strip_prefix("~/") {
        format!("{}/{rest}", home.trim_end_matches('/'))
    } else if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    };
    let stripped = joined.trim_end_matches('/');
    if stripped.is_empty() { "/".into() } else { stripped.into() }
}

pub(crate) fn parent_path(path: &str) -> String {
    if path == "/" {
        return "/".into();
    }
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/".into(),
        Some(index) => trimmed[..index].into(),
    }
}

fn join_path(parent: &str, child: &str) -> String {
    if parent == "/" { format!("/{child}") } else { format!("{parent}/{child}") }
}

enum Listing {
    Loading,
    Folders(Vec<(String, String)>),
    Error,
}

pub(crate) struct FolderPicker {
    focus_handle: FocusHandle,
    home: String,
    current: String,
    input: Entity<TextInput>,
    listing: Listing,
    on_open: OnOpen,
    _subscription: Subscription,
}

impl EventEmitter<DismissEvent> for FolderPicker {}

impl Focusable for FolderPicker {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl FolderPicker {
    pub fn new(initial: Option<String>, on_open: impl Fn(PathBuf, &mut Window, &mut App) + 'static, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let home = std::env::var("HOME").ok().filter(|home| !home.is_empty()).unwrap_or_else(|| "/".into());
        let start = normalize_linux_path(initial.as_deref().unwrap_or(&home), &home);
        let input = cx.new(|cx| TextInput::new(window, cx).appearance(InputAppearance::Field));
        let subscription = cx.subscribe_in(&input, window, |this, input, event: &TextInputEvent, _, cx| match event {
            TextInputEvent::Confirmed => {
                let path = input.read(cx).text().to_string();
                this.navigate(&path, cx);
            }
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        });
        let mut picker = Self {
            focus_handle: cx.focus_handle(),
            home,
            current: start.clone(),
            input,
            listing: Listing::Loading,
            on_open: Rc::new(on_open),
            _subscription: subscription,
        };
        picker.navigate(&start, cx);
        picker
    }

    fn navigate(&mut self, path: &str, cx: &mut Context<Self>) {
        let path = normalize_linux_path(path, &self.home);
        self.current = path.clone();
        self.input.update(cx, |input, cx| input.set_text(path.clone(), cx));
        self.listing = Listing::Loading;
        cx.notify();
        let read = path.clone();
        let task = cx.background_spawn(async move {
            let entries = std::fs::read_dir(&read)?;
            let mut folders: Vec<(String, String)> = entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    (!name.is_empty()).then(|| (join_path(&read, &name), name))
                })
                .collect();
            folders.sort_by_key(|(_, name)| name.to_lowercase());
            std::io::Result::Ok(folders)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.current != path {
                    return;
                }
                this.listing = match result {
                    Ok(folders) => Listing::Folders(folders),
                    Err(error) => {
                        eprintln!("Failed to read folder {path}: {error}");
                        Listing::Error
                    }
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(self.listing, Listing::Error) {
            notifications::error(cx, "Choose a readable folder.", None);
            return;
        }
        let path = PathBuf::from(&self.current);
        cx.emit(DismissEvent);
        (self.on_open)(path, window, cx);
    }

    fn title(&self) -> SharedString {
        if self.current == "/" {
            return "/".into();
        }
        self.current.rsplit('/').find(|segment| !segment.is_empty()).unwrap_or(&self.current).to_string().into()
    }
}

impl Render for FolderPicker {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let weak = cx.entity().downgrade();
        let can_go_up = self.current != "/";
        let toolbar = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .px(px(12.))
            .py(px(8.))
            .border_b_1()
            .border_color(colors.divider)
            .child(Button::icon("folder-picker-home", IconName::House).tooltip("Home").on_click(cx.listener(|this, _, _, cx| {
                let home = this.home.clone();
                this.navigate(&home, cx);
            })))
            .child(
                Button::icon("folder-picker-up", IconName::ArrowUp)
                    .tooltip("Parent folder")
                    .disabled(!can_go_up)
                    .on_click(cx.listener(|this, _, _, cx| {
                        let parent = parent_path(&this.current);
                        this.navigate(&parent, cx);
                    })),
            )
            .child(div().flex_1().min_w_0().font_family(typography::MONO_FONT).child(self.input.clone()))
            .child(Button::new("folder-picker-go", "Go").on_click(cx.listener(|this, _, _, cx| {
                let path = this.input.read(cx).text().to_string();
                this.navigate(&path, cx);
            })));
        let location = div()
            .flex()
            .items_center()
            .min_h(px(32.))
            .px(px(12.))
            .border_b_1()
            .border_color(colors.divider)
            .text_size(typography::text_sm())
            .child(div().truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(self.title()))
            .child(div().ml_auto().truncate().font_family(typography::MONO_FONT).text_color(colors.subtle_foreground).child(self.current.clone()));
        let body = match &self.listing {
            Listing::Error => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .px(px(24.))
                .child(EmptyState::new("Unable to read this folder.").icon(IconName::Warning).message(self.current.clone()))
                .into_any_element(),
            Listing::Loading => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::text_sm())
                .text_color(colors.muted_foreground)
                .child("Loading folders…")
                .into_any_element(),
            Listing::Folders(folders) if folders.is_empty() => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::text_sm())
                .text_color(colors.muted_foreground)
                .child("No folders")
                .into_any_element(),
            Listing::Folders(folders) => div()
                .id("folder-picker-list")
                .max_h(px(320.))
                .overflow_y_scroll()
                .py(px(4.))
                .px(px(4.))
                .children(folders.iter().enumerate().map(|(index, (path, name))| {
                    let path = path.clone();
                    SidebarListItem::new(("folder-picker-entry", index), name.clone())
                        .leading_icon(IconName::Folder)
                        .on_click(cx.listener(move |this, _, _, cx| this.navigate(&path, cx)))
                }))
                .scrollbar(window, cx)
                .into_any_element(),
        };
        Dialog::new("folder-picker", "Open Folder")
            .size(DialogSize::Lg)
            .layout(DialogLayout::Flush)
            .track_focus(&self.focus_handle)
            .on_close(move |_, cx| {
                weak.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
            })
            .footer([
                Button::new("folder-picker-cancel", "Cancel")
                    .variant(ButtonVariant::Ghost)
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(DismissEvent)))
                    .into_any_element(),
                Button::new("folder-picker-open", "Open Folder")
                    .variant(ButtonVariant::Accent)
                    .on_click(cx.listener(|this, _, window, cx| this.open(window, cx)))
                    .into_any_element(),
            ])
            .child(toolbar)
            .child(div().flex().flex_col().min_h(px(300.)).child(location).child(body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_paths() {
        assert_eq!(normalize_linux_path("", "/home/me"), "/home/me");
        assert_eq!(normalize_linux_path("~/code/", "/home/me/"), "/home/me/code");
        assert_eq!(normalize_linux_path("usr/lib", "/home/me"), "/usr/lib");
        assert_eq!(normalize_linux_path("///", "/home/me"), "/");
        assert_eq!(parent_path("/home/me"), "/home");
        assert_eq!(parent_path("/home"), "/");
        assert_eq!(parent_path("/"), "/");
    }
}
