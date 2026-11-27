//! E2B (<https://e2b.dev>) behind [`Provider`]. Two servers answer here, and keeping them apart is
//! most of what this file is: the account API (`https://api.<domain>`) makes and kills sandboxes
//! with the user's key, and `envd`, the daemon inside each sandbox
//! (`https://49983-<sandbox-id>.<domain>`), runs commands and holds files. envd has a key of its
//! own when the API hands one out, and the account key is never sent to it.
//!
//! Commands come back as a Connect-RPC stream of envelopes ([`crate::connect`]) whose payloads are
//! `start`, `data`, `end` and `keepalive` events, with the output base64 encoded the way protobuf
//! JSON encodes bytes.

use std::time::Duration;

use base64::Engine as _;
use serde_json::{Value, json};

use crate::{Error, Exec, Listed, Output, Provider, Result, Sandbox, Spec, connect};

pub const ID: &str = "e2b";
const DEFAULT_DOMAIN: &str = "e2b.app";
/// The port envd listens on inside every sandbox.
const ENVD_PORT: u16 = 49983;
/// The image a sandbox is made from when the caller names none.
const DEFAULT_TEMPLATE: &str = "base";
/// The account the commands and files belong to inside the sandbox.
const SANDBOX_USER: &str = "user";
/// Lifecycle calls are small; none of them has a reason to take longer than this.
const API_TIMEOUT: Duration = Duration::from_secs(30);
/// Read beyond a command's own timeout, so a command that just ran out is reported as timed out
/// by the sandbox rather than as a dead connection by us.
const EXEC_GRACE: Duration = Duration::from_secs(10);
/// Moving a file is not an API call: a workspace is tens of megabytes and crosses the internet.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct E2b {
    api_key: String,
    domain: String,
    /// Overrides `https://api.<domain>`, for a self-hosted install or a test server.
    api_base: Option<String>,
    /// Overrides every sandbox's own base, for the same reasons.
    envd_base: Option<String>,
    client: reqwest::blocking::Client,
}

impl E2b {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            domain: DEFAULT_DOMAIN.into(),
            api_base: None,
            envd_base: None,
            client: reqwest::blocking::Client::new(),
        }
    }

    pub fn with_domain(mut self, domain: impl Into<String>) -> Self {
        self.domain = domain.into();
        self
    }

    /// Points both servers at one base, as a test server and a single-host install do.
    pub fn with_bases(mut self, base: impl Into<String>) -> Self {
        let base = base.into().trim_end_matches('/').to_string();
        self.api_base = Some(base.clone());
        self.envd_base = Some(base);
        self
    }

    fn api(&self, path: &str) -> String {
        match &self.api_base {
            Some(base) => format!("{base}{path}"),
            None => format!("https://api.{}{path}", self.domain),
        }
    }

    fn envd(&self, sandbox: &Sandbox, path: &str) -> String {
        match &self.envd_base {
            Some(base) => format!("{base}{path}"),
            None => format!("{}{path}", sandbox.host.trim_end_matches('/')),
        }
    }

    /// Adds the headers envd wants on every request, whichever URL form reached it.
    fn envd_headers(&self, request: reqwest::blocking::RequestBuilder, sandbox: &Sandbox) -> reqwest::blocking::RequestBuilder {
        let request = request.header("E2b-Sandbox-Id", &sandbox.id).header("E2b-Sandbox-Port", ENVD_PORT.to_string());
        match &sandbox.access_token {
            Some(token) => request.header("X-Access-Token", token),
            None => request,
        }
    }

    /// Turns a refusal into the one of four shapes a caller acts on. `what` names the call so the
    /// message says which of the two servers said no.
    fn refused(&self, status: u16, body: &str, what: &str) -> Error {
        let detail = detail_of(body);
        let message = |reason: &str| format!("{what}: {reason}");
        match status {
            401 | 403 => Error::auth(message("E2B refused the API key. Check it in Settings and reconnect.")),
            404 => Error::gone(message("the sandbox is gone. It expired or something else stopped it.")),
            429 => Error::unavailable(message("E2B is rate limiting this account. Try again in a moment.")),
            _ => Error::unavailable(message(&detail.unwrap_or_else(|| format!("E2B answered {status}.")))),
        }
    }

    fn send(&self, request: reqwest::blocking::RequestBuilder, what: &str) -> Result<reqwest::blocking::Response> {
        let response = request.send().map_err(|error| {
            if error.is_timeout() {
                Error::unavailable(format!("{what}: E2B did not answer in time."))
            } else {
                Error::unavailable(format!("{what}: E2B could not be reached ({error})."))
            }
        })?;
        let status = response.status().as_u16();
        if (200..300).contains(&status) {
            return Ok(response);
        }
        let body = response.text().unwrap_or_default();
        Err(self.refused(status, &body, what))
    }
}

