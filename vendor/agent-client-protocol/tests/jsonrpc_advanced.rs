//! Advanced feature tests for JSON-RPC layer
//!
//! Tests advanced JSON-RPC capabilities:
//! - Bidirectional communication (both sides can be client+server)
//! - Request ID tracking and matching
//! - Out-of-order response handling

use agent_client_protocol::{
    ConnectionTo, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse, Responder, SentRequest,
    role::UntypedRole,
};
use futures::{AsyncRead, AsyncWrite};
use serde::{Deserialize, Serialize};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

/// Test helper to block and wait for a JSON-RPC response.
async fn recv<T: JsonRpcResponse + Send>(
    response: SentRequest<T>,
) -> Result<T, agent_client_protocol::Error> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    response.on_receiving_result(async move |result| {
        tx.send(result)
            .map_err(|_| agent_client_protocol::Error::internal_error())
    })?;
    rx.await
        .map_err(|_| agent_client_protocol::Error::internal_error())?
}

/// Helper to set up test streams for testing.
fn setup_test_streams() -> (
    impl AsyncRead,
    impl AsyncWrite,
    impl AsyncRead,
    impl AsyncWrite,
) {
    let (client_writer, server_reader) = tokio::io::duplex(1024);
    let (server_writer, client_reader) = tokio::io::duplex(1024);

    let server_reader = server_reader.compat();
    let server_writer = server_writer.compat_write();
    let client_reader = client_reader.compat();
    let client_writer = client_writer.compat_write();

    (server_reader, server_writer, client_reader, client_writer)
}

// ============================================================================
// Test types
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PingRequest {
    value: u32,
}

impl JsonRpcMessage for PingRequest {
    fn matches_method(method: &str) -> bool {
        method == "ping"
    }

    fn method(&self) -> &'static str {
        "ping"
    }

    fn to_untyped_message(
        &self,
    ) -> Result<agent_client_protocol::UntypedMessage, agent_client_protocol::Error> {
        agent_client_protocol::UntypedMessage::new(self.method(), self)
    }

    fn parse_message(
        method: &str,
        params: &impl serde::Serialize,
    ) -> Result<Self, agent_client_protocol::Error> {
        if !Self::matches_method(method) {
            return Err(agent_client_protocol::Error::method_not_found());
        }
        agent_client_protocol::util::json_cast(params)
    }
}

impl JsonRpcRequest for PingRequest {
    type Response = PongResponse;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PongResponse {
    value: u32,
}

impl JsonRpcResponse for PongResponse {
    fn into_json(self, _method: &str) -> Result<serde_json::Value, agent_client_protocol::Error> {
        serde_json::to_value(self).map_err(agent_client_protocol::Error::into_internal_error)
    }

