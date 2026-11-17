//! Renders the account, sharing and team views into PNGs with the GPU but without a window,
//! against a local mock of the account service (never athas.dev).
//!
//! `cargo run -p collaboration --example account_snapshot -- <out-dir> [dark|light]`

use std::{path::PathBuf, sync::Arc, time::Duration};

use account::{AccountMenu, AccountSettings, FeedbackDialog, MemoryTokenStore, ServiceUrls};
use anyhow::{Context as _, Result};
use collaboration::{ShareDialog, SharingSettings, TeamSessionView, TeamView, sharing};
use gpui::{
    AnyView, AppContext, Context, HeadlessAppContext, IntoElement, ParentElement, Render, Styled, Window, div, px, size,
};
use serde_json::json;
use telemetry::mock_server::{MockServer, Response};
use theme::{ActiveTheme, Appearance};

struct Frame {
    view: AnyView,
    page: bool,
}

impl Render for Frame {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .size_full()
            .flex()
            .flex_col()
            .p(px(16.))
            .bg(if self.page { colors.background } else { colors.surface })
            .text_color(colors.foreground)
            .child(self.view.clone())
    }
}

fn now_minus(minutes: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::minutes(minutes)).to_rfc3339()
}

fn mock_service(team: bool) -> MockServer {
    let collaboration = json!({
        "enabled": team,
        "workspace": { "id": 9, "name": "Athas Labs", "slug": "athas", "role": "owner", "visibility": "private" },
        "members": [
            { "id": 1, "userId": 3, "name": "Sam Lee", "email": "sam@example.com", "role": "owner", "status": "active" },
            { "id": 2, "userId": 4, "name": "Ana Ruiz", "email": "ana@example.com", "role": "member", "status": "active" },
            { "id": 3, "userId": 5, "name": "Kai Chen", "email": "kai@example.com", "role": "member", "status": "invited" },
        ],
        "invitations": [{ "id": 1, "email": "lee@example.com", "role": "member", "status": "pending" }],
        "sharedSessions": [
            { "shareId": "sh1", "title": "Fix the login redirect", "ownerUserId": 4, "ownerName": "Ana Ruiz", "live": true, "revision": 3, "updatedAt": now_minus(12), "commentCount": 2, "reviewState": "requested" },
            { "shareId": "sh2", "title": "Port the settings view", "ownerUserId": 3, "ownerName": "Sam Lee", "live": false, "revision": 1, "updatedAt": now_minus(300), "commentCount": 0, "reviewState": "approved" },
        ],
        "inbox": [
            { "id": 11, "kind": "review_request", "actorUserId": 4, "actorName": "Ana Ruiz", "shareId": "sh1", "sessionTitle": "Fix the login redirect", "body": "Can you check the tests?", "createdAt": now_minus(10), "readAt": null },
            { "id": 12, "kind": "handoff", "actorUserId": 4, "actorName": "Ana Ruiz", "shareId": "sh2", "sessionTitle": "Port the settings view", "body": "", "createdAt": now_minus(1440), "readAt": now_minus(1000) },
        ],
        "presence": [{ "id": 1, "userId": 4, "deviceId": "d", "status": "online", "activeFilePath": "/Users/ana/code/app/src/auth.rs", "heartbeatAt": now_minus(0) }],
        "capabilities": { "canShareSessions": true, "presence": true },
    });
    let subscription = json!({
        "status": "pro",
        "subscription": { "plan": if team { "teams" } else { "pro" }, "renews_at": "2026-12-01T00:00:00Z" },
        "collaboration": collaboration,
        "intelligence": { "credits": { "allowanceCents": 2000, "usedCents": 1240, "pendingCents": 60, "remainingCents": 700, "requestsCount": 88, "walletBalanceCents": 1500 } },
    });
    MockServer::start(move |request| match request.path.split('?').next().unwrap_or_default() {
        "/api/auth/me" => Response::json(200, json!({ "user": { "id": 3, "email": "sam@example.com", "name": "Sam Lee", "github_username": "samlee" } })),
        "/api/auth/subscription" => Response::json(200, subscription.clone()),
        "/api/shares" => Response::json(200, json!({
            "pro": true, "sessionsEnabled": true,
            "items": [
                { "id": "a1", "title": "Fix the login redirect", "kind": "agent", "visibility": "organization", "live": true, "sourceId": "s1", "revision": 2, "updatedAt": 1, "emails": [], "workspaceId": 9 },
                { "id": "a2", "title": "Explain the renderer", "kind": "agent", "visibility": "public", "live": false, "sourceId": "s2", "revision": 1, "updatedAt": 1, "emails": [] },
            ],
            "organizations": [{ "id": 9, "name": "Athas Labs" }],
        })),
        "/api/collaboration/sessions/sh1" => Response::json(200, json!({
            "session": { "shareId": "sh1", "title": "Fix the login redirect", "ownerUserId": 4, "ownerName": "Ana Ruiz", "live": true, "reviewState": "requested", "commentCount": 2 },
            "messages": [
                { "role": "user", "content": "The login page redirects to /dashboard even when a return URL is set. Fix it and add a test." },
                { "role": "assistant", "content": "The redirect ignored `returnTo`. I now read it from the query, check it is a same-origin path, and fall back to /dashboard. Added `redirects_to_return_url` and `rejects_external_return_url` tests." },
            ],
            "comments": [
                { "id": 1, "authorName": "Kai Chen", "kind": "comment", "body": "Should we log rejected return URLs?", "filePath": "src/auth.rs", "line": 42, "createdAt": now_minus(30) },
                { "id": 2, "authorName": "Sam Lee", "kind": "approve", "body": "", "createdAt": now_minus(5) },
            ],
            "members": [{ "userId": 4, "name": "Ana Ruiz" }],
        })),
        _ => Response::json(404, json!({ "error": "Not found" })),
    })
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = PathBuf::from(args.first().cloned().unwrap_or_else(|| ".".into()));
    let appearance = if args.get(1).map(String::as_str) == Some("light") { Appearance::Light } else { Appearance::Dark };
    let suffix = if appearance == Appearance::Light { "-light" } else { "" };

    for (scene, signed_in, team) in [
        ("menu-signed-out", false, false),
        ("menu", true, false),
        ("settings", true, false),
        ("settings-signed-out", false, false),
        ("feedback", false, false),
        ("share", true, true),
        ("team", true, true),
        ("team-no-plan", true, false),
        ("team-signed-out", false, false),
        ("team-session", true, true),
    ] {
        let server = mock_service(team);
        let text_system = gpui_platform::current_platform(true).text_system();
        let mut cx = HeadlessAppContext::with_platform(text_system, Arc::new(ui::Assets), || gpui_platform::current_headless_renderer());
        cx.update(|cx| -> Result<()> {
            ui::load_fonts(cx)?;
            ui::init(cx);
            settings::init(cx, settings::Settings::default(), None);
            theme::init(cx, None, appearance, false);
            let tokens: Arc<dyn account::TokenStore> =
                if signed_in { Arc::new(MemoryTokenStore::with_token("demo")) } else { Arc::new(MemoryTokenStore::default()) };
            account::init_with(cx, ServiceUrls::local(server.url()), tokens);
            Ok(())
        })?;
        cx.allow_parking();
        for _ in 0..10 {
            cx.run_until_parked();
            std::thread::sleep(Duration::from_millis(30));
        }

        let (width, height, page) = match scene {
            "menu" | "menu-signed-out" => (320., 520., false),
            "feedback" | "share" => (580., 640., false),
            _ => (720., 620., true),
        };
        let window = cx.open_window(size(px(width), px(height)), |window, cx| {
            let view: AnyView = match scene {
                "menu" | "menu-signed-out" => cx.new(|cx| AccountMenu::new(window, cx)).into(),
                "settings" | "settings-signed-out" => {
                    let account = cx.new(AccountSettings::new);
                    let sharing = cx.new(SharingSettings::new);
                    cx.new(|_| Stack(vec![account.into(), sharing.into()])).into()
                }
                "feedback" => cx.new(|cx| FeedbackDialog::new("0.1.0", window, cx)).into(),
                "share" => {
                    let transcript = serde_json::from_str(include_str!("../../agent_ui/fixtures/session.json")).expect("fixture");
                    let draft = sharing::agent_draft("s1", "Add a GPUI shell skeleton", &transcript, None);
                    cx.new(|cx| ShareDialog::new(draft, window, cx)).into()
                }
                "team-session" => cx.new(|cx| TeamSessionView::new("sh1".into(), "Fix the login redirect".into(), None, window, cx)).into(),
                _ => cx.new(TeamView::new).into(),
            };
            cx.new(|_| Frame { view, page })
        })?;
        for _ in 0..8 {
            cx.update_window(window.into(), |_, window, _| window.refresh())?;
            cx.run_until_parked();
            std::thread::sleep(Duration::from_millis(40));
        }
        let image = cx.capture_screenshot(window.into()).context("capturing the window")?;
        let path = out.join(format!("account-{scene}{suffix}.png"));
        image.save(&path).with_context(|| format!("writing {}", path.display()))?;
        println!("{}", path.display());
    }
    Ok(())
}

/// Views one above the other, as the Settings page stacks the account and sharing sections.
struct Stack(Vec<AnyView>);

impl Render for Stack {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().flex().flex_col().gap(px(24.)).children(self.0.clone())
    }
}
