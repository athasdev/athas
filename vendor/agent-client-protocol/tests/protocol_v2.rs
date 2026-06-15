#![cfg(feature = "unstable_protocol_v2")]

use std::path::PathBuf;

use agent_client_protocol::schema::{self, ProtocolVersion, v2};
use agent_client_protocol::{
    Agent, Builder, Client, ConnectTo, Error, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse,
    NullHandler, Role, UntypedRole, jsonrpcmsg,
};
use agent_client_protocol_test::testy::Testy;
use futures::StreamExt as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "initialize", response = ForeignInitializeResponse)]
struct ForeignInitializeRequest {
    #[serde(rename = "protocolVersion")]
    protocol_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcResponse)]
struct ForeignInitializeResponse {
    #[serde(rename = "protocolVersion")]
    protocol_version: String,
}

struct ForeignPeer;

impl ConnectTo<UntypedRole> for ForeignPeer {
    async fn connect_to(self, client: impl ConnectTo<UntypedRole>) -> Result<(), Error> {
        UntypedRole
            .builder()
            .on_receive_request(
                async |request: ForeignInitializeRequest, responder, _cx| {
                    assert_eq!(request.protocol_version, "2025-06-18");
                    responder.respond(ForeignInitializeResponse {
                        protocol_version: request.protocol_version,
                    })
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_to(client)
            .await
    }
}

fn cwd() -> Result<PathBuf, Error> {
    std::env::current_dir().map_err(Error::into_internal_error)
}

#[cfg(feature = "unstable_mcp_over_acp")]
fn json_value(value: impl Serialize) -> Result<Value, Error> {
    serde_json::to_value(value).map_err(Error::into_internal_error)
}

async fn assert_malformed_initialize_rejected(params: Map<String, Value>) -> Result<(), Error> {
    let agent = Agent.v2().on_receive_request(
        async |_initialize: v2::InitializeRequest, responder, _cx| {
            responder.respond_with_internal_error("handler should not run")
        },
        agent_client_protocol::on_receive_request!(),
    );
    let (mut channel, agent_future) = ConnectTo::<Client>::into_channel_and_future(agent);
    let agent_task = tokio::spawn(agent_future);

    channel
        .tx
        .unbounded_send(Ok(jsonrpcmsg::Message::Request(
            jsonrpcmsg::Request::new_v2(
                "initialize".into(),
                Some(jsonrpcmsg::Params::Object(params)),
                Some(jsonrpcmsg::Id::Number(1)),
            ),
        )))
        .map_err(Error::into_internal_error)?;

    while let Some(message) = channel.rx.next().await {
        let message = message?;
        let jsonrpcmsg::Message::Response(response) = message else {
            continue;
        };
        let error = response.error.expect("malformed initialize should fail");
        assert_eq!(error.code, -32602);
        let data = error
            .data
            .as_ref()
            .and_then(|data| data.as_str())
            .unwrap_or_default();
        assert!(data.contains("protocolVersion"), "{error:?}");
        agent_task.abort();
        return Ok(());
    }

    agent_task.abort();
    Err(agent_client_protocol::util::internal_error(
        "agent did not respond to malformed initialize",
    ))
}

async fn assert_v2_client_rejected_by_v1_agent(agent: impl ConnectTo<Client>) -> Result<(), Error> {
    Client
        .v2()
        .connect_with(agent, async |cx| {
            let error = cx
                .send_request(v2::InitializeRequest::new(ProtocolVersion::V2))
                .block_task()
                .await
                .expect_err("v1 agent protocol mode should reject v2 clients");
            let data = error
                .data
                .as_ref()
                .and_then(|data| data.as_str())
                .unwrap_or_default();
            assert!(
                data.contains("required ACP protocol version 2"),
                "{error:?}"
            );
            Ok(())
        })
        .await
}

#[tokio::test(flavor = "current_thread")]
async fn non_acp_initialize_is_not_rewritten() -> Result<(), Error> {
    UntypedRole
        .builder()
        .connect_with(ForeignPeer, async |cx| {
            let response = cx
                .send_request(ForeignInitializeRequest {
                    protocol_version: "2025-06-18".into(),
                })
                .block_task()
                .await?;

            assert_eq!(response.protocol_version, "2025-06-18");
            Ok(())
        })
        .await
}

#[tokio::test(flavor = "current_thread")]
async fn v2_agent_rejects_initialize_without_protocol_version() -> Result<(), Error> {
    assert_malformed_initialize_rejected(Map::new()).await
}

#[tokio::test(flavor = "current_thread")]
async fn v2_agent_rejects_initialize_with_malformed_protocol_version() -> Result<(), Error> {
    let mut params = Map::new();
    params.insert("protocolVersion".into(), serde_json::json!(100_000));

    assert_malformed_initialize_rejected(params).await
}

#[tokio::test(flavor = "current_thread")]
async fn role_builder_v1_agent_rejects_v2_client_negotiation() -> Result<(), Error> {
    let agent = <Agent as Role>::builder(Agent).on_receive_request(
        async |initialize: schema::InitializeRequest, responder, _cx| {
            assert_eq!(initialize.protocol_version, ProtocolVersion::V1);
            responder.respond(schema::InitializeResponse::new(initialize.protocol_version))
        },
        agent_client_protocol::on_receive_request!(),
    );

    Client
        .v2()
        .connect_with(agent, async |cx| {
            let error = cx
                .send_request(v2::InitializeRequest::new(ProtocolVersion::V2))
                .block_task()
                .await
                .expect_err("Role::builder should preserve v1 agent protocol mode");
            let data = error
                .data
                .as_ref()
                .and_then(|data| data.as_str())
                .unwrap_or_default();
            assert!(
                data.contains("required ACP protocol version 2"),
                "{error:?}"
            );
            Ok(())
        })
        .await
}

#[tokio::test(flavor = "current_thread")]
async fn builder_new_v1_agent_rejects_v2_client_negotiation() -> Result<(), Error> {
    let agent = Builder::new(Agent).on_receive_request(
        async |initialize: schema::InitializeRequest, responder, _cx| {
            assert_eq!(initialize.protocol_version, ProtocolVersion::V1);
            responder.respond(schema::InitializeResponse::new(initialize.protocol_version))
        },
        agent_client_protocol::on_receive_request!(),
    );

    assert_v2_client_rejected_by_v1_agent(agent).await
}

#[tokio::test(flavor = "current_thread")]
async fn builder_new_with_v1_agent_rejects_v2_client_negotiation() -> Result<(), Error> {
    let agent = Builder::new_with(Agent, NullHandler).on_receive_request(
        async |initialize: schema::InitializeRequest, responder, _cx| {
            assert_eq!(initialize.protocol_version, ProtocolVersion::V1);
            responder.respond(schema::InitializeResponse::new(initialize.protocol_version))
        },
        agent_client_protocol::on_receive_request!(),
    );

    assert_v2_client_rejected_by_v1_agent(agent).await
}

#[tokio::test(flavor = "current_thread")]
async fn role_builder_v1_client_downgrades_initialize_for_v2_agent() -> Result<(), Error> {
    let agent = Agent.v2().on_receive_request(
        async |initialize: v2::InitializeRequest, responder, _cx| {
            assert_eq!(initialize.protocol_version, ProtocolVersion::V2);
            responder.respond(v2::InitializeResponse::new(initialize.protocol_version))
        },
        agent_client_protocol::on_receive_request!(),
    );

    <Client as Role>::builder(Client)
        .connect_with(agent, async |cx| {
            let initialize = cx
                .send_request(schema::InitializeRequest::new(ProtocolVersion::V2))
                .block_task()
                .await?;
            assert_eq!(initialize.protocol_version, ProtocolVersion::V1);
            Ok(())
        })
        .await
}

#[test]
fn v2_extension_enum_parsing_preserves_method_prefix() -> Result<(), Error> {
    let params = serde_json::json!({ "payload": true });

    let request = v2::ClientRequest::parse_message("_vendor/request", &params)?;
    assert_eq!(request.method(), "_vendor/request");
    let untyped_request = request.to_untyped_message()?;
    assert_eq!(untyped_request.method(), "_vendor/request");
    assert_eq!(untyped_request.params(), &params);

    let notification = v2::AgentNotification::parse_message("_vendor/notify", &params)?;
    assert_eq!(notification.method(), "_vendor/notify");
    let untyped_notification = notification.to_untyped_message()?;
    assert_eq!(untyped_notification.method(), "_vendor/notify");
    assert_eq!(untyped_notification.params(), &params);

    Ok(())
}

#[cfg(feature = "unstable_mcp_over_acp")]
#[test]
fn mcp_over_acp_variants_are_jsonrpc_mapped() -> Result<(), Error> {
    fn assert_request<Req: JsonRpcRequest>() {}
    fn assert_notification<Notif: agent_client_protocol::JsonRpcNotification>() {}

    macro_rules! assert_message_mapping {
        ($ty:ty, $method:literal, $params:expr, $pattern:pat) => {{
            let message = <$ty as JsonRpcMessage>::parse_message($method, &$params)?;
            assert_eq!(message.method(), $method);
            assert_eq!(message.to_untyped_message()?.method(), $method);
            assert!(matches!(message, $pattern));
        }};
    }

    macro_rules! assert_response_mapping {
        ($ty:ty, $method:literal, $value:expr, $pattern:pat) => {{
            let response = <$ty as JsonRpcResponse>::from_value($method, $value)?;
            assert!(matches!(response, $pattern));
        }};
    }

    assert_request::<v2::ConnectMcpRequest>();
    assert_request::<v2::MessageMcpRequest>();
    assert_request::<v2::DisconnectMcpRequest>();
    assert_notification::<v2::MessageMcpNotification>();

    assert_message_mapping!(
        schema::ClientRequest,
        "mcp/message",
        json_value(schema::MessageMcpRequest::new("conn-1", "tools/list"))?,
        schema::ClientRequest::MessageMcpRequest(_)
    );
    assert_response_mapping!(
        schema::AgentResponse,
        "mcp/message",
        serde_json::json!({ "tools": [] }),
        schema::AgentResponse::MessageMcpResponse(_)
    );
    assert_message_mapping!(
        schema::ClientNotification,
        "mcp/message",
        json_value(schema::MessageMcpNotification::new(
            "conn-1",
            "notifications/tools/list"
        ))?,
        schema::ClientNotification::MessageMcpNotification(_)
    );
    assert_message_mapping!(
        schema::AgentRequest,
        "mcp/connect",
        json_value(schema::ConnectMcpRequest::new("server-1"))?,
        schema::AgentRequest::ConnectMcpRequest(_)
    );
    assert_message_mapping!(
        schema::AgentRequest,
        "mcp/message",
        json_value(schema::MessageMcpRequest::new("conn-1", "tools/list"))?,
        schema::AgentRequest::MessageMcpRequest(_)
    );
    assert_message_mapping!(
        schema::AgentRequest,
        "mcp/disconnect",
        json_value(schema::DisconnectMcpRequest::new("conn-1"))?,
        schema::AgentRequest::DisconnectMcpRequest(_)
    );
    assert_response_mapping!(
        schema::ClientResponse,
        "mcp/connect",
        json_value(schema::ConnectMcpResponse::new("conn-1"))?,
        schema::ClientResponse::ConnectMcpResponse(_)
    );
    assert_response_mapping!(
        schema::ClientResponse,
        "mcp/message",
        serde_json::json!({ "tools": [] }),
        schema::ClientResponse::MessageMcpResponse(_)
    );
    assert_response_mapping!(
        schema::ClientResponse,
        "mcp/disconnect",
        serde_json::json!({}),
        schema::ClientResponse::DisconnectMcpResponse(_)
    );
    assert_message_mapping!(
        schema::AgentNotification,
        "mcp/message",
        json_value(schema::MessageMcpNotification::new(
            "conn-1",
            "notifications/tools/list"
        ))?,
        schema::AgentNotification::MessageMcpNotification(_)
    );

    assert_message_mapping!(
        v2::MessageMcpRequest,
        "mcp/message",
        json_value(v2::MessageMcpRequest::new("conn-1", "tools/list"))?,
        v2::MessageMcpRequest { .. }
    );
    assert_message_mapping!(
        v2::MessageMcpNotification,
        "mcp/message",
        json_value(v2::MessageMcpNotification::new(
            "conn-1",
            "notifications/tools/list"
        ))?,
        v2::MessageMcpNotification { .. }
    );
    assert_message_mapping!(
        v2::ConnectMcpRequest,
        "mcp/connect",
        json_value(v2::ConnectMcpRequest::new("server-1"))?,
        v2::ConnectMcpRequest { .. }
    );
    assert_message_mapping!(
        v2::DisconnectMcpRequest,
        "mcp/disconnect",
        json_value(v2::DisconnectMcpRequest::new("conn-1"))?,
        v2::DisconnectMcpRequest { .. }
    );

    assert_message_mapping!(
        v2::ClientRequest,
        "mcp/message",
        json_value(v2::MessageMcpRequest::new("conn-1", "tools/list"))?,
        v2::ClientRequest::MessageMcpRequest(_)
    );
    assert_response_mapping!(
        v2::AgentResponse,
        "mcp/message",
        serde_json::json!({ "tools": [] }),
        v2::AgentResponse::MessageMcpResponse(_)
    );
    assert_message_mapping!(
        v2::ClientNotification,
        "mcp/message",
        json_value(v2::MessageMcpNotification::new(
            "conn-1",
            "notifications/tools/list"
        ))?,
        v2::ClientNotification::MessageMcpNotification(_)
    );
    assert_message_mapping!(
        v2::AgentRequest,
        "mcp/connect",
        json_value(v2::ConnectMcpRequest::new("server-1"))?,
        v2::AgentRequest::ConnectMcpRequest(_)
    );
    assert_message_mapping!(
        v2::AgentRequest,
        "mcp/message",
        json_value(v2::MessageMcpRequest::new("conn-1", "tools/list"))?,
        v2::AgentRequest::MessageMcpRequest(_)
    );
    assert_message_mapping!(
        v2::AgentRequest,
        "mcp/disconnect",
        json_value(v2::DisconnectMcpRequest::new("conn-1"))?,
        v2::AgentRequest::DisconnectMcpRequest(_)
    );
    assert_response_mapping!(
        v2::ClientResponse,
        "mcp/connect",
        json_value(v2::ConnectMcpResponse::new("conn-1"))?,
        v2::ClientResponse::ConnectMcpResponse(_)
    );
    assert_response_mapping!(
        v2::ClientResponse,
        "mcp/message",
        serde_json::json!({ "tools": [] }),
        v2::ClientResponse::MessageMcpResponse(_)
    );
    assert_response_mapping!(
        v2::ClientResponse,
        "mcp/disconnect",
        serde_json::json!({}),
        v2::ClientResponse::DisconnectMcpResponse(_)
    );
    assert_message_mapping!(
        v2::AgentNotification,
        "mcp/message",
        json_value(v2::MessageMcpNotification::new(
            "conn-1",
            "notifications/tools/list"
        ))?,
        v2::AgentNotification::MessageMcpNotification(_)
    );

    Ok(())
}

#[tokio::test(flavor = "current_thread")]
async fn v2_agent_serves_v1_client_with_v2_handlers() -> Result<(), Error> {
    let agent = Agent
        .v2()
        .on_receive_request(
            async |initialize: v2::InitializeRequest, responder, _cx| {
                assert_eq!(initialize.protocol_version, ProtocolVersion::V2);
                // The compatibility layer should force this back to the negotiated v1 wire version.
                responder.respond(v2::InitializeResponse::new(ProtocolVersion::V2))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async |request: v2::NewSessionRequest, responder, _cx| {
                assert!(request.cwd.is_absolute());
                responder.respond(v2::NewSessionResponse::new(v2::SessionId::new(
                    "v2-session",
                )))
            },
            agent_client_protocol::on_receive_request!(),
        );

    Client
        .builder()
        .connect_with(agent, async |cx| {
            let initialize = cx
                .send_request(schema::InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            assert_eq!(initialize.protocol_version, ProtocolVersion::V1);

            let session = cx
                .send_request(schema::NewSessionRequest::new(cwd()?))
                .block_task()
                .await?;
            assert_eq!(session.session_id.0.as_ref(), "v2-session");
            Ok(())
        })
        .await
}

#[tokio::test(flavor = "current_thread")]
async fn v2_client_rejects_v1_agent() -> Result<(), Error> {
    Client
        .v2()
        .connect_with(Testy::new(), async |cx| {
            let error = cx
                .send_request(v2::InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await
                .expect_err("v2 clients require a v2 agent");
            let data = error
                .data
                .as_ref()
                .and_then(|data| data.as_str())
                .unwrap_or_default();
            assert!(
                data.contains("required ACP protocol version 2"),
                "{error:?}"
            );
            Ok(())
        })
        .await
}

#[tokio::test(flavor = "current_thread")]
async fn v2_client_and_agent_negotiate_v2() -> Result<(), Error> {
    let agent = Agent
        .v2()
        .on_receive_request(
            async |initialize: v2::InitializeRequest, responder, _cx| {
                assert_eq!(initialize.protocol_version, ProtocolVersion::V2);
                responder.respond(v2::InitializeResponse::new(initialize.protocol_version))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async |request: v2::NewSessionRequest, responder, _cx| {
                assert!(request.cwd.is_absolute());
                responder.respond(v2::NewSessionResponse::new(v2::SessionId::new(
                    "v2-native-session",
                )))
            },
            agent_client_protocol::on_receive_request!(),
        );

    Client
        .v2()
        .connect_with(agent, async |cx| {
            let initialize = cx
                .send_request(v2::InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            assert_eq!(initialize.protocol_version, ProtocolVersion::V2);

            let session = cx
                .send_request(v2::NewSessionRequest::new(cwd()?))
                .block_task()
                .await?;
            assert_eq!(session.session_id.0.as_ref(), "v2-native-session");
            Ok(())
        })
        .await
}
