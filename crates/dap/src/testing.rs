//! A scripted debug adapter on a local TCP port. It plays a small Python-like program paused in
//! `compute()`, so tests and headless snapshots can drive a real session without a debugger.

use std::{
    io::BufReader,
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

use serde_json::{Value, json};

use crate::{
    Adapter, Connection,
    transport::{read_message, write_message},
};

pub struct FakeAdapter {
    port: u16,
    received: Arc<Mutex<Vec<Value>>>,
}

impl FakeAdapter {
    /// Listens for one session. Frames point into `source`.
    pub fn start(source: PathBuf) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind a local port");
        let port = listener.local_addr().expect("local address").port();
        let received: Arc<Mutex<Vec<Value>>> = Arc::default();
        let log = received.clone();
        thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                Script { source, line: 3, breakpoint_lines: Vec::new(), next_seq: 1, received: log }.run(stream);
            }
        });
        Self { port, received }
    }

    pub fn adapter(&self) -> Adapter {
        Adapter { name: "fake".into(), kind: "fake".into(), connection: Connection::Tcp { host: "127.0.0.1".into(), port: self.port, spawn: None } }
    }

    /// The commands received so far, in order.
    pub fn commands(&self) -> Vec<String> {
        self.requests().iter().filter_map(|request| request.get("command")?.as_str().map(String::from)).collect()
    }

    /// Every request received so far.
    pub fn requests(&self) -> Vec<Value> {
        self.received.lock().map(|received| received.clone()).unwrap_or_default()
    }
}

struct Script {
    source: PathBuf,
    line: u32,
    breakpoint_lines: Vec<u32>,
    next_seq: i64,
    received: Arc<Mutex<Vec<Value>>>,
}

impl Script {
    fn run(mut self, stream: TcpStream) {
        let Ok(mut writer) = stream.try_clone() else { return };
        let mut reader = BufReader::new(stream);
        while let Ok(Some(request)) = read_message(&mut reader) {
            if let Ok(mut received) = self.received.lock() {
                received.push(request.clone());
            }
            let command = request["command"].as_str().unwrap_or_default().to_string();
            let arguments = request.get("arguments").cloned().unwrap_or(Value::Null);
            let (result, after) = self.answer(&command, &arguments);
            let seq = self.seq();
            let mut response = json!({ "seq": seq, "type": "response", "request_seq": request["seq"], "command": command });
            match result {
                Ok(body) => {
                    response["success"] = true.into();
                    response["body"] = body;
                }
                Err(message) => {
                    response["success"] = false.into();
                    response["message"] = message.into();
                }
            }
            // `launch` announces `initialized` before answering, as debugpy does.
            let (before, after): (Vec<_>, Vec<_>) = after.into_iter().partition(|(event, _)| *event == "initialized");
            for (event, body) in before.into_iter().chain([("", Value::Null)]).chain(after) {
                let message = if event.is_empty() {
                    response.clone()
                } else {
                    json!({ "seq": self.seq(), "type": "event", "event": event, "body": body })
                };
                if write_message(&mut writer, &message).is_err() {
                    return;
                }
            }
            if command == "disconnect" {
                return;
            }
        }
    }

    fn seq(&mut self) -> i64 {
        self.next_seq += 1;
        self.next_seq
    }

    fn stopped(&self, reason: &str) -> (&'static str, Value) {
        ("stopped", json!({ "reason": reason, "threadId": 1, "allThreadsStopped": true }))
    }

