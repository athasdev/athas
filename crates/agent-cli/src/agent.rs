use crate::{Options, session::Session};
use anyhow::{Context, Result, bail};
use athas_ai::{
   workspace_command::run_workspace_command,
   workspace_tools::{
      ListFilesOptions, SearchOptions, list_workspace_files, read_workspace_file,
      search_workspace_files, write_workspace_file,
   },
};
use futures::StreamExt;
use serde_json::{Value, json};
use std::{
   collections::HashMap,
   env, fs,
   io::{self, Write},
};
#[cfg(target_os = "macos")]
use std::{
   io::Read,
   process::{Command, Stdio},
   time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

pub enum Event {
   Status(String),
   TextDelta(String),
   Tool(String),
   Permission(String, oneshot::Sender<bool>),
   Done,
}

#[cfg(target_os = "macos")]
fn macos_keychain_secret(service: &str, account: &str) -> Option<String> {
   let mut child = Command::new("/usr/bin/security")
      .args(["find-generic-password", "-s", service, "-a", account, "-w"])
      .stdin(Stdio::null())
      .stdout(Stdio::piped())
      .stderr(Stdio::null())
      .spawn()
      .ok()?;
   let deadline = Instant::now() + Duration::from_secs(3);
   loop {
      match child.try_wait() {
         Ok(Some(status)) => {
            if !status.success() {
               return None;
            }
            let mut value = String::new();
            child.stdout.take()?.read_to_string(&mut value).ok()?;
            return Some(value.trim_end_matches(['\r', '\n']).to_string());
         }
         Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
         _ => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
         }
      }
   }
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
   json!({"type":"function","function":{"name":name,"description":description,
      "parameters":{"type":"object","properties":properties,"required":required}}})
}

fn tools() -> Vec<Value> {
   vec![
      tool(
         "list_files",
         "List project files, respecting gitignore.",
         json!({"path":{"type":"string"},"glob":{"type":"string"}}),
         &[],
      ),
      tool(
         "search_files",
         "Search text across project files.",
         json!({"query":{"type":"string"},"glob":{"type":"string"}}),
         &["query"],
      ),
      tool(
         "read_file",
         "Read a text file relative to the workspace.",
         json!({"path":{"type":"string"}}),
         &["path"],
      ),
      tool(
         "write_file",
         "Create or replace a file. Read existing files before writing them.",
         json!({"path":{"type":"string"},"content":{"type":"string"}}),
         &["path", "content"],
      ),
      tool(
         "run_command",
         "Run a shell command in the workspace, with user approval.",
         json!({"command":{"type":"string"}}),
         &["command"],
      ),
   ]
}

fn connection(options: &Options) -> Result<(String, Option<String>)> {
   let key = |storage_key: &str, variable: &str, provider: &str| -> Result<String> {
      if let Ok(key) = env::var(variable) {
         return Ok(key);
      }
      let identifiers = [options.app_identifier.as_str(), "com.code.athas"];
      for identifier in identifiers {
         #[cfg(target_os = "macos")]
         if let Some(key) = macos_keychain_secret(identifier, storage_key) {
            return Ok(key);
         }
         #[cfg(not(target_os = "macos"))]
         if let Ok(entry) = keyring::Entry::new(identifier, storage_key)
            && let Ok(key) = entry.get_password()
         {
            return Ok(key);
         }
      }
      let mut directories = Vec::new();
      if let Some(data) = dirs::data_dir() {
         directories.push(data.join(&options.app_identifier));
         directories.push(data.join("com.code.athas"));
         directories.push(data.join("athas"));
      }
      if let Some(home) = dirs::home_dir() {
         directories.push(home.join(".athas"));
      }
      for directory in directories {
         if let Ok(contents) = fs::read_to_string(directory.join("secure.json"))
            && let Ok(secrets) = serde_json::from_str::<Value>(&contents)
            && let Some(key) = secrets[storage_key].as_str()
         {
            return Ok(key.into());
         }
      }
      bail!("Sign in to Athas Desktop or set {variable} for {provider}")
   };
   match options.provider.as_str() {
      "athas" => Ok((
         format!(
            "{}/api/ai/chat",
            env::var("ATHAS_API_URL")
               .unwrap_or_else(|_| "https://athas.dev".into())
               .trim_end_matches('/')
         ),
         Some(key("athas_auth_token", "ATHAS_AUTH_TOKEN", "Athas")?),
      )),
      "openai" => Ok((
         "https://api.openai.com/v1/chat/completions".into(),
         Some(key("ai_token_openai", "OPENAI_API_KEY", "OpenAI")?),
      )),
      "openrouter" => Ok((
         "https://openrouter.ai/api/v1/chat/completions".into(),
         Some(key(
            "ai_token_openrouter",
            "OPENROUTER_API_KEY",
            "OpenRouter",
         )?),
      )),
      "ollama" => Ok(("http://127.0.0.1:11434/v1/chat/completions".into(), None)),
      _ => bail!("Unsupported provider"),
   }
}

