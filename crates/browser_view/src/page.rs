//! A browser tab: its navigation bar in GPUI and the native page under it.
//!
//! Ported from Athas's `features/browser/components/browser-page.tsx` and the page side of
//! `browser-tab-manager.ts`.

use athas_browser::BrowserEvent;
use futures::{StreamExt, channel::mpsc};
use ui::scale::px;
use gpui::{
    App, ClickEvent, Context, Entity, EventEmitter, FocusHandle, Focusable, ObjectFit, Subscription, Window, div, img,
    prelude::*,
};
use ui::{
    Button, ButtonSize, ButtonVariant, DropdownMenu, EmptyState, Icon, IconName, IconSize, InputAppearance, InputGroup, MenuEntry, MenuItem,
    TextInput, TextInputEvent, pane_actions, pane_header,
    prelude::*,
};

use crate::{
    Back, FocusAddressBar, Forward, ImportBrowserData, ManagePasskeys, OpenDevTools, Reload, ResetZoom, ZoomIn, ZoomOut,
    address::{format_browser_address, is_blank_page, is_secure_address, resolve_browser_address},
    host::{Content, Host, HostRef, NativeEvent, NavigationAction},
    key_bindings::{browser_key_bindings, is_page_command},
    page_state::{PageState, step_zoom},
    pages,
    profile::PageProfile,
    slot::webview_slot,
};

const SLOT_RADIUS: f32 = 8.;

/// Where an owner of the page adds its own controls (`BrowserPage`'s `addressLeading`, `actions`
/// and `banner`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageSlot {
    /// Before the address field.
    AddressLeading,
    /// Beside the page actions menu.
    Actions,
    /// A strip between the navigation bar and the page.
    Banner,
}

/// Draws the owner's control for a slot, given the page's address.
pub type PageExtras = std::rc::Rc<dyn Fn(PageSlot, &str, &mut Window, &mut App) -> Option<gpui::AnyElement>>;

pub enum BrowserPageEvent {
    /// The tab's name changed: the page's title, or its host.
    TitleChanged(String),
}

pub struct BrowserPage {
    id: String,
    state: PageState,
    zoom: f64,
    host: HostRef,
    address: Entity<TextInput>,
    /// The address bar holds text the user typed, not the page's address.
    editing: bool,
    focus_handle: FocusHandle,
    menu: Entity<DropdownMenu>,
    extras: Option<PageExtras>,
    /// The passkey sheet or the profile dialog over the page.
    pub(crate) profile: PageProfile,
    _subscriptions: Vec<Subscription>,
}

/// What a page opens over itself once it shows, for a command run with no browser tab in front.
#[derive(Clone, Copy, PartialEq, Eq)]
enum OpenOnShow {
    Import,
    Passkeys,
}

thread_local! {
    static OPEN_ON_SHOW: std::cell::RefCell<Option<(OpenOnShow, String)>> = const { std::cell::RefCell::new(None) };
}

/// Opens a blank browser tab with the import dialog, or the passkeys, over it.
fn open_tab_with(open: OpenOnShow, cx: &mut App) {
    let id = pages::new_page_id();
    OPEN_ON_SHOW.with(|pending| *pending.borrow_mut() = Some((open, id.clone())));
    pages::with_store(|store| store.update(&id, |page| page.url = crate::address::BLANK_PAGE_URL.to_string()));
    workbench_api::open_resource(cx, crate::BROWSER_KIND, &id, &crate::address::browser_tab_name(crate::address::BLANK_PAGE_URL, None));
}

/// The profile commands where no browser tab is in front to take them.
pub(crate) fn init_profile_commands(cx: &mut App) {
    if !PageProfile::AVAILABLE {
        return;
    }
    cx.on_action(|_: &ImportBrowserData, cx| open_tab_with(OpenOnShow::Import, cx));
    cx.on_action(|_: &ManagePasskeys, cx| open_tab_with(OpenOnShow::Passkeys, cx));
}

impl EventEmitter<BrowserPageEvent> for BrowserPage {}

