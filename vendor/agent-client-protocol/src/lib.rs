use futures::{AsyncRead, AsyncWrite, future::LocalBoxFuture};
use rpc::RpcConnection;

mod agent;
mod client;
mod rpc;
#[cfg(test)]
mod rpc_tests;
mod stream_broadcast;

pub use agent::*;
pub use agent_client_protocol_schema::*;
pub use client::*;
pub use rpc::*;
pub use stream_broadcast::{
    StreamMessage, StreamMessageContent, StreamMessageDirection, StreamReceiver,
};

// Client to Agent

/// A client-side connection to an agent.
///
/// This struct provides the client's view of an ACP connection, allowing
/// clients (such as code editors) to communicate with agents. It implements
/// the [`Agent`] trait to provide methods for initializing sessions, sending
/// prompts, and managing the agent lifecycle.
///
/// See protocol docs: [Client](https://agentclientprotocol.com/protocol/overview#client)
#[derive(Debug)]
pub struct ClientSideConnection {
    conn: RpcConnection<ClientSide, AgentSide>,
}

impl ClientSideConnection {
    /// Creates a new client-side connection to an agent.
    ///
    /// This establishes the communication channel between a client and agent
    /// following the ACP specification.
    ///
    /// # Arguments
    ///
    /// * `client` - A handler that implements the [`Client`] trait to process incoming agent requests
    /// * `outgoing_bytes` - The stream for sending data to the agent (typically stdout)
    /// * `incoming_bytes` - The stream for receiving data from the agent (typically stdin)
    /// * `spawn` - A function to spawn async tasks (e.g., `tokio::spawn`)
    ///
    /// # Returns
    ///
    /// Returns a tuple containing:
    /// - The connection instance for making requests to the agent
    /// - An I/O future that must be spawned to handle the underlying communication
    ///
    /// See protocol docs: [Communication Model](https://agentclientprotocol.com/protocol/overview#communication-model)
    pub fn new(
        client: impl MessageHandler<ClientSide> + 'static,
        outgoing_bytes: impl Unpin + AsyncWrite,
        incoming_bytes: impl Unpin + AsyncRead,
        spawn: impl Fn(LocalBoxFuture<'static, ()>) + 'static,
    ) -> (Self, impl Future<Output = Result<()>>) {
        let (conn, io_task) = RpcConnection::new(client, outgoing_bytes, incoming_bytes, spawn);
        (Self { conn }, io_task)
    }

    /// Subscribe to receive stream updates from the agent.
    ///
    /// This allows the client to receive real-time notifications about
    /// agent activities, such as tool calls, content updates, and progress reports.
    ///
    /// # Returns
    ///
    /// A [`StreamReceiver`] that can be used to receive stream messages.
    pub fn subscribe(&self) -> StreamReceiver {
        self.conn.subscribe()
    }
}

#[async_trait::async_trait(?Send)]
impl Agent for ClientSideConnection {
    async fn initialize(&self, args: InitializeRequest) -> Result<InitializeResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.initialize,
                Some(ClientRequest::InitializeRequest(args)),
            )
            .await
    }

    async fn authenticate(&self, args: AuthenticateRequest) -> Result<AuthenticateResponse> {
        self.conn
            .request::<Option<_>>(
                AGENT_METHOD_NAMES.authenticate,
                Some(ClientRequest::AuthenticateRequest(args)),
            )
            .await
            .map(Option::unwrap_or_default)
    }

    async fn new_session(&self, args: NewSessionRequest) -> Result<NewSessionResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_new,
                Some(ClientRequest::NewSessionRequest(args)),
            )
            .await
    }

    async fn load_session(&self, args: LoadSessionRequest) -> Result<LoadSessionResponse> {
        self.conn
            .request::<Option<_>>(
                AGENT_METHOD_NAMES.session_load,
                Some(ClientRequest::LoadSessionRequest(args)),
            )
            .await
            .map(Option::unwrap_or_default)
    }

    async fn set_session_mode(
        &self,
        args: SetSessionModeRequest,
    ) -> Result<SetSessionModeResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_set_mode,
                Some(ClientRequest::SetSessionModeRequest(args)),
            )
            .await
    }

    async fn prompt(&self, args: PromptRequest) -> Result<PromptResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_prompt,
                Some(ClientRequest::PromptRequest(args)),
            )
            .await
    }

    async fn cancel(&self, args: CancelNotification) -> Result<()> {
        self.conn.notify(
            AGENT_METHOD_NAMES.session_cancel,
            Some(ClientNotification::CancelNotification(args)),
        )
    }

    #[cfg(feature = "unstable_session_model")]
    async fn set_session_model(
        &self,
        args: SetSessionModelRequest,
    ) -> Result<SetSessionModelResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_set_model,
                Some(ClientRequest::SetSessionModelRequest(args)),
            )
            .await
    }

    #[cfg(feature = "unstable_session_list")]
    async fn list_sessions(&self, args: ListSessionsRequest) -> Result<ListSessionsResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_list,
                Some(ClientRequest::ListSessionsRequest(args)),
            )
            .await
    }

    #[cfg(feature = "unstable_session_fork")]
    async fn fork_session(&self, args: ForkSessionRequest) -> Result<ForkSessionResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_fork,
                Some(ClientRequest::ForkSessionRequest(args)),
            )
            .await
    }

    #[cfg(feature = "unstable_session_resume")]
    async fn resume_session(&self, args: ResumeSessionRequest) -> Result<ResumeSessionResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_resume,
                Some(ClientRequest::ResumeSessionRequest(args)),
            )
            .await
    }

    #[cfg(feature = "unstable_session_config_options")]
    async fn set_session_config_option(
        &self,
        args: SetSessionConfigOptionRequest,
    ) -> Result<SetSessionConfigOptionResponse> {
        self.conn
            .request(
                AGENT_METHOD_NAMES.session_set_config_option,
                Some(ClientRequest::SetSessionConfigOptionRequest(args)),
            )
            .await
    }

    async fn ext_method(&self, args: ExtRequest) -> Result<ExtResponse> {
        self.conn
            .request(
                format!("_{}", args.method),
                Some(ClientRequest::ExtMethodRequest(args)),
            )
            .await
    }

    async fn ext_notification(&self, args: ExtNotification) -> Result<()> {
        self.conn.notify(
            format!("_{}", args.method),
            Some(ClientNotification::ExtNotification(args)),
        )
    }
}

