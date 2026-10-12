use crate::{
   host::{IdeHost, ToolError},
   selection::{EditorSelection, file_url},
};
use serde_json::{Map, Value, json};
use std::{
   path::Path,
   sync::{Arc, Mutex, MutexGuard},
};

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
const TOOL_ERROR: i64 = -32000;

const DEFAULT_PROTOCOL_VERSION: &str = "2025-03-26";
const SCHEMA_URI: &str = "http://json-schema.org/draft-07/schema#";

/// Editor state the server answers from without asking the frontend.
#[derive(Debug, Default)]
pub struct IdeState {
   inner: Mutex<StateInner>,
}

#[derive(Debug, Default)]
struct StateInner {
   workspace_folders: Vec<String>,
   current_selection: Option<EditorSelection>,
   latest_selection: Option<EditorSelection>,
}

impl IdeState {
   fn lock(&self) -> MutexGuard<'_, StateInner> {
      self
         .inner
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
   }

   pub fn workspace_folders(&self) -> Vec<String> {
      self.lock().workspace_folders.clone()
   }

   pub fn set_workspace_folders(&self, folders: Vec<String>) {
      self.lock().workspace_folders = folders;
   }

   /// Records the active editor's selection, or that no editor is active. Returns whether Claude
   /// should hear about it, which is only when an editor's selection actually changed.
   pub fn update_selection(&self, selection: Option<EditorSelection>) -> bool {
      let mut inner = self.lock();
      let Some(selection) = selection else {
         inner.current_selection = None;
         return false;
      };
      let changed = inner.latest_selection.as_ref() != Some(&selection);
      inner.current_selection = Some(selection.clone());
      inner.latest_selection = Some(selection);
      changed
   }

   fn current_selection(&self) -> Option<EditorSelection> {
      self.lock().current_selection.clone()
   }

   fn latest_selection(&self) -> Option<EditorSelection> {
      self.lock().latest_selection.clone()
   }
}

/// Answers Claude's JSON-RPC messages: the MCP handshake, the tool list, and tool calls.
pub struct McpHandler {
   host: Arc<dyn IdeHost>,
   state: Arc<IdeState>,
   server_version: String,
}

impl McpHandler {
   pub fn new(host: Arc<dyn IdeHost>, state: Arc<IdeState>, server_version: String) -> Self {
      Self {
         host,
         state,
         server_version,
      }
   }

   /// Handles one incoming text frame. Returns the response to send back, or None for
   /// notifications and for responses to requests the server made.
   pub async fn handle_text(&self, text: &str) -> Option<Value> {
      let message: Value = match serde_json::from_str(text) {
         Ok(message) => message,
         Err(_) => return Some(error_response(Value::Null, PARSE_ERROR, "Parse error")),
      };
      let Some(object) = message.as_object() else {
         return Some(error_response(
            Value::Null,
            INVALID_REQUEST,
            "Invalid Request",
         ));
      };
      let id = object.get("id").cloned().unwrap_or(Value::Null);
      if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
         return Some(error_response(id, INVALID_REQUEST, "Invalid Request"));
      }
      let method = object.get("method").and_then(Value::as_str)?;
      if id.is_null() {
         return None;
      }

