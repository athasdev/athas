//! The browser side: the page's workspace server, its socket, and the app booted into the page's
//! canvas.
//!
//! The page is served by the workspace server (`athas-server --web DIR`), which prints the
//! address with its token: `/?token=…`. `?server=http://host:port` points at another server.
//! Without a server the workbench opens with no project.
//!
//! Build with `scripts/build-web.sh [--release]` and serve the folder it prints with
//! `athas-server --root <project> --web <dir>` (`docs/packaging.md`).

use std::{cell::RefCell, path::PathBuf, rc::Rc, sync::Arc, time::Duration};

use gpui::{App, AppContext as _, ApplicationHandle, WindowOptions};
use serde_json::{Map, Value};
use wasm_bindgen::{JsCast as _, prelude::*};
use web_protocol::{CallError, CallOutcome, CallRequest, ClientMessage, SOCKET_STOPPED, ServerMessage, WorkspaceInfo};
use web_sys::{BinaryType, CloseEvent, MessageEvent, WebSocket};
use workbench::{WebBackend, Workbench};
use workspace::StateStore;

use crate::{Events, RemoteFs, Transport};

const RETRY_DELAYS_MS: [i32; 5] = [500, 1000, 2000, 5000, 10_000];
const PING_INTERVAL: Duration = Duration::from_secs(25);
const INPUT_INTERVAL: Duration = Duration::from_millis(8);
const STATE_KEY: &str = "athas.workspace";
const TOKEN_KEY: &str = "athas.server-token";

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static CONNECTION: RefCell<Option<Connection>> = const { RefCell::new(None) };
}

fn log(message: &str) {
    web_sys::console::log_1(&message.into());
}

fn query(name: &str) -> Option<String> {
    let search = web_sys::window()?.location().search().ok()?;
    search.trim_start_matches('?').split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name && !value.is_empty()).then(|| js_sys::decode_uri_component(value).ok().and_then(|value| value.as_string())).flatten()
    })
}

fn session_storage() -> Option<web_sys::Storage> {
    web_sys::window()?.session_storage().ok().flatten()
}

/// The workspace server; blocking calls are synchronous `POST /call` requests.
struct Server {
    base: String,
    token: std::sync::Mutex<String>,
    /// Gets a fresh token when the server refuses this one (a cloud workspace's token source).
    refresh: Option<fn() -> Option<String>>,
}

impl Server {
    fn token(&self) -> String {
        self.token.lock().map(|token| token.clone()).unwrap_or_default()
    }

    fn set_token(&self, token: String) {
        if let Ok(mut current) = self.token.lock() {
            *current = token;
        }
    }

    fn find() -> Option<Self> {
        let base = query("server").or_else(|| web_sys::window()?.location().origin().ok())?;
        let token = match query("token") {
            Some(token) => {
                if let Some(storage) = session_storage() {
                    let _ = storage.set_item(TOKEN_KEY, &token);
                }
                token
            }
            None => session_storage()?.get_item(TOKEN_KEY).ok().flatten()?,
        };
        Some(Self { base: base.trim_end_matches('/').to_string(), token: std::sync::Mutex::new(token), refresh: None })
    }

    /// Retries once with a fresh token when the server refused the current one.
    fn request(&self, method: &str, path: &str, body: Option<&str>) -> Result<String, CallError> {
        match self.request_once(method, path, body) {
            Err(error) if error.code == "unauthorized" => match self.refresh.and_then(|refresh| refresh()) {
                Some(token) => {
                    self.set_token(token);
                    self.request_once(method, path, body)
                }
                None => Err(error),
            },
            result => result,
        }
    }

    fn request_once(&self, method: &str, path: &str, body: Option<&str>) -> Result<String, CallError> {
        let unreachable = |error: JsValue| CallError::new("disconnected", format!("The workspace server could not be reached: {error:?}"));
        let xhr = web_sys::XmlHttpRequest::new().map_err(unreachable)?;
        xhr.open_with_async(method, &format!("{}{path}", self.base), false).map_err(unreachable)?;
        xhr.set_request_header("Authorization", &format!("Bearer {}", self.token())).map_err(unreachable)?;
        if body.is_some() {
            xhr.set_request_header("Content-Type", "application/json").map_err(unreachable)?;
        }
        xhr.send_with_opt_str(body).map_err(unreachable)?;
        match xhr.status().map_err(unreachable)? {
            200 => Ok(xhr.response_text().ok().flatten().unwrap_or_default()),
            401 => Err(CallError::new("unauthorized", "The workspace server refused the token.")),
            0 => Err(CallError::new("disconnected", "The workspace server could not be reached.")),
            status => Err(CallError::new("error", format!("The workspace server answered {status}."))),
        }
    }