/// Marker type representing the client side of an ACP connection.
///
/// This type is used by the RPC layer to determine which messages
/// are incoming vs outgoing from the client's perspective.
///
/// See protocol docs: [Communication Model](https://agentclientprotocol.com/protocol/overview#communication-model)
#[derive(Clone, Debug)]
pub struct ClientSide;

impl Side for ClientSide {
    type InNotification = AgentNotification;
    type InRequest = AgentRequest;
    type OutResponse = ClientResponse;

    fn decode_request(method: &str, params: Option<&RawValue>) -> Result<AgentRequest> {
        let params = params.ok_or_else(Error::invalid_params)?;

        match method {
            m if m == CLIENT_METHOD_NAMES.session_request_permission => {
                serde_json::from_str(params.get())
                    .map(AgentRequest::RequestPermissionRequest)
                    .map_err(Into::into)
            }
            m if m == CLIENT_METHOD_NAMES.fs_write_text_file => serde_json::from_str(params.get())
                .map(AgentRequest::WriteTextFileRequest)
                .map_err(Into::into),
            m if m == CLIENT_METHOD_NAMES.fs_read_text_file => serde_json::from_str(params.get())
                .map(AgentRequest::ReadTextFileRequest)
                .map_err(Into::into),
            m if m == CLIENT_METHOD_NAMES.terminal_create => serde_json::from_str(params.get())
                .map(AgentRequest::CreateTerminalRequest)
                .map_err(Into::into),
            m if m == CLIENT_METHOD_NAMES.terminal_output => serde_json::from_str(params.get())
                .map(AgentRequest::TerminalOutputRequest)
                .map_err(Into::into),
            m if m == CLIENT_METHOD_NAMES.terminal_kill => serde_json::from_str(params.get())
                .map(AgentRequest::KillTerminalCommandRequest)
                .map_err(Into::into),
            m if m == CLIENT_METHOD_NAMES.terminal_release => serde_json::from_str(params.get())
                .map(AgentRequest::ReleaseTerminalRequest)
                .map_err(Into::into),
            m if m == CLIENT_METHOD_NAMES.terminal_wait_for_exit => {
                serde_json::from_str(params.get())
                    .map(AgentRequest::WaitForTerminalExitRequest)
                    .map_err(Into::into)
            }
            _ => {
                if let Some(custom_method) = method.strip_prefix('_') {
                    Ok(AgentRequest::ExtMethodRequest(ExtRequest::new(
                        custom_method,
                        params.to_owned().into(),
                    )))
                } else {
                    Err(Error::method_not_found())
                }
            }
        }
    }