      let params = object.get("params").cloned().unwrap_or(Value::Null);
      Some(match self.handle_request(method, params).await {
         Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
         Err((code, message)) => error_response(id, code, &message),
      })
   }

   /// The last selection, sent to a client as soon as it connects so it starts with context.
   pub fn latest_selection_notification(&self) -> Option<Value> {
      self
         .state
         .latest_selection()
         .map(|selection| notification("selection_changed", selection.to_protocol()))
   }

   async fn handle_request(&self, method: &str, params: Value) -> Result<Value, (i64, String)> {
      match method {
         "initialize" => Ok(self.initialize(&params)),
         "ping" => Ok(json!({})),
         "tools/list" => Ok(json!({ "tools": tool_definitions() })),
         "prompts/list" => Ok(json!({ "prompts": [] })),
         "resources/list" => Ok(json!({ "resources": [] })),
         "tools/call" => self.call_tool(params).await,
         _ => Err((METHOD_NOT_FOUND, format!("Method not found: {method}"))),
      }
   }

   fn initialize(&self, params: &Value) -> Value {
      let protocol_version = params
         .get("protocolVersion")
         .and_then(Value::as_str)
         .unwrap_or(DEFAULT_PROTOCOL_VERSION);
      json!({
         "protocolVersion": protocol_version,
         "capabilities": {
            "logging": {},
            "prompts": { "listChanged": true },
            "tools": { "listChanged": true },
         },
         "serverInfo": { "name": "athas", "version": self.server_version },
      })
   }

   async fn call_tool(&self, params: Value) -> Result<Value, (i64, String)> {
      let name = params
         .get("name")
         .and_then(Value::as_str)
         .ok_or_else(|| (INVALID_PARAMS, "Missing tool name".to_string()))?
         .to_string();
      let arguments = match params.get("arguments") {
         None | Some(Value::Null) => Value::Object(Map::new()),
         Some(Value::Object(arguments)) => Value::Object(arguments.clone()),
         Some(_) => return Err((INVALID_PARAMS, "Tool arguments must be an object".into())),
      };

      let texts = match name.as_str() {
         "getWorkspaceFolders" => vec![self.workspace_folders_result()],
         "getCurrentSelection" => vec![selection_result(
            self.state.current_selection(),
            "No active editor found",
         )],
         "getLatestSelection" => vec![selection_result(
            self.state.latest_selection(),
            "No selection available",
         )],
         _ => {
            let Some(required) = editor_tool_required_args(&name) else {
               return Err((METHOD_NOT_FOUND, format!("Tool not found: {name}")));
            };
            validate_arguments(&arguments, required)?;
            self
               .host
               .call_tool(&name, arguments)
               .await
               .map_err(tool_error)?
         }
      };

      let content: Vec<Value> = texts
         .into_iter()
         .map(|text| json!({ "type": "text", "text": text }))
         .collect();
      Ok(json!({ "content": content }))
   }

   fn workspace_folders_result(&self) -> String {
      let folders = self.state.workspace_folders();
      let entries: Vec<Value> = folders
         .iter()
         .map(|path| {
            let name = Path::new(path)
               .file_name()
               .map(|name| name.to_string_lossy().into_owned())
               .unwrap_or_else(|| path.clone());
            json!({ "name": name, "uri": file_url(path), "path": path })
         })
         .collect();
      json!({
         "success": true,
         "folders": entries,
         "rootPath": folders.first(),
      })
      .to_string()
   }
}

/// The tools the frontend answers, with the string arguments each one requires. `close_tab` is
/// internal: Claude calls it to close the diff it opened, but it is not advertised.
fn editor_tool_required_args(name: &str) -> Option<&'static [&'static str]> {
   Some(match name {
      "openFile" | "checkDocumentDirty" | "saveDocument" => &["filePath"],
      "openDiff" => &[
         "old_file_path",
         "new_file_path",
         "new_file_contents",
         "tab_name",
      ],
      "close_tab" => &["tab_name"],
      "getOpenEditors" | "getDiagnostics" | "closeAllDiffTabs" => &[],
      _ => return None,
   })
}

fn validate_arguments(arguments: &Value, required: &[&str]) -> Result<(), (i64, String)> {
   for name in required {
      if !arguments.get(*name).is_some_and(Value::is_string) {
         return Err((
            INVALID_PARAMS,
            format!("Missing required string parameter: {name}"),
         ));
      }
   }
   Ok(())
}

fn tool_error(error: ToolError) -> (i64, String) {
   match error {
      ToolError::InvalidParams(message) => (INVALID_PARAMS, message),
      ToolError::Failed(message) => (TOOL_ERROR, message),
      ToolError::Unavailable => (
         TOOL_ERROR,
         "Athas did not answer; make sure an editor window is open".to_string(),
      ),
   }
}