impl Focusable for BrowserPage {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// Opens a browser tab on `url`, or a blank one.
pub fn open_browser_tab(url: Option<&str>, cx: &mut App) {
    let id = pages::new_page_id();
    let url = url.unwrap_or(crate::address::BLANK_PAGE_URL);
    pages::with_store(|store| store.update(&id, |page| page.url = url.to_string()));
    let title = crate::address::browser_tab_name(url, None);
    workbench_api::open_resource(cx, crate::BROWSER_KIND, &id, &title);
}

impl BrowserPage {
    pub fn new(id: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let saved = pages::with_store(|store| store.get(&id).cloned()).unwrap_or_default();
        let url = if saved.url.is_empty() { crate::address::BLANK_PAGE_URL.to_string() } else { saved.url };
        let zoom = saved.zoom.unwrap_or(1.0);
        let (events, mut receiver) = mpsc::unbounded();
        let host = Host::new(events, zoom);
        {
            let mut host = host.borrow_mut();
            host.key_bindings = cx.try_global::<keymap::ActiveKeymap>().map(|active| browser_key_bindings(&active.bindings)).unwrap_or_default();
            if !is_blank_page(&url) {
                host.pending = Some(Content::Url(url.clone()));
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

        let address = cx.new(|cx| {
            let mut input = TextInput::new(window, cx).placeholder("Search or enter address").appearance(InputAppearance::Bare);
            input.set_text(format_browser_address(&url).to_string(), cx);
            input
        });
        let address_events = cx.subscribe_in(&address, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(text) => this.editing = text.as_ref() != format_browser_address(&this.state.url),
            TextInputEvent::Confirmed => this.submit_address(window, cx),
            TextInputEvent::Cancelled => {
                if this.editing {
                    this.editing = false;
                    this.sync_address(cx);
                    this.address.update(cx, |input, cx| input.select_all_text(cx));
                } else if !this.state.is_blank() {
                    this.focus_page();
                }
            }
            TextInputEvent::Focused => this.address.update(cx, |input, cx| input.select_all_text(cx)),
            TextInputEvent::Blurred => {
                this.editing = false;
                this.sync_address(cx);
            }
        });
        let focus_handle = cx.focus_handle();
        let focus_blank = cx.on_focus(&focus_handle, window, |this, window, cx| {
            if this.state.is_blank() {
                this.address.update(cx, |input, cx| input.focus(window, cx));
            }
        });
        let menu = Self::build_menu(cx.weak_entity(), cx);
        Self {
            id,
            state: PageState::new(url),
            zoom,
            host,
            address,
            editing: false,
            focus_handle,
            menu,
            extras: None,
            profile: PageProfile::default(),
            _subscriptions: vec![address_events, focus_blank],
        }
        .with_pending_dialog(window, cx)
    }

    fn with_pending_dialog(self, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let open = OPEN_ON_SHOW.with(|pending| {
            let mut pending = pending.borrow_mut();
            if pending.as_ref().is_some_and(|(_, id)| *id == self.id) { pending.take().map(|(open, _)| open) } else { None }
        });
        #[cfg(all(debug_assertions, feature = "webview", any(target_os = "macos", target_os = "windows")))]
        if let Ok(kind) = std::env::var("ATHAS_SNAPSHOT_PASSKEY") {
            let page = cx.weak_entity();
            window.defer(cx, move |window, cx| {
                page.update(cx, |page, cx| {
                    let host = page.host.clone();
                    page.profile.preview_sheet(&host, &kind, window, cx);
                })
                .ok();
            });
        }
        if let Some(open) = open {
            // The tab's view is not in the window yet; the dialog opens once it is.
            let page = cx.weak_entity();
            window.defer(cx, {
                move |window, cx| {
                    page.update(cx, |page, cx| match open {
                        OpenOnShow::Import => page.open_import(window, cx),
                        OpenOnShow::Passkeys => page.open_passkeys(window, cx),
                    })
                    .ok();
                }
            });
        }
        self
    }

    pub fn open_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.release_native_focus();
        let host = self.host.clone();
        self.profile.open_import(&host, window, cx);
    }

