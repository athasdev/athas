use std::sync::{Arc, Mutex};

use crate::*;

#[derive(Clone)]
struct TestClient {
    permission_responses: Arc<Mutex<Vec<RequestPermissionOutcome>>>,
    file_contents: Arc<Mutex<std::collections::HashMap<std::path::PathBuf, String>>>,
    written_files: Arc<Mutex<Vec<(std::path::PathBuf, String)>>>,
    session_notifications: Arc<Mutex<Vec<SessionNotification>>>,
    extension_notifications: Arc<Mutex<Vec<(String, ExtNotification)>>>,
}

impl TestClient {
    fn new() -> Self {
        Self {
            permission_responses: Arc::new(Mutex::new(Vec::new())),
            file_contents: Arc::new(Mutex::new(std::collections::HashMap::new())),
            written_files: Arc::new(Mutex::new(Vec::new())),
            session_notifications: Arc::new(Mutex::new(Vec::new())),
            extension_notifications: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn add_permission_response(&self, outcome: RequestPermissionOutcome) {
        self.permission_responses.lock().unwrap().push(outcome);
    }

    fn add_file_content(&self, path: std::path::PathBuf, content: String) {
        self.file_contents.lock().unwrap().insert(path, content);
    }
}

macro_rules! raw_json {
    ($($json:tt)+) => {{
        let response = serde_json::json!($($json)+);
        serde_json::value::to_raw_value(&response).unwrap().into()
    }};
}

#[async_trait::async_trait(?Send)]
impl Client for TestClient {
    async fn request_permission(
        &self,
        _arguments: RequestPermissionRequest,
    ) -> Result<RequestPermissionResponse> {
        let responses = self.permission_responses.clone();
        let mut responses = responses.lock().unwrap();
        let outcome = responses
            .pop()
            .unwrap_or(RequestPermissionOutcome::Cancelled);
        Ok(RequestPermissionResponse::new(outcome))
    }

    async fn write_text_file(
        &self,
        arguments: WriteTextFileRequest,
    ) -> Result<WriteTextFileResponse> {
        self.written_files
            .lock()
            .unwrap()
            .push((arguments.path, arguments.content));
        Ok(WriteTextFileResponse::default())
    }

    async fn read_text_file(&self, arguments: ReadTextFileRequest) -> Result<ReadTextFileResponse> {
        let contents = self.file_contents.lock().unwrap();
        let content = contents
            .get(&arguments.path)
            .cloned()
            .unwrap_or_else(|| "default content".to_string());
        Ok(ReadTextFileResponse::new(content))
    }

    async fn session_notification(&self, args: SessionNotification) -> Result<()> {
        self.session_notifications.lock().unwrap().push(args);
        Ok(())
    }

    async fn create_terminal(
        &self,
        _args: CreateTerminalRequest,
    ) -> Result<CreateTerminalResponse> {
        unimplemented!()
    }

    async fn terminal_output(
        &self,
        _args: TerminalOutputRequest,
    ) -> Result<TerminalOutputResponse> {
        unimplemented!()
    }

    async fn kill_terminal_command(
        &self,
        _args: KillTerminalCommandRequest,
    ) -> Result<KillTerminalCommandResponse> {
        unimplemented!()
    }

    async fn release_terminal(
        &self,
        _args: ReleaseTerminalRequest,
    ) -> Result<ReleaseTerminalResponse> {
        unimplemented!()
    }

    async fn wait_for_terminal_exit(
        &self,
        _args: WaitForTerminalExitRequest,
    ) -> Result<WaitForTerminalExitResponse> {
        unimplemented!()
    }

    async fn ext_method(&self, args: ExtRequest) -> Result<ExtResponse> {
        match dbg!(args.method.as_ref()) {
            "example.com/ping" => Ok(ExtResponse::new(raw_json!({
                "response": "pong",
                "params": args.params
            }))),
            _ => Err(Error::method_not_found()),
        }
    }

    async fn ext_notification(&self, args: ExtNotification) -> Result<()> {
        self.extension_notifications
            .lock()
            .unwrap()
            .push((args.method.to_string(), args));
        Ok(())
    }
}

#[derive(Clone)]
struct TestAgent {
    sessions: Arc<Mutex<std::collections::HashMap<SessionId, std::path::PathBuf>>>,
    prompts_received: Arc<Mutex<Vec<PromptReceived>>>,
    cancellations_received: Arc<Mutex<Vec<SessionId>>>,
    extension_notifications: Arc<Mutex<Vec<(String, ExtNotification)>>>,
}

type PromptReceived = (SessionId, Vec<ContentBlock>);

impl TestAgent {
    fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
            prompts_received: Arc::new(Mutex::new(Vec::new())),
            cancellations_received: Arc::new(Mutex::new(Vec::new())),
            extension_notifications: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl Agent for TestAgent {
    async fn initialize(&self, arguments: InitializeRequest) -> Result<InitializeResponse> {
        Ok(InitializeResponse::new(arguments.protocol_version)
            .agent_info(Implementation::new("test-agent", "0.0.0").title("Test Agent")))
    }

    async fn authenticate(&self, _arguments: AuthenticateRequest) -> Result<AuthenticateResponse> {
        Ok(AuthenticateResponse::default())
    }

    async fn new_session(&self, arguments: NewSessionRequest) -> Result<NewSessionResponse> {
        let session_id = SessionId::new("test-session-123");
        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), arguments.cwd);
        Ok(NewSessionResponse::new(session_id))
    }

    async fn load_session(&self, _: LoadSessionRequest) -> Result<LoadSessionResponse> {
        Ok(LoadSessionResponse::new())
    }

    async fn set_session_mode(
        &self,
        _arguments: SetSessionModeRequest,
    ) -> Result<SetSessionModeResponse> {
        Ok(SetSessionModeResponse::new())
    }

    async fn prompt(&self, arguments: PromptRequest) -> Result<PromptResponse> {
        self.prompts_received
            .lock()
            .unwrap()
            .push((arguments.session_id, arguments.prompt));
        Ok(PromptResponse::new(StopReason::EndTurn))
    }

    async fn cancel(&self, args: CancelNotification) -> Result<()> {
        self.cancellations_received
            .lock()
            .unwrap()
            .push(args.session_id);
        Ok(())
    }

    #[cfg(feature = "unstable_session_model")]
    async fn set_session_model(
        &self,
        args: agent_client_protocol_schema::SetSessionModelRequest,
    ) -> Result<agent_client_protocol_schema::SetSessionModelResponse> {
        log::info!("Received select model request {args:?}");
        Ok(agent_client_protocol_schema::SetSessionModelResponse::default())
    }

    #[cfg(feature = "unstable_session_list")]
    async fn list_sessions(
        &self,
        _args: agent_client_protocol_schema::ListSessionsRequest,
    ) -> Result<agent_client_protocol_schema::ListSessionsResponse> {
        let sessions = self.sessions.lock().unwrap();
        let session_infos: Vec<_> = sessions
            .iter()
            .map(|(id, cwd)| {
                agent_client_protocol_schema::SessionInfo::new(id.clone(), cwd.clone())
            })
            .collect();
        Ok(agent_client_protocol_schema::ListSessionsResponse::new(
            session_infos,
        ))
    }

    #[cfg(feature = "unstable_session_fork")]
    async fn fork_session(
        &self,
        args: agent_client_protocol_schema::ForkSessionRequest,
    ) -> Result<agent_client_protocol_schema::ForkSessionResponse> {
        let new_session_id = SessionId::new(format!("fork-of-{}", args.session_id.0));
        self.sessions
            .lock()
            .unwrap()
            .insert(new_session_id.clone(), args.cwd);
        Ok(agent_client_protocol_schema::ForkSessionResponse::new(
            new_session_id,
        ))
    }

    #[cfg(feature = "unstable_session_resume")]
    async fn resume_session(
        &self,
        args: agent_client_protocol_schema::ResumeSessionRequest,
    ) -> Result<agent_client_protocol_schema::ResumeSessionResponse> {
        // Check if session exists
        if !self.sessions.lock().unwrap().contains_key(&args.session_id) {
            return Err(Error::invalid_params());
        }
        Ok(agent_client_protocol_schema::ResumeSessionResponse::new())
    }

    #[cfg(feature = "unstable_session_config_options")]
    async fn set_session_config_option(
        &self,
        args: agent_client_protocol_schema::SetSessionConfigOptionRequest,
    ) -> Result<agent_client_protocol_schema::SetSessionConfigOptionResponse> {
        Ok(
            agent_client_protocol_schema::SetSessionConfigOptionResponse::new(vec![
                agent_client_protocol_schema::SessionConfigOption::select(
                    args.config_id,
                    "Test Option",
                    args.value,
                    vec![
                        agent_client_protocol_schema::SessionConfigSelectOption::new(
                            "value1", "Value 1",
                        ),
                        agent_client_protocol_schema::SessionConfigSelectOption::new(
                            "value2", "Value 2",
                        ),
                    ],
                ),
            ]),
        )
    }

    async fn ext_method(&self, args: ExtRequest) -> Result<ExtResponse> {
        dbg!();
        match dbg!(args.method.as_ref()) {
            "example.com/echo" => {
                let response = serde_json::json!({
                    "echo": args.params
                });
                Ok(ExtResponse::new(
                    serde_json::value::to_raw_value(&response)?.into(),
                ))
            }
            _ => Err(Error::method_not_found()),
        }
    }

    async fn ext_notification(&self, args: ExtNotification) -> Result<()> {
        self.extension_notifications
            .lock()
            .unwrap()
            .push((args.method.to_string(), args));
        Ok(())
    }
}

// Helper function to create a bidirectional connection
fn create_connection_pair(
    client: &TestClient,
    agent: &TestAgent,
) -> (ClientSideConnection, AgentSideConnection) {
    let (client_to_agent_rx, client_to_agent_tx) = piper::pipe(1024);
    let (agent_to_client_rx, agent_to_client_tx) = piper::pipe(1024);

    let (agent_conn, agent_io_task) = ClientSideConnection::new(
        client.clone(),
        client_to_agent_tx,
        agent_to_client_rx,
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );

    let (client_conn, client_io_task) = AgentSideConnection::new(
        agent.clone(),
        agent_to_client_tx,
        client_to_agent_rx,
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );

    // Spawn the IO tasks
    tokio::task::spawn_local(agent_io_task);
    tokio::task::spawn_local(client_io_task);

    (agent_conn, client_conn)
}

#[tokio::test]
async fn test_initialize() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (agent_conn, _client_conn) = create_connection_pair(&client, &agent);

