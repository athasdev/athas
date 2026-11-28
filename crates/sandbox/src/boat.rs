//! Boat (<https://boat.dev>) behind [`Provider`]. One host, one key, and every answer wrapped in
//! the same envelope (`{"ok": true, "type": "...", ...}`), which makes this the plainest of the
//! hosted providers: a command is a POST that returns an exit code and two strings.
//!
//! Two of Boat's own limits are handled here rather than passed on. A command may not ask for
//! more than ten minutes, so a longer one is clamped and reported as timed out by us instead of
//! rejected by Boat before it starts. A file may not be written larger than five megabytes, so a
//! workspace archive over that goes in pieces and is put back together with one `cat`.

use std::time::Duration;

use base64::Engine as _;
use serde_json::{Value, json};

use crate::{Error, Exec, Listed, Output, Provider, Result, Sandbox, Spec};

pub const ID: &str = "boat";
const API_BASE: &str = "https://boat.dev/api/v1";
/// Where Boat lets a file be written, and so where a workspace goes.
const ROOT: &str = "/home/user";
const API_TIMEOUT: Duration = Duration::from_secs(60);
const EXEC_GRACE: Duration = Duration::from_secs(10);
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// The longest Boat will run a command for; longer is rejected outright.
const MAX_COMMAND_SECONDS: u64 = 600;
/// The most Boat takes in one file write, with room under the five megabytes for base64's third.
const MAX_WRITE_BYTES: usize = 3 * 1024 * 1024;
/// What the pieces of a split write are called while they wait to be joined.
const PART_SUFFIX: &str = ".athas-part-";

pub struct Boat {
    api_key: String,
    base: String,
    client: reqwest::blocking::Client,
}

impl Boat {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self { api_key: api_key.into(), base: API_BASE.into(), client: reqwest::blocking::Client::new() }
    }

    /// Points at another base, for a test server.
    pub fn with_base(mut self, base: impl Into<String>) -> Self {
        self.base = base.into().trim_end_matches('/').to_string();
        self
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    fn send(&self, request: reqwest::blocking::RequestBuilder, what: &str) -> Result<reqwest::blocking::Response> {
        let response = request.bearer_auth(&self.api_key).send().map_err(|error| {
            if error.is_timeout() {
                Error::unavailable(format!("{what}: Boat did not answer in time."))
            } else {
                Error::unavailable(format!("{what}: Boat could not be reached ({error})."))
            }
        })?;
        let status = response.status().as_u16();
        if (200..300).contains(&status) {
            return Ok(response);
        }
        let body = response.text().unwrap_or_default();
        Err(refused(status, &body, what))
    }

    /// The envelope, unwrapped. Boat can answer 200 with `ok: false`, so the status line is not
    /// the last word on whether the call worked.
    fn json(&self, request: reqwest::blocking::RequestBuilder, what: &str) -> Result<Value> {
        let value: Value = self
            .send(request, what)?
            .json()
            .map_err(|error| Error::protocol(format!("{what}: Boat's answer could not be read ({error}).")))?;
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            let status = value.get("status").and_then(Value::as_u64).unwrap_or(0) as u16;
            return Err(refused(status, &value.to_string(), what));
        }
        Ok(value)
    }

    /// Writes a file Boat will take whole.
    fn write_one(&self, sandbox: &Sandbox, path: &str, bytes: &[u8], what: &str) -> Result<()> {
        let body = json!({
            "path": path,
            "content": base64::engine::general_purpose::STANDARD.encode(bytes),
            "encoding": "base64",
        });
        self.json(self.client.put(self.url(&files_path(&sandbox.id))).timeout(TRANSFER_TIMEOUT).json(&body), what)?;
        Ok(())
    }

    /// Runs a command without the clamping and the timeout bookkeeping [`Provider::exec`] does:
    /// the file writer uses it to join its own pieces, where neither applies.
    fn plain_exec(&self, sandbox: &Sandbox, command: &str, what: &str) -> Result<Output> {
        let body = json!({ "command": command, "timeoutSeconds": MAX_COMMAND_SECONDS });
        let request = self.client.post(self.url(&commands_path(&sandbox.id))).timeout(Duration::from_secs(MAX_COMMAND_SECONDS) + EXEC_GRACE).json(&body);
        let answer = self.json(request, what)?;
        Ok(output_from(&answer))
    }
}

fn files_path(id: &str) -> String {
    format!("/sandboxes/{id}/files")
}

fn commands_path(id: &str) -> String {
    format!("/sandboxes/{id}/commands")
}

/// Boat's own words for a failure, when it sent any.
fn detail_of(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let message = value.get("message").or_else(|| value.get("error"))?.as_str()?.trim().to_string();
    (!message.is_empty()).then_some(message)
}

fn refused(status: u16, body: &str, what: &str) -> Error {
    let message = |reason: &str| format!("{what}: {reason}");
    match status {
        401 | 403 => Error::auth(message("Boat refused the API key. Check it in Settings and reconnect.")),
        404 | 410 => Error::gone(message("the sandbox is gone. It was deleted or its time ran out.")),
        429 => Error::unavailable(message("Boat is rate limiting this account. Try again in a moment.")),
        _ => Error::unavailable(message(&detail_of(body).unwrap_or_else(|| format!("Boat answered {status}.")))),
    }
}