    fn decode_notification(method: &str, params: Option<&RawValue>) -> Result<AgentNotification> {
        let params = params.ok_or_else(Error::invalid_params)?;

        match method {
            m if m == CLIENT_METHOD_NAMES.session_update => serde_json::from_str(params.get())
                .map(AgentNotification::SessionNotification)
                .map_err(Into::into),
            _ => {
                if let Some(custom_method) = method.strip_prefix('_') {
                    Ok(AgentNotification::ExtNotification(ExtNotification::new(
                        custom_method,
                        RawValue::from_string(params.get().to_string())?.into(),
                    )))
                } else {
                    Err(Error::method_not_found())
                }
            }
        }
    }
}

impl<T: Client> MessageHandler<ClientSide> for T {
    async fn handle_request(&self, request: AgentRequest) -> Result<ClientResponse> {
        match request {
            AgentRequest::RequestPermissionRequest(args) => {
                let response = self.request_permission(args).await?;
                Ok(ClientResponse::RequestPermissionResponse(response))
            }
            AgentRequest::WriteTextFileRequest(args) => {
                let response = self.write_text_file(args).await?;
                Ok(ClientResponse::WriteTextFileResponse(response))
            }
            AgentRequest::ReadTextFileRequest(args) => {
                let response = self.read_text_file(args).await?;
                Ok(ClientResponse::ReadTextFileResponse(response))
            }
            AgentRequest::CreateTerminalRequest(args) => {
                let response = self.create_terminal(args).await?;
                Ok(ClientResponse::CreateTerminalResponse(response))
            }
            AgentRequest::TerminalOutputRequest(args) => {
                let response = self.terminal_output(args).await?;
                Ok(ClientResponse::TerminalOutputResponse(response))
            }
            AgentRequest::ReleaseTerminalRequest(args) => {
                let response = self.release_terminal(args).await?;
                Ok(ClientResponse::ReleaseTerminalResponse(response))
            }
            AgentRequest::WaitForTerminalExitRequest(args) => {
                let response = self.wait_for_terminal_exit(args).await?;
                Ok(ClientResponse::WaitForTerminalExitResponse(response))
            }
            AgentRequest::KillTerminalCommandRequest(args) => {
                let response = self.kill_terminal_command(args).await?;
                Ok(ClientResponse::KillTerminalResponse(response))
            }
            AgentRequest::ExtMethodRequest(args) => {
                let response = self.ext_method(args).await?;
                Ok(ClientResponse::ExtMethodResponse(response))
            }
            _ => Err(Error::method_not_found()),
        }
    }

    async fn handle_notification(&self, notification: AgentNotification) -> Result<()> {
        match notification {
            AgentNotification::SessionNotification(args) => {
                self.session_notification(args).await?;
            }
            AgentNotification::ExtNotification(args) => {
                self.ext_notification(args).await?;
            }
            // Ignore unknown notifications
            _ => {}
        }
        Ok(())
    }
}

// Agent to Client

/// An agent-side connection to a client.
///
/// This struct provides the agent's view of an ACP connection, allowing
/// agents to communicate with clients. It implements the [`Client`] trait
/// to provide methods for requesting permissions, accessing the file system,
/// and sending session updates.
///
/// See protocol docs: [Agent](https://agentclientprotocol.com/protocol/overview#agent)
#[derive(Debug)]
pub struct AgentSideConnection {
    conn: RpcConnection<AgentSide, ClientSide>,
}