    fn workspace(&self) -> Result<WorkspaceInfo, CallError> {
        serde_json::from_str(&self.request("GET", "/workspace", None)?).map_err(|error| CallError::invalid(error.to_string()))
    }

    fn socket_url(&self) -> String {
        let base = self.base.strip_prefix("http").map(|rest| format!("ws{rest}")).unwrap_or_else(|| self.base.clone());
        format!("{base}/socket")
    }
}

impl Transport for Server {
    fn call(&self, method: &str, params: Value) -> Result<Value, CallError> {
        let params = match params {
            Value::Object(params) => params,
            _ => Map::new(),
        };
        let body = serde_json::to_string(&CallRequest { method: method.into(), params }).unwrap_or_default();
        let answer = self.request("POST", "/call", Some(&body))?;
        serde_json::from_str::<CallOutcome>(&answer).map_err(|error| CallError::invalid(error.to_string()))?.into_result()
    }

    /// Over the socket when it is up, so input keeps its order and nothing waits.
    fn notify(&self, method: &str, params: Value) {
        if !send_call(method, &params) {
            let _ = self.call(method, params);
        }
    }
}

/// The workspace socket: it authenticates with its first message, then carries file changes,
/// terminal output and the calls nobody waits for. It reconnects after drops.
struct Connection {
    url: String,
    token: String,
    events: Arc<Events>,
    socket: Option<WebSocket>,
    ready: bool,
    stopped: bool,
    attempt: usize,
    next_id: u64,
}

fn send_call(method: &str, params: &Value) -> bool {
    CONNECTION.with_borrow_mut(|connection| {
        let Some(connection) = connection.as_mut().filter(|connection| connection.ready) else { return false };
        let Some(socket) = &connection.socket else { return false };
        connection.next_id += 1;
        let params = params.as_object().cloned().unwrap_or_default();
        let message = ClientMessage::Call { id: connection.next_id, method: method.into(), params };
        socket.send_with_str(&serde_json::to_string(&message).unwrap_or_default()).is_ok()
    })
}

fn send_ping() {
    CONNECTION.with_borrow(|connection| {
        if let Some(socket) = connection.as_ref().filter(|connection| connection.ready).and_then(|connection| connection.socket.as_ref()) {
            let _ = socket.send_with_str(&serde_json::to_string(&ClientMessage::Ping).unwrap_or_default());
        }
    });
}

fn open_socket() {
    let opened = CONNECTION.with_borrow_mut(|connection| {
        let connection = connection.as_mut().filter(|connection| !connection.stopped)?;
        let socket = WebSocket::new(&connection.url).ok()?;
        socket.set_binary_type(BinaryType::Arraybuffer);
        connection.socket = Some(socket.clone());
        connection.ready = false;
        Some((socket, connection.token.clone()))
    });
    let Some((socket, token)) = opened else {
        schedule_reconnect();
        return;
    };

    let auth = socket.clone();
    let on_open = Closure::<dyn FnMut()>::new(move || {
        let _ = auth.send_with_str(&serde_json::to_string(&ClientMessage::Auth { token: token.clone() }).unwrap_or_default());
    });
    socket.set_onopen(Some(on_open.as_ref().unchecked_ref()));
    on_open.forget();

    let current = socket.clone();
    let on_message = Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
        let events = CONNECTION.with_borrow(|connection| {
            connection.as_ref().filter(|connection| connection.socket.as_ref() == Some(&current)).map(|connection| connection.events.clone())
        });
        let Some(events) = events else { return };
        let data = event.data();
        if let Some(buffer) = data.dyn_ref::<js_sys::ArrayBuffer>() {
            events.handle_binary(&js_sys::Uint8Array::new(buffer).to_vec());
            return;
        }
        let Some(text) = data.as_string() else { return };
        match serde_json::from_str::<ServerMessage>(&text) {
            Ok(ServerMessage::Ready { .. }) => CONNECTION.with_borrow_mut(|connection| {
                if let Some(connection) = connection.as_mut() {
                    connection.ready = true;
                    connection.attempt = 0;
                }
            }),
            Ok(ServerMessage::Stopped { reason, error }) => {
                log(&format!("athas: the workspace stopped ({reason})"));
                CONNECTION.with_borrow_mut(|connection| {
                    if let Some(connection) = connection.as_mut() {
                        connection.stopped = true;
                    }
                });
                cloud_workspace_ended(error);
            }
            Ok(message) => events.handle(message),
            Err(_) => {}
        }
    });
    socket.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    on_message.forget();

    let current = socket.clone();
    let on_close = Closure::<dyn FnMut(CloseEvent)>::new(move |event: CloseEvent| {
        let ours = CONNECTION.with_borrow_mut(|connection| {
            let Some(connection) = connection.as_mut().filter(|connection| connection.socket.as_ref() == Some(&current)) else { return false };
            connection.socket = None;
            connection.ready = false;
            connection.stopped |= event.code() == SOCKET_STOPPED;
            true
        });
        if ours {
            schedule_reconnect();
        }
    });
    socket.set_onclose(Some(on_close.as_ref().unchecked_ref()));
    on_close.forget();
}