/// Boat's words for a sandbox's state; `running` is what the rest of Athas asks about.
fn state_of(entry: &Value) -> String {
    let state = entry.get("state").and_then(Value::as_str).unwrap_or("unknown");
    match state.eq_ignore_ascii_case("started") || state.eq_ignore_ascii_case("ready") {
        true => "running".into(),
        false => state.to_string(),
    }
}

fn listed_from(entry: &Value) -> Option<Listed> {
    Some(Listed {
        id: entry.get("id")?.as_str()?.to_string(),
        template: entry.get("from").or_else(|| entry.get("template")).and_then(Value::as_str).unwrap_or_default().to_string(),
        state: state_of(entry),
        started_at: entry.get("createdAt").and_then(Value::as_str).map(str::to_string),
        ends_at: entry.get("expiresAt").and_then(Value::as_str).map(str::to_string),
        cpus: entry.get("vcpus").and_then(Value::as_u64).unwrap_or(0) as u32,
        memory_mb: entry.get("memoryMb").and_then(Value::as_u64).unwrap_or(0) as u32,
    })
}

/// A finished command, as Boat reports it. A command Boat stopped itself says so in `timedOut`,
/// which is better than inferring it from a missing exit code.
fn output_from(answer: &Value) -> Output {
    let timed_out = answer.get("timedOut").and_then(Value::as_bool).unwrap_or(false);
    let exit_code = answer.get("exitCode").and_then(Value::as_i64).map(|code| code as i32);
    Output {
        exit_code: if timed_out { None } else { exit_code },
        stdout: answer.get("stdout").and_then(Value::as_str).unwrap_or_default().to_string(),
        stderr: answer.get("stderr").and_then(Value::as_str).unwrap_or_default().to_string(),
        timed_out,
    }
}

/// What a file's bytes are, however Boat chose to send them.
fn decode(answer: &Value) -> Result<Vec<u8>> {
    let content = answer.get("content").and_then(Value::as_str).ok_or_else(|| Error::protocol("Boat sent a file with no content in it."))?;
    match answer.get("encoding").and_then(Value::as_str) {
        Some("base64") => base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|error| Error::protocol(format!("Boat sent a file that is not the base64 it says it is ({error})."))),
        _ => Ok(content.as_bytes().to_vec()),
    }
}

impl Provider for Boat {
    fn id(&self) -> &str {
        ID
    }

    fn list(&self) -> Result<Vec<Listed>> {
        let listed = self.json(self.client.get(self.url("/sandboxes")).timeout(API_TIMEOUT), "Listing the sandboxes")?;
        let Some(entries) = listed.get("sandboxes").and_then(Value::as_array) else {
            return Err(Error::protocol("Boat answered the sandbox list with something that is not a list."));
        };
        Ok(entries.iter().filter_map(listed_from).collect())
    }