            let result =
                agent_conn
                    .initialize(InitializeRequest::new(ProtocolVersion::LATEST).client_info(
                        Implementation::new("test-client", "0.0.0").title("Test Client"),
                    ))
                    .await;

            assert!(result.is_ok());
            let response = result.unwrap();
            assert_eq!(response.protocol_version, ProtocolVersion::LATEST);
        })
        .await;
}

#[tokio::test]
async fn test_basic_session_creation() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (agent_conn, _client_conn) = create_connection_pair(&client, &agent);

            agent_conn
                .new_session(NewSessionRequest::new("/test"))
                .await
                .expect("new_session failed");
        })
        .await;
}

#[tokio::test]
async fn test_bidirectional_file_operations() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            // Add test file content
            let test_path = std::path::PathBuf::from("/test/file.txt");
            client.add_file_content(test_path.clone(), "Hello, World!".to_string());

            let (_agent_conn, client_conn) = create_connection_pair(&client, &agent);

            // Test reading a file
            let session_id = SessionId::new("test-session");
            let read_result = client_conn
                .read_text_file(ReadTextFileRequest::new(session_id.clone(), &test_path))
                .await
                .expect("read_text_file failed");

            assert_eq!(read_result.content, "Hello, World!");

            // Test writing a file
            let write_result = client_conn
                .write_text_file(WriteTextFileRequest::new(
                    session_id.clone(),
                    &test_path,
                    "Updated content",
                ))
                .await;

            assert!(write_result.is_ok());
        })
        .await;
}