fn schedule_reconnect() {
    let delay = CONNECTION.with_borrow_mut(|connection| {
        let connection = connection.as_mut().filter(|connection| !connection.stopped)?;
        let delay = RETRY_DELAYS_MS[connection.attempt.min(RETRY_DELAYS_MS.len() - 1)];
        connection.attempt += 1;
        Some(delay)
    });
    let (Some(delay), Some(window)) = (delay, web_sys::window()) else { return };
    let retry = Closure::once_into_js(open_socket);
    let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(retry.unchecked_ref(), delay);
}

/// Runs `f` with the app, from a browser event outside any app update.
fn with_app(f: impl FnOnce(&mut App)) {
    APPLICATION.with_borrow(|app| {
        if let Some(app) = app.as_ref() {
            app.update(f);
        }
    });
}

fn js_error(error: JsValue) -> String {
    error.as_string().unwrap_or_else(|| format!("{error:?}"))
}

/// Saves `bytes` through a download link.
fn download_bytes(name: &str, bytes: &[u8]) -> Result<(), String> {
    let window = web_sys::window().ok_or("The page has no window.")?;
    let document = window.document().ok_or("The page has no document.")?;
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let blob = web_sys::Blob::new_with_u8_array_sequence(&parts).map_err(js_error)?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(js_error)?;
    let link: web_sys::HtmlAnchorElement = document.create_element("a").map_err(js_error)?.dyn_into().map_err(|_| "Could not make a download link.")?;
    link.set_href(&url);
    link.set_download(name);
    link.click();
    let revoke = Closure::once_into_js(move || {
        let _ = web_sys::Url::revoke_object_url(&url);
    });
    let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(revoke.unchecked_ref(), 10_000);
    Ok(())
}

/// Lets the user choose a file with a file input, and reads it.
fn choose_file(accept: Option<&str>, done: impl FnOnce(Option<(String, Vec<u8>)>) + 'static) -> Result<(), String> {
    let document = web_sys::window().and_then(|window| window.document()).ok_or("The page has no document.")?;
    let input: web_sys::HtmlInputElement = document.create_element("input").map_err(js_error)?.dyn_into().map_err(|_| "Could not make a file input.")?;
    input.set_type("file");
    if let Some(accept) = accept {
        input.set_accept(accept);
    }
    let chosen = input.clone();
    let on_change = Closure::once_into_js(move || {
        let Some(file) = chosen.files().and_then(|files| files.get(0)) else {
            done(None);
            return;
        };
        let Ok(reader) = web_sys::FileReader::new() else {
            done(None);
            return;
        };
        let name = file.name();
        let loaded = reader.clone();
        let on_load = Closure::once_into_js(move || {
            let bytes = loaded.result().ok().map(|result| js_sys::Uint8Array::new(&result).to_vec());
            done(bytes.map(|bytes| (name, bytes)));
        });
        reader.set_onload(Some(on_load.unchecked_ref()));
        if reader.read_as_array_buffer(&file).is_err() {
            log("athas: could not read the chosen file");
        }
    });
    input.set_onchange(Some(on_change.unchecked_ref()));
    input.click();
    Ok(())
}

/// Browser file inputs and downloads for the views that would open native file dialogs.
fn web_files(server: Arc<Server>) -> workbench_api::WebFiles {
    let (uploads, folders, transfers) = (server.clone(), server.clone(), server);
    workbench_api::WebFiles {
        upload: std::rc::Rc::new(move |accept, done, cx| {
            let server = uploads.clone();
            let done = Rc::new(RefCell::new(Some(done)));
            let answer = done.clone();
            let started = choose_file(accept, move |chosen| {
                let result = match chosen {
                    Some((name, bytes)) => crate::transfers::upload(&*server, &name, &bytes).map(Some),
                    None => Ok(None),
                };
                if let Some(done) = answer.borrow_mut().take() {
                    with_app(move |cx| done(result, cx));
                }
            });
            if let Err(error) = started
                && let Some(done) = done.borrow_mut().take()
            {
                done(Err(error), cx);
            }
        }),
        download: std::rc::Rc::new(|name, bytes, _| {
            if let Err(error) = download_bytes(name, &bytes) {
                log(&format!("athas: download failed: {error}"));
            }
        }),
        transfer_dir: std::rc::Rc::new(move |_| crate::transfers::new_dir(&*folders)),
        download_transfer: std::rc::Rc::new(move |path, _| {
            let (name, bytes) = crate::transfers::read(&*transfers, path)?;
            download_bytes(&name, &bytes)
        }),
    }
}

/// The workbench's projects, tabs and layout, kept in the browser.
struct BrowserStore;