/// E2B's own words for a failure, when it sent any.
fn detail_of(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let message = value.get("message").or_else(|| value.get("error"))?.as_str()?.trim().to_string();
    (!message.is_empty()).then_some(message)
}

/// `{"event": {"data": {"stdout": "aGk="}}}` -> the bytes it stands for.
fn event_text(data: &Value, stream: &str) -> Option<String> {
    let encoded = data.get(stream)?.as_str()?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Protobuf JSON writes `exitCode`; a hand-written server or an older envd may write `exit_code`.
fn number_field(value: &Value, camel: &str, snake: &str) -> Option<i64> {
    value.get(camel).or_else(|| value.get(snake)).and_then(|field| field.as_i64().or_else(|| field.as_str()?.parse().ok()))
}

impl Provider for E2b {
    fn id(&self) -> &str {
        ID
    }

    fn list(&self) -> Result<Vec<Listed>> {
        let response = self.send(
            self.client.get(self.api("/v2/sandboxes")).header("X-API-KEY", &self.api_key).timeout(API_TIMEOUT),
            "Listing the sandboxes",
        )?;
        let listed: Value = response.json().map_err(|error| Error::protocol(format!("E2B's list could not be read ({error}).")))?;
        let Some(entries) = listed.as_array() else {
            return Err(Error::protocol("E2B answered the sandbox list with something that is not a list."));
        };
        Ok(entries
            .iter()
            .filter_map(|entry| {
                let number = |key: &str| entry.get(key).and_then(Value::as_u64).unwrap_or_default() as u32;
                Some(Listed {
                    id: entry.get("sandboxID")?.as_str()?.to_string(),
                    // The alias is what the template was asked for by name; the id behind it
                    // means nothing to a reader.
                    template: entry
                        .get("alias")
                        .or_else(|| entry.get("templateID"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    state: entry.get("state").and_then(Value::as_str).unwrap_or("running").to_string(),
                    started_at: entry.get("startedAt").and_then(Value::as_str).map(str::to_string),
                    ends_at: entry.get("endAt").and_then(Value::as_str).map(str::to_string),
                    cpus: number("cpuCount"),
                    memory_mb: number("memoryMB"),
                })
            })
            .collect())
    }

    fn create(&self, spec: &Spec) -> Result<Sandbox> {
        let mut body = json!({
            "templateID": spec.template.clone().unwrap_or_else(|| DEFAULT_TEMPLATE.into()),
            "timeout": spec.timeout_seconds(),
        });
        if !spec.env.is_empty() {
            body["envVars"] = json!(spec.env);
        }
        if !spec.metadata.is_empty() {
            body["metadata"] = json!(spec.metadata);
        }
        let response = self
            .send(
                self.client.post(self.api("/v2/sandboxes")).header("X-API-KEY", &self.api_key).timeout(API_TIMEOUT).json(&body),
                "Creating a sandbox",
            )
            // A 404 here is the template, not a sandbox that never existed.
            .map_err(|error| match error.kind {
                crate::ErrorKind::Gone => Error::unavailable(format!(
                    "Creating a sandbox: E2B has no template named {}.",
                    spec.template.clone().unwrap_or_else(|| DEFAULT_TEMPLATE.into())
                )),
                _ => error,
            })?;
        let created: Value = response.json().map_err(|error| Error::protocol(format!("E2B's answer could not be read ({error}).")))?;
        let id = created
            .get("sandboxID")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::protocol("E2B created a sandbox without telling us its id."))?
            .to_string();
        let domain = created.get("domain").and_then(Value::as_str).unwrap_or(&self.domain);
        Ok(Sandbox {
            provider: ID.into(),
            id: id.clone(),
            host: format!("https://{ENVD_PORT}-{id}.{domain}"),
            access_token: created.get("envdAccessToken").and_then(Value::as_str).map(str::to_string),
            root: crate::DEFAULT_ROOT.into(),
        })
    }

    fn attach(&self, id: &str) -> Result<Sandbox> {
        let path = format!("/sandboxes/{id}");
        let response = self.send(
            self.client.get(self.api(&path)).header("X-API-KEY", &self.api_key).timeout(API_TIMEOUT),
            "Opening the sandbox",
        )?;
        let detail: Value = response.json().map_err(|error| Error::protocol(format!("E2B's answer could not be read ({error}).")))?;
        let domain = detail.get("domain").and_then(Value::as_str).unwrap_or(&self.domain);
        Ok(Sandbox {
            provider: ID.into(),
            id: id.to_string(),
            host: format!("https://{ENVD_PORT}-{id}.{domain}"),
            access_token: detail.get("envdAccessToken").and_then(Value::as_str).map(str::to_string),
            root: crate::DEFAULT_ROOT.into(),
        })
    }

    fn exec(&self, sandbox: &Sandbox, exec: &Exec) -> Result<Output> {
        let mut process = json!({ "cmd": "/bin/bash", "args": ["-l", "-c", exec.command] });
        if let Some(cwd) = &exec.cwd {
            process["cwd"] = json!(cwd);
        }
        if !exec.env.is_empty() {
            process["envs"] = json!(exec.env);
        }
        let body = connect::encode(json!({ "process": process }).to_string().as_bytes());
        let request = self
            .client
            .post(self.envd(sandbox, "/process.Process/Start"))
            .header("Content-Type", "application/connect+json")
            .header("Connect-Protocol-Version", "1")
            .header("Connect-Timeout-Ms", exec.timeout.as_millis().to_string())
            .timeout(exec.timeout + EXEC_GRACE)
            .body(body);
        let response = match self.send(self.envd_headers(request, sandbox), "Running a command") {
            Ok(response) => response,
            // The only timeout we can tell apart from a dead sandbox: our own read ran out while
            // the command was still going.
            Err(error) if error.is_retryable() && error.message.contains("did not answer in time") => {
                return Ok(Output { exit_code: None, stdout: String::new(), stderr: String::new(), timed_out: true });
            }
            Err(error) => return Err(error),
        };
        let bytes = response.bytes().map_err(|error| Error::unavailable(format!("Running a command: the output stopped ({error}).")))?;
        let mut output = Output::default();
        let mut ended = false;
        for frame in connect::decode(&bytes)? {
            if frame.is_end() {
                if let Some(error) = connect::stream_error(&frame) {
                    return Err(Error::unavailable(format!("Running a command: {error}")));
                }
                continue;
            }
            let Some(event) = frame.json().and_then(|value| value.get("event").cloned()) else { continue };
            if let Some(data) = event.get("data") {
                if let Some(text) = event_text(data, "stdout") {
                    output.stdout.push_str(&text);
                }
                if let Some(text) = event_text(data, "stderr") {
                    output.stderr.push_str(&text);
                }
            }
            if let Some(end) = event.get("end") {
                // Protobuf JSON leaves a zero out, so a command that succeeded carries no
                // `exitCode` at all. An `end` event is the exit; what it does not say is 0.
                ended = true;
                output.exit_code = Some(number_field(end, "exitCode", "exit_code").unwrap_or(0) as i32);
            }
        }
        // No `end` event at all: the command never got to exit.
        output.timed_out = !ended;
        Ok(output)
    }

    fn write_file(&self, sandbox: &Sandbox, path: &str, bytes: &[u8]) -> Result<()> {
        let request = self
            .client
            .post(self.envd(sandbox, &files_query(path)))
            .header("Content-Type", "application/octet-stream")
            .timeout(TRANSFER_TIMEOUT)
            .body(bytes.to_vec());
        self.send(self.envd_headers(request, sandbox), &format!("Writing {path}"))?;
        Ok(())
    }

    fn read_file(&self, sandbox: &Sandbox, path: &str) -> Result<Vec<u8>> {
        let request = self.client.get(self.envd(sandbox, &files_query(path))).timeout(TRANSFER_TIMEOUT);
        let response = self.send(self.envd_headers(request, sandbox), &format!("Reading {path}"))?;
        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(|error| Error::unavailable(format!("Reading {path}: the sandbox stopped sending ({error}).")))
    }

    fn keep_alive(&self, sandbox: &Sandbox, seconds: u32) -> Result<()> {
        let path = format!("/sandboxes/{}/timeout", sandbox.id);
        self.send(
            self.client.post(self.api(&path)).header("X-API-KEY", &self.api_key).timeout(API_TIMEOUT).json(&json!({ "timeout": seconds })),
            "Keeping the sandbox alive",
        )?;
        Ok(())
    }

    fn dispose(&self, sandbox: &Sandbox) -> Result<()> {
        let path = format!("/sandboxes/{}", sandbox.id);
        match self.send(self.client.delete(self.api(&path)).header("X-API-KEY", &self.api_key).timeout(API_TIMEOUT), "Stopping the sandbox")
        {
            // Already gone is what was wanted.
            Err(error) if error.kind == crate::ErrorKind::Gone => Ok(()),
            Err(error) => Err(error),
            Ok(_) => Ok(()),
        }
    }
}

/// envd's file endpoint, with the path escaped for a query string.
fn files_query(path: &str) -> String {
    format!("/files?path={}&username={SANDBOX_USER}", escape_query(path))
}

/// Percent-encodes everything a path may hold that a query string may not.
fn escape_query(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => escaped.push(byte as char),
            _ => escaped.push_str(&format!("%{byte:02X}")),
        }
    }
    escaped
}