#[tokio::test]
async fn test_session_notifications() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (_agent_conn, client_conn) = create_connection_pair(&client, &agent);

            let session_id = SessionId::new("test-session");
            // Send various session updates
            client_conn
                .session_notification(SessionNotification::new(
                    session_id.clone(),
                    SessionUpdate::UserMessageChunk(ContentChunk::new("Hello from user".into())),
                ))
                .await
                .expect("session_notification failed");

            client_conn
                .session_notification(SessionNotification::new(
                    session_id.clone(),
                    SessionUpdate::AgentMessageChunk(ContentChunk::new("Hello from agent".into())),
                ))
                .await
                .expect("session_notification failed");

            tokio::task::yield_now().await;

            let notifications = client.session_notifications.lock().unwrap();
            assert_eq!(notifications.len(), 2);
            assert_eq!(notifications[0].session_id, session_id);
            assert_eq!(notifications[1].session_id, session_id);
        })
        .await;
}

#[tokio::test]
async fn test_cancel_notification() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (agent_conn, _client_conn) = create_connection_pair(&client, &agent);

            let session_id = SessionId::new("test-session");
            // Send cancel notification
            agent_conn
                .cancel(CancelNotification::new(session_id.clone()))
                .await
                .expect("cancel failed");

            tokio::task::yield_now().await;

            let cancelled = agent.cancellations_received.lock().unwrap();
            assert_eq!(cancelled.len(), 1);
            assert_eq!(cancelled[0], session_id);
        })
        .await;
}