impl StateStore for BrowserStore {
    fn load(&self) -> Option<String> {
        web_sys::window()?.local_storage().ok()??.get_item(STATE_KEY).ok()?
    }

    fn save(&self, json: &str) -> anyhow::Result<()> {
        let storage = web_sys::window().and_then(|window| window.local_storage().ok().flatten()).ok_or_else(|| anyhow::anyhow!("no local storage"))?;
        storage.set_item(STATE_KEY, json).map_err(|error| anyhow::anyhow!("{error:?}"))
    }
}

/// Connects to the workspace server and installs its backends; the project's root when it did.
fn install_backend() -> Option<(PathBuf, Arc<Server>, Arc<Events>)> {
    let server = Server::find()?;
    let info = match server.workspace() {
        Ok(info) => info,
        Err(error) => {
            log(&format!("athas: no workspace server: {}", error.message));
            return None;
        }
    };
    Some(install_server(server, info))
}

/// Installs the backends of the workspace `server` serves and opens its socket.
fn install_server(server: Server, info: WorkspaceInfo) -> (PathBuf, Arc<Server>, Arc<Events>) {
    let root = PathBuf::from(&info.root);
    let server = Arc::new(server);
    let transport: Arc<dyn Transport> = server.clone();
    let events = Events::new(root.clone());
    let fs = RemoteFs::new(root.clone(), transport.clone(), events.clone());
    let git = crate::discover(root.clone(), transport.clone());
    git_panel::set_discover(git.clone());
    github_panel::relay::set_transport(Arc::new(crate::GitHubRelay::new(transport.clone())));
    let services = Arc::new(crate::ServiceRelay::new(transport.clone()));
    database_view::relay::set_transport(services.clone());
    docker_view::relay::set_transport(services);
    match transport.call("preview.base", serde_json::json!({})) {
        Ok(answer) => {
            let (base, preview_path, preview_root) = (server.base.clone(), answer["path"].as_str().unwrap_or_default().to_string(), root.clone());
            browser_view::set_preview_address(Arc::new(move |file: &std::path::Path| crate::preview_address(&base, &preview_path, &preview_root, file)));
        }
        Err(error) => log(&format!("athas: no HTML previews: {}", error.message)),
    }
    git_diff::remote::set_remote(Arc::new(crate::RemoteDiffs::new(root.clone(), transport.clone())));
    search_panel::set_web_grep(Arc::new({
        let (root, transport) = (root.clone(), transport.clone());
        move |roots: &[PathBuf], pattern: &search_panel::GrepPattern, filter: &search_panel::PathFilter| {
            crate::grep(&*transport, &root, roots, pattern, filter)
        }
    }));
    let terminal = {
        let (root, transport, events) = (root.clone(), transport.clone(), events.clone());
        Arc::new(move |cwd: &std::path::Path| {
            let (root, transport, events, cwd) = (root.clone(), transport.clone(), events.clone(), cwd.to_path_buf());
            Some(terminal_view::TerminalStart::Pty {
                name: "server".into(),
                spawn: Box::new(move |size, io| crate::spawn_terminal(&root, transport, events, cwd, size, io)),
            })
        })
    };
    agent_ui::acp::remote::set_remote_agents(Arc::new(crate::RemoteAgentHost::new(root.clone(), transport.clone(), events.clone())));
    browser_view::set_web_files(fs.clone());
    workbench::set_web_backend(WebBackend { root: root.clone(), fs: fs.clone(), files: fs, git, terminal });
    CONNECTION.set(Some(Connection {
        url: server.socket_url(),
        token: server.token(),
        events: events.clone(),
        socket: None,
        ready: false,
        stopped: false,
        attempt: 0,
        next_id: 0,
    }));
    open_socket();
    log(&format!("athas: serving {} ({}) from {}", info.repo, info.branch, server.base));
    (root, server, events)
}

/// Sends the terminals' typed input on a short timer and keeps the socket alive.
fn keep_sending_input(server: Arc<Server>, events: Arc<Events>, cx: &mut App) {
    cx.spawn(async move |cx| {
        let mut since_ping = Duration::ZERO;
        loop {
            cx.background_executor().timer(INPUT_INTERVAL).await;
            crate::send_input(&*server, &events);
            since_ping += INPUT_INTERVAL;
            if since_ping >= PING_INTERVAL {
                since_ping = Duration::ZERO;
                send_ping();
            }
        }
    })
    .detach();
}

