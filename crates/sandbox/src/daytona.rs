//! Daytona (<https://daytona.io>) behind [`Provider`]. Two hosts again, as with E2B, and the same
//! rule: the account API (`app.daytona.io/api`) makes and kills sandboxes, and the toolbox
//! (`proxy.app.daytona.io/toolbox/<id>`) runs commands and holds files. Unlike E2B both take the
//! account's own key, so there is no second token to carry.
//!
//! What makes this the short file: the toolbox answers a command with one JSON object -- an exit
//! code and the output as text -- so there is no streaming protocol to decode. The cost of that
//! is that stdout and stderr arrive as one stream, which is what a terminal shows anyway.

use std::time::Duration;

use serde_json::{Value, json};

use crate::{Error, Exec, Listed, Output, Provider, Result, Sandbox, Spec};

pub const ID: &str = "daytona";
const API_BASE: &str = "https://app.daytona.io/api";
const TOOLBOX_BASE: &str = "https://proxy.app.daytona.io/toolbox";
/// Where a sandbox's own user lives, when the sandbox does not say who that is.
const DEFAULT_USER: &str = "daytona";
const API_TIMEOUT: Duration = Duration::from_secs(60);
const EXEC_GRACE: Duration = Duration::from_secs(10);
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// What goes between the parts of a multipart body. Long and unlikely enough that no file
/// contains it, which is the whole requirement.
const BOUNDARY: &str = "athas-sandbox-boundary-7f3a9c1e";

pub struct Daytona {
    api_key: String,
    api_base: String,
    toolbox_base: String,
    client: reqwest::blocking::Client,
}

impl Daytona {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            api_base: API_BASE.into(),
            toolbox_base: TOOLBOX_BASE.into(),
            client: reqwest::blocking::Client::new(),
        }
    }

    /// Points both hosts at one base, for a self-hosted install or a test server.
    pub fn with_bases(mut self, base: impl Into<String>) -> Self {
        let base = base.into().trim_end_matches('/').to_string();
        self.api_base = base.clone();
        self.toolbox_base = format!("{base}/toolbox");
        self
    }

    fn api(&self, path: &str) -> String {
        format!("{}{path}", self.api_base)
    }

    fn toolbox(&self, id: &str, path: &str) -> String {
        format!("{}/{id}{path}", self.toolbox_base)
    }

    fn authorized(&self, request: reqwest::blocking::RequestBuilder) -> reqwest::blocking::RequestBuilder {
        request.bearer_auth(&self.api_key)
    }

    fn send(&self, request: reqwest::blocking::RequestBuilder, what: &str) -> Result<reqwest::blocking::Response> {
        let response = self.authorized(request).send().map_err(|error| {
            if error.is_timeout() {
                Error::unavailable(format!("{what}: Daytona did not answer in time."))
            } else {
                Error::unavailable(format!("{what}: Daytona could not be reached ({error})."))
            }
        })?;
        let status = response.status().as_u16();
        if (200..300).contains(&status) {
            return Ok(response);
        }
        let body = response.text().unwrap_or_default();
        Err(refused(status, &body, what))
    }

    fn json(&self, request: reqwest::blocking::RequestBuilder, what: &str) -> Result<Value> {
        self.send(request, what)?.json().map_err(|error| Error::protocol(format!("{what}: Daytona's answer could not be read ({error}).")))
    }
}

/// Daytona's own words for a failure, when it sent any.
fn detail_of(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let message = value.get("message").or_else(|| value.get("error"))?;
    let text = match message {
        Value::String(text) => text.trim().to_string(),
        // A validation failure arrives as a list of them.
        Value::Array(parts) => parts.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "),
        _ => return None,
    };
    (!text.is_empty()).then_some(text)
}

fn refused(status: u16, body: &str, what: &str) -> Error {
    let message = |reason: &str| format!("{what}: {reason}");
    match status {
        401 | 403 => Error::auth(message("Daytona refused the API key. Check it in Settings and reconnect.")),
        404 => Error::gone(message("the sandbox is gone. It was deleted or it expired.")),
        429 => Error::unavailable(message("Daytona is rate limiting this account. Try again in a moment.")),
        _ => Error::unavailable(message(&detail_of(body).unwrap_or_else(|| format!("Daytona answered {status}.")))),
    }
}