#[tokio::test]
async fn test_concurrent_operations() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            // Add multiple file contents
            for i in 0..5 {
                let path = std::path::PathBuf::from(format!("/test/file{i}.txt"));
                client.add_file_content(path, format!("Content {i}"));
            }

            let (_agent_conn, client_conn) = create_connection_pair(&client, &agent);

            let session_id = SessionId::new("test-session");

            // Launch multiple concurrent read operations
            let mut read_futures = vec![];
            for i in 0..5 {
                let path = std::path::PathBuf::from(format!("/test/file{i}.txt"));
                let future =
                    client_conn.read_text_file(ReadTextFileRequest::new(session_id.clone(), path));
                read_futures.push(future);
            }

            // Wait for all reads to complete
            let results = futures::future::join_all(read_futures).await;

            // Verify all reads succeeded
            for (i, result) in results.into_iter().enumerate() {
                let output = result.expect("read failed");
                assert_eq!(output.content, format!("Content {i}"));
            }
        })
        .await;
}

#[tokio::test]
async fn test_full_conversation_flow() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            // Set up permission to approve the tool call
            client.add_permission_response(RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(PermissionOptionId::new("allow-once"))));

            let (agent_conn, client_conn) = create_connection_pair(&client, &agent);
            // 1. Start new session
            let new_session_result = agent_conn
                .new_session(NewSessionRequest::new("/test"))
                .await
                .expect("new_session failed");

            let session_id = new_session_result.session_id;

            // 2. Send user message
            let user_prompt = vec!["Please analyze the file and summarize it".into()];

            agent_conn
                .prompt(PromptRequest::new(session_id.clone(), user_prompt))
                .await
                .expect("prompt failed");

            // 3. Agent starts responding
            client_conn
                .session_notification(SessionNotification::new(session_id.clone(), SessionUpdate::AgentMessageChunk(ContentChunk::new("I'll analyze the file for you. ".into()))))
                .await
                .expect("session_notification failed");

            // 4. Agent creates a tool call
            let tool_call_id = ToolCallId::new("read-file-001");
            client_conn
                .session_notification(SessionNotification::new(session_id.clone(), SessionUpdate::ToolCall(ToolCall::new(tool_call_id.clone(), "Reading file").kind(ToolKind::Read).locations(vec![ToolCallLocation::new("/test/data.txt")]))))
                .await
                .expect("session_notification failed");

            // 5. Agent requests permission for the tool call
            let permission_result = client_conn
                .request_permission(RequestPermissionRequest::new(session_id.clone(), ToolCallUpdate::new(tool_call_id.clone(), ToolCallUpdateFields::new().title("Read /test/data.txt").locations(vec![ToolCallLocation::new("/test/data.txt")])), vec![
                        PermissionOption::new(PermissionOptionId::new("allow-once"), "Allow once", PermissionOptionKind::AllowOnce),
                        PermissionOption::new(
                            PermissionOptionId::new("reject-once"),
                             "Reject",
                             PermissionOptionKind::RejectOnce,
                        ),
                    ],
                ))
                .await
                .expect("request_permission failed");

            // Verify permission was granted
            match permission_result.outcome {
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome { option_id, .. }) => {
                    assert_eq!(option_id.0.as_ref(), "allow-once");
                }
                _ => panic!("Expected permission to be granted"),
            }

            // 6. Update tool call status
            client_conn
                .session_notification(SessionNotification::new(
                     session_id.clone(),
                     SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                         tool_call_id.clone(),
                         ToolCallUpdateFields::new().status(ToolCallStatus::InProgress),
                    ))))
                .await
                .expect("session_notification failed");

            // 7. Tool call completes with content
            client_conn
                .session_notification(SessionNotification::new(
                     session_id.clone(),
                     SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(tool_call_id.clone(), ToolCallUpdateFields::new().status(ToolCallStatus::Completed).content(vec!["File contents: Lorem ipsum dolor sit amet".into()])))))
                .await
                .expect("session_notification failed");

            // 8. Agent sends more text after tool completion
            client_conn
                .session_notification(SessionNotification::new(
                     session_id.clone(),
                    SessionUpdate::AgentMessageChunk(ContentChunk::new("Based on the file contents, here's my summary: The file contains placeholder text commonly used in the printing industry.".into()))))
                .await
                .expect("session_notification failed");

            for _ in 0..10 {
                tokio::task::yield_now().await;
            }

            // Verify we received all the updates
            let updates = client.session_notifications.lock().unwrap();
            assert!(updates.len() >= 5); // At least 5 updates sent

            // Verify the sequence of updates
            let mut found_agent_message = false;
            let mut found_tool_call = false;
            let mut found_tool_update = false;
            let mut found_final_message = false;

            for notification in updates.iter() {
                match &notification.update {
                    SessionUpdate::AgentMessageChunk(ContentChunk { content : ContentBlock::Text(text), ..}) => {
                        if text.text.contains("I'll analyze") {
                            found_agent_message = true;
                        } else if text.text.contains("Based on the file") {
                            found_final_message = true;
                        }
                    }
                    SessionUpdate::ToolCall(_) => {
                        found_tool_call = true;
                    }
                    SessionUpdate::ToolCallUpdate(update) => {
                        if let Some(ToolCallStatus::Completed) = update.fields.status {
                            found_tool_update = true;
                        }
                    }
                    _ => {}
                }
            }

            assert!(found_agent_message, "Should have initial agent message");
            assert!(found_tool_call, "Should have tool call");
            assert!(found_tool_update, "Should have tool call completion");
            assert!(found_final_message, "Should have final agent message");
        })
        .await;
}