pub async fn list_models(options: &Options) -> Result<Vec<(String, String)>> {
   if options.provider != "athas" {
      bail!("/models is available for the Athas provider");
   }
   let (url, token) = connection(options)?;
   let response = reqwest::Client::new()
      .get(url)
      .bearer_auth(token.context("Athas sign-in is missing")?)
      .timeout(std::time::Duration::from_secs(15))
      .send()
      .await
      .context("Could not reach Athas models")?;
   let status = response.status();
   let body: Value = response
      .json()
      .await
      .context("Invalid Athas model catalog")?;
   if !status.is_success() {
      bail!(
         "Athas models returned {status}: {}",
         body["error"].as_str().unwrap_or("request failed")
      );
   }
   if body["enabled"] != true {
      bail!("Athas hosted models need Pro or pay-as-you-go credit");
   }
   Ok(body["data"]
      .as_array()
      .into_iter()
      .flatten()
      .filter_map(|item| Some((item["id"].as_str()?.into(), item["name"].as_str()?.into())))
      .collect())
}

async fn request_model(
   client: &reqwest::Client,
   options: &Options,
   messages: &[Value],
   sender: &mpsc::UnboundedSender<Event>,
) -> Result<Value> {
   let (url, key) = connection(options)?;
   let mut request = client.post(url).json(&json!({
      "model": options.model, "messages": messages, "tools": tools(), "tool_choice":"auto", "stream":true
   }));
   if let Some(key) = key {
      request = request.bearer_auth(key);
   }
   if options.provider == "athas" {
      request = request.header("X-Athas-Intelligence-Scope", "personal");
   }
   let response = request
      .send()
      .await
      .context("Could not reach model provider")?;
   let status = response.status();
   if !status.is_success() {
      let body: Value = response.json().await.context("Invalid model response")?;
      bail!(
         "Model provider returned {status}: {}",
         body["error"]["message"]
            .as_str()
            .or_else(|| body["error"].as_str())
            .unwrap_or("request failed")
      );
   }
   parse_model_stream(response, sender).await
}

#[derive(Default)]
struct ModelStream {
   pending: Vec<u8>,
   content: String,
   calls: Vec<Value>,
}

impl ModelStream {
   fn push(&mut self, chunk: &[u8], sender: &mpsc::UnboundedSender<Event>) -> Result<()> {
      self.pending.extend_from_slice(chunk);
      while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
         let line = self.pending.drain(..=end).collect::<Vec<_>>();
         let line = std::str::from_utf8(&line)?.trim();
         let Some(data) = line.strip_prefix("data: ") else {
            continue;
         };
         if data == "[DONE]" {
            continue;
         }
         let event: Value = serde_json::from_str(data).context("Invalid model stream event")?;
         let delta = &event["choices"][0]["delta"];
         if let Some(text) = delta["content"].as_str() {
            self.content.push_str(text);
            let _ = sender.send(Event::TextDelta(text.into()));
         }
         if let Some(parts) = delta["tool_calls"].as_array() {
            for part in parts {
               let index = part["index"].as_u64().unwrap_or(0) as usize;
               while self.calls.len() <= index {
                  self.calls.push(
                     json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
                  );
               }
               if let Some(id) = part["id"].as_str() {
                  self.calls[index]["id"] = json!(id);
               }
               for field in ["name", "arguments"] {
                  if let Some(fragment) = part["function"][field].as_str() {
                     let previous = self.calls[index]["function"][field].as_str().unwrap_or("");
                     self.calls[index]["function"][field] = json!(format!("{previous}{fragment}"));
                  }
               }
            }
         }
      }
      Ok(())
   }

   fn finish(self) -> Value {
      json!({"content":self.content,"role":"assistant","tool_calls":self.calls})
   }
}

