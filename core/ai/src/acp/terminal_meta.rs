//! Terminal output agents stream through tool call `_meta`, the extension the Claude and Codex
//! ACP adapters use (and Zed reads) when a client advertises `_meta.terminal_output`. The agent
//! runs the command itself; the client only shows it:
//!
//! - `tool_call._meta.terminal_info { terminal_id, cwd? }` starts a display-only terminal,
//! - `tool_call_update._meta.terminal_output { terminal_id, data }` appends output (Codex sends
//!   `terminal_output_delta` in the same shape for some commands),
//! - `tool_call_update._meta.terminal_exit { terminal_id, exit_code, signal }` ends it.

use super::types::AcpEvent;
use agent_client_protocol::schema::v1 as acp;
use serde_json::Value;

/// The `_meta` key a client sets in its capabilities to receive this extension.
pub(super) const TERMINAL_OUTPUT_META_KEY: &str = "terminal_output";

/// The terminal parts of one tool call notification's `_meta`.
#[derive(Debug, Default, PartialEq)]
pub(super) struct ToolTerminalMeta {
   /// `terminal_info`: the terminal id, and its working directory when given.
   pub started: Option<(String, Option<String>)>,
   pub output: Vec<(String, String)>,
   pub exit: Option<(String, Option<u32>, Option<String>)>,
}

fn terminal_id(value: &Value) -> Option<String> {
   value
      .get("terminal_id")
      .and_then(Value::as_str)
      .map(str::to_string)
}

impl ToolTerminalMeta {
   pub fn parse(meta: Option<&acp::Meta>) -> Self {
      let Some(meta) = meta else {
         return Self::default();
      };
      let started = meta.get("terminal_info").and_then(|info| {
         let cwd = info.get("cwd").and_then(Value::as_str).map(str::to_string);
         Some((terminal_id(info)?, cwd))
      });
      let output = ["terminal_output", "terminal_output_delta"]
         .into_iter()
         .filter_map(|key| {
            let value = meta.get(key)?;
            let data = value.get("data").and_then(Value::as_str)?;
            Some((terminal_id(value)?, data.to_string()))
         })
         .collect();
      let exit = meta.get("terminal_exit").and_then(|value| {
         let exit_code = value
            .get("exit_code")
            .and_then(Value::as_u64)
            .and_then(|code| u32::try_from(code).ok());
         let signal = value
            .get("signal")
            .and_then(Value::as_str)
            .map(str::to_string);
         Some((terminal_id(value)?, exit_code, signal))
      });
      Self {
         started,
         output,
         exit,
      }
   }

   /// The event that starts the display-only terminal, sent before the tool call event so the
   /// call's row finds it.
   pub fn start_event(&self, session_id: &str) -> Option<AcpEvent> {
      let (terminal_id, cwd) = self.started.as_ref()?;
      Some(AcpEvent::TerminalStarted {
         session_id: session_id.to_string(),
         terminal_id: terminal_id.clone(),
         cwd: cwd.clone(),
         display_only: true,
      })
   }

   /// Output and exit events, sent after the tool call event.
   pub fn update_events(self, session_id: &str) -> Vec<AcpEvent> {
      let output = self
         .output
         .into_iter()
         .map(|(terminal_id, data)| AcpEvent::TerminalOutput {
            session_id: session_id.to_string(),
            terminal_id,
            data,
         });
      let exit = self
         .exit
         .map(|(terminal_id, exit_code, signal)| AcpEvent::TerminalExit {
            session_id: session_id.to_string(),
            terminal_id,
            exit_code,
            signal,
         });
      output.chain(exit).collect()
   }
}

/// Makes a tool call that starts a display-only terminal show it: the call's content gets a
/// terminal item when the agent sent none, so its output appears in the call as it streams.
pub(super) fn with_terminal_content(output: Option<Value>, terminal_id: &str) -> Option<Value> {
   let item = serde_json::json!({ "type": "terminal", "terminalId": terminal_id });
   match output {
      Some(Value::Array(mut items)) => {
         let shown = items.iter().any(|existing| {
            existing.get("type") == Some(&Value::from("terminal"))
               && existing.get("terminalId") == Some(&Value::from(terminal_id))
         });
         if !shown {
            items.push(item);
         }
         Some(Value::Array(items))
      }
      None => Some(Value::Array(vec![item])),
      other => other,
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   fn meta(value: Value) -> acp::Meta {
      value.as_object().unwrap().clone()
   }

   #[test]
   fn reads_the_claude_and_codex_terminal_meta() {
      let info = ToolTerminalMeta::parse(Some(&meta(json!({
         "claudeCode": { "toolName": "Bash" },
         "terminal_info": { "terminal_id": "toolu_1" },
      }))));
      assert_eq!(info.started, Some(("toolu_1".to_string(), None)));
      assert!(matches!(
         info.start_event("s1"),
         Some(AcpEvent::TerminalStarted {
            display_only: true,
            ..
         })
      ));

      let codex = ToolTerminalMeta::parse(Some(&meta(json!({
         "terminal_info": { "terminal_id": "call_1", "cwd": "/work" },
      }))));
      assert_eq!(
         codex.started,
         Some(("call_1".to_string(), Some("/work".to_string())))
      );

      let finished = ToolTerminalMeta::parse(Some(&meta(json!({
         "terminal_output_delta": { "terminal_id": "call_1", "data": "a" },
         "terminal_output": { "terminal_id": "call_1", "data": "b" },
         "terminal_exit": { "terminal_id": "call_1", "exit_code": 2, "signal": null },
      }))));
      let events = serde_json::to_value(finished.update_events("s1")).unwrap();
      assert_eq!(
         events,
         json!([
            { "type": "terminal_output", "sessionId": "s1", "terminalId": "call_1", "data": "b" },
            { "type": "terminal_output", "sessionId": "s1", "terminalId": "call_1", "data": "a" },
            {
               "type": "terminal_exit",
               "sessionId": "s1",
               "terminalId": "call_1",
               "exitCode": 2,
               "signal": null,
            },
         ])
      );

      assert_eq!(ToolTerminalMeta::parse(None), ToolTerminalMeta::default());
      let partial = ToolTerminalMeta::parse(Some(&meta(json!({
         "terminal_output": { "data": "no id" },
      }))));
      assert!(partial.output.is_empty());
   }

   #[test]
   fn adds_the_terminal_to_content_that_lacks_it() {
      let terminal = json!({ "type": "terminal", "terminalId": "t1" });
      assert_eq!(with_terminal_content(None, "t1"), Some(json!([terminal])));
      let text = json!({ "type": "content", "content": { "type": "text", "text": "ls" } });
      assert_eq!(
         with_terminal_content(Some(json!([text])), "t1"),
         Some(json!([text, terminal]))
      );
      assert_eq!(
         with_terminal_content(Some(json!([terminal])), "t1"),
         Some(json!([terminal]))
      );
   }
}
