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

/// Protobuf JSON omits zero values, so envd's `end` event for a command that worked carries no
/// `exitCode` at all. Read as "no exit code" that made every successful command look like one
/// that never finished.
#[test]
fn an_end_event_with_no_exit_code_is_a_command_that_succeeded() {
    let server = exec_server(format!(
        "{}{}",
        data_frame("stdout", "done\n"),
        frame(0, json!({ "event": { "end": { "exited": true, "status": "exit status 0" } } })),
    ));
    let (client, sandbox) = sandbox_of(&server);

    let output = client.exec(&sandbox, &Exec::new("tar xzf archive.tgz")).expect("the command runs");

    assert_eq!(output.exit_code, Some(0));
    assert!(output.succeeded(), "a command that exited cleanly is not a failure");
    assert!(!output.timed_out, "it ended, so it did not run out of time");
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
                { "sandboxID": "sb-1", "alias": "base", "templateID": "rki5", "state": "running", "startedAt": "2026-11-27T10:00:00Z", "endAt": "2026-11-27T11:00:00Z", "cpuCount": 2, "memoryMB": 512 },
                { "sandboxID": "sb-2", "templateID": "athas-agent", "state": "paused", "startedAt": "2026-11-27T09:00:00Z" },
                { "templateID": "base", "state": "running" }
            ]),
        )
    });
    let client = E2b::new("key-123").with_bases(server.url());

    let listed = client.list().expect("the list is read");

    assert_eq!(listed.len(), 2, "an entry with no id is not a sandbox anything can be done to");
    assert_eq!(listed[0].id, "sb-1");
    assert_eq!(listed[0].template, "base", "the alias is the name a reader asked for");
    assert_eq!((listed[0].cpus, listed[0].memory_mb), (2, 512));
    assert_eq!(listed[0].ends_at.as_deref(), Some("2026-11-27T11:00:00Z"));
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

/// Daytona against a local server that answers the way Daytona does. The two hosts are pointed at
/// one base, which is what [`Daytona::with_bases`] is for, so a test can tell the account API's
/// calls from the toolbox's by their paths alone.
mod daytona {
    use serde_json::json;
    use telemetry::mock_server::{MockServer, Request, Response};

    use crate::{Error, ErrorKind, Exec, Provider, Sandbox, Spec, daytona::Daytona};

    fn handle(sandbox: &Sandbox) -> Sandbox {
        sandbox.clone()
    }

    #[test]
    fn creating_a_sandbox_asks_the_account_api_and_puts_the_workspace_in_the_sandbox_users_home() {
        let server = MockServer::start(|_| Response::json(201, json!({ "id": "sb-7", "state": "started", "user": "ubuntu" })));
        let client = Daytona::new("dtn-key").with_bases(server.url());
        let spec = Spec { timeout_seconds: Some(3600), ..Spec::default() };

        let sandbox = client.create(&spec).expect("the sandbox is created");

        assert_eq!(sandbox.id, "sb-7");
        // The home of the sandbox's own user, not a guess: a workspace written anywhere else is
        // a workspace the sandbox user cannot change.
        assert_eq!(sandbox.root, "/home/ubuntu");
        let request = &server.requests()[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/sandbox");
        assert_eq!(request.header("Authorization"), Some("Bearer dtn-key"));
        // An hour, in the minutes Daytona counts idle time in.
        assert_eq!(request.json()["autoStopInterval"], json!(60));
    }

    #[test]
    fn a_command_comes_back_in_one_answer_with_its_exit_code() {
        let server = MockServer::start(|_| Response::json(200, json!({ "exitCode": 0, "result": "hello\n" })));
        let client = Daytona::new("dtn-key").with_bases(server.url());
        let sandbox = Sandbox { provider: "daytona".into(), id: "sb-7".into(), host: String::new(), access_token: None, root: "/home/daytona".into() };

        let output = client.exec(&handle(&sandbox), &Exec::new("echo hello").in_dir("/home/daytona/work")).expect("the command runs");

        assert!(output.succeeded());
        assert_eq!(output.stdout, "hello\n");
        assert!(!output.timed_out);
        let request = &server.requests()[0];
        assert_eq!(request.path, "/toolbox/sb-7/process/execute");
        assert_eq!(request.json()["cwd"], json!("/home/daytona/work"));
    }

    #[test]
    fn a_file_goes_over_as_multipart_with_its_path_in_the_query() {
        let server = MockServer::start(|_| Response::json(200, json!({ "ok": true })));
        let client = Daytona::new("dtn-key").with_bases(server.url());
        let sandbox = Sandbox { provider: "daytona".into(), id: "sb-7".into(), host: String::new(), access_token: None, root: "/home/daytona".into() };

        client.write_file(&handle(&sandbox), "/home/daytona/.athas-sync.tar.gz", b"gzipped").expect("the file is written");

        let request = &server.requests()[0];
        assert_eq!(request.method, "POST");
        assert!(request.path.starts_with("/toolbox/sb-7/files/upload-v2?path="), "{}", request.path);
        assert!(request.header("Content-Type").is_some_and(|value| value.starts_with("multipart/form-data; boundary=")));
        assert!(request.body.contains("gzipped"), "the file's bytes are in the body");
    }

    #[test]
    fn a_refused_key_is_the_users_to_fix_and_is_never_retried() {
        let server = MockServer::start(|_| Response::json(401, json!({ "message": "invalid api key" })));
        let client = Daytona::new("wrong").with_bases(server.url());

        let error: Error = client.list().expect_err("the key is refused");

        assert_eq!(error.kind, ErrorKind::Auth);
        assert!(!error.is_retryable());
        assert!(error.message.contains("refused the API key"), "{}", error.message);
    }

    #[test]
    fn a_sandbox_that_stopped_on_its_own_is_started_again_rather_than_called_gone() {
        let server = MockServer::start(|request: &Request| match request.method.as_str() {
            "POST" => Response::json(200, json!({ "ok": true })),
            _ => Response::json(200, json!({ "id": "sb-7", "state": "stopped", "user": "daytona" })),
        });
        let client = Daytona::new("dtn-key").with_bases(server.url());

        let sandbox = client.attach("sb-7").expect("the sandbox is opened");

        assert_eq!(sandbox.id, "sb-7");
        let paths: Vec<String> = server.requests().into_iter().map(|request| request.path).collect();
        assert_eq!(paths, vec!["/sandbox/sb-7", "/sandbox/sb-7/start"]);
    }
}

/// Boat against a local server. The two limits worth a test are Boat's own: ten minutes on a
/// command and five megabytes on a file.
mod boat {
    use std::time::Duration;