    fn answer(&mut self, command: &str, arguments: &Value) -> (Result<Value, String>, Vec<(&'static str, Value)>) {
        let path = self.source.to_string_lossy().into_owned();
        match command {
            "initialize" => (
                Ok(json!({
                    "supportsConfigurationDoneRequest": true,
                    "supportsConditionalBreakpoints": true,
                    "supportsHitConditionalBreakpoints": true,
                    "supportsLogPoints": true,
                    "supportsSetVariable": true,
                    "supportsTerminateRequest": true,
                    "exceptionBreakpointFilters": [
                        { "filter": "raised", "label": "Raised Exceptions", "default": false },
                        { "filter": "uncaught", "label": "Uncaught Exceptions", "default": true },
                    ],
                })),
                Vec::new(),
            ),
            "launch" | "attach" => (Ok(Value::Null), vec![("initialized", Value::Null)]),
            "setBreakpoints" => {
                let lines: Vec<u32> = arguments["breakpoints"]
                    .as_array()
                    .map(|breakpoints| breakpoints.iter().filter_map(|breakpoint| breakpoint["line"].as_u64()).map(|line| line as u32).collect())
                    .unwrap_or_default();
                if arguments["source"]["path"].as_str() == Some(path.as_str()) {
                    self.breakpoint_lines = lines.clone();
                }
                let breakpoints: Vec<Value> = lines
                    .iter()
                    .map(|line| {
                        if *line > 100 {
                            json!({ "id": line, "verified": false, "message": "No code on this line", "line": line })
                        } else {
                            json!({ "id": line, "verified": true, "line": line })
                        }
                    })
                    .collect();
                (Ok(json!({ "breakpoints": breakpoints })), Vec::new())
            }
            "setExceptionBreakpoints" => (Ok(Value::Null), Vec::new()),
            "configurationDone" => {
                self.line = self.breakpoint_lines.iter().copied().filter(|line| *line <= 100).min().unwrap_or(3);
                (
                    Ok(Value::Null),
                    vec![
                        ("process", json!({ "name": path })),
                        ("output", json!({ "category": "stdout", "output": "Starting fake program\nloading da" })),
                        ("output", json!({ "category": "stdout", "output": "ta... done\n" })),
                        ("output", json!({ "category": "stderr", "output": "warning: using test data\n" })),
                        ("output", json!({ "category": "telemetry", "output": "hidden" })),
                        self.stopped("breakpoint"),
                    ],
                )
            }
            "threads" => (Ok(json!({ "threads": [{ "id": 1, "name": "MainThread" }, { "id": 2, "name": "worker-1" }] })), Vec::new()),
            "stackTrace" => {
                let frames = if arguments["threadId"] == 2 {
                    json!([{ "id": 2000, "name": "wait", "line": 0, "column": 0, "source": { "name": "threading.py" }, "presentationHint": "subtle" }])
                } else {
                    json!([
                        { "id": 1000, "name": "compute", "line": self.line, "column": 5, "source": { "path": path, "name": "app.py" } },
                        { "id": 1001, "name": "main", "line": 24, "column": 5, "source": { "path": path, "name": "app.py" } },
                        { "id": 1002, "name": "<module>", "line": 1, "column": 1, "source": { "name": "runpy.py" }, "presentationHint": "subtle" },
                    ])
                };
                (Ok(json!({ "stackFrames": frames, "totalFrames": 3 })), Vec::new())
            }
            "scopes" => (
                Ok(json!({ "scopes": [
                    { "name": "Locals", "variablesReference": 100, "expensive": false },
                    { "name": "Globals", "variablesReference": 200, "expensive": true },
                ] })),
                Vec::new(),
            ),
            "variables" => {
                let variables = match arguments["variablesReference"].as_i64() {
                    Some(100) => json!([
                        { "name": "count", "value": "3", "type": "int", "variablesReference": 0 },
                        { "name": "user", "value": "{'name': 'Ada', 'age': 36}", "type": "dict", "variablesReference": 101 },
                        { "name": "items", "value": "[1, 2, 3]", "type": "list", "variablesReference": 102 },
                        { "name": "greeting", "value": "'hello'", "type": "str", "variablesReference": 0 },
                    ]),
                    Some(101) => json!([
                        { "name": "'name'", "value": "'Ada'", "type": "str", "variablesReference": 0 },
                        { "name": "'age'", "value": "36", "type": "int", "variablesReference": 0 },
                    ]),
                    Some(102) => json!([
                        { "name": "0", "value": "1", "type": "int", "variablesReference": 0 },
                        { "name": "1", "value": "2", "type": "int", "variablesReference": 0 },
                        { "name": "2", "value": "3", "type": "int", "variablesReference": 0 },
                    ]),
                    Some(200) => json!([{ "name": "__name__", "value": "'__main__'", "type": "str", "variablesReference": 0 }]),
                    _ => return (Err("Unknown variables reference".into()), Vec::new()),
                };
                (Ok(json!({ "variables": variables })), Vec::new())
            }
            "evaluate" => match arguments["expression"].as_str().unwrap_or_default() {
                "count" => (Ok(json!({ "result": "3", "type": "int", "variablesReference": 0 })), Vec::new()),
                "count * 2" => (Ok(json!({ "result": "6", "type": "int", "variablesReference": 0 })), Vec::new()),
                "user" => (Ok(json!({ "result": "{'name': 'Ada', 'age': 36}", "type": "dict", "variablesReference": 101 })), Vec::new()),
                expression => (Err(format!("NameError: name '{expression}' is not defined")), Vec::new()),
            },
            "next" | "stepIn" | "stepOut" => {
                self.line += 1;
                (Ok(Value::Null), vec![("continued", json!({ "threadId": 1, "allThreadsContinued": true })), self.stopped("step")])
            }
            "pause" => (Ok(Value::Null), vec![self.stopped("pause")]),
            "continue" => (
                Ok(json!({ "allThreadsContinued": true })),
                vec![("output", json!({ "category": "stdout", "output": "done\n" })), ("exited", json!({ "exitCode": 0 })), ("terminated", Value::Null)],
            ),
            "setVariable" => (Ok(json!({ "value": arguments["value"], "type": "int", "variablesReference": 0 })), Vec::new()),
            "redefineClasses" => (Ok(json!({ "changedClasses": ["app.Main"] })), Vec::new()),
            "terminate" => (Ok(Value::Null), vec![("terminated", Value::Null)]),
            "disconnect" => (Ok(Value::Null), Vec::new()),
            other => (Err(format!("unsupported request {other}")), Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, path::Path, rc::Rc, time::Duration};

    use gpui::{AppContext as _, Entity, TestAppContext};

    use super::*;
    use crate::{
        BreakpointField, BreakpointStore, DapClient, DebugSession, Incoming, LaunchConfig, Loadable, OutputCategory, SessionStatus,
        parse_launch_json,
    };

    fn config() -> LaunchConfig {
        parse_launch_json(r#"{ "configurations": [{ "name": "Fake", "type": "fake", "request": "launch", "program": "app.py" }] }"#)
            .unwrap()
            .remove(0)
    }

    /// Runs the app until `done` holds, letting the adapter's threads answer in between.
    fn wait_until(cx: &mut TestAppContext, what: &str, mut done: impl FnMut(&mut TestAppContext) -> bool) {
        for _ in 0..400 {
            cx.run_until_parked();
            if done(cx) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("timed out waiting for {what}");
    }

    fn start(cx: &mut TestAppContext, source: &Path) -> (FakeAdapter, Entity<BreakpointStore>, Entity<DebugSession>) {
        cx.executor().allow_parking();
        let fake = FakeAdapter::start(source.to_path_buf());
        let store = cx.new(|_| BreakpointStore::new(None));
        store.update(cx, |store, cx| {
            store.toggle(source, 6, cx);
            store.toggle(source, 199, cx);
            let id = store.breakpoints_for(source)[0].id;
            store.set_field(id, BreakpointField::Condition, Some("count > 2".into()), cx);
        });
        let adapter = fake.adapter();
        let session = cx.new(|cx| DebugSession::new(config(), PathBuf::from("/"), Some(adapter), store.clone(), cx));
        (fake, store, session)
    }

    #[test]
    fn client_round_trip_over_tcp() {
        let fake = FakeAdapter::start(PathBuf::from("/tmp/app.py"));
        let Connection::Tcp { port, .. } = fake.adapter().connection else { unreachable!() };
        let (client, mut incoming) = DapClient::connect("127.0.0.1", port, None, Duration::from_secs(5)).unwrap();
        futures::executor::block_on(async {
            use futures::StreamExt as _;
            let capabilities = client.request("initialize", json!({ "adapterID": "fake" })).await.unwrap();
            assert_eq!(capabilities["supportsLogPoints"], true);
            client.request("launch", json!({})).await.unwrap();
            assert_eq!(incoming.next().await, Some(Incoming::Event { event: "initialized".into(), body: Value::Null }));
            let error = client.request("evaluate", json!({ "expression": "nope" })).await.unwrap_err();
            assert!(error.to_string().contains("NameError"));
            let error = client.request("bogus", json!({})).await.unwrap_err();
            assert!(error.to_string().contains("unsupported request bogus"));
        });
    }

    #[gpui::test]
    fn session_runs_from_handshake_to_end(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("app.py");
        let (fake, store, session) = start(cx, &source);

        wait_until(cx, "the first stop", |cx| session.read_with(cx, |session, _| session.status() == SessionStatus::Stopped && !session.frames().is_empty()));
        let commands = fake.commands();
        assert_eq!(&commands[..4], ["initialize", "launch", "setBreakpoints", "setExceptionBreakpoints"]);
        assert!(commands.contains(&"configurationDone".to_string()));
        let requests = fake.requests();
        let set = requests.iter().find(|request| request["command"] == "setBreakpoints").unwrap();
        assert_eq!(set["arguments"]["breakpoints"][0], json!({ "line": 7, "condition": "count > 2" }));
        let exceptions = requests.iter().find(|request| request["command"] == "setExceptionBreakpoints").unwrap();
        assert_eq!(exceptions["arguments"]["filters"], json!(["uncaught"]));
        let launch = requests.iter().find(|request| request["command"] == "launch").unwrap();
        assert_eq!(launch["arguments"]["program"], "app.py");
        assert_eq!(launch["arguments"]["type"], "fake");

        // Breakpoint verification comes back to the store.
        store.read_with(cx, |store, _| {
            let breakpoints = store.breakpoints_for(&source);
            assert_eq!(breakpoints[0].state.verified, Some(true));
            assert_eq!(breakpoints[1].state.verified, Some(false));
            assert_eq!(breakpoints[1].state.message.as_deref(), Some("No code on this line"));
            assert_eq!(store.execution_position().map(|position| position.row), Some(6));
        });

        // Paused on line 7: threads, frames, and the locals loaded eagerly but not the globals.
        wait_until(cx, "locals", |cx| session.read_with(cx, |session, _| matches!(session.variables(100), Some(Loadable::Loaded(_)))));
        session.read_with(cx, |session, _| {
            assert_eq!(session.stop_info().unwrap().label(), "Paused on breakpoint");
            assert_eq!(session.threads().len(), 2);
            assert_eq!(session.frames()[0].line, 7);
            assert_eq!(session.selected_frame(), Some(1000));
            assert_eq!(session.scopes().len(), 2);
            assert!(session.variables(200).is_none());
            let Some(Loadable::Loaded(locals)) = session.variables(100) else { unreachable!() };
            assert_eq!(locals[1].name, "user");
            assert_eq!(locals[1].variables_reference, 101);
            // Output pieces are joined into lines and telemetry is dropped.
            let program: Vec<&str> = session
                .output()
                .iter()
                .filter(|line| matches!(line.category, OutputCategory::Stdout | OutputCategory::Stderr))
                .map(|line| line.text.as_str())
                .collect();
            assert_eq!(program, ["Starting fake program", "loading data... done", "warning: using test data"]);
        });

        // Children load lazily.
        session.update(cx, |session, cx| session.load_variables(101, cx));
        wait_until(cx, "children", |cx| session.read_with(cx, |session, _| matches!(session.variables(101), Some(Loadable::Loaded(_)))));

        // Setting a variable shows the adapter's answer in place.
        let set = session.update(cx, |session, cx| session.set_variable(100, "count", "5", cx));
        let done = Rc::new(RefCell::new(None));
        let slot = done.clone();
        cx.foreground_executor().spawn(async move { *slot.borrow_mut() = Some(set.await) }).detach();
        wait_until(cx, "setVariable", |_| done.borrow().is_some());
        done.borrow_mut().take().unwrap().unwrap();
        session.read_with(cx, |session, _| {
            let Some(Loadable::Loaded(locals)) = session.variables(100) else { unreachable!() };
            assert_eq!(locals[0].value, "5");
        });
        let redefine = session.update(cx, |session, cx| session.custom_request("redefineClasses", json!({}), cx));
        let answer = Rc::new(RefCell::new(None));
        let slot = answer.clone();
        cx.foreground_executor().spawn(async move { *slot.borrow_mut() = Some(redefine.await) }).detach();
        wait_until(cx, "redefineClasses", |_| answer.borrow().is_some());
        assert_eq!(answer.borrow_mut().take().unwrap().unwrap()["changedClasses"], json!(["app.Main"]));

        // Evaluation, in a watch and in the console.
        let watch = session.update(cx, |session, cx| session.evaluate("count * 2", "watch", cx));
        let result = Rc::new(RefCell::new(None));
        let slot = result.clone();
        cx.foreground_executor().spawn(async move { *slot.borrow_mut() = Some(watch.await) }).detach();
        wait_until(cx, "evaluate", |_| result.borrow().is_some());
        assert_eq!(result.borrow_mut().take().unwrap().unwrap().result, "6");
        session.update(cx, |session, cx| session.evaluate_in_console("missing", cx));
        wait_until(cx, "console error", |cx| {
            session.read_with(cx, |session, _| session.output().iter().any(|line| line.category == OutputCategory::Error))
        });

        // A new breakpoint while paused is sent at once.
        store.update(cx, |store, cx| {
            store.toggle(&source, 9, cx);
        });
        wait_until(cx, "breakpoint sync", |_| {
            fake.requests().iter().filter(|request| request["command"] == "setBreakpoints").count() >= 2
        });

        // Stepping moves on a line; continuing runs to the end.
        session.update(cx, |session, cx| session.step_over(cx));
        wait_until(cx, "the step", |cx| {
            session.read_with(cx, |session, _| session.status() == SessionStatus::Stopped && session.frames().first().is_some_and(|frame| frame.line == 8))
        });
        session.update(cx, |session, cx| session.resume(cx));
        wait_until(cx, "the end", |cx| session.read_with(cx, |session, _| session.status() == SessionStatus::Ended));
        assert!(fake.commands().contains(&"disconnect".to_string()));
        store.read_with(cx, |store, _| {
            assert!(store.execution_position().is_none());
            assert!(store.breakpoints_for(&source).iter().all(|breakpoint| breakpoint.state.verified.is_none()));
        });
        session.read_with(cx, |session, _| {
            assert!(session.output().iter().any(|line| line.text == "Process exited with code 0"));
        });
    }

    #[gpui::test]
    fn stopping_disconnects(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let (fake, _store, session) = start(cx, &dir.path().join("app.py"));
        wait_until(cx, "the first stop", |cx| session.read_with(cx, |session, _| session.status() == SessionStatus::Stopped));
        session.update(cx, |session, cx| session.stop(cx));
        wait_until(cx, "the end", |cx| session.read_with(cx, |session, _| session.status() == SessionStatus::Ended));
        let disconnect = fake.requests().into_iter().find(|request| request["command"] == "disconnect").unwrap();
        assert_eq!(disconnect["arguments"]["terminateDebuggee"], true);
    }

    #[gpui::test]
    fn a_missing_adapter_ends_the_session_with_the_reason(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let store = cx.new(|_| BreakpointStore::new(None));
        let config = parse_launch_json(r#"{ "configurations": [{ "name": "x", "type": "cobol", "request": "launch" }] }"#).unwrap().remove(0);
        let session = cx.new(|cx| DebugSession::new(config, PathBuf::from("/"), None, store, cx));
        wait_until(cx, "the failure", |cx| session.read_with(cx, |session, _| session.status() == SessionStatus::Ended));
        session.read_with(cx, |session, _| assert!(session.ended_reason().unwrap().contains("cobol")));
    }
}