/// Daytona calls a running sandbox "started"; everything that reads a state here expects
/// "running". The provider's own word is kept for every other state, which is the point of
/// [`Listed::state`] being a string.
fn state_of(entry: &Value) -> String {
    let state = entry.get("state").and_then(Value::as_str).unwrap_or("unknown");
    match state.eq_ignore_ascii_case("started") {
        true => "running".into(),
        false => state.to_string(),
    }
}

/// The home of the sandbox's own user, which is where a workspace belongs.
fn root_of(entry: &Value) -> String {
    let user = entry.get("user").and_then(Value::as_str).filter(|user| !user.is_empty()).unwrap_or(DEFAULT_USER);
    format!("/home/{user}")
}

fn listed_from(entry: &Value) -> Option<Listed> {
    Some(Listed {
        id: entry.get("id")?.as_str()?.to_string(),
        template: entry
            .get("snapshot")
            .or_else(|| entry.get("image"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        state: state_of(entry),
        started_at: entry.get("createdAt").and_then(Value::as_str).map(str::to_string),
        // Daytona stops a sandbox after an idle interval rather than at a moment it can name.
        ends_at: None,
        cpus: entry.get("cpu").and_then(Value::as_u64).unwrap_or(0) as u32,
        memory_mb: entry.get("memory").and_then(Value::as_u64).unwrap_or(0) as u32 * 1024,
    })
}

/// One file as a multipart body. Hand-written because the only thing reqwest's own multipart
/// would add here is a feature flag and a dependency on an async body type.
fn multipart(name: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(bytes.len() + 256);
    body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
    body.extend_from_slice(format!("Content-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n").as_bytes());
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    body
}

impl Provider for Daytona {
    fn id(&self) -> &str {
        ID
    }

    fn list(&self) -> Result<Vec<Listed>> {
        let listed = self.json(self.client.get(self.api("/sandbox")).timeout(API_TIMEOUT), "Listing the sandboxes")?;
        // A list, or a page with the list inside it: Daytona has sent both.
        let entries = listed.as_array().cloned().or_else(|| listed.get("items").and_then(Value::as_array).cloned());
        let Some(entries) = entries else {
            return Err(Error::protocol("Daytona answered the sandbox list with something that is not a list."));
        };
        Ok(entries.iter().filter_map(listed_from).collect())
    }

    fn create(&self, spec: &Spec) -> Result<Sandbox> {
        let mut body = json!({ "autoStopInterval": minutes(spec.timeout_seconds()) });
        if let Some(snapshot) = &spec.template {
            body["snapshot"] = json!(snapshot);
        }
        if !spec.env.is_empty() {
            body["env"] = json!(spec.env);
        }
        if !spec.metadata.is_empty() {
            body["labels"] = json!(spec.metadata);
        }
        let created = self.json(self.client.post(self.api("/sandbox")).timeout(API_TIMEOUT).json(&body), "Creating a sandbox")?;
        let id = created
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::protocol("Daytona created a sandbox without telling us its id."))?
            .to_string();
        Ok(Sandbox {
            provider: ID.into(),
            host: self.toolbox(&id, ""),
            access_token: None,
            root: root_of(&created),
            id,
        })
    }

    fn attach(&self, id: &str) -> Result<Sandbox> {
        let detail = self.json(self.client.get(self.api(&format!("/sandbox/{id}"))).timeout(API_TIMEOUT), "Opening the sandbox")?;
        // A sandbox that stopped on its own is started again rather than reported as gone: the
        // files in it are the reason the user picked it.
        if !state_of(&detail).eq_ignore_ascii_case("running") {
            self.send(self.client.post(self.api(&format!("/sandbox/{id}/start"))).timeout(API_TIMEOUT), "Starting the sandbox")?;
        }
        Ok(Sandbox {
            provider: ID.into(),
            id: id.to_string(),
            host: self.toolbox(id, ""),
            access_token: None,
            root: root_of(&detail),
        })
    }

    fn exec(&self, sandbox: &Sandbox, exec: &Exec) -> Result<Output> {
        let mut body = json!({ "command": exec.command, "timeout": exec.timeout.as_secs() });
        if let Some(cwd) = &exec.cwd {
            body["cwd"] = json!(cwd);
        }
        let request = self.client.post(self.toolbox(&sandbox.id, "/process/execute")).timeout(exec.timeout + EXEC_GRACE).json(&body);
        let answer = match self.send(request, "Running a command") {
            Ok(response) => response,
            // Our own read ran out while the command was still going: that is a timeout, not a
            // dead sandbox, and it is the one case we can tell apart.
            Err(error) if error.message.contains("did not answer in time") => {
                return Ok(Output { exit_code: None, stdout: String::new(), stderr: String::new(), timed_out: true });
            }
            Err(error) => return Err(error),
        };
        let result: Value = answer.json().map_err(|error| Error::protocol(format!("Running a command: the output could not be read ({error}).")))?;
        let code = result.get("exitCode").or_else(|| result.get("code")).and_then(Value::as_i64).map(|code| code as i32);
        // The toolbox sends one stream, which is what a terminal would have shown.
        let text = result.get("result").or_else(|| result.get("output")).and_then(Value::as_str).unwrap_or_default().to_string();
        Ok(Output { exit_code: code, stdout: text, stderr: String::new(), timed_out: code.is_none() })
    }

    fn write_file(&self, sandbox: &Sandbox, path: &str, bytes: &[u8]) -> Result<()> {
        let name = path.rsplit('/').next().unwrap_or("file");
        let request = self
            .client
            .post(self.toolbox(&sandbox.id, "/files/upload-v2"))
            .query(&[("path", path)])
            .header("Content-Type", format!("multipart/form-data; boundary={BOUNDARY}"))
            .timeout(TRANSFER_TIMEOUT)
            .body(multipart(name, bytes));
        self.send(request, &format!("Writing {path}"))?;
        Ok(())
    }

    fn read_file(&self, sandbox: &Sandbox, path: &str) -> Result<Vec<u8>> {
        let request = self.client.get(self.toolbox(&sandbox.id, "/files/download")).query(&[("path", path)]).timeout(TRANSFER_TIMEOUT);
        let response = self.send(request, &format!("Reading {path}"))?;
        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(|error| Error::unavailable(format!("Reading {path}: the sandbox stopped sending ({error}).")))
    }

    fn keep_alive(&self, sandbox: &Sandbox, seconds: u32) -> Result<()> {
        // Daytona counts an idle interval in minutes rather than a deadline, so this sets how
        // long it may sit unused -- which is the same promise, said the other way round.
        let path = format!("/sandbox/{}/autostop/{}", sandbox.id, minutes(seconds));
        self.send(self.client.post(self.api(&path)).timeout(API_TIMEOUT), "Keeping the sandbox alive")?;
        Ok(())
    }

    fn dispose(&self, sandbox: &Sandbox) -> Result<()> {
        let path = format!("/sandbox/{}", sandbox.id);
        match self.send(self.client.delete(self.api(&path)).timeout(API_TIMEOUT), "Stopping the sandbox") {
            // Already gone is what was wanted.
            Err(error) if error.kind == crate::ErrorKind::Gone => Ok(()),
            Err(error) => Err(error),
            Ok(_) => Ok(()),
        }
    }
}

/// Seconds as whole minutes, never rounding down to "never stop": a zero interval is Daytona's
/// word for a sandbox that runs until someone remembers it.
fn minutes(seconds: u32) -> u32 {
    seconds.div_ceil(60).max(1)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn an_interval_never_rounds_down_to_never_stopping() {
        assert_eq!(super::minutes(0), 1);
        assert_eq!(super::minutes(30), 1);
        assert_eq!(super::minutes(60), 1);
        assert_eq!(super::minutes(61), 2);
        assert_eq!(super::minutes(3600), 60);
    }

    #[test]
    fn a_started_sandbox_is_a_running_one_whatever_daytona_calls_it() {
        assert_eq!(super::state_of(&json!({ "state": "started" })), "running");
        // Every other state is kept as the provider said it, so one we have never seen still shows.
        assert_eq!(super::state_of(&json!({ "state": "pending_build" })), "pending_build");
    }

    #[test]
    fn a_workspace_belongs_in_the_sandbox_users_home() {
        assert_eq!(super::root_of(&json!({ "user": "ubuntu" })), "/home/ubuntu");
        assert_eq!(super::root_of(&json!({})), "/home/daytona");
    }

    #[test]
    fn a_multipart_body_carries_the_bytes_between_its_boundaries() {
        let body = super::multipart("sync.tar.gz", b"\x1f\x8b\x08");
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with(&format!("--{}\r\n", super::BOUNDARY)));
        assert!(text.contains("filename=\"sync.tar.gz\""));
        assert!(text.ends_with(&format!("--{}--\r\n", super::BOUNDARY)));
        assert!(body.windows(3).any(|window| window == b"\x1f\x8b\x08"), "the file's own bytes survive");
    }
}