    pub fn open_passkeys(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.release_native_focus();
        self.profile.open_passkeys(window, cx);
    }

    /// Adds the owner's controls to the page, redrawn whenever `source` changes.
    pub fn set_extras<T: 'static>(&mut self, extras: PageExtras, source: &Entity<T>, cx: &mut Context<Self>) {
        self.extras = Some(extras);
        self._subscriptions.push(cx.observe(source, |_, _, cx| cx.notify()));
        cx.notify();
    }

    pub fn url(&self) -> &str {
        &self.state.url
    }

    pub fn state(&self) -> &PageState {
        &self.state
    }

    pub fn reload(&mut self, cx: &mut Context<Self>) {
        self.perform(NavigationAction::Reload, cx);
    }

    fn build_menu(page: gpui::WeakEntity<Self>, cx: &mut Context<Self>) -> Entity<DropdownMenu> {
        cx.new(move |_| {
            DropdownMenu::new(
                |open, _, _| Button::icon("browser-page-actions", IconName::Dots).size(ButtonSize::Small).active(open).tooltip("Page actions").into_any_element(),
                move |_, cx| {
                    let blank = page.upgrade().is_none_or(|page| page.read(cx).state.is_blank());
                    let item = |label: &'static str, icon: IconName, run: fn(&mut BrowserPage, &mut Window, &mut Context<BrowserPage>)| {
                        let page = page.clone();
                        MenuItem::new(label).icon(icon).disabled(blank).on_select(move |window, cx| {
                            page.update(cx, |page, cx| run(page, window, cx)).ok();
                        })
                    };
                    let profile_item = |label: &'static str, icon: IconName, run: fn(&mut BrowserPage, &mut Window, &mut Context<BrowserPage>)| {
                        let page = page.clone();
                        MenuItem::new(label).icon(icon).on_select(move |window, cx| {
                            page.update(cx, |page, cx| run(page, window, cx)).ok();
                        })
                    };
                    let mut entries: Vec<MenuEntry> = vec![
                        item("Open in System Browser", IconName::OpenExternal, |page, _, cx| cx.open_url(&page.state.url)).into(),
                        item("Copy Address", IconName::Copy, |page, _, cx| {
                            cx.write_to_clipboard(gpui::ClipboardItem::new_string(page.state.url.clone()));
                            notifications::info(cx, "Copied address");
                        })
                        .into(),
                        MenuEntry::Separator,
                        item("Developer Tools", IconName::Bug, |page, _, cx| page.open_devtools(cx)).into(),
                        item("Clear Browsing Data", IconName::Trash, |page, _, cx| page.clear_browsing_data(cx)).destructive().into(),
                    ];
                    if PageProfile::AVAILABLE {
                        entries.splice(
                            3..3,
                            [
                                profile_item("Import from Browser…", IconName::Download, BrowserPage::open_import).into(),
                                profile_item("Passkeys", IconName::Key, BrowserPage::open_passkeys).into(),
                                MenuEntry::Separator,
                            ],
                        );
                    }
                    entries
                },
            )
        })
    }

    fn sync_address(&mut self, cx: &mut Context<Self>) {
        if self.editing {
            return;
        }
        let text = format_browser_address(&self.state.url).to_string();
        if self.address.read(cx).text().as_ref() == text {
            return;
        }
        self.address.update(cx, |input, cx| input.set_text(text, cx));
    }

    fn remember(&self) {
        let (url, zoom) = (self.state.url.clone(), self.zoom);
        pages::with_store(|store| {
            store.update(&self.id, |page| {
                page.url = url;
                page.zoom = (zoom != 1.0).then_some(zoom);
            })
        });
    }

    fn changed(&mut self, changed: crate::page_state::Changed, cx: &mut Context<Self>) {
        if changed.url {
            self.remember();
            self.sync_address(cx);
        }
        if changed.name {
            let name = self.state.tab_name();
            workbench_api::rename_resource(cx, crate::BROWSER_KIND, &self.id, &name);
            cx.emit(BrowserPageEvent::TitleChanged(name));
        }
        cx.notify();
    }

    fn fail(&mut self, error: String, cx: &mut Context<Self>) {
        self.state.fail(error);
        cx.notify();
    }

    /// Loads `url` in the page.
    pub fn navigate(&mut self, url: &str, cx: &mut Context<Self>) {
        let changed = self.state.navigate(url);
        let result = {
            let mut host = self.host.borrow_mut();
            match &host.native {
                Some(native) => native.navigate(if is_blank_page(url) { crate::address::BLANK_PAGE_URL } else { url }),
                None => {
                    host.pending = (!is_blank_page(url)).then(|| Content::Url(url.to_string()));
                    Ok(())
                }
            }
        };
        if let Err(error) = result {
            self.state.fail(error);
        }
        self.changed(changed, cx);
    }

    fn submit_address(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // An untouched address does nothing, as the original's null draft: Enter is not Reload.
        if !self.editing {
            return;
        }
        let typed = self.address.read(cx).text().to_string();
        let Some(url) = resolve_browser_address(&typed) else { return };
        self.editing = false;
        let modifiers = window.modifiers();
        if modifiers.platform || modifiers.control || modifiers.alt {
            self.sync_address(cx);
            crate::page::open_browser_tab(Some(&url), cx);
            return;
        }
        self.navigate(&url, cx);
        self.sync_address(cx);
        if !is_blank_page(&url) {
            window.focus(&self.focus_handle, cx);
            self.focus_page();
        }
    }

    fn focus_page(&self) {
        if let Some(native) = &self.host.borrow().native {
            native.focus();
        }
    }

    pub fn perform(&mut self, action: NavigationAction, cx: &mut Context<Self>) {
        let result = match &self.host.borrow().native {
            Some(native) => native.perform(action),
            None => Ok(()),
        };
        match result {
            Err(error) => self.fail(error, cx),
            Ok(()) if self.host.borrow().native.is_none() && action == NavigationAction::Reload && !self.state.is_blank() => {
                let url = self.state.url.clone();
                self.navigate(&url, cx);
            }
            Ok(()) => {}
        }
    }

    /// Steps the page zoom like a browser does, or resets it when `direction` is 0.
    pub fn zoom(&mut self, direction: i32, cx: &mut Context<Self>) {
        self.zoom = step_zoom(self.zoom, direction);
        self.remember();
        let mut host = self.host.borrow_mut();
        host.zoom = self.zoom;
        if let Some(Err(error)) = host.native.as_ref().map(|native| native.set_zoom(self.zoom)) {
            drop(host);
            self.fail(error, cx);
            return;
        }
        cx.notify();
    }

    fn open_devtools(&mut self, cx: &mut Context<Self>) {
        if let Some(Err(error)) = self.host.borrow().native.as_ref().map(|native| native.open_devtools()) {
            notifications::error(cx, error, None);
        }
    }

    fn clear_browsing_data(&mut self, cx: &mut Context<Self>) {
        match self.host.borrow().native.as_ref().map(|native| native.clear_data()) {
            Some(Ok(())) => {
                notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, "Cleared browsing data", None, None);
            }
            Some(Err(error)) => {
                notifications::error(cx, error, None);
            }
            None => {}
        }
    }

    pub fn focus_address_bar(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.release_native_focus();
        self.address.update(cx, |input, cx| {
            input.focus(window, cx);
            input.select_all_text(cx);
        });
    }

    fn release_native_focus(&self) {
        let mut host = self.host.borrow_mut();
        if host.native_focused {
            host.native_focused = false;
            if let Some(native) = &host.native {
                native.focus_parent();
            }
        }
    }

    /// Runs a workbench shortcut pressed while the page had keyboard focus.
    fn run_shortcut(&mut self, command: &str, window: &mut Window, cx: &mut Context<Self>) {
        if !is_page_command(command) {
            self.release_native_focus();
        }
        let action = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action(command)).or_else(|| match command {
            "workbench.zoomIn" => Some(Box::new(ZoomIn) as Box<dyn gpui::Action>),
            "workbench.zoomOut" => Some(Box::new(ZoomOut)),
            "workbench.zoomReset" => Some(Box::new(ResetZoom)),
            _ => None,
        });
        if let Some(action) = action {
            window.focus(&self.focus_handle, cx);
            window.dispatch_action(action, cx);
        }
    }

    fn handle_native(&mut self, event: NativeEvent, window: &mut Window, cx: &mut Context<Self>) {
        if crate::host::handle_occlusion(&self.host, &event, cx) {
            return;
        }
        match event {
            NativeEvent::Page(BrowserEvent::Focused) => {
                // A click on the page never reaches the workbench, so a menu open over part of
                // the page would otherwise stay open.
                let dismiss_at = {
                    let host = self.host.borrow();
                    match (&host.occlusion, &host.applied) {
                        (crate::layout::Occlusion::Covered, Some(Some((geometry, holes)))) => crate::layout::uncovered_point(*geometry, holes),
                        _ => None,
                    }
                };
                if let Some(point) = dismiss_at {
                    dismiss_workbench_popups(point, &self.host, window, cx);
                }
                self.host.borrow_mut().native_focused = true;
                self.editing = false;
                self.sync_address(cx);
                window.focus(&self.focus_handle, cx);
            }
            NativeEvent::Page(BrowserEvent::Shortcut { command }) => self.run_shortcut(&command, window, cx),
            NativeEvent::Page(BrowserEvent::OpenInNewTab { url }) => open_browser_tab(Some(&url), cx),
            NativeEvent::PasskeyRequest { request_id, create, origin, options } => {
                self.release_native_focus();
                let host = self.host.clone();
                self.profile.passkey_request(&host, request_id, create, &origin, &options, window, cx);
            }
            NativeEvent::PasskeyCancel(request_id) => self.profile.passkey_cancel(Some(request_id), window, cx),
            NativeEvent::Page(BrowserEvent::DownloadStarted { path, .. }) => {
                notifications::info(cx, format!("Downloading {}", file_name(&path)));
            }
            NativeEvent::Page(BrowserEvent::DownloadFinished { path, success, .. }) => {
                if success {
                    let title = path.as_deref().map_or("Download finished".to_string(), |path| format!("Downloaded {}", file_name(path)));
                    let action = path.map(|path| {
                        notifications::NotificationAction::new("Show", move |_, cx| cx.reveal_path(std::path::Path::new(&path)))
                    });
                    notifications::notify_with(
                        cx,
                        notifications::NotificationKind::Success,
                        notifications::NotificationCategory::Athas,
                        title,
                        None,
                        None,
                        notifications::ToastOptions { action, ..Default::default() },
                    );
                } else {
                    notifications::error(cx, "Download failed", None);
                }
            }
            NativeEvent::Page(event) => {
                // A page that moves on takes its passkey request with it.
                if matches!(event, BrowserEvent::LoadStarted { .. }) {
                    self.profile.passkey_cancel(None, window, cx);
                }
                let changed = self.state.apply(&event);
                self.changed(changed, cx);
            }
            NativeEvent::Location { can_go_back, can_go_forward } => {
                let url = self.host.borrow().native.as_ref().and_then(|native| native.url());
                if let Some(url) = url {
                    let changed = self.state.apply(&BrowserEvent::UrlChanged { url, can_go_back, can_go_forward });
                    self.changed(changed, cx);
                }
            }
            NativeEvent::OpenExternally(url) => cx.open_url(&url),
            NativeEvent::Failed(error) => self.fail(error, cx),
            NativeEvent::CaptureStarted | NativeEvent::Snapshot(_) | NativeEvent::Revealed => {}
        }
    }

    fn render_slot(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let overlay = self.profile.render(cx);
        let colors = cx.theme().colors.clone();
        let host = self.host.borrow();
        let content = if let Some(error) = &self.state.error {
            let url = self.state.url.clone();
            Some(
                EmptyState::new("Something went wrong")
                    .icon(IconName::WarningCircle)
                    .message(error.clone())
                    .action(Button::new("browser-try-again", "Try Again").on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.navigate(&url, cx))))
                    .into_any_element(),
            )
        } else if self.state.is_blank() {
            Some(
                EmptyState::new("Browse the web")
                    .icon(IconName::Globe)
                    .message("Search or enter an address, such as localhost:5173 or athas.dev")
                    .when(PageProfile::AVAILABLE, |state| {
                        state.action(
                            Button::new("browser-import", "Import from Browser")
                                .leading_icon(IconName::Download)
                                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.open_import(window, cx))),
                        )
                    })
                    .into_any_element(),
            )
        } else if host.unavailable || !crate::NATIVE_PAGES {
            Some(page_placeholder(&self.state.url, cx).into_any_element())
        } else {
            None
        };
        div()
            .id("browser-slot")
            .relative()
            .flex()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .rounded(px(SLOT_RADIUS))
            .bg(colors.surface)
            .shadow(cx.theme().shadows.raised.clone())
            .children(host.snapshot.clone().map(|picture| img(picture).absolute().top_0().left_0().size_full().object_fit(ObjectFit::Fill)))
            .children(content)
            .child(webview_slot(self.host.clone(), f64::from(SLOT_RADIUS)))
            .children(overlay)
    }
}

