//! The E2B client against a local server that answers like E2B does, so nothing here reaches the
//! network. The Connect frames are written by hand: that wire format is the part most likely to
//! be got wrong, and a test that builds it with the same code it checks would not notice.

use std::time::Duration;

use serde_json::{Value, json};
use telemetry::mock_server::{MockServer, Request, Response};

use crate::{Error, ErrorKind, Exec, Provider, Sandbox, Spec, connect, e2b::E2b};

/// One Connect envelope: flag byte, four-byte big-endian length, payload.
fn frame(flags: u8, payload: Value) -> String {
    let body = payload.to_string();
    let mut bytes = vec![flags];
    bytes.extend_from_slice(&(body.len() as u32).to_be_bytes());
    bytes.extend_from_slice(body.as_bytes());
    String::from_utf8(bytes).expect("a short frame is valid UTF-8")
}

fn data_frame(stream: &str, text: &str) -> String {
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(text);
    frame(0, json!({ "event": { "data": { stream: encoded } } }))
}

fn sandbox_of(server: &MockServer) -> (E2b, Sandbox) {
    let client = E2b::new("key-123").with_bases(server.url());
    let sandbox = Sandbox {
        provider: "e2b".into(),
        id: "sb-1".into(),
        host: "https://49983-sb-1.e2b.app".into(),
        access_token: Some("envd-token".into()),
        root: crate::DEFAULT_ROOT.into(),
    };
    (client, sandbox)
}

fn exec_server(body: String) -> MockServer {
    MockServer::start(move |_: &Request| Response { status: 200, body: body.clone() })
}