fn boot(cx: &mut App, backend: Option<(PathBuf, Arc<Server>, Arc<Events>)>) {
    if let Err(error) = ui::load_fonts(cx) {
        log(&format!("athas: could not load fonts: {error:#}"));
    }
    ui::init(cx);
    settings::init(cx, settings::load(None, None), None);
    account::init(cx);
    extensions::init(cx);
    extensions_ui::init(cx);
    let appearance = workbench::appearance_of(cx.window_appearance());
    theme::init(cx, None, appearance, false);
    workbench::apply_theme(appearance, cx);
    collaboration::register_commands(cx);
    settings_ui::init(cx);
    if let Some((root, server, events)) = &backend {
        workbench_api::set_web_files(cx, web_files(server.clone()));
        let (root, transport, events): (_, Arc<dyn Transport>, _) = (root.clone(), server.clone(), events.clone());
        lsp_client::init_with(cx, move || Box::new(crate::RemoteLauncher::new(root, transport, events)));
    }
    workbench::init(cx);
    if backend.is_some() {
        agent_ui::pull_request::install(agent_ui::pull_request::github_source(cx), cx);
    }

    let root = backend.as_ref().map(|(root, _, _)| root.clone());
    let cloud_page = backend.is_none() && is_website_app_page();
    if let Some((_, server, events)) = backend {
        keep_sending_input(server, events, cx);
    }

    let store: Rc<dyn StateStore> = Rc::new(BrowserStore);
    let opened = cx.open_window(WindowOptions::default(), move |window, cx| {
        cx.new(|cx| {
            let mut workbench = Workbench::new(Some(store), window, cx);
            if let Some(root) = root {
                workbench.open_project_path(root, cx);
            }
            workbench
        })
    });
    if let Err(error) = opened {
        log(&format!("athas: could not open the workbench: {error:#}"));
        return;
    }
    cx.activate(true);
    if cloud_page {
        install_web_chrome(cx);
        resume_cloud_workspace(cx);
    }
}

// Cloud workspaces: the page is served by the website at athas.dev/app without a workspace
// server of its own. A signed-in Pro user's open cloud workspace is picked up and connected, the
// way the website's web app resumes one after a reload (`cloud-workspace-controller.ts`).

/// The website's APIs, same-origin, with its session cookie.
struct WebsiteFetch;

impl crate::cloud::Fetch for WebsiteFetch {
    fn fetch(&self, method: &str, path: &str, body: Option<&str>) -> Result<(u16, String), String> {
        let xhr = web_sys::XmlHttpRequest::new().map_err(js_error)?;
        xhr.open_with_async(method, path, false).map_err(js_error)?;
        xhr.set_request_header("Accept", "application/json").map_err(js_error)?;
        if body.is_some() {
            xhr.set_request_header("Content-Type", "application/json").map_err(js_error)?;
        }
        xhr.set_request_header("Cache-Control", "no-store").map_err(js_error)?;
        xhr.send_with_opt_str(body).map_err(js_error)?;
        match xhr.status().map_err(js_error)? {
            0 => Err("The website could not be reached.".into()),
            status => Ok((status, xhr.response_text().ok().flatten().unwrap_or_default())),
        }
    }
}

struct Cloud {
    controller: crate::cloud::CloudController<WebsiteFetch>,
    tokens: crate::cloud::TokenSource,
}

thread_local! {
    static CLOUD: RefCell<Option<Cloud>> = const { RefCell::new(None) };
}

fn is_website_app_page() -> bool {
    web_sys::window().and_then(|window| window.location().pathname().ok()).is_some_and(|path| path == "/app" || path.starts_with("/app/"))
}

fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

/// A fresh token for the cloud workspace in use, when the Worker refused the last one.
fn refresh_cloud_token() -> Option<String> {
    CLOUD.with_borrow_mut(|cloud| {
        let cloud = cloud.as_mut()?;
        cloud.tokens.token(&cloud.controller.api, true, now_ms()).ok()
    })
}

fn notify_cloud_error(message: String, cx: &mut App) {
    log(&format!("athas: {message}"));
    notifications::error(cx, message, None);
}