/// Closes workbench popups after a click into a page by pressing the pointer, as the workbench
/// sees it, on a part of the page no UI covers. Runs after the current update, since the press
/// reaches every view's handlers.
fn dismiss_workbench_popups(point: (f64, f64), host: &HostRef, window: &mut Window, cx: &mut App) {
    let host = std::rc::Rc::downgrade(host);
    window.defer(cx, move |window, cx| {
        let position = gpui::point(px(point.0 as f32), px(point.1 as f32));
        let modifiers = gpui::Modifiers::default();
        let button = gpui::MouseButton::Left;
        // The press would hand keyboard focus from the page back to the window; the page keeps it.
        let host = host.upgrade();
        if let Some(host) = &host {
            host.borrow_mut().native_focused = false;
        }
        window.dispatch_event(gpui::PlatformInput::MouseDown(gpui::MouseDownEvent { button, position, modifiers, click_count: 1, first_mouse: false }), cx);
        window.dispatch_event(gpui::PlatformInput::MouseUp(gpui::MouseUpEvent { button, position, modifiers, click_count: 1 }), cx);
        if let Some(host) = host {
            host.borrow_mut().native_focused = true;
        }
    });
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path).file_name().map_or_else(|| path.to_string(), |name| name.to_string_lossy().into_owned())
}