#[tokio::test]
async fn test_extension_methods_and_notifications() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            // Store references to the client and agent to check notifications later
            let client_ref = client.clone();
            let agent_ref = agent.clone();

            let (client_conn, agent_conn) = create_connection_pair(&client, &agent);
            // Test agent calling client extension method
            let params: Arc<_> = raw_json!({ "data": "test" });
            let client_response = agent_conn
                .ext_method(ExtRequest::new("example.com/ping", params))
                .await
                .unwrap();

            assert_eq!(
                serde_json::to_value(client_response).unwrap(),
                serde_json::json!({
                    "response": "pong",
                    "params": {"data": "test"}
                })
            );

            // Test client calling agent extension method
            let params: Arc<_> = raw_json!({ "message": "hello" });
            let agent_response = client_conn
                .ext_method(ExtRequest::new("example.com/echo", params))
                .await
                .unwrap();

            assert_eq!(
                serde_json::to_value(agent_response).unwrap(),
                serde_json::json!({
                    "echo": {"message": "hello"}
                })
            );

            // Test extension notifications
            let params: Arc<_> = raw_json!({ "info": "client notification" });
            agent_conn
                .ext_notification(ExtNotification::new("example.com/client/notify", params))
                .await
                .unwrap();

            let params: Arc<_> = raw_json!({ "info": "agent notification" });
            client_conn
                .ext_notification(ExtNotification::new("example.com/agent/notify", params))
                .await
                .unwrap();

            // Yield to allow notifications to be processed
            tokio::task::yield_now().await;

            // Verify client received the notification
            let client_notifications = client_ref.extension_notifications.lock().unwrap();
            assert_eq!(client_notifications.len(), 1);
            assert_eq!(client_notifications[0].0, "example.com/client/notify");
            assert_eq!(
                serde_json::to_value(&client_notifications[0].1).unwrap(),
                serde_json::json!({"info": "client notification"})
            );

            // Verify agent received the notification
            let agent_notifications = agent_ref.extension_notifications.lock().unwrap();
            assert_eq!(agent_notifications.len(), 1);
            assert_eq!(agent_notifications[0].0, "example.com/agent/notify");
            assert_eq!(
                serde_json::to_value(&agent_notifications[0].1).unwrap(),
                serde_json::json!({"info": "agent notification"})
            );
        })
        .await;
}

#[cfg(feature = "unstable_session_fork")]
#[tokio::test]
async fn test_fork_session() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (agent_conn, _client_conn) = create_connection_pair(&client, &agent);

            // First create a session
            let new_session_response = agent_conn
                .new_session(NewSessionRequest::new("/test"))
                .await
                .expect("new_session failed");

            let original_session_id = new_session_response.session_id;

            // Fork the session
            let fork_response = agent_conn
                .fork_session(agent_client_protocol_schema::ForkSessionRequest::new(
                    original_session_id.clone(),
                    "/test",
                ))
                .await
                .expect("fork_session failed");

            // Verify the forked session has a different ID
            assert_ne!(fork_response.session_id, original_session_id);
            assert_eq!(
                fork_response.session_id.0.as_ref(),
                format!("fork-of-{}", original_session_id.0)
            );

            // Verify the forked session was added to the agent's sessions
            let sessions = agent.sessions.lock().unwrap();
            assert!(sessions.contains_key(&fork_response.session_id));
        })
        .await;
}

