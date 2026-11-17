//! Preview links (`features/previews`): share a dev server on this computer through a temporary
//! athas.dev link (Pro). The account service creates the preview, a tunnel to the athas-cloud
//! Worker carries visitor requests here, and they are answered from `http://localhost:<port>`.

pub mod protocol;
pub mod proxy;
pub mod tunnel;

use std::{collections::BTreeMap, time::Duration};

use account::{AccountEvent, AccountStore, ApiError, Method};
use gpui::{
    App, AppContext, ClipboardItem, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, Global, SharedString, Subscription, Task, Window,
    div, prelude::*, px,
};
use serde::Deserialize;
use serde_json::Value;
use theme::ActiveTheme;
use ui::{Badge, Button, ButtonSize, ButtonVariant, Dialog, Field, IconName, TextInput, TextInputEvent, Tone, metrics, typography};

use tunnel::{TicketError, Tunnel, TunnelEvent, TunnelStatus};

/// A preview link as the account service describes it.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: String,
    #[serde(default)]
    pub kind: String,
    pub url: String,
    pub port: u16,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub expires_at: String,
    #[serde(default)]
    pub requests: u64,
}

/// Where a local preview's tunnel connects, and until when its token is valid.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTicket {
    pub url: String,
    pub expires_at: String,
}

impl PreviewTicket {
    pub fn token(&self) -> Option<String> {
        url::Url::parse(&self.url).ok()?.query_pairs().find(|(key, _)| key == "token").map(|(_, value)| value.into_owned())
    }
}

/// "localhost:5173 · 12 requests · until 18:30", or the sandbox port for a cloud agent.
pub fn describe_preview(preview: &Preview, requests: u64) -> String {
    let source = if preview.kind == "sandbox" { format!("Cloud agent port {}", preview.port) } else { format!("localhost:{}", preview.port) };
    let count = format!("{requests} {}", if requests == 1 { "request" } else { "requests" });
    let until = chrono::DateTime::parse_from_rfc3339(&preview.expires_at)
        .map(|date| date.with_timezone(&chrono::Local).format("%H:%M").to_string())
        .unwrap_or_default();
    format!("{source} · {count} · until {until}")
}

/// The previews API (`previews-api.ts`) with the account token.
fn request(cx: &App, method: Method, path: &str, body: Option<Value>) -> Option<impl FnOnce() -> Result<Value, ApiError> + Send + 'static> {
    let store = AccountStore::global(cx)?.read(cx);
    let (client, token) = (store.client().clone(), store.token()?.to_string());
    let path = format!("/api/previews{path}");
    Some(move || client.authed(&token, method, &path, body.as_ref(), "Previews are temporarily unavailable."))
}

fn parse<T: for<'de> Deserialize<'de>>(value: &Value, key: &str) -> Result<T, ApiError> {
    serde_json::from_value(value.get(key).cloned().unwrap_or(Value::Null)).map_err(|error| ApiError::Malformed(error.to_string()))
}

/// A local server this app shares, with its tunnel's state and the requests it answered.
pub struct SharedPreview {
    pub preview: Preview,
    pub status: TunnelStatus,
    pub requests: u64,
    tunnel: Tunnel,
}

/// The previews this app shares (`previews.store.ts`).
#[derive(Default)]
pub struct Previews {
    pub shared: BTreeMap<String, SharedPreview>,
}

impl Global for Previews {}

gpui::actions!(preview, [ShareLocalServer]);

pub fn init(cx: &mut App) {
    cx.set_global(Previews::default());
    if let Some(store) = AccountStore::global(cx) {
        cx.subscribe(&store, |_, event: &AccountEvent, cx| {
            if *event == AccountEvent::SignedOut {
                stop_all(cx);
            }
        })
        .detach();
    }
    cx.on_app_quit(|cx| {
        stop_all(cx);
        async {}
    })
    .detach();
}

fn update_shared(cx: &mut App, id: &str, update: impl FnOnce(&mut Previews, &str)) {
    if cx.has_global::<Previews>() {
        cx.update_global::<Previews, _>(|previews, _| update(previews, id));
        cx.refresh_windows();
    }
}