/// Picks up a cloud workspace that is starting or running, follows it until it runs and connects
/// the workbench to it.
fn resume_cloud_workspace(cx: &mut App) {
    let api = crate::cloud::WebsiteApi::new(WebsiteFetch);
    match api.account() {
        Ok(crate::cloud::WebsiteAccount::SignedIn { cloud_editor: true, .. }) => {}
        Ok(_) => return,
        Err(error) => {
            log(&format!("athas: the website account could not be read: {error}"));
            return;
        }
    }
    let mut controller = crate::cloud::CloudController::new(api);
    let Some((run, workspace)) = controller.begin_resume() else { return };
    let tokens = crate::cloud::TokenSource::new(workspace.id.clone());
    CLOUD.set(Some(Cloud { controller, tokens }));
    cx.spawn(async move |cx| {
        let mut step = CLOUD.with_borrow_mut(|cloud| cloud.as_mut().map(|cloud| cloud.controller.follow_step(run, workspace, true)));
        let ready = loop {
            match step {
                Some(crate::cloud::FollowStep::Continue(workspace)) => {
                    cx.background_executor().timer(crate::cloud::STARTING_POLL).await;
                    step = CLOUD.with_borrow_mut(|cloud| cloud.as_mut().map(|cloud| cloud.controller.follow_step(run, workspace, false)));
                }
                Some(crate::cloud::FollowStep::Ready(ready)) => break Some(ready),
                Some(crate::cloud::FollowStep::Done) | None => break None,
            }
        };
        let Some(ready) = ready else {
            let error = CLOUD.with_borrow(|cloud| cloud.as_ref().and_then(|cloud| cloud.controller.state().error.clone()));
            if let Some(error) = error {
                cx.update(|cx| notify_cloud_error(error, cx));
            }
            return;
        };
        CLOUD.with_borrow_mut(|cloud| {
            if let Some(cloud) = cloud.as_mut() {
                cloud.tokens = crate::cloud::TokenSource::new(ready.workspace.id.clone());
                let _ = cloud.tokens.session(&cloud.controller.api);
            }
        });
        let server = Server { base: ready.session.base_url(), token: std::sync::Mutex::new(ready.session.token.clone()), refresh: Some(refresh_cloud_token) };
        let (sender, receiver) = futures::channel::oneshot::channel();
        workspace_info(server.socket_url(), ready.session.token.clone(), move |info| {
            let _ = sender.send(info);
        });
        let answer = receiver.await.unwrap_or_else(|_| Err("The cloud workspace did not answer.".to_string()));
        let info = match answer {
            Ok(info) => info,
            Err(error) => {
                CLOUD.with_borrow_mut(|cloud| {
                    if let Some(cloud) = cloud.as_mut() {
                        cloud.controller.connect_failed(run, error.clone());
                    }
                });
                cx.update(|cx| notify_cloud_error(error, cx));
                return;
            }
        };
        let (root, server, events) = install_server(server, info);
        cx.update(|cx| {
            workbench_api::set_web_files(cx, web_files(server.clone()));
            keep_sending_input(server.clone(), events, cx);
            workbench_api::open_project(cx, root.to_string_lossy().into_owned());
            CLOUD.with_borrow_mut(|cloud| {
                if let Some(cloud) = cloud.as_mut() {
                    cloud.controller.connected(run);
                }
            });
        });
        // Tokens last ten minutes; the socket gets a fresh one well before that.
        loop {
            cx.background_executor().timer(crate::cloud::TOKEN_RENEW).await;
            let connected = CLOUD.with_borrow(|cloud| cloud.as_ref().is_some_and(|cloud| cloud.controller.state().phase == crate::cloud::Phase::Connected));
            if !connected {
                break;
            }
            let fresh = CLOUD.with_borrow_mut(|cloud| cloud.as_mut().and_then(|cloud| cloud.tokens.refresh(&cloud.controller.api).ok()));
            if let Some(fresh) = fresh {
                server.set_token(fresh.token.clone());
                renew_socket(fresh.token);
            }
        }
    })
    .detach();
}

/// Hands the socket a fresh token, and keeps it for reconnecting.
fn renew_socket(token: String) {
    CONNECTION.with_borrow_mut(|connection| {
        let Some(connection) = connection.as_mut() else { return };
        connection.token = token.clone();
        if let Some(socket) = connection.socket.as_ref().filter(|_| connection.ready) {
            let _ = socket.send_with_str(&serde_json::to_string(&ClientMessage::Renew { token }).unwrap_or_default());
        }
    });
}

/// The workspace's socket said it stopped: tell the user why, as the website reports it.
fn cloud_workspace_ended(socket_error: Option<String>) {
    let message = CLOUD.with_borrow_mut(|cloud| {
        let cloud = cloud.as_mut()?;
        cloud.controller.ended(socket_error);
        cloud.controller.state().error.clone()
    });
    if let Some(message) = message {
        with_app(|cx| notify_cloud_error(message, cx));
    }
}