#[cfg(feature = "unstable_session_list")]
#[tokio::test]
async fn test_list_sessions() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (agent_conn, _client_conn) = create_connection_pair(&client, &agent);

            // First create a session
            let new_session_response = agent_conn
                .new_session(NewSessionRequest::new("/test"))
                .await
                .expect("new_session failed");

            // Verify the session was created
            assert!(!new_session_response.session_id.0.is_empty());

            // List sessions
            let list_response = agent_conn
                .list_sessions(agent_client_protocol_schema::ListSessionsRequest::new())
                .await
                .expect("list_sessions failed");

            // Verify the response contains our session
            assert_eq!(list_response.sessions.len(), 1);
            assert_eq!(
                list_response.sessions[0].session_id,
                new_session_response.session_id
            );
            assert_eq!(
                list_response.sessions[0].cwd,
                std::path::PathBuf::from("/test")
            );
            assert!(list_response.next_cursor.is_none());
        })
        .await;
}

#[cfg(feature = "unstable_session_resume")]
#[tokio::test]
async fn test_resume_session() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (agent_conn, _client_conn) = create_connection_pair(&client, &agent);

            // First create a session
            let new_session_response = agent_conn
                .new_session(NewSessionRequest::new("/test"))
                .await
                .expect("new_session failed");

            let session_id = new_session_response.session_id;

            // Resume the session
            let resume_response = agent_conn
                .resume_session(agent_client_protocol_schema::ResumeSessionRequest::new(
                    session_id.clone(),
                    "/test",
                ))
                .await
                .expect("resume_session failed");

            // Verify we got a valid response (no modes by default in TestAgent)
            assert!(resume_response.modes.is_none());
        })
        .await;
}

#[cfg(feature = "unstable_session_info_update")]
#[tokio::test]
async fn test_session_info_update() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (_agent_conn, client_conn) = create_connection_pair(&client, &agent);

            let session_id = SessionId::new("test-session");

            // Send a session info update notification
            client_conn
                .session_notification(SessionNotification::new(
                    session_id.clone(),
                    SessionUpdate::SessionInfoUpdate(
                        agent_client_protocol_schema::SessionInfoUpdate::new()
                            .title("Test Session Title")
                            .updated_at("2025-01-15T12:00:00Z"),
                    ),
                ))
                .await
                .expect("session_notification failed");

            tokio::task::yield_now().await;

            // Verify client received the notification
            let notifications = client.session_notifications.lock().unwrap();
            assert_eq!(notifications.len(), 1);
            assert_eq!(notifications[0].session_id, session_id);

            if let SessionUpdate::SessionInfoUpdate(info_update) = &notifications[0].update {
                assert_eq!(
                    info_update.title,
                    agent_client_protocol_schema::MaybeUndefined::Value(
                        "Test Session Title".to_string()
                    )
                );
                assert_eq!(
                    info_update.updated_at,
                    agent_client_protocol_schema::MaybeUndefined::Value(
                        "2025-01-15T12:00:00Z".to_string()
                    )
                );
            } else {
                panic!("Expected SessionInfoUpdate variant");
            }
        })
        .await;
}

#[cfg(feature = "unstable_session_config_options")]
#[tokio::test]
async fn test_set_session_config_option() {
    let local_set = tokio::task::LocalSet::new();
    local_set
        .run_until(async {
            let client = TestClient::new();
            let agent = TestAgent::new();

            let (agent_conn, _client_conn) = create_connection_pair(&client, &agent);

            // Set a config option
            let response = agent_conn
                .set_session_config_option(
                    agent_client_protocol_schema::SetSessionConfigOptionRequest::new(
                        "test-session",
                        "mode",
                        "value2",
                    ),
                )
                .await
                .expect("set_session_config_option failed");

            // Verify we got config options back
            assert_eq!(response.config_options.len(), 1);
            assert_eq!(
                response.config_options[0].id,
                agent_client_protocol_schema::SessionConfigId::new("mode")
            );
        })
        .await;
}