async fn parse_model_stream(
   response: reqwest::Response,
   sender: &mpsc::UnboundedSender<Event>,
) -> Result<Value> {
   let mut stream = response.bytes_stream();
   let mut model = ModelStream::default();
   while let Some(chunk) = stream.next().await {
      model.push(&chunk.context("Model stream failed")?, sender)?;
   }
   Ok(model.finish())
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn reconstructs_split_streamed_text_and_tool_arguments() {
      let text = json!({"choices":[{"delta":{"content":"Merhaba"}}]});
      let first = json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1",
         "function":{"name":"read_","arguments":"{\"path\":"}}]}}]});
      let second = json!({"choices":[{"delta":{"tool_calls":[{"index":0,
         "function":{"name":"file","arguments":"\"src/main.rs\"}"}}]}}]});
      let body = format!("data: {text}\n\ndata: {first}\n\ndata: {second}\n\ndata: [DONE]\n\n");
      let split = body.find("Merhaba").unwrap() + 3;
      let parts = [&body.as_bytes()[..split], &body.as_bytes()[split..]];
      let (sender, mut events) = mpsc::unbounded_channel();
      let mut stream = ModelStream::default();
      for part in parts {
         stream.push(part, &sender).unwrap();
      }
      let result = stream.finish();
      assert_eq!(result["content"], "Merhaba");
      assert_eq!(result["tool_calls"][0]["function"]["name"], "read_file");
      assert_eq!(
         result["tool_calls"][0]["function"]["arguments"],
         "{\"path\":\"src/main.rs\"}"
      );
      assert!(matches!(events.try_recv(), Ok(Event::TextDelta(text)) if text == "Merhaba"));
   }
}

async fn ask(sender: &mpsc::UnboundedSender<Event>, description: String) -> bool {
   let (reply, response) = oneshot::channel();
   if sender.send(Event::Permission(description, reply)).is_err() {
      return false;
   }
   response.await.unwrap_or(false)
}

async fn execute_tool(
   options: &Options,
   name: &str,
   input: &Value,
   read_cache: &mut HashMap<String, Option<String>>,
   sender: &mpsc::UnboundedSender<Event>,
) -> Result<String> {
   let root = options
      .root
      .to_str()
      .context("Workspace path is not UTF-8")?;
   let path = input["path"].as_str().unwrap_or("");
   let result = match name {
      "list_files" => {
         let data = list_workspace_files(
            root,
            &ListFilesOptions {
               path: input["path"].as_str().map(str::to_owned),
               glob: input["glob"].as_str().map(str::to_owned),
               limit: Some(200),
               offset: None,
            },
         )
         .map_err(anyhow::Error::msg)?;
         serde_json::to_string(&data)?
      }
      "search_files" => {
         let query = input["query"].as_str().context("query is required")?;
         let data = search_workspace_files(
            root,
            &SearchOptions {
               query: query.into(),
               regex: false,
               case_sensitive: None,
               path: None,
               glob: input["glob"].as_str().map(str::to_owned),
               context_lines: Some(2),
               max_results: Some(80),
            },
         )
         .map_err(anyhow::Error::msg)?;
         serde_json::to_string(&data)?
      }
      "read_file" => {
         let content = read_workspace_file(root, path).map_err(anyhow::Error::msg)?;
         read_cache.insert(path.into(), Some(content.clone()));
         content
      }
      "write_file" => {
         if path.is_empty() {
            bail!("path is required");
         }
         let content = input["content"].as_str().context("content is required")?;
         let previous = read_cache.get(path).cloned();
         if previous.is_none() && options.root.join(path).exists() {
            bail!("Read an existing file before changing it");
         }
         if !ask(sender, format!("Write {path} ({} bytes)?", content.len())).await {
            bail!("User denied file write");
         }
         let written = write_workspace_file(root, path, previous.flatten().as_deref(), content)
            .map_err(anyhow::Error::msg)?;
         read_cache.insert(path.into(), Some(content.into()));
         serde_json::to_string(&written)?
      }
      "run_command" => {
         let command = input["command"].as_str().context("command is required")?;
         if !ask(sender, format!("Run: {command}?")).await {
            bail!("User denied command");
         }
         let output = run_workspace_command(root, command, &Uuid::new_v4().to_string())
            .await
            .map_err(anyhow::Error::msg)?;
         serde_json::to_string(&output)?
      }
      _ => bail!("Unknown tool {name}"),
   };
   Ok(result.chars().take(24_000).collect())
}