/// Reads the workspace's description from a socket of its own: the Worker sends it once the
/// token is accepted, and has no `GET /workspace`.
fn workspace_info(url: String, token: String, done: impl FnOnce(Result<WorkspaceInfo, String>) + 'static) {
    let done: Rc<RefCell<Option<Box<dyn FnOnce(Result<WorkspaceInfo, String>)>>>> = Rc::new(RefCell::new(Some(Box::new(done))));
    let finish = {
        let done = done.clone();
        move |result: Result<WorkspaceInfo, String>| {
            if let Some(done) = done.borrow_mut().take() {
                done(result);
            }
        }
    };
    let socket = match WebSocket::new(&url) {
        Ok(socket) => socket,
        Err(error) => {
            finish(Err(js_error(error)));
            return;
        }
    };
    let auth = socket.clone();
    let on_open = Closure::<dyn FnMut()>::new(move || {
        let _ = auth.send_with_str(&serde_json::to_string(&ClientMessage::Auth { token: token.clone() }).unwrap_or_default());
    });
    socket.set_onopen(Some(on_open.as_ref().unchecked_ref()));
    on_open.forget();
    let (answered, current) = (finish.clone(), socket.clone());
    let on_message = Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
        if let Some(Ok(ServerMessage::Ready { workspace })) = event.data().as_string().map(|text| serde_json::from_str::<ServerMessage>(&text)) {
            answered(Ok(workspace));
            let _ = current.close();
        }
    });
    socket.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    on_message.forget();
    let on_close = Closure::<dyn FnMut(CloseEvent)>::new(move |event: CloseEvent| {
        let reason = if event.code() == web_protocol::SOCKET_UNAUTHORIZED {
            "Athas could not get access to the cloud workspace.".to_string()
        } else {
            "The connection to the cloud workspace ended.".to_string()
        };
        finish(Err(reason));
    });
    socket.set_onclose(Some(on_close.as_ref().unchecked_ref()));
    on_close.forget();
}

#[wasm_bindgen(start)]
pub fn start() {
    gpui_platform::web_init();
    let backend = install_backend();
    let handle = gpui_platform::application().with_assets(ui::Assets).run_embedded(move |cx| boot(cx, backend));
    APPLICATION.set(Some(handle));
}

// The web app's chrome at athas.dev/app: the account menu and the GitHub Repository step of the
// project picker (`web-account-menu.tsx`, `github-repository-content.tsx`), drawn by the workbench
// from what `workbench::WebChrome` gives it.

thread_local! {
    static ACCOUNT: RefCell<Option<crate::cloud::WebsiteAccount>> = const { RefCell::new(None) };
}

/// The athas.dev account the page shares with the website, read once.
fn website_account() -> Option<crate::cloud::WebsiteAccount> {
    if let Some(account) = ACCOUNT.with_borrow(Clone::clone) {
        return Some(account);
    }
    let account = crate::cloud::WebsiteApi::new(WebsiteFetch).account().map_err(|error| log(&format!("athas: the website account could not be read: {error}"))).ok()?;
    ACCOUNT.set(Some(account.clone()));
    Some(account)
}

fn cloud_phase() -> crate::cloud::Phase {
    CLOUD.with_borrow(|cloud| cloud.as_ref().map_or(crate::cloud::Phase::Idle, |cloud| cloud.controller.state().phase))
}

/// A website page in a new tab, so the workspace open here stays connected (`openWebsitePage`).
fn open_website_page(path: &str) {
    if let Some(window) = web_sys::window() {
        let _ = window.open_with_url_and_target_and_features(path, "_blank", "noopener");
    }
}

/// The sign-in page, which brings the user back here (`goToSignIn`).
fn go_to_sign_in() {
    let Some(location) = web_sys::window().map(|window| window.location()) else { return };
    let url = crate::cloud::sign_in_url(&location.pathname().unwrap_or_default(), &location.search().unwrap_or_default());
    let _ = location.assign(&url);
}

fn reload_page() {
    if let Some(window) = web_sys::window() {
        let _ = window.location().reload();
    }
}

fn install_web_chrome(cx: &mut App) {
    use crate::cloud::{WebsiteAccount, pages};
    use workbench::{BranchList, RepositoryEntry, RepositoryGate, WebChrome};
    let api = || crate::cloud::WebsiteApi::new(WebsiteFetch);
    // The web build keeps its own account, so point the avatars at that one instead of the
    // desktop account store the workbench installed.
    ui::avatar::set_account_lookup(cx, |_| match ACCOUNT.with_borrow(Clone::clone) {
        Some(WebsiteAccount::SignedIn { user, .. }) => Some(ui::avatar::AccountIdentity {
            user_id: user.id,
            name: user.name.clone().unwrap_or_default(),
            email: user.email.clone(),
            avatar_url: user.avatar_url.clone(),
            github_login: None,
        }),
        _ => None,
    });
    workbench::set_web_chrome(
        cx,
        WebChrome {
            account_name: Rc::new(|_| match ACCOUNT.with_borrow(Clone::clone) {
                Some(WebsiteAccount::SignedIn { user, .. }) => Some(user.name.unwrap_or(user.email)),
                _ => None,
            }),
            account_menu: Rc::new(|_| account_menu_entries()),
            repository_gate: Rc::new(|_| {
                crate::cloud::repository_gate(website_account().as_ref())
                    .map(|(title, message, action)| RepositoryGate { title: title.into(), message: message.into(), action: action.into() })
            }),
            gate_action: Rc::new(|_| match website_account() {
                None | Some(WebsiteAccount::SignedOut) => go_to_sign_in(),
                Some(WebsiteAccount::SignedIn { cloud_editor: false, .. }) => open_website_page(pages::BILLING),
                Some(WebsiteAccount::SignedIn { .. }) => open_website_page(pages::INTEGRATIONS),
            }),
            open_workspace: Rc::new(|_| {
                CLOUD.with_borrow(|cloud| {
                    let state = cloud.as_ref()?.controller.state();
                    let workspace = state.workspace.as_ref().filter(|_| state.phase != crate::cloud::Phase::Idle)?;
                    Some(format!("{} on {}", workspace.repo, workspace.branch))
                })
            }),
            repositories: Rc::new(move |_| {
                api()
                    .list_repositories()
                    .map(|repos| repos.into_iter().map(|repo| RepositoryEntry { full_name: repo.full_name, private: repo.private, description: repo.description }).collect())
                    .map_err(|error| if error.message.is_empty() { "Your repositories could not be loaded.".into() } else { error.message })
            }),
            branches: Rc::new(move |repo, _| {
                api()
                    .list_branches(repo)
                    .map(|branches| BranchList { default_branch: branches.default_branch, branches: branches.branches })
                    .map_err(|error| if error.message.is_empty() { "The branches could not be loaded.".into() } else { error.message })
            }),
            open_repository: Rc::new(|repo, branch, cx| open_cloud_repository(&repo, &branch, cx)),
        },
    );
}