impl AgentSideConnection {
    /// Creates a new agent-side connection to a client.
    ///
    /// This establishes the communication channel from the agent's perspective
    /// following the ACP specification.
    ///
    /// # Arguments
    ///
    /// * `agent` - A handler that implements the [`Agent`] trait to process incoming client requests
    /// * `outgoing_bytes` - The stream for sending data to the client (typically stdout)
    /// * `incoming_bytes` - The stream for receiving data from the client (typically stdin)
    /// * `spawn` - A function to spawn async tasks (e.g., `tokio::spawn`)
    ///
    /// # Returns
    ///
    /// Returns a tuple containing:
    /// - The connection instance for making requests to the client
    /// - An I/O future that must be spawned to handle the underlying communication
    ///
    /// See protocol docs: [Communication Model](https://agentclientprotocol.com/protocol/overview#communication-model)
    pub fn new(
        agent: impl MessageHandler<AgentSide> + 'static,
        outgoing_bytes: impl Unpin + AsyncWrite,
        incoming_bytes: impl Unpin + AsyncRead,
        spawn: impl Fn(LocalBoxFuture<'static, ()>) + 'static,
    ) -> (Self, impl Future<Output = Result<()>>) {
        let (conn, io_task) = RpcConnection::new(agent, outgoing_bytes, incoming_bytes, spawn);
        (Self { conn }, io_task)
    }

    /// Subscribe to receive stream updates from the client.
    ///
    /// This allows the agent to receive real-time notifications about
    /// client activities and cancellation requests.
    ///
    /// # Returns
    ///
    /// A [`StreamReceiver`] that can be used to receive stream messages.
    pub fn subscribe(&self) -> StreamReceiver {
        self.conn.subscribe()
    }
}

#[async_trait::async_trait(?Send)]
impl Client for AgentSideConnection {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> Result<RequestPermissionResponse> {
        self.conn
            .request(
                CLIENT_METHOD_NAMES.session_request_permission,
                Some(AgentRequest::RequestPermissionRequest(args)),
            )
            .await
    }

    async fn write_text_file(&self, args: WriteTextFileRequest) -> Result<WriteTextFileResponse> {
        self.conn
            .request::<Option<_>>(
                CLIENT_METHOD_NAMES.fs_write_text_file,
                Some(AgentRequest::WriteTextFileRequest(args)),
            )
            .await
            .map(Option::unwrap_or_default)
    }

    async fn read_text_file(&self, args: ReadTextFileRequest) -> Result<ReadTextFileResponse> {
        self.conn
            .request(
                CLIENT_METHOD_NAMES.fs_read_text_file,
                Some(AgentRequest::ReadTextFileRequest(args)),
            )
            .await
    }

    async fn create_terminal(&self, args: CreateTerminalRequest) -> Result<CreateTerminalResponse> {
        self.conn
            .request(
                CLIENT_METHOD_NAMES.terminal_create,
                Some(AgentRequest::CreateTerminalRequest(args)),
            )
            .await
    }

    async fn terminal_output(&self, args: TerminalOutputRequest) -> Result<TerminalOutputResponse> {
        self.conn
            .request(
                CLIENT_METHOD_NAMES.terminal_output,
                Some(AgentRequest::TerminalOutputRequest(args)),
            )
            .await
    }

    async fn release_terminal(
        &self,
        args: ReleaseTerminalRequest,
    ) -> Result<ReleaseTerminalResponse> {
        self.conn
            .request::<Option<_>>(
                CLIENT_METHOD_NAMES.terminal_release,
                Some(AgentRequest::ReleaseTerminalRequest(args)),
            )
            .await
            .map(Option::unwrap_or_default)
    }

    async fn wait_for_terminal_exit(
        &self,
        args: WaitForTerminalExitRequest,
    ) -> Result<WaitForTerminalExitResponse> {
        self.conn
            .request(
                CLIENT_METHOD_NAMES.terminal_wait_for_exit,
                Some(AgentRequest::WaitForTerminalExitRequest(args)),
            )
            .await
    }