pub async fn run_turn(
   options: &Options,
   session: &mut Session,
   prompt: String,
   sender: mpsc::UnboundedSender<Event>,
) -> Result<()> {
   session.add("user", prompt.clone())?;
   let root = options.root.display();
   let mut messages = vec![json!({"role":"system","content":format!(
      "You are Athas Agent, a coding assistant working in {root}. Inspect before editing. \
       Keep edits scoped to the user's request. Never claim checks ran unless their results are visible. \
       Use relative workspace paths. Ask through tools before modifying files or running commands."
   )})];
   for message in session
      .messages
      .iter()
      .rev()
      .take(40)
      .collect::<Vec<_>>()
      .into_iter()
      .rev()
   {
      if matches!(message.role.as_str(), "user" | "assistant") {
         messages.push(json!({"role":message.role,"content":message.content}));
      }
   }
   let client = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(120))
      .build()?;
   let mut read_cache = HashMap::new();
   for step in 0..16 {
      let _ = sender.send(Event::Status(format!("Thinking · step {}", step + 1)));
      let message = request_model(&client, options, &messages, &sender).await?;
      if !message.is_object() {
         bail!("Model response had no message");
      }
      let content = message["content"].as_str().unwrap_or("");
      let calls = message["tool_calls"]
         .as_array()
         .cloned()
         .unwrap_or_default();
      if calls.is_empty() {
         if content.trim().is_empty() {
            bail!("Model returned an empty response");
         }
         session.add("assistant", content.into())?;
         let _ = sender.send(Event::Done);
         return Ok(());
      }
      messages.push(message);
      for call in calls {
         let name = call["function"]["name"].as_str().unwrap_or("unknown");
         let raw = call["function"]["arguments"].as_str().unwrap_or("{}");
         let _ = sender.send(Event::Tool(name.into()));
         let output = match serde_json::from_str::<Value>(raw) {
            Ok(input) => execute_tool(options, name, &input, &mut read_cache, &sender)
               .await
               .unwrap_or_else(|error| format!("Error: {error}")),
            Err(error) => format!("Invalid tool arguments: {error}"),
         };
         messages.push(json!({"role":"tool","tool_call_id":call["id"],"content":output}));
      }
   }
   bail!("Agent reached the 16-step limit")
}

pub async fn run_once(options: &Options, mut session: Session, prompt: String) -> Result<()> {
   let (sender, mut receiver) = mpsc::unbounded_channel();
   let worker_options = options.clone();
   let worker =
      tokio::spawn(async move { run_turn(&worker_options, &mut session, prompt, sender).await });
   while let Some(event) = receiver.recv().await {
      match event {
         Event::TextDelta(value) => {
            if options.format_json {
               println!("{}", json!({"type":"text_delta","text":value}));
            } else {
               print!("{value}");
               io::stdout().flush()?;
            }
         }
         Event::Tool(name) => {
            if options.format_json {
               println!("{}", json!({"type":"tool","name":name}));
            } else {
               eprintln!("\nTool: {name}");
            }
         }
         Event::Permission(description, reply) => {
            let approved = if crossterm::tty::IsTty::is_tty(&io::stdin()) {
               eprint!("{description} [y/N] ");
               io::stderr().flush()?;
               let mut line = String::new();
               io::stdin().read_line(&mut line)?;
               line.trim().eq_ignore_ascii_case("y")
            } else {
               false
            };
            let _ = reply.send(approved);
         }
         Event::Status(_) => {}
         Event::Done => {
            if !options.format_json {
               println!();
            }
         }
      }
   }
   worker.await??;
   Ok(())
}