#[test]
fn creating_a_sandbox_asks_the_account_api_and_addresses_envd_by_sandbox_id() {
    let server = MockServer::start(|_| {
        Response::json(201, json!({ "sandboxID": "sb-9", "clientID": "c1", "envdAccessToken": "envd-token", "templateID": "base" }))
    });
    let client = E2b::new("key-123").with_bases(server.url());
    let spec = Spec { template: Some("athas-agent".into()), timeout_seconds: Some(900), ..Spec::default() };

    let sandbox = client.create(&spec).expect("the sandbox is created");

    assert_eq!(sandbox.id, "sb-9");
    assert_eq!(sandbox.access_token.as_deref(), Some("envd-token"));
    assert_eq!(sandbox.host, "https://49983-sb-9.e2b.app");
    let request = &server.requests()[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/v2/sandboxes");
    assert_eq!(request.header("X-API-KEY"), Some("key-123"));
    assert_eq!(request.json()["templateID"], json!("athas-agent"));
    assert_eq!(request.json()["timeout"], json!(900));
}

#[test]
fn a_sandbox_starts_with_no_environment_of_its_own() {
    let server = MockServer::start(|_| Response::json(201, json!({ "sandboxID": "sb-9" })));
    let client = E2b::new("key-123").with_bases(server.url());

    client.create(&Spec::default()).expect("the sandbox is created");

    assert!(server.requests()[0].json().get("envVars").is_none());
}

#[test]
fn a_command_runs_through_envd_and_its_output_comes_back_decoded() {
    let body = format!(
        "{}{}{}{}",
        frame(0, json!({ "event": { "start": { "pid": 11 } } })),
        data_frame("stdout", "two lines\nof output\n"),
        data_frame("stderr", "a warning\n"),
        frame(0, json!({ "event": { "end": { "exitCode": 0, "exited": true } } })),
    );
    let server = exec_server(body);
    let (client, sandbox) = sandbox_of(&server);

    let output = client.exec(&sandbox, &Exec::new("ls -1").in_dir("/home/user/project")).expect("the command runs");

    assert_eq!(output.stdout, "two lines\nof output\n");
    assert_eq!(output.stderr, "a warning\n");
    assert_eq!(output.exit_code, Some(0));
    assert!(output.succeeded() && !output.timed_out);
    let request = &server.requests()[0];
    assert_eq!(request.path, "/process.Process/Start");
    assert_eq!(request.header("E2b-Sandbox-Id"), Some("sb-1"));
    assert_eq!(request.header("E2b-Sandbox-Port"), Some("49983"));
    assert_eq!(request.header("X-Access-Token"), Some("envd-token"));
    assert_eq!(request.header("Connect-Protocol-Version"), Some("1"));
}

#[test]
fn the_account_key_never_reaches_the_sandbox() {
    let server = exec_server(frame(0, json!({ "event": { "end": { "exitCode": 0 } } })));
    let (client, sandbox) = sandbox_of(&server);

    client.exec(&sandbox, &Exec::new("env")).expect("the command runs");

    let request = &server.requests()[0];
    assert_eq!(request.header("X-API-KEY"), None);
    assert!(!request.body.contains("key-123"));
}

#[test]
fn the_command_is_sent_as_one_connect_envelope_a_shell_runs() {
    let server = exec_server(frame(0, json!({ "event": { "end": { "exitCode": 0 } } })));
    let (client, sandbox) = sandbox_of(&server);

    client.exec(&sandbox, &Exec::new("echo hi && false").in_dir("/home/user/project")).expect("the command runs");

    let frames = connect::decode(server.requests()[0].body.as_bytes()).expect("the request is one envelope");
    assert_eq!(frames.len(), 1);
    let sent = frames[0].json().expect("the envelope holds JSON");
    assert_eq!(sent["process"]["cmd"], json!("/bin/bash"));
    assert_eq!(sent["process"]["args"], json!(["-l", "-c", "echo hi && false"]));
    assert_eq!(sent["process"]["cwd"], json!("/home/user/project"));
}

#[test]
fn a_failing_command_keeps_its_exit_code_instead_of_becoming_an_error() {
    let body = format!("{}{}", data_frame("stderr", "not found\n"), frame(0, json!({ "event": { "end": { "exitCode": 127 } } })));
    let server = exec_server(body);
    let (client, sandbox) = sandbox_of(&server);

    let output = client.exec(&sandbox, &Exec::new("nope")).expect("a non-zero exit is still an answer");

    assert_eq!(output.exit_code, Some(127));
    assert!(!output.succeeded());
    assert!(!output.timed_out);
}

#[test]
fn a_stream_that_ends_without_an_exit_is_reported_as_a_timeout() {
    let server = exec_server(data_frame("stdout", "working"));
    let (client, sandbox) = sandbox_of(&server);

    let output = client.exec(&sandbox, &Exec::new("sleep 600").with_timeout(Duration::from_secs(1))).expect("the call returns");

    assert!(output.timed_out);
    assert_eq!(output.exit_code, None);
    assert_eq!(output.stdout, "working");
}

#[test]
fn an_error_in_the_trailing_envelope_fails_the_call_even_though_the_status_was_200() {
    let server = exec_server(frame(connect::FLAG_END, json!({ "error": { "code": "internal", "message": "the sandbox ran out of memory" } })));
    let (client, sandbox) = sandbox_of(&server);

    let error = client.exec(&sandbox, &Exec::new("build")).expect_err("a trailing error is a failure");

    assert_eq!(error.kind, ErrorKind::Unavailable);
    assert!(error.message.contains("ran out of memory"), "{}", error.message);
}

#[test]
fn files_go_in_and_out_through_envd_with_the_path_escaped() {
    let server = MockServer::start(|request: &Request| match request.method.as_str() {
        "GET" => Response { status: 200, body: "fn main() {}\n".into() },
        _ => Response::json(200, json!([{ "name": "main.rs", "path": "/home/user/my project/main.rs" }])),
    });
    let (client, sandbox) = sandbox_of(&server);

    client.write_file(&sandbox, "/home/user/my project/main.rs", b"fn main() {}\n").expect("the file is written");
    let read = client.read_file(&sandbox, "/home/user/my project/main.rs").expect("the file is read");

    assert_eq!(read, b"fn main() {}\n");
    let written = &server.requests()[0];
    assert_eq!(written.method, "POST");
    assert_eq!(written.path, "/files?path=/home/user/my%20project/main.rs&username=user");
    assert_eq!(written.body, "fn main() {}\n");
    assert_eq!(server.requests()[1].method, "GET");
}

#[test]
fn the_list_is_what_the_account_has_right_now() {
    let server = MockServer::start(|_| {
        Response::json(
            200,
            json!([
                { "sandboxID": "sb-1", "templateID": "base", "state": "running", "startedAt": "2026-11-27T10:00:00Z" },
                { "sandboxID": "sb-2", "templateID": "athas-agent", "state": "paused", "startedAt": "2026-11-27T09:00:00Z" },
                { "templateID": "base", "state": "running" }
            ]),
        )
    });
    let client = E2b::new("key-123").with_bases(server.url());

    let listed = client.list().expect("the list is read");

    assert_eq!(listed.len(), 2, "an entry with no id is not a sandbox anything can be done to");
    assert_eq!(listed[0].id, "sb-1");
    assert!(listed[0].is_running());
    assert_eq!(listed[1].template, "athas-agent");
    assert!(!listed[1].is_running());
    assert_eq!(server.requests()[0].path, "/v2/sandboxes");
    assert_eq!(server.requests()[0].header("X-API-KEY"), Some("key-123"));
}

#[test]
fn a_key_the_provider_refuses_is_an_auth_failure_the_moment_it_is_checked() {
    let server = MockServer::start(|_| Response::json(401, json!({ "message": "invalid api key" })));
    let client = E2b::new("wrong").with_bases(server.url());

    let error = client.list().expect_err("a refused key fails");

    assert_eq!(error.kind, ErrorKind::Auth);
    assert!(!error.is_retryable(), "a bad key is not worth retrying");
}

#[test]
fn a_sandbox_that_already_exists_is_opened_with_the_token_it_answers_with() {
    let server = MockServer::start(|_| {
        Response::json(200, json!({ "sandboxID": "sb-7", "templateID": "base", "state": "running", "envdAccessToken": "envd-7" }))
    });
    let client = E2b::new("key-123").with_bases(server.url());

    let sandbox = client.attach("sb-7").expect("the sandbox is opened");

    assert_eq!(sandbox.id, "sb-7");
    assert_eq!(sandbox.access_token.as_deref(), Some("envd-7"));
    assert_eq!(sandbox.host, "https://49983-sb-7.e2b.app");
    assert_eq!(server.requests()[0].path, "/sandboxes/sb-7");
}

#[test]
fn opening_a_sandbox_that_is_gone_says_so_rather_than_failing_blankly() {
    let server = MockServer::start(|_| Response::json(404, json!({ "message": "sandbox not found" })));
    let client = E2b::new("key-123").with_bases(server.url());

    let error = client.attach("sb-old").expect_err("a sandbox that is gone cannot be opened");

    assert_eq!(error.kind, ErrorKind::Gone);
}

#[test]
fn a_refused_key_is_told_apart_from_a_sandbox_that_is_gone() {
    let unauthorized = MockServer::start(|_| Response::json(401, json!({ "message": "invalid api key" })));
    let (client, sandbox) = sandbox_of(&unauthorized);
    let error = client.keep_alive(&sandbox, 600).expect_err("401 is a failure");
    assert_eq!(error.kind, ErrorKind::Auth);
    assert!(!error.is_retryable());

    let missing = MockServer::start(|_| Response::json(404, json!({ "message": "sandbox not found" })));
    let (client, sandbox) = sandbox_of(&missing);
    let error = client.keep_alive(&sandbox, 600).expect_err("404 is a failure");
    assert_eq!(error.kind, ErrorKind::Gone);
}

#[test]
fn stopping_a_sandbox_that_is_already_stopped_is_not_a_failure() {
    let server = MockServer::start(|_| Response::json(404, json!({ "message": "sandbox not found" })));
    let (client, sandbox) = sandbox_of(&server);

    client.dispose(&sandbox).expect("a sandbox already gone is the point of dispose");

    assert_eq!(server.requests()[0].method, "DELETE");
    assert_eq!(server.requests()[0].path, "/sandboxes/sb-1");
}

#[test]
fn a_missing_template_is_not_reported_as_a_sandbox_that_expired() {
    let server = MockServer::start(|_| Response::json(404, json!({ "message": "template not found" })));
    let client = E2b::new("key-123").with_bases(server.url());

    let error = client.create(&Spec { template: Some("athas-agent".into()), ..Spec::default() }).expect_err("404 is a failure");

    assert_eq!(error.kind, ErrorKind::Unavailable);
    assert!(error.message.contains("athas-agent"), "{}", error.message);
}

#[test]
fn envelopes_survive_a_round_trip_and_a_cut_stream_is_refused() {
    let encoded = connect::encode(br#"{"hello":"world"}"#);
    assert_eq!(encoded[0], 0);
    assert_eq!(&encoded[1..5], &17u32.to_be_bytes());

    let frames = connect::decode(&encoded).expect("what was encoded can be decoded");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].json(), Some(json!({ "hello": "world" })));
    assert!(!frames[0].is_end());

    let cut = &encoded[..encoded.len() - 3];
    let error: Error = connect::decode(cut).expect_err("a half message is not half an answer");
    assert_eq!(error.kind, ErrorKind::Protocol);
}