/// Creates a preview of `http://localhost:<port>` and keeps its tunnel open.
pub fn share_local_server(port: u16, cx: &mut App) -> Task<Result<Preview, String>> {
    let Some(create) = request(cx, Method::Post, "", Some(serde_json::json!({ "kind": "local", "port": port }))) else {
        return Task::ready(Err("Sign in to share a local server.".into()));
    };
    let ticket_request = AccountStore::global(cx).map(|store| {
        let store = store.read(cx);
        (store.client().clone(), store.token().unwrap_or_default().to_string())
    });
    let created = cx.background_spawn(async move {
        let value = create().map_err(|error| error.to_string())?;
        let preview: Preview = parse(&value, "preview").map_err(|error| error.to_string())?;
        let ticket: PreviewTicket = parse(&value, "connect").map_err(|error| error.to_string())?;
        Ok::<_, String>((preview, ticket))
    });
    cx.spawn(async move |cx| {
        let (preview, ticket) = created.await?;
        let (client, token) = ticket_request.ok_or("Sign in to share a local server.")?;
        let path = format!("/api/previews/{}/token", url::form_urlencoded::byte_serialize(preview.id.as_bytes()).collect::<String>());
        let tickets: tunnel::TicketSource = Box::new(move || match client.authed(&token, Method::Post, &path, None, "Previews are temporarily unavailable.") {
            Ok(value) => parse(&value, "connect").map_err(|_| TicketError::Failed),
            Err(ApiError::Http { status: 404 | 410, .. }) => Err(TicketError::Ended),
            Err(_) => Err(TicketError::Failed),
        });
        let (sender, receiver) = futures_channel();
        let tunnel = tunnel::connect(port, ticket, tickets, move |event| {
            sender.unbounded_send(event).ok();
        });
        let id = preview.id.clone();
        cx.update(|cx| {
            cx.update_global::<Previews, _>(|previews, _| {
                previews.shared.insert(id.clone(), SharedPreview { preview: preview.clone(), status: TunnelStatus::Connecting, requests: 0, tunnel });
            });
            cx.spawn(async move |cx| {
                use futures::StreamExt as _;
                let mut receiver = receiver;
                while let Some(event) = receiver.next().await {
                    let ended = matches!(event, TunnelEvent::Status(TunnelStatus::Ended));
                    cx.update(|cx| {
                        update_shared(cx, &id, |previews, id| match event {
                            TunnelEvent::Status(TunnelStatus::Ended) => {
                                previews.shared.remove(id);
                            }
                            TunnelEvent::Status(status) => {
                                if let Some(entry) = previews.shared.get_mut(id) {
                                    entry.status = status;
                                }
                            }
                            TunnelEvent::Request { .. } => {
                                if let Some(entry) = previews.shared.get_mut(id) {
                                    entry.requests += 1;
                                }
                            }
                        })
                    });
                    if ended {
                        break;
                    }
                }
            })
            .detach();
        });
        Ok(preview)
    })
}

fn futures_channel() -> (futures::channel::mpsc::UnboundedSender<TunnelEvent>, futures::channel::mpsc::UnboundedReceiver<TunnelEvent>) {
    futures::channel::mpsc::unbounded()
}

/// Stops a preview, closing its tunnel when this app runs it.
pub fn stop_preview(id: &str, cx: &mut App) -> Task<Result<(), String>> {
    if let Some(shared) = cx.try_global::<Previews>().and_then(|previews| previews.shared.get(id)) {
        shared.tunnel.close();
    }
    let path = format!("/{}", url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>());
    let stop = request(cx, Method::Delete, &path, None);
    let id = id.to_string();
    let task = cx.background_spawn(async move { stop.map_or(Ok(Value::Null), |stop| stop()).map(|_| ()).map_err(|error| error.to_string()) });
    cx.spawn(async move |cx| {
        let result = task.await;
        cx.update(|cx| update_shared(cx, &id, |previews, id| drop(previews.shared.remove(id))));
        result
    })
}

/// Stops every preview this app shares, for signing out and quitting.
pub fn stop_all(cx: &mut App) {
    let ids: Vec<String> = cx.try_global::<Previews>().map(|previews| previews.shared.keys().cloned().collect()).unwrap_or_default();
    for id in ids {
        stop_preview(&id, cx).detach();
    }
}

/// Whether the account may share local servers (Pro).
pub fn has_previews(cx: &App) -> bool {
    AccountStore::global(cx).is_some_and(|store| store.read(cx).features().previews)
}

/// The preview this app shares of `localhost:<port>`.
pub fn shared_local(port: u16, cx: &App) -> Option<Preview> {
    cx.try_global::<Previews>()?.shared.values().find(|entry| entry.preview.kind != "sandbox" && entry.preview.port == port).map(|entry| entry.preview.clone())
}

/// The preview link for the page a browser shows, keeping its path and query.
pub fn preview_link_for(preview_url: &str, page_url: &str) -> String {
    let (Ok(base), Ok(page)) = (url::Url::parse(preview_url), url::Url::parse(page_url)) else { return preview_url.to_string() };
    let path = match page.query() {
        Some(query) => format!("{}?{query}", page.path()),
        None => page.path().to_string(),
    };
    base.join(&path).map_or_else(|_| preview_url.to_string(), |url| url.to_string())
}