    use serde_json::json;
    use telemetry::mock_server::{MockServer, Request, Response};

    use crate::{ErrorKind, Exec, Provider, Sandbox, Spec, boat::Boat};

    fn sandbox_of() -> Sandbox {
        Sandbox { provider: "boat".into(), id: "sb-3".into(), host: String::new(), access_token: None, root: "/home/user".into() }
    }

    #[test]
    fn creating_a_sandbox_reads_the_id_out_of_boats_envelope() {
        let server = MockServer::start(|_| Response::json(200, json!({ "ok": true, "type": "sandbox.created", "sandbox": { "id": "sb-3", "state": "running" } })));
        let client = Boat::new("boat_key").with_base(server.url());

        let sandbox = client.create(&Spec { timeout_seconds: Some(1800), ..Spec::default() }).expect("the sandbox is created");

        assert_eq!(sandbox.id, "sb-3");
        assert_eq!(sandbox.root, "/home/user");
        let request = &server.requests()[0];
        assert_eq!(request.path, "/sandboxes");
        assert_eq!(request.header("Authorization"), Some("Bearer boat_key"));
        assert_eq!(request.json()["ttlSeconds"], json!(1800));
    }

    #[test]
    fn a_command_longer_than_boat_allows_is_clamped_rather_than_rejected() {
        let server = MockServer::start(|_| Response::json(200, json!({ "ok": true, "exitCode": 0, "stdout": "", "stderr": "", "timedOut": false })));
        let client = Boat::new("boat_key").with_base(server.url());

        // Athas gives a command fifteen minutes; Boat refuses anything over ten.
        let exec = Exec::new("cargo build").with_timeout(Duration::from_secs(15 * 60));
        client.exec(&sandbox_of(), &exec).expect("the command runs");

        assert_eq!(server.requests()[0].json()["timeoutSeconds"], json!(600));
    }

    #[test]
    fn a_failure_boat_sends_with_a_200_is_still_a_failure() {
        let server = MockServer::start(|_| Response::json(200, json!({ "ok": false, "status": 404, "message": "sandbox not found" })));
        let client = Boat::new("boat_key").with_base(server.url());

        let error = client.list().expect_err("the call failed even though the status line said 200");

        assert_eq!(error.kind, ErrorKind::Gone);
    }

    #[test]
    fn a_file_too_big_for_one_write_goes_in_pieces_and_is_joined_in_the_sandbox() {
        let server = MockServer::start(|_| Response::json(200, json!({ "ok": true, "exitCode": 0, "stdout": "", "stderr": "", "timedOut": false })));
        let client = Boat::new("boat_key").with_base(server.url());
        // Over two of Boat's writes' worth, so it takes three pieces and one command.
        let archive = vec![7u8; 7 * 1024 * 1024];

        client.write_file(&sandbox_of(), "/home/user/.athas-sync.tar.gz", &archive).expect("the archive is written");

        let requests = server.requests();
        let writes: Vec<&Request> = requests.iter().filter(|request| request.method == "PUT").collect();
        assert_eq!(writes.len(), 3, "three pieces");
        let names: Vec<String> = writes.iter().map(|request| request.json()["path"].as_str().unwrap_or_default().to_string()).collect();
        assert_eq!(names, vec![
            "/home/user/.athas-sync.tar.gz.athas-part-0000",
            "/home/user/.athas-sync.tar.gz.athas-part-0001",
            "/home/user/.athas-sync.tar.gz.athas-part-0002",
        ]);
        // One command puts them back together and clears up after itself, so the sandbox is not
        // left holding a second copy of the workspace.
        let joined = requests.iter().find(|request| request.path == "/sandboxes/sb-3/commands").expect("the pieces are joined");
        let command = joined.json()["command"].as_str().unwrap_or_default().to_string();
        assert!(command.starts_with("cat '/home/user/.athas-sync.tar.gz.athas-part-0000'"), "{command}");
        assert!(command.contains("> '/home/user/.athas-sync.tar.gz'"), "{command}");
        assert!(command.contains("rm -f"), "{command}");
    }

    #[test]
    fn a_file_is_asked_for_as_base64_so_a_binary_one_survives_the_round_trip() {
        let server = MockServer::start(|_| Response::json(200, json!({ "ok": true, "content": "AAEC", "encoding": "base64" })));
        let client = Boat::new("boat_key").with_base(server.url());

        let bytes = client.read_file(&sandbox_of(), "/home/user/a.bin").expect("the file is read");

        assert_eq!(bytes, vec![0u8, 1, 2]);
        assert!(server.requests()[0].path.contains("encoding=base64"), "{}", server.requests()[0].path);
    }
}