/// The account menu's rows (`WebAccountMenu`).
fn account_menu_entries() -> Vec<ui::MenuEntry> {
    use crate::cloud::{AccountRow, pages};
    use ui::{IconName, MenuEntry, MenuItem};
    let page = |path: &'static str| move |_: &mut gpui::Window, _: &mut App| open_website_page(path);
    crate::cloud::account_menu_rows(website_account().as_ref(), cloud_phase())
        .into_iter()
        .map(|row| match row {
            AccountRow::Separator => MenuEntry::Separator,
            AccountRow::Header { name, email, plan } => MenuItem::new(name).description(email).icon(IconName::User).trailing_text(plan).on_select(page(pages::ACCOUNT)).into(),
            AccountRow::Item { id, label, trailing, disabled } => {
                let item = MenuItem::new(label).disabled(disabled);
                let item = match trailing {
                    Some(text) => item.trailing_text(text),
                    None => item,
                };
                match id {
                    "open-github-repository" => item.icon(IconName::Github).on_select(|window, cx| window.dispatch_action(Box::new(workbench::OpenGithubRepository), cx)),
                    "stop-cloud-workspace" => item.icon(IconName::Stop).on_select(|_, cx| stop_cloud_workspace(cx)),
                    "dashboard" => item.icon(IconName::House).external().on_select(page(pages::DASHBOARD)),
                    "account" => item.icon(IconName::User).external().on_select(page(pages::ACCOUNT)),
                    "billing" => item.icon(IconName::CreditCard).external().on_select(page(pages::BILLING)),
                    "integrations" => item.icon(IconName::Github).external().on_select(page(pages::INTEGRATIONS)),
                    "settings" => item.icon(IconName::Settings).on_select(|_, cx| workbench_api::open_settings(cx, None, None)),
                    "docs" => item.icon(IconName::BookOpen).external().on_select(page(pages::DOCS)),
                    "sign-in" => item.icon(IconName::SignIn).on_select(|_, _| go_to_sign_in()),
                    "sign-out" => item.icon(IconName::SignOut).on_select(|_, _| {
                        let _ = crate::cloud::WebsiteApi::new(WebsiteFetch).sign_out();
                        reload_page();
                    }),
                    _ => item,
                }
                .into()
            }
        })
        .collect()
}

/// Stops the cloud workspace in use; the page starts over without it, since its backend is set
/// once per page load.
fn stop_cloud_workspace(cx: &mut App) {
    let error = CLOUD.with_borrow_mut(|cloud| {
        let cloud = cloud.as_mut()?;
        cloud.controller.stop();
        cloud.controller.state().error.clone()
    });
    match error {
        Some(error) => notify_cloud_error(error, cx),
        None => reload_page(),
    }
}

/// Opens a repository at a branch in a cloud workspace (`openRepository`): the website starts it,
/// and the page reloads to follow and connect to it as it does after any reload.
fn open_cloud_repository(repo: &str, branch: &str, cx: &mut App) {
    CLOUD.with_borrow_mut(|cloud| {
        if let Some(cloud) = cloud.as_mut() {
            cloud.controller.stop();
        }
    });
    let mut controller = crate::cloud::CloudController::new(crate::cloud::WebsiteApi::new(WebsiteFetch));
    let Some(run) = controller.begin_open() else { return };
    match controller.open_step(run, repo, branch) {
        Ok(Some(_)) => reload_page(),
        Ok(None) => {}
        Err(()) => notify_cloud_error(controller.state().error.clone().unwrap_or_else(|| "The cloud workspace could not be opened.".into()), cx),
    }
}