fn list_previews(cx: &App) -> Task<Vec<Preview>> {
    let Some(list) = request(cx, Method::Get, "", None) else { return Task::ready(Vec::new()) };
    cx.background_spawn(async move { list().ok().and_then(|value| parse(&value, "previews").ok()).unwrap_or_default() })
}

fn copy_link(url: &str, cx: &mut App) {
    cx.write_to_clipboard(ClipboardItem::new_string(url.to_string()));
    notifications::info(cx, "Preview link copied");
}

/// Share Local Server (`share-local-server-dialog.tsx`).
pub struct ShareLocalServerDialog {
    port: Entity<TextInput>,
    detected: Option<Vec<u16>>,
    remote: Vec<Preview>,
    sharing: bool,
    focus_handle: FocusHandle,
    _tasks: Vec<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for ShareLocalServerDialog {}

impl Focusable for ShareLocalServerDialog {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        if self.has_previews(cx) { self.port.focus_handle(cx) } else { self.focus_handle.clone() }
    }
}

impl ShareLocalServerDialog {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let port = cx.new(|cx| TextInput::new(window, cx).placeholder("5173"));
        let input = cx.subscribe_in(&port, window, |this, _, event: &TextInputEvent, _, cx| match event {
            TextInputEvent::Changed(_) => cx.notify(),
            TextInputEvent::Confirmed => this.share(cx),
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        });
        let observe = cx.observe_global::<Previews>(|_, cx| cx.notify());
        let mut dialog = Self { port, detected: None, remote: Vec::new(), sharing: false, focus_handle: cx.focus_handle(), _tasks: Vec::new(), _subscriptions: vec![input, observe] };
        let detect = cx.background_spawn(async { proxy::detect_local_ports(&proxy::COMMON_DEV_PORTS, Duration::from_millis(800)) });
        dialog._tasks.push(cx.spawn(async move |this, cx| {
            let ports = detect.await;
            this.update(cx, |this, cx| {
                this.detected = Some(ports);
                cx.notify();
            })
            .ok();
        }));
        dialog._tasks.push(cx.spawn(async move |this, cx| {
            loop {
                let Ok(task) = this.update(cx, |_, cx| list_previews(cx)) else { break };
                let previews = task.await;
                if this.update(cx, |this, cx| {
                    this.remote = previews;
                    cx.notify();
                })
                .is_err()
                {
                    break;
                }
                cx.background_executor().timer(Duration::from_secs(15)).await;
            }
        }));
        dialog
    }

    fn has_previews(&self, cx: &App) -> bool {
        has_previews(cx)
    }

    fn share(&mut self, cx: &mut Context<Self>) {
        let Some(port) = proxy::parse_port_input(self.port.read(cx).text()) else { return };
        if self.sharing {
            return;
        }
        self.sharing = true;
        let task = share_local_server(port, cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.sharing = false;
                match result {
                    Ok(preview) => {
                        this.port.update(cx, |input, cx| input.set_text("", cx));
                        copy_link(&preview.url, cx);
                    }
                    Err(error) => {
                        notifications::error(cx, error, None);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    fn preview_row(&self, preview: &Preview, status: Option<TunnelStatus>, requests: u64, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = cx.theme().colors.clone();
        let host = url::Url::parse(&preview.url).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_else(|| preview.url.clone());
        let (copy, open, id) = (preview.url.clone(), preview.url.clone(), preview.id.clone());
        let tone = |status: TunnelStatus| match status {
            TunnelStatus::Connecting => Tone::Info,
            TunnelStatus::Open => Tone::Success,
            TunnelStatus::Reconnecting => Tone::Warning,
            TunnelStatus::Ended => Tone::Neutral,
        };
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .px(px(12.))
            .py(px(8.))
            .rounded(metrics::RADIUS_LG)
            .bg(colors.surface)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .text_size(typography::TEXT_SM)
                            .child(div().truncate().child(host.clone()))
                            .children(status.map(|status| Badge::new(status.label()).tone(tone(status)))),
                    )
                    .child(div().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(describe_preview(preview, requests))),
            )
            .child(
                Button::icon(SharedString::from(format!("preview-copy-{id}")), IconName::Copy)
                    .variant(ButtonVariant::Ghost)
                    .tooltip(format!("Copy link to {host}"))
                    .on_click(move |_, _, cx| copy_link(&copy, cx)),
            )
            .child(
                Button::icon(SharedString::from(format!("preview-open-{id}")), IconName::OpenExternal)
                    .variant(ButtonVariant::Ghost)
                    .tooltip(format!("Open {host} in your browser"))
                    .on_click(move |_, _, cx| cx.open_url(&open)),
            )
            .child(
                Button::icon(SharedString::from(format!("preview-stop-{id}")), IconName::Stop)
                    .variant(ButtonVariant::Ghost)
                    .tooltip(format!("Stop sharing {host}"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let stop = stop_preview(&id, cx);
                        let id = id.clone();
                        cx.spawn(async move |this, cx| {
                            if let Err(error) = stop.await {
                                cx.update(|cx| notifications::error(cx, error, None));
                            }
                            this.update(cx, |this, cx| {
                                this.remote.retain(|preview| preview.id != id);
                                cx.notify();
                            })
                            .ok();
                        })
                        .detach();
                        let _ = this;
                    })),
            )
            .into_any_element()
    }
}