    async fn kill_terminal_command(
        &self,
        args: KillTerminalCommandRequest,
    ) -> Result<KillTerminalCommandResponse> {
        self.conn
            .request::<Option<_>>(
                CLIENT_METHOD_NAMES.terminal_kill,
                Some(AgentRequest::KillTerminalCommandRequest(args)),
            )
            .await
            .map(Option::unwrap_or_default)
    }

    async fn session_notification(&self, args: SessionNotification) -> Result<()> {
        self.conn.notify(
            CLIENT_METHOD_NAMES.session_update,
            Some(AgentNotification::SessionNotification(args)),
        )
    }

    async fn ext_method(&self, args: ExtRequest) -> Result<ExtResponse> {
        self.conn
            .request(
                format!("_{}", args.method),
                Some(AgentRequest::ExtMethodRequest(args)),
            )
            .await
    }

    async fn ext_notification(&self, args: ExtNotification) -> Result<()> {
        self.conn.notify(
            format!("_{}", args.method),
            Some(AgentNotification::ExtNotification(args)),
        )
    }
}

/// Marker type representing the agent side of an ACP connection.
///
/// This type is used by the RPC layer to determine which messages
/// are incoming vs outgoing from the agent's perspective.
///
/// See protocol docs: [Communication Model](https://agentclientprotocol.com/protocol/overview#communication-model)
#[derive(Clone, Debug)]
pub struct AgentSide;

impl Side for AgentSide {
    type InRequest = ClientRequest;
    type InNotification = ClientNotification;
    type OutResponse = AgentResponse;

    fn decode_request(method: &str, params: Option<&RawValue>) -> Result<ClientRequest> {
        let params = params.ok_or_else(Error::invalid_params)?;

        match method {
            m if m == AGENT_METHOD_NAMES.initialize => serde_json::from_str(params.get())
                .map(ClientRequest::InitializeRequest)
                .map_err(Into::into),
            m if m == AGENT_METHOD_NAMES.authenticate => serde_json::from_str(params.get())
                .map(ClientRequest::AuthenticateRequest)
                .map_err(Into::into),
            m if m == AGENT_METHOD_NAMES.session_new => serde_json::from_str(params.get())
                .map(ClientRequest::NewSessionRequest)
                .map_err(Into::into),
            m if m == AGENT_METHOD_NAMES.session_load => serde_json::from_str(params.get())
                .map(ClientRequest::LoadSessionRequest)
                .map_err(Into::into),
            m if m == AGENT_METHOD_NAMES.session_set_mode => serde_json::from_str(params.get())
                .map(ClientRequest::SetSessionModeRequest)
                .map_err(Into::into),
            #[cfg(feature = "unstable_session_model")]
            m if m == AGENT_METHOD_NAMES.session_set_model => serde_json::from_str(params.get())
                .map(ClientRequest::SetSessionModelRequest)
                .map_err(Into::into),
            #[cfg(feature = "unstable_session_list")]
            m if m == AGENT_METHOD_NAMES.session_list => serde_json::from_str(params.get())
                .map(ClientRequest::ListSessionsRequest)
                .map_err(Into::into),
            #[cfg(feature = "unstable_session_fork")]
            m if m == AGENT_METHOD_NAMES.session_fork => serde_json::from_str(params.get())
                .map(ClientRequest::ForkSessionRequest)
                .map_err(Into::into),
            #[cfg(feature = "unstable_session_resume")]
            m if m == AGENT_METHOD_NAMES.session_resume => serde_json::from_str(params.get())
                .map(ClientRequest::ResumeSessionRequest)
                .map_err(Into::into),
            #[cfg(feature = "unstable_session_config_options")]
            m if m == AGENT_METHOD_NAMES.session_set_config_option => {
                serde_json::from_str(params.get())
                    .map(ClientRequest::SetSessionConfigOptionRequest)
                    .map_err(Into::into)
            }
            m if m == AGENT_METHOD_NAMES.session_prompt => serde_json::from_str(params.get())
                .map(ClientRequest::PromptRequest)
                .map_err(Into::into),
            _ => {
                if let Some(custom_method) = method.strip_prefix('_') {
                    Ok(ClientRequest::ExtMethodRequest(ExtRequest::new(
                        custom_method,
                        params.to_owned().into(),
                    )))
                } else {
                    Err(Error::method_not_found())
                }
            }
        }
    }