fn selection_result(selection: Option<EditorSelection>, missing: &str) -> String {
   match selection {
      Some(selection) => {
         let mut value = selection.to_protocol();
         value["success"] = Value::Bool(true);
         value.to_string()
      }
      None => json!({ "success": false, "message": missing }).to_string(),
   }
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
   json!({
      "jsonrpc": "2.0",
      "id": id,
      "error": { "code": code, "message": message },
   })
}

pub fn notification(method: &str, params: Value) -> Value {
   json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

fn object_schema(properties: Value, required: &[&str]) -> Value {
   json!({
      "type": "object",
      "properties": properties,
      "required": required,
      "additionalProperties": false,
      "$schema": SCHEMA_URI,
   })
}

fn tool(name: &str, description: &str, input_schema: Value) -> Value {
   json!({ "name": name, "description": description, "inputSchema": input_schema })
}

fn file_path_property(description: &str) -> Value {
   json!({ "filePath": { "type": "string", "description": description } })
}

pub fn tool_definitions() -> Vec<Value> {
   let no_input = || object_schema(json!({}), &[]);
   vec![
      tool(
         "openFile",
         "Open a file in the editor and optionally select a range of text",
         object_schema(
            json!({
               "filePath": { "type": "string", "description": "Path to the file to open" },
               "preview": {
                  "type": "boolean",
                  "description": "Whether to open the file in preview mode",
                  "default": false,
               },
               "startLine": {
                  "type": "integer",
                  "description": "Optional: Line number to start selection",
               },
               "endLine": {
                  "type": "integer",
                  "description": "Optional: Line number to end selection",
               },
               "startText": {
                  "type": "string",
                  "description": "Text pattern to find the start of the selection range. \
                     Selects from the beginning of this match.",
               },
               "endText": {
                  "type": "string",
                  "description": "Text pattern to find the end of the selection range. Selects \
                     up to the end of this match. If not provided, only the startText match \
                     will be selected.",
               },
               "selectToEndOfLine": {
                  "type": "boolean",
                  "description": "If true, selection will extend to the end of the line \
                     containing the endText match.",
                  "default": false,
               },
               "makeFrontmost": {
                  "type": "boolean",
                  "description": "Whether to make the file the active editor tab. If false, \
                     the file will be opened in the background without changing focus.",
                  "default": true,
               },
            }),
            &["filePath"],
         ),
      ),
      tool(
         "openDiff",
         "Open a diff view comparing old file content with new file content",
         object_schema(
            json!({
               "old_file_path": {
                  "type": "string",
                  "description": "Path to the old file to compare",
               },
               "new_file_path": {
                  "type": "string",
                  "description": "Path to the new file to compare",
               },
               "new_file_contents": {
                  "type": "string",
                  "description": "Contents for the new file version",
               },
               "tab_name": { "type": "string", "description": "Name for the diff tab/view" },
            }),
            &[
               "old_file_path",
               "new_file_path",
               "new_file_contents",
               "tab_name",
            ],
         ),
      ),
      tool(
         "getCurrentSelection",
         "Get the current text selection in the editor",
         no_input(),
      ),
      tool(
         "getLatestSelection",
         "Get the most recent text selection (even if not in the active editor)",
         no_input(),
      ),
      tool(
         "getOpenEditors",
         "Get list of currently open files",
         no_input(),
      ),
      tool(
         "getWorkspaceFolders",
         "Get all workspace folders currently open in the IDE",
         no_input(),
      ),
      tool(
         "getDiagnostics",
         "Get language diagnostics (errors, warnings) from the editor",
         object_schema(
            json!({
               "uri": {
                  "type": "string",
                  "description": "Optional file URI to get diagnostics for. If not provided, \
                     gets diagnostics for all open files.",
               },
            }),
            &[],
         ),
      ),
      tool(
         "checkDocumentDirty",
         "Check if a document has unsaved changes (is dirty)",
         object_schema(
            file_path_property("Path to the file to check"),
            &["filePath"],
         ),
      ),
      tool(
         "saveDocument",
         "Save a document with unsaved changes",
         object_schema(
            file_path_property("Path to the file to save"),
            &["filePath"],
         ),
      ),
      tool(
         "closeAllDiffTabs",
         "Close all diff tabs in the editor",
         no_input(),
      ),
   ]
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::selection::SelectionPosition;
   use async_trait::async_trait;

   #[derive(Default)]
   struct FakeHost {
      calls: Mutex<Vec<(String, Value)>>,
      failure: Option<ToolError>,
   }

   #[async_trait]
   impl IdeHost for FakeHost {
      async fn call_tool(&self, tool: &str, arguments: Value) -> Result<Vec<String>, ToolError> {
         self
            .calls
            .lock()
            .unwrap()
            .push((tool.to_string(), arguments));
         match &self.failure {
            Some(error) => Err(error.clone()),
            None => Ok(vec![format!("ran {tool}")]),
         }
      }
   }

   fn handler_with(host: FakeHost) -> (McpHandler, Arc<FakeHost>, Arc<IdeState>) {
      let host = Arc::new(host);
      let state = Arc::new(IdeState::default());
      let handler = McpHandler::new(host.clone(), state.clone(), "1.2.3".to_string());
      (handler, host, state)
   }

   async fn request(handler: &McpHandler, method: &str, params: Value) -> Value {
      let message = json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params });
      handler.handle_text(&message.to_string()).await.unwrap()
   }

   async fn call(handler: &McpHandler, name: &str, arguments: Value) -> Value {
      request(
         handler,
         "tools/call",
         json!({ "name": name, "arguments": arguments }),
      )
      .await
   }

   fn first_text_json(response: &Value) -> Value {
      let text = response["result"]["content"][0]["text"].as_str().unwrap();
      serde_json::from_str(text).unwrap()
   }

   fn selection(text: &str) -> EditorSelection {
      EditorSelection {
         file_path: "/work/a.ts".to_string(),
         text: text.to_string(),
         start: SelectionPosition {
            line: 1,
            character: 0,
         },
         end: SelectionPosition {
            line: 1,
            character: text.len() as u32,
         },
      }
   }

   #[tokio::test]
   async fn initialize_echoes_the_protocol_version_and_names_athas() {
      let (handler, ..) = handler_with(FakeHost::default());
      let response = request(
         &handler,
         "initialize",
         json!({ "protocolVersion": "2025-06-18" }),
      )
      .await;
      assert_eq!(response["id"], 7);
      assert_eq!(response["result"]["protocolVersion"], "2025-06-18");
      assert_eq!(response["result"]["serverInfo"]["name"], "athas");
      assert!(response["result"]["capabilities"]["tools"].is_object());
   }

   #[tokio::test]
   async fn tool_list_advertises_the_editor_tools_but_not_close_tab() {
      let (handler, ..) = handler_with(FakeHost::default());
      let response = request(&handler, "tools/list", Value::Null).await;
      let names: Vec<&str> = response["result"]["tools"]
         .as_array()
         .unwrap()
         .iter()
         .map(|tool| tool["name"].as_str().unwrap())
         .collect();
      assert_eq!(
         names,
         [
            "openFile",
            "openDiff",
            "getCurrentSelection",
            "getLatestSelection",
            "getOpenEditors",
            "getWorkspaceFolders",
            "getDiagnostics",
            "checkDocumentDirty",
            "saveDocument",
            "closeAllDiffTabs",
         ]
      );
   }

   #[tokio::test]
   async fn notifications_and_client_responses_get_no_reply() {
      let (handler, ..) = handler_with(FakeHost::default());
      let notification = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
      assert_eq!(handler.handle_text(&notification.to_string()).await, None);
      let response = json!({ "jsonrpc": "2.0", "id": 1, "result": {} });
      assert_eq!(handler.handle_text(&response.to_string()).await, None);
   }

   #[tokio::test]
   async fn malformed_messages_get_json_rpc_errors() {
      let (handler, ..) = handler_with(FakeHost::default());
      let parse = handler.handle_text("{not json").await.unwrap();
      assert_eq!(parse["error"]["code"], PARSE_ERROR);
      let version = handler
         .handle_text(r#"{"jsonrpc":"1.0","id":3,"method":"ping"}"#)
         .await
         .unwrap();
      assert_eq!(version["error"]["code"], INVALID_REQUEST);
      assert_eq!(version["id"], 3);
      let unknown = request(&handler, "resources/read", Value::Null).await;
      assert_eq!(unknown["error"]["code"], METHOD_NOT_FOUND);
   }

   #[tokio::test]
   async fn editor_tools_go_to_the_host_and_come_back_as_text_content() {
      let (handler, host, _) = handler_with(FakeHost::default());
      let response = call(&handler, "openFile", json!({ "filePath": "/work/a.ts" })).await;
      assert_eq!(
         response["result"],
         json!({ "content": [{ "type": "text", "text": "ran openFile" }] })
      );
      assert_eq!(
         host.calls.lock().unwrap()[0],
         ("openFile".to_string(), json!({ "filePath": "/work/a.ts" }))
      );

      let close = call(&handler, "close_tab", json!({ "tab_name": "x" })).await;
      assert_eq!(close["result"]["content"][0]["text"], "ran close_tab");
   }

   #[tokio::test]
   async fn missing_required_arguments_never_reach_the_host() {
      let (handler, host, _) = handler_with(FakeHost::default());
      let response = call(
         &handler,
         "openDiff",
         json!({ "old_file_path": "/a", "new_file_path": "/a", "tab_name": "t" }),
      )
      .await;
      assert_eq!(response["error"]["code"], INVALID_PARAMS);
      let response = call(&handler, "saveDocument", json!({ "filePath": 3 })).await;
      assert_eq!(response["error"]["code"], INVALID_PARAMS);
      assert!(host.calls.lock().unwrap().is_empty());
   }

   #[tokio::test]
   async fn unsupported_tools_are_reported_as_not_found() {
      let (handler, host, _) = handler_with(FakeHost::default());
      let response = call(&handler, "executeCode", json!({ "code": "1" })).await;
      assert_eq!(response["error"]["code"], METHOD_NOT_FOUND);
      assert_eq!(response["error"]["message"], "Tool not found: executeCode");
      assert!(host.calls.lock().unwrap().is_empty());
   }

   #[tokio::test]
   async fn host_failures_become_tool_errors() {
      let (handler, ..) = handler_with(FakeHost {
         failure: Some(ToolError::Unavailable),
         ..FakeHost::default()
      });
      let response = call(&handler, "getOpenEditors", json!({})).await;
      assert_eq!(response["error"]["code"], TOOL_ERROR);
   }

   #[tokio::test]
   async fn workspace_folders_come_from_server_state() {
      let (handler, host, state) = handler_with(FakeHost::default());
      state.set_workspace_folders(vec!["/work/app".to_string(), "/work/lib".to_string()]);
      let response = call(&handler, "getWorkspaceFolders", Value::Null).await;
      assert_eq!(
         first_text_json(&response),
         json!({
            "success": true,
            "folders": [
               { "name": "app", "uri": "file:///work/app", "path": "/work/app" },
               { "name": "lib", "uri": "file:///work/lib", "path": "/work/lib" },
            ],
            "rootPath": "/work/app",
         })
      );
      assert!(host.calls.lock().unwrap().is_empty());
   }

   #[tokio::test]
   async fn selections_track_the_active_editor_and_remember_the_last_one() {
      let (handler, _, state) = handler_with(FakeHost::default());
      let none = call(&handler, "getCurrentSelection", json!({})).await;
      assert_eq!(first_text_json(&none)["success"], false);

      assert!(state.update_selection(Some(selection("abc"))));
      assert!(!state.update_selection(Some(selection("abc"))));
      let current = first_text_json(&call(&handler, "getCurrentSelection", json!({})).await);
      assert_eq!(current["success"], true);
      assert_eq!(current["text"], "abc");
      assert_eq!(current["selection"]["end"]["character"], 3);

      assert!(!state.update_selection(None));
      let current = first_text_json(&call(&handler, "getCurrentSelection", json!({})).await);
      assert_eq!(current["message"], "No active editor found");
      let latest = first_text_json(&call(&handler, "getLatestSelection", json!({})).await);
      assert_eq!(latest["text"], "abc");
   }
}