impl Render for ShareLocalServerDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let entity = cx.entity().downgrade();
        let dialog = Dialog::new("share-local-server", "Share Local Server").icon(IconName::Broadcast).on_close(move |_, cx| {
            entity.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
        });
        if !self.has_previews(cx) {
            return dialog
                .track_focus(&self.focus_handle)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(div().text_size(typography::TEXT_SM).child(
                            "Preview links are part of Athas Pro. Share a dev server running on your computer, or an app a cloud agent is running, with a temporary link.",
                        ))
                        .child(
                            div().flex().child(
                                Button::new("previews-plans", "See plans")
                                    .variant(ButtonVariant::Accent)
                                    .trailing_icon(IconName::OpenExternal)
                                    .on_click(|_, _, cx| cx.open_url("https://athas.dev/pricing")),
                            ),
                        ),
                )
                .into_any_element();
        }
        let port = proxy::parse_port_input(self.port.read(cx).text());
        let detected = self.detected.clone();
        let description = match &detected {
            Some(ports) if !ports.is_empty() => "Servers answering on common dev ports:",
            None => "Looking for running dev servers…",
            Some(_) => "Start your dev server, then enter the port it listens on.",
        };
        let (shared, rows): (Vec<_>, Vec<_>) = {
            let previews = cx.global::<Previews>();
            let shared: Vec<(Preview, TunnelStatus, u64)> = previews.shared.values().map(|entry| (entry.preview.clone(), entry.status, entry.requests)).collect();
            let others: Vec<Preview> = self.remote.iter().filter(|preview| preview.active && !previews.shared.contains_key(&preview.id)).cloned().collect();
            (shared, others)
        };
        let mut items: Vec<gpui::AnyElement> = shared.iter().map(|(preview, status, requests)| self.preview_row(preview, Some(*status), *requests, cx)).collect();
        items.extend(rows.iter().map(|preview| self.preview_row(preview, None, preview.requests, cx)));
        let share_button = Button::new("preview-share", if self.sharing { "Sharing…" } else { "Share" })
            .variant(ButtonVariant::Accent)
            .leading_icon(IconName::Broadcast)
            .disabled(port.is_none() || self.sharing)
            .on_click(cx.listener(|this, _, _, cx| this.share(cx)));
        dialog
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(Field::new().label("Port on localhost").control(div().flex().items_center().gap(px(8.)).child(div().flex_1().child(self.port.clone())).child(share_button)).description(description))
                            .children(detected.filter(|ports| !ports.is_empty()).map(|ports| {
                                div().flex().flex_wrap().gap(px(6.)).children(ports.into_iter().map(|value| {
                                    Button::new(SharedString::from(format!("preview-port-{value}")), value.to_string())
                                        .size(ButtonSize::Small)
                                        .active(port == Some(value))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.port.update(cx, |input, cx| input.set_text(value.to_string(), cx));
                                            cx.notify();
                                        }))
                                }))
                            })),
                    )
                    .when(!items.is_empty(), |this| {
                        this.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(div().font_weight(typography::MEDIUM).text_size(typography::TEXT_SM).child("Active previews"))
                                .children(items),
                        )
                    })
                    .child(div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(
                        "Anyone with a link can open the preview until it expires after 8 hours or you stop it. Visitors see a notice with your name first.",
                    )),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_links_keep_the_page_path() {
        assert_eq!(preview_link_for("https://p.athas.dev/abc/", "http://localhost:5173/docs?x=1"), "https://p.athas.dev/docs?x=1");
        assert_eq!(preview_link_for("https://p.athas.dev/", "not a url"), "https://p.athas.dev/");
    }

    #[test]
    fn reads_the_ticket_token_and_describes_previews() {
        let ticket = PreviewTicket { url: "wss://tunnel.athas.dev/connect?preview=p&token=abc".into(), expires_at: "2026-11-12T10:00:00Z".into() };
        assert_eq!(ticket.token().as_deref(), Some("abc"));
        let preview = Preview { id: "p".into(), kind: "local".into(), url: "https://p.preview.athas.dev".into(), port: 5173, active: true, expires_at: "bad".into(), requests: 0 };
        assert_eq!(describe_preview(&preview, 1), "localhost:5173 · 1 request · until ");
    }
}