    fn create(&self, spec: &Spec) -> Result<Sandbox> {
        let mut body = json!({ "ttlSeconds": spec.timeout_seconds() });
        if let Some(template) = &spec.template {
            body["from"] = json!(template);
        }
        if !spec.metadata.is_empty() {
            body["labels"] = json!(spec.metadata);
        }
        let created = self.json(self.client.post(self.url("/sandboxes")).timeout(API_TIMEOUT).json(&body), "Creating a sandbox")?;
        let id = created
            .get("sandbox")
            .and_then(|sandbox| sandbox.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(|| Error::protocol("Boat created a sandbox without telling us its id."))?
            .to_string();
        let sandbox = Sandbox { provider: ID.into(), id, host: self.base.clone(), access_token: None, root: ROOT.into() };
        // Boat has no way to put environment on a sandbox, so it goes on the shell that every
        // command runs through. Exported once here instead of repeated on every exec.
        if !spec.env.is_empty() {
            let exports = spec.env.iter().map(|(name, value)| format!("export {name}={}", shell_quote(value))).collect::<Vec<_>>().join("\n");
            let command = format!("printf '%s\\n' {} >> {ROOT}/.profile", shell_quote(&exports));
            let _ = self.plain_exec(&sandbox, &command, "Setting the sandbox's environment");
        }
        Ok(sandbox)
    }

    fn attach(&self, id: &str) -> Result<Sandbox> {
        let detail = self.json(self.client.get(self.url(&format!("/sandboxes/{id}"))).timeout(API_TIMEOUT), "Opening the sandbox")?;
        let sandbox = detail.get("sandbox").cloned().unwrap_or(detail);
        // A stopped sandbox is resumed rather than called gone: Boat keeps its disk, which is
        // the reason someone picks an old one out of the list.
        if !state_of(&sandbox).eq_ignore_ascii_case("running") {
            self.send(self.client.post(self.url(&format!("/sandboxes/{id}/resume"))).timeout(API_TIMEOUT), "Resuming the sandbox")?;
        }
        Ok(Sandbox { provider: ID.into(), id: id.to_string(), host: self.base.clone(), access_token: None, root: ROOT.into() })
    }

    fn exec(&self, sandbox: &Sandbox, exec: &Exec) -> Result<Output> {
        let seconds = exec.timeout.as_secs().clamp(1, MAX_COMMAND_SECONDS);
        let mut body = json!({ "command": exec.command, "timeoutSeconds": seconds });
        if let Some(cwd) = &exec.cwd {
            body["cwd"] = json!(cwd);
        }
        let request = self.client.post(self.url(&commands_path(&sandbox.id))).timeout(Duration::from_secs(seconds) + EXEC_GRACE).json(&body);
        let answer = match self.json(request, "Running a command") {
            Ok(answer) => answer,
            Err(error) if error.message.contains("did not answer in time") => {
                return Ok(Output { exit_code: None, stdout: String::new(), stderr: String::new(), timed_out: true });
            }
            Err(error) => return Err(error),
        };
        Ok(output_from(&answer))
    }

    fn write_file(&self, sandbox: &Sandbox, path: &str, bytes: &[u8]) -> Result<()> {
        let what = format!("Writing {path}");
        if bytes.len() <= MAX_WRITE_BYTES {
            return self.write_one(sandbox, path, bytes, &what);
        }
        // Too big for one write: the pieces go over with names of their own and are joined in
        // the sandbox, where moving three megabytes costs nothing.
        let mut parts = Vec::new();
        for (index, chunk) in bytes.chunks(MAX_WRITE_BYTES).enumerate() {
            let part = format!("{path}{PART_SUFFIX}{index:04}");
            self.write_one(sandbox, &part, chunk, &what)?;
            parts.push(part);
        }
        let joined = parts.iter().map(|part| shell_quote(part)).collect::<Vec<_>>().join(" ");
        let command = format!("cat {joined} > {} && rm -f {joined}", shell_quote(path));
        let result = self.plain_exec(sandbox, &command, &what)?;
        if !result.succeeded() {
            return Err(Error::unavailable(format!("{what}: the pieces could not be put back together. {}", result.stderr.trim())));
        }
        Ok(())
    }

    fn read_file(&self, sandbox: &Sandbox, path: &str) -> Result<Vec<u8>> {
        let request = self
            .client
            .get(self.url(&files_path(&sandbox.id)))
            .query(&[("path", path), ("encoding", "base64")])
            .timeout(TRANSFER_TIMEOUT);
        let answer = self.json(request, &format!("Reading {path}"))?;
        decode(&answer)
    }

    fn keep_alive(&self, sandbox: &Sandbox, seconds: u32) -> Result<()> {
        let path = format!("/sandboxes/{}", sandbox.id);
        self.json(self.client.patch(self.url(&path)).timeout(API_TIMEOUT).json(&json!({ "ttlSeconds": seconds })), "Keeping the sandbox alive")?;
        Ok(())
    }

    fn dispose(&self, sandbox: &Sandbox) -> Result<()> {
        // Stopped, not deleted. Boat keeps a stopped sandbox's disk, and deleting one is a thing
        // the user asks for on its own page, not something a closing session does for them.
        let path = format!("/sandboxes/{}/stop", sandbox.id);
        match self.send(self.client.post(self.url(&path)).timeout(API_TIMEOUT), "Stopping the sandbox") {
            Err(error) if error.kind == crate::ErrorKind::Gone => Ok(()),
            Err(error) => Err(error),
            Ok(_) => Ok(()),
        }
    }
}

/// A value the remote shell reads as one word, however it is spelled.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn a_command_boat_stopped_itself_is_reported_as_timed_out_and_not_as_an_exit_code() {
        let answer = json!({ "exitCode": null, "stdout": "half", "stderr": "", "timedOut": true });
        let output = super::output_from(&answer);
        assert!(output.timed_out);
        assert_eq!(output.exit_code, None);
        assert_eq!(output.stdout, "half");
    }

    #[test]
    fn a_command_that_finished_keeps_its_exit_code() {
        let output = super::output_from(&json!({ "exitCode": 2, "stdout": "", "stderr": "nope", "timedOut": false }));
        assert_eq!(output.exit_code, Some(2));
        assert!(!output.succeeded());
        assert!(!output.timed_out);
    }

    #[test]
    fn a_file_is_decoded_the_way_boat_says_it_encoded_it() {
        let encoded = json!({ "content": "aGVsbG8=", "encoding": "base64" });
        assert_eq!(super::decode(&encoded).unwrap(), b"hello");
        // Without an encoding it is text, which is what Boat's default is.
        let plain = json!({ "content": "hello" });
        assert_eq!(super::decode(&plain).unwrap(), b"hello");
    }

    #[test]
    fn a_sandbox_that_is_ready_is_a_running_one() {
        assert_eq!(super::state_of(&json!({ "state": "ready" })), "running");
        assert_eq!(super::state_of(&json!({ "state": "archiving" })), "archiving");
    }
}