    fn decode_notification(method: &str, params: Option<&RawValue>) -> Result<ClientNotification> {
        let params = params.ok_or_else(Error::invalid_params)?;

        match method {
            m if m == AGENT_METHOD_NAMES.session_cancel => serde_json::from_str(params.get())
                .map(ClientNotification::CancelNotification)
                .map_err(Into::into),
            _ => {
                if let Some(custom_method) = method.strip_prefix('_') {
                    Ok(ClientNotification::ExtNotification(ExtNotification::new(
                        custom_method,
                        RawValue::from_string(params.get().to_string())?.into(),
                    )))
                } else {
                    Err(Error::method_not_found())
                }
            }
        }
    }
}

impl<T: Agent> MessageHandler<AgentSide> for T {
    async fn handle_request(&self, request: ClientRequest) -> Result<AgentResponse> {
        match request {
            ClientRequest::InitializeRequest(args) => {
                let response = self.initialize(args).await?;
                Ok(AgentResponse::InitializeResponse(response))
            }
            ClientRequest::AuthenticateRequest(args) => {
                let response = self.authenticate(args).await?;
                Ok(AgentResponse::AuthenticateResponse(response))
            }
            ClientRequest::NewSessionRequest(args) => {
                let response = self.new_session(args).await?;
                Ok(AgentResponse::NewSessionResponse(response))
            }
            ClientRequest::LoadSessionRequest(args) => {
                let response = self.load_session(args).await?;
                Ok(AgentResponse::LoadSessionResponse(response))
            }
            ClientRequest::PromptRequest(args) => {
                let response = self.prompt(args).await?;
                Ok(AgentResponse::PromptResponse(response))
            }
            ClientRequest::SetSessionModeRequest(args) => {
                let response = self.set_session_mode(args).await?;
                Ok(AgentResponse::SetSessionModeResponse(response))
            }
            #[cfg(feature = "unstable_session_model")]
            ClientRequest::SetSessionModelRequest(args) => {
                let response = self.set_session_model(args).await?;
                Ok(AgentResponse::SetSessionModelResponse(response))
            }
            #[cfg(feature = "unstable_session_list")]
            ClientRequest::ListSessionsRequest(args) => {
                let response = self.list_sessions(args).await?;
                Ok(AgentResponse::ListSessionsResponse(response))
            }
            #[cfg(feature = "unstable_session_fork")]
            ClientRequest::ForkSessionRequest(args) => {
                let response = self.fork_session(args).await?;
                Ok(AgentResponse::ForkSessionResponse(response))
            }
            #[cfg(feature = "unstable_session_resume")]
            ClientRequest::ResumeSessionRequest(args) => {
                let response = self.resume_session(args).await?;
                Ok(AgentResponse::ResumeSessionResponse(response))
            }
            #[cfg(feature = "unstable_session_config_options")]
            ClientRequest::SetSessionConfigOptionRequest(args) => {
                let response = self.set_session_config_option(args).await?;
                Ok(AgentResponse::SetSessionConfigOptionResponse(response))
            }
            ClientRequest::ExtMethodRequest(args) => {
                let response = self.ext_method(args).await?;
                Ok(AgentResponse::ExtMethodResponse(response))
            }
            _ => Err(Error::method_not_found()),
        }
    }

    async fn handle_notification(&self, notification: ClientNotification) -> Result<()> {
        match notification {
            ClientNotification::CancelNotification(args) => {
                self.cancel(args).await?;
            }
            ClientNotification::ExtNotification(args) => {
                self.ext_notification(args).await?;
            }
            // Ignore unknown notifications
            _ => {}
        }
        Ok(())
    }
}