/// What stands where the native page goes when there is none: a headless window, or a build
/// without native pages.
pub(crate) fn page_placeholder(url: &str, cx: &App) -> impl IntoElement {
    let colors = &cx.theme().colors;
    let message = if crate::NATIVE_PAGES { "The page shows here in the app window" } else { "Pages can't show inside Athas on this platform yet" };
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(8.))
        .px(px(24.))
        .max_w(px(420.))
        .text_center()
        .child(Icon::new(IconName::Globe).size(IconSize::Custom(px(24.))).color(colors.subtle_foreground))
        .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(message))
        .child(div().max_w_full().truncate().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(url.to_string()))
}

impl Render for BrowserPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let blank = self.state.is_blank();
        let loading = self.state.is_loading;
        let secure = is_secure_address(&self.state.url);
        let address_focus = self.address.focus_handle(cx);
        let address_focused = address_focus.contains_focused(window, cx);
        let shortcut = |command: &str| {
            cx.try_global::<keymap::ActiveKeymap>()
                .and_then(|active| keymap::shortcuts_by_command(&active.bindings).get(command).map(|key| keymap::display_key(key)))
        };
        let back = Button::icon("browser-back", IconName::ArrowLeft)
            .size(ButtonSize::Small)
            .tooltip("Back")
            .when_some(shortcut("browser.back"), |button, key| button.shortcut(key))
            .disabled(!self.state.can_go_back())
            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.perform(NavigationAction::Back, cx)));
        let forward = Button::icon("browser-forward", IconName::ArrowRight)
            .size(ButtonSize::Small)
            .tooltip("Forward")
            .when_some(shortcut("browser.forward"), |button, key| button.shortcut(key))
            .disabled(!self.state.can_go_forward())
            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.perform(NavigationAction::Forward, cx)));
        let reload = Button::icon("browser-reload", if loading { IconName::X } else { IconName::ArrowClockwise })
            .size(ButtonSize::Small)
            .tooltip(if loading { "Stop" } else { "Reload" })
            .when_some(shortcut("browser.reload").filter(|_| !loading), |button, key| button.shortcut(key))
            .disabled(blank)
            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                this.perform(if loading { NavigationAction::Stop } else { NavigationAction::Reload }, cx)
            }));
        let address = InputGroup::new(self.address.clone())
            .focus_handle(&address_focus)
            .start(Icon::new(if secure { IconName::Lock } else { IconName::Globe }).size(IconSize::Small).color(if address_focused {
                colors.muted_foreground
            } else {
                colors.subtle_foreground
            }));
        let zoom = (self.zoom - 1.0).abs() > f64::EPSILON;
        let extras = self.extras.clone();
        let url = self.state.url.clone();
        let extra = |slot: PageSlot, window: &mut Window, cx: &mut Context<Self>| extras.as_ref().and_then(|extras| extras(slot, &url, window, cx));
        let leading = extra(PageSlot::AddressLeading, window, cx);
        let actions = extra(PageSlot::Actions, window, cx);
        let banner = extra(PageSlot::Banner, window, cx);
        div()
            .id("browser-page")
            .key_context("Browser")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(|this, _: &Back, _, cx| this.perform(NavigationAction::Back, cx)))
            .on_action(cx.listener(|this, _: &Forward, _, cx| this.perform(NavigationAction::Forward, cx)))
            .on_action(cx.listener(|this, _: &Reload, _, cx| this.perform(NavigationAction::Reload, cx)))
            .on_action(cx.listener(|this, _: &FocusAddressBar, window, cx| this.focus_address_bar(window, cx)))
            .on_action(cx.listener(|this, _: &OpenDevTools, _, cx| this.open_devtools(cx)))
            .when(PageProfile::AVAILABLE, |this| {
                this.on_action(cx.listener(|this, _: &ImportBrowserData, window, cx| this.open_import(window, cx)))
                    .on_action(cx.listener(|this, _: &ManagePasskeys, window, cx| this.open_passkeys(window, cx)))
            })
            .on_action(cx.listener(|this, _: &ZoomIn, _, cx| this.zoom(1, cx)))
            .on_action(cx.listener(|this, _: &ZoomOut, _, cx| this.zoom(-1, cx)))
            .on_action(cx.listener(|this, _: &ResetZoom, _, cx| this.zoom(0, cx)))
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .bg(colors.background)
            .child(
                pane_header(cx)
                    .child(div().flex().flex_none().items_center().gap(metrics::chrome_gap_tight()).child(back).child(forward).child(reload))
                    .child(div().flex().flex_1().min_w_0().items_center().gap(metrics::chrome_gap_tight()).children(leading).child(address))
                    .child(
                        pane_actions()
                            .children(actions)
                            .when(zoom, |this| {
                                this.child(
                                    Button::new("browser-reset-zoom", format!("{}%", (self.zoom * 100.0).round()))
                                        .variant(ButtonVariant::Ghost)
                                        .size(ButtonSize::Small)
                                        .tooltip("Reset zoom")
                                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.zoom(0, cx))),
                                )
                            })
                            .child(self.menu.clone()),
                    ),
            )
            .children(banner)
            .child(div().flex().flex_1().min_h_0().px(px(6.)).pb(px(6.)).child(self.render_slot(cx)))
    }
}
