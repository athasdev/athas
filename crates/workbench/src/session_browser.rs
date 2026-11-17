//! The session's browser controls (`session-panel/components/session-browser-view.tsx`): the
//! local servers it started and the others on this computer, sharing the page's server through a
//! preview link, and a banner while the agent browses on the hosted browser.

use std::{rc::Rc, time::Duration};

use browser_view::{BrowserPage, PageSlot};
use gpui::{AnyElement, App, AppContext as _, ClipboardItem, Context, Entity, SharedString, WeakEntity, Window, prelude::*};
use ui::{Alert, AlertVariant, Button, ButtonSize, ButtonVariant, DropdownAlign, DropdownMenu, IconName, MenuEntry, MenuItem, MenuSize, Tone};

/// How long the ports found on this computer are trusted before they are looked for again.
const DETECTED_FRESH: Duration = Duration::from_secs(10);

pub(crate) struct SessionBrowser {
    chat_id: String,
    page: WeakEntity<BrowserPage>,
    servers: Vec<String>,
    detected: Option<(Vec<u16>, std::time::Instant)>,
    detecting: bool,
    sharing: bool,
    shared_port: Option<u16>,
    server_menu: Entity<DropdownMenu>,
    shared_menu: Entity<DropdownMenu>,
}

/// "localhost:5173/docs" for a page address.
pub(crate) fn display_address(url: &str) -> String {
    let Some((_, rest)) = url.split_once("://").filter(|(scheme, rest)| !scheme.is_empty() && !rest.is_empty()) else { return url.to_string() };
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    if path.is_empty() { host.to_string() } else { format!("{host}/{path}") }
}

fn copy_preview_link(url: String, cx: &mut App) {
    cx.write_to_clipboard(ClipboardItem::new_string(url.clone()));
    let open = url.clone();
    notifications::notify_with(
        cx,
        notifications::NotificationKind::Success,
        notifications::NotificationCategory::Athas,
        "Preview link copied",
        Some(url.into()),
        None,
        notifications::ToastOptions {
            action: Some(notifications::NotificationAction { label: "Open".into(), handler: Rc::new(move |_, cx| cx.open_url(&open)) }),
            ..Default::default()
        },
    );
}

impl SessionBrowser {
    pub(crate) fn new(chat_id: String, page: WeakEntity<BrowserPage>, servers: Vec<String>, cx: &mut Context<Self>) -> Self {
        let this = cx.weak_entity();
        let server_menu = cx.new(|_| {
            DropdownMenu::new(
                |open, _, _| Button::icon("session-browser-servers", IconName::Laptop).size(ButtonSize::Small).active(open).tooltip("Local servers").into_any_element(),
                {
                    let this = this.clone();
                    move |_, cx| this.update(cx, |this, cx| this.server_entries(cx)).unwrap_or_default()
                },
            )
            .align(DropdownAlign::Start)
            .size(MenuSize::Wide)
        });
        let shared_menu = cx.new(|_| {
            DropdownMenu::new(
                {
                    let this = this.clone();
                    move |_, _, cx| {
                        let port = this.upgrade().and_then(|this| this.read(cx).shared_port);
                        Button::new("session-browser-shared", "Shared")
                            .leading_icon(IconName::Broadcast)
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .active(true)
                            .when_some(port, |button, port| button.tooltip(format!("Sharing localhost:{port}")))
                            .into_any_element()
                    }
                },
                move |_, cx| this.update(cx, |this, cx| this.shared_entries(cx)).unwrap_or_default(),
            )
        });
        let mut browser = Self { chat_id, page, servers, detected: None, detecting: false, sharing: false, shared_port: None, server_menu, shared_menu };
        browser.detect(cx);
        browser
    }

    pub(crate) fn set_servers(&mut self, servers: Vec<String>, cx: &mut Context<Self>) {
        if self.servers != servers {
            self.servers = servers;
            cx.notify();
        }
    }

    /// Draws the control for one of the page's slots.
    pub(crate) fn render_slot(&mut self, slot: PageSlot, url: &str, cx: &mut Context<Self>) -> Option<AnyElement> {
        match slot {
            PageSlot::AddressLeading => Some(self.server_menu.clone().into_any_element()),
            PageSlot::Actions => Some(self.render_share(url, cx)),
            PageSlot::Banner => self.render_hosted_banner(cx),
        }
    }