    fn from_value(
        _method: &str,
        value: serde_json::Value,
    ) -> Result<Self, agent_client_protocol::Error> {
        agent_client_protocol::util::json_cast(&value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SlowRequest {
    delay_ms: u64,
    id: u32,
}

impl JsonRpcMessage for SlowRequest {
    fn matches_method(method: &str) -> bool {
        method == "slow"
    }

    fn method(&self) -> &'static str {
        "slow"
    }

    fn to_untyped_message(
        &self,
    ) -> Result<agent_client_protocol::UntypedMessage, agent_client_protocol::Error> {
        agent_client_protocol::UntypedMessage::new(self.method(), self)
    }

    fn parse_message(
        method: &str,
        params: &impl serde::Serialize,
    ) -> Result<Self, agent_client_protocol::Error> {
        if !Self::matches_method(method) {
            return Err(agent_client_protocol::Error::method_not_found());
        }
        agent_client_protocol::util::json_cast(params)
    }
}

impl JsonRpcRequest for SlowRequest {
    type Response = SlowResponse;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SlowResponse {
    id: u32,
}

impl JsonRpcResponse for SlowResponse {
    fn into_json(self, _method: &str) -> Result<serde_json::Value, agent_client_protocol::Error> {
        serde_json::to_value(self).map_err(agent_client_protocol::Error::into_internal_error)
    }

    fn from_value(
        _method: &str,
        value: serde_json::Value,
    ) -> Result<Self, agent_client_protocol::Error> {
        agent_client_protocol::util::json_cast(&value)
    }
}

// ============================================================================
// Test 1: Bidirectional communication
// ============================================================================

#[tokio::test(flavor = "current_thread")]
async fn test_bidirectional_communication() {
    use tokio::task::LocalSet;

    let local = LocalSet::new();

    local
        .run_until(async {
            // Set up two connections that are symmetric - both can send and receive
            let (server_reader, server_writer, client_reader, client_writer) = setup_test_streams();

            let side_a_transport =
                agent_client_protocol::ByteStreams::new(server_writer, server_reader);
            let side_a = UntypedRole.builder().on_receive_request(
                async |request: PingRequest,
                       responder: Responder<PongResponse>,
                       _connection: ConnectionTo<UntypedRole>| {
                    responder.respond(PongResponse {
                        value: request.value + 1,
                    })
                },
                agent_client_protocol::on_receive_request!(),
            );

            let side_b_transport =
                agent_client_protocol::ByteStreams::new(client_writer, client_reader);

            // Spawn side_a as server
            tokio::task::spawn_local(async move {
                side_a.connect_to(side_a_transport).await.ok();
            });

            // Use side_b as client
            let result = UntypedRole
                .builder()
                .connect_with(
                    side_b_transport,
                    async |cx| -> Result<(), agent_client_protocol::Error> {
                        let request = PingRequest { value: 10 };
                        let response_future = recv(cx.send_request(request));
                        let response: Result<PongResponse, _> = response_future.await;

                        assert!(response.is_ok());
                        if let Ok(resp) = response {
                            assert_eq!(resp.value, 11);
                        }
                        Ok(())
                    },
                )
                .await;

            assert!(result.is_ok(), "Test failed: {result:?}");
        })
        .await;
}

// ============================================================================
// Test 2: Request IDs are properly tracked
// ============================================================================

#[tokio::test(flavor = "current_thread")]
async fn test_request_ids() {
    use tokio::task::LocalSet;

    let local = LocalSet::new();

    local
        .run_until(async {
            let (server_reader, server_writer, client_reader, client_writer) = setup_test_streams();

            let server_transport =
                agent_client_protocol::ByteStreams::new(server_writer, server_reader);
            let server = UntypedRole.builder().on_receive_request(
                async |request: PingRequest,
                       responder: Responder<PongResponse>,
                       _connection: ConnectionTo<UntypedRole>| {
                    responder.respond(PongResponse {
                        value: request.value + 1,
                    })
                },
                agent_client_protocol::on_receive_request!(),
            );

            let client_transport =
                agent_client_protocol::ByteStreams::new(client_writer, client_reader);
            let client = UntypedRole.builder();

            tokio::task::spawn_local(async move {
                server.connect_to(server_transport).await.ok();
            });

            let result = client
                .connect_with(
                    client_transport,
                    async |cx| -> Result<(), agent_client_protocol::Error> {
                        // Send multiple requests and verify responses match
                        let req1 = PingRequest { value: 1 };
                        let req2 = PingRequest { value: 2 };
                        let req3 = PingRequest { value: 3 };

                        let resp1_future = recv(cx.send_request(req1));
                        let resp2_future = recv(cx.send_request(req2));
                        let resp3_future = recv(cx.send_request(req3));

                        let resp1: Result<PongResponse, _> = resp1_future.await;
                        let resp2: Result<PongResponse, _> = resp2_future.await;
                        let resp3: Result<PongResponse, _> = resp3_future.await;

                        // Verify each response corresponds to its request
                        assert_eq!(resp1.unwrap().value, 2); // 1 + 1
                        assert_eq!(resp2.unwrap().value, 3); // 2 + 1
                        assert_eq!(resp3.unwrap().value, 4); // 3 + 1

                        Ok(())
                    },
                )
                .await;

            assert!(result.is_ok(), "Test failed: {result:?}");
        })
        .await;
}

// ============================================================================
// Test 3: Out-of-order responses
// ============================================================================

#[tokio::test(flavor = "current_thread")]
async fn test_out_of_order_responses() {
    use tokio::task::LocalSet;

    let local = LocalSet::new();

    local
        .run_until(async {
            let (server_reader, server_writer, client_reader, client_writer) = setup_test_streams();

            let server_transport =
                agent_client_protocol::ByteStreams::new(server_writer, server_reader);
            let server = UntypedRole.builder().on_receive_request(
                async |request: SlowRequest,
                       responder: Responder<SlowResponse>,
                       _connection: ConnectionTo<UntypedRole>| {
                    // Simulate delay
                    tokio::time::sleep(tokio::time::Duration::from_millis(request.delay_ms)).await;
                    responder.respond(SlowResponse { id: request.id })
                },
                agent_client_protocol::on_receive_request!(),
            );

            let client_transport =
                agent_client_protocol::ByteStreams::new(client_writer, client_reader);
            let client = UntypedRole.builder();

            tokio::task::spawn_local(async move {
                server.connect_to(server_transport).await.ok();
            });

            let result = client
                .connect_with(
                    client_transport,
                    async |cx| -> Result<(), agent_client_protocol::Error> {
                        // Send requests with different delays
                        // Request 1: 100ms delay
                        // Request 2: 50ms delay
                        // Request 3: 10ms delay
                        // Responses should arrive in order: 3, 2, 1

                        let req1 = SlowRequest {
                            delay_ms: 100,
                            id: 1,
                        };
                        let req2 = SlowRequest {
                            delay_ms: 50,
                            id: 2,
                        };
                        let req3 = SlowRequest {
                            delay_ms: 10,
                            id: 3,
                        };

                        let resp1_future = recv(cx.send_request(req1));
                        let resp2_future = recv(cx.send_request(req2));
                        let resp3_future = recv(cx.send_request(req3));

                        // Wait for all responses
                        let resp1: Result<SlowResponse, _> = resp1_future.await;
                        let resp2: Result<SlowResponse, _> = resp2_future.await;
                        let resp3: Result<SlowResponse, _> = resp3_future.await;

                        // Verify each future got the correct response despite out-of-order arrival
                        assert_eq!(resp1.unwrap().id, 1);
                        assert_eq!(resp2.unwrap().id, 2);
                        assert_eq!(resp3.unwrap().id, 3);

                        Ok(())
                    },
                )
                .await;

            assert!(result.is_ok(), "Test failed: {result:?}");
        })
        .await;
}