    fn detect(&mut self, cx: &mut Context<Self>) {
        if self.detecting || self.detected.as_ref().is_some_and(|(_, at)| at.elapsed() < DETECTED_FRESH) {
            return;
        }
        self.detecting = true;
        let work = cx.background_spawn(async { previews::proxy::detect_local_ports(&previews::proxy::COMMON_DEV_PORTS, Duration::from_millis(800)) });
        cx.spawn(async move |this, cx| {
            let ports = work.await;
            this.update(cx, |this, cx| {
                this.detecting = false;
                this.detected = Some((ports, std::time::Instant::now()));
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open(&self, url: &str, window: &mut Window, cx: &mut App) {
        if let Some(page) = self.page.upgrade() {
            page.update(cx, |page, cx| page.navigate(url, cx));
            let focus = gpui::Focusable::focus_handle(page.read(cx), cx);
            window.focus(&focus, cx);
        }
    }

    fn open_item(&self, label: String, icon: IconName, url: String) -> MenuEntry {
        let page = self.page.clone();
        MenuItem::new(label)
            .icon(icon)
            .on_select(move |window, cx| {
                if let Some(page) = page.upgrade() {
                    page.update(cx, |page, cx| page.navigate(&url, cx));
                    let focus = gpui::Focusable::focus_handle(page.read(cx), cx);
                    window.focus(&focus, cx);
                }
            })
            .into()
    }

    fn server_entries(&mut self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        self.detect(cx);
        let mut entries = vec![MenuEntry::Label("Started in this session".into())];
        if self.servers.is_empty() {
            entries.push(MenuItem::new("No servers yet").disabled(true).into());
        }
        for url in &self.servers {
            entries.push(self.open_item(display_address(url), IconName::Globe, url.clone()));
        }
        entries.push(MenuEntry::Separator);
        entries.push(MenuEntry::Label("Running on this computer".into()));
        let session_ports: Vec<u16> = self.servers.iter().filter_map(|url| agent_ui::dev_servers::local_server_port(url)).collect();
        let others: Vec<u16> = self.detected.as_ref().map(|(ports, _)| ports.iter().copied().filter(|port| !session_ports.contains(port)).collect()).unwrap_or_default();
        if others.is_empty() {
            let empty = if self.detected.is_none() { "Looking for servers…" } else { "No other servers found" };
            entries.push(MenuItem::new(empty).disabled(true).into());
        }
        for port in others {
            entries.push(self.open_item(format!("localhost:{port}"), IconName::Laptop, format!("http://localhost:{port}/")));
        }
        entries
    }

    fn page_url(&self, cx: &App) -> Option<String> {
        self.page.upgrade().map(|page| page.read(cx).url().to_string())
    }

    fn shared_entries(&mut self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let Some(url) = self.page_url(cx) else { return Vec::new() };
        let Some(shared) = agent_ui::dev_servers::local_server_port(&url).and_then(|port| previews::shared_local(port, cx)) else { return Vec::new() };
        let link = previews::preview_link_for(&shared.url, &url);
        let copy = link.clone();
        let id = shared.id.clone();
        vec![
            MenuItem::new("Copy Preview Link").icon(IconName::Copy).on_select(move |_, cx| copy_preview_link(copy.clone(), cx)).into(),
            MenuItem::new("Open Preview Link").icon(IconName::OpenExternal).on_select(move |_, cx| cx.open_url(&link)).into(),
            MenuEntry::Separator,
            MenuItem::new("Stop Sharing")
                .icon(IconName::Stop)
                .destructive()
                .on_select(move |_, cx| {
                    let task = previews::stop_preview(&id, cx);
                    cx.spawn(async move |cx| {
                        if let Err(error) = task.await {
                            cx.update(|cx| notifications::error(cx, error, None));
                        }
                    })
                    .detach();
                })
                .into(),
        ]
    }

    fn share(&mut self, port: u16, url: String, window: &mut Window, cx: &mut Context<Self>) {
        if !previews::has_previews(cx) {
            window.dispatch_action(Box::new(previews::ShareLocalServer), cx);
            return;
        }
        if self.sharing {
            return;
        }
        self.sharing = true;
        cx.notify();
        let task = previews::share_local_server(port, cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.sharing = false;
                match result {
                    Ok(preview) => copy_preview_link(previews::preview_link_for(&preview.url, &url), cx),
                    Err(error) => {
                        notifications::error(cx, error, None);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn render_share(&mut self, url: &str, cx: &mut Context<Self>) -> AnyElement {
        let Some(port) = agent_ui::dev_servers::local_server_port(url) else {
            return Button::new("session-browser-share", "Share")
                .leading_icon(IconName::Broadcast)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .disabled(true)
                .tooltip("Open a local server to share it")
                .into_any_element();
        };
        self.shared_port = previews::shared_local(port, cx).map(|_| port);
        if self.shared_port.is_some() {
            return self.shared_menu.clone().into_any_element();
        }
        let url = url.to_string();
        Button::new("session-browser-share", if self.sharing { "Sharing…" } else { "Share" })
            .leading_icon(IconName::Broadcast)
            .variant(ButtonVariant::Ghost)
            .size(ButtonSize::Small)
            .disabled(self.sharing)
            .tooltip(SharedString::from(format!("Share localhost:{port} with a preview link")))
            .on_click(cx.listener(move |this, _, window, cx| this.share(port, url.clone(), window, cx)))
            .into_any_element()
    }

    fn render_hosted_banner(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let run = browser_view::browser_use::running(&self.chat_id, cx)?;
        let url = run.url.clone();
        Some(
            Alert::new()
                .tone(Tone::Info)
                .variant(AlertVariant::Banner)
                .icon(IconName::Globe)
                .title(format!("Agent is browsing {}", display_address(&run.url)))
                .description("It runs on Athas's hosted browser, not on this page.")
                .action(
                    Button::new("session-browser-open-here", "Open here")
                        .size(ButtonSize::Small)
                        .on_click(cx.listener(move |this, _, window, cx| this.open(&url, window, cx))),
                )
                .into_any_element(),
        )
    }
}

/// Adds the session's controls to its browser page.
pub(crate) fn attach(chat_id: &str, page: &Entity<BrowserPage>, servers: Vec<String>, cx: &mut App) -> Entity<SessionBrowser> {
    let tools = cx.new(|cx| SessionBrowser::new(chat_id.to_string(), page.downgrade(), servers, cx));
    let weak = tools.downgrade();
    let extras: browser_view::PageExtras = Rc::new(move |slot, url, _window, cx| weak.update(cx, |tools, cx| tools.render_slot(slot, url, cx)).ok().flatten());
    page.update(cx, |page, cx| page.set_extras(extras, &tools, cx));
    tools
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_read_as_host_and_path() {
        assert_eq!(display_address("http://localhost:5173/"), "localhost:5173");
        assert_eq!(display_address("https://example.com/docs?q=1"), "example.com/docs");
        assert_eq!(display_address("not a url"), "not a url");
    }
}
