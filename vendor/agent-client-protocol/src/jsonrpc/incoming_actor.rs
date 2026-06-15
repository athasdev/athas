// Types re-exported from crate root
use std::collections::HashMap;

use futures::StreamExt as _;
use futures::channel::mpsc;
use futures::channel::oneshot;
use futures_concurrency::stream::StreamExt as _;
use rustc_hash::FxHashMap;
use uuid::Uuid;

use crate::Dispatch;
use crate::RoleId;
use crate::UntypedMessage;
use crate::jsonrpc::ConnectionTo;
use crate::jsonrpc::HandleDispatchFrom;
use crate::jsonrpc::OutgoingMessage;
use crate::jsonrpc::ReplyMessage;
use crate::jsonrpc::Responder;
use crate::jsonrpc::ResponseRouter;
use crate::jsonrpc::dynamic_handler::DynHandleDispatchFrom;
use crate::jsonrpc::dynamic_handler::DynamicHandlerMessage;
use crate::jsonrpc::outgoing_actor::send_raw_message;
use crate::jsonrpc::protocol_compat::ProtocolCompat;

use crate::role::Role;

use super::Handled;

struct PendingReply {
    method: String,
    role_id: RoleId,
    sender: oneshot::Sender<crate::jsonrpc::ResponsePayload>,
}

/// Incoming protocol actor: The central dispatch loop for a connection.
///
/// This actor handles JSON-RPC protocol semantics:
/// - Routes responses to pending request awaiters
/// - Routes requests/notifications to registered handlers
/// - Converts jsonrpcmsg::Request to UntypedMessage for handlers
/// - Manages reply subscriptions from outgoing requests
///
/// This is the protocol layer - it has no knowledge of how messages arrived.
///
/// The type parameter `MyRole` is the role of this endpoint (e.g., `Agent`).
/// Messages are received from `MyRole::Counterpart` (e.g., `Client`).
pub(super) async fn incoming_protocol_actor<Counterpart: Role>(
    counterpart: Counterpart,
    connection: &ConnectionTo<Counterpart>,
    transport_rx: mpsc::UnboundedReceiver<Result<jsonrpcmsg::Message, crate::Error>>,
    dynamic_handler_rx: mpsc::UnboundedReceiver<DynamicHandlerMessage<Counterpart>>,
    reply_rx: mpsc::UnboundedReceiver<ReplyMessage>,
    mut handler: impl HandleDispatchFrom<Counterpart>,
    protocol_compat: ProtocolCompat,
) -> Result<(), crate::Error> {
    let mut my_rx = transport_rx
        .map(IncomingProtocolMsg::Transport)
        .merge(dynamic_handler_rx.map(IncomingProtocolMsg::DynamicHandler))
        .merge(reply_rx.map(IncomingProtocolMsg::Reply));

    let mut dynamic_handlers: FxHashMap<Uuid, Box<dyn DynHandleDispatchFrom<Counterpart>>> =
        FxHashMap::default();
    let mut pending_messages: Vec<Dispatch> = vec![];

    // Map from request ID to (method, sender) for response dispatch.
    // Keys are JSON values because jsonrpcmsg::Id doesn't implement Eq.
    // The method is stored to allow routing responses through typed handlers.
    let mut pending_replies: HashMap<serde_json::Value, PendingReply> = HashMap::new();

    while let Some(message_result) = my_rx.next().await {
        tracing::trace!(message = ?message_result, actor = "incoming_protocol_actor");
        match message_result {
            IncomingProtocolMsg::Reply(message) => match message {
                ReplyMessage::Subscribe {
                    id,
                    role_id,
                    method,
                    sender,
                } => {
                    tracing::trace!(?id, %method, "incoming_actor: subscribing to response");
                    let id = serde_json::to_value(&id).unwrap();
                    pending_replies.insert(
                        id,
                        PendingReply {
                            method,
                            role_id,
                            sender,
                        },
                    );
                }
            },

            IncomingProtocolMsg::DynamicHandler(message) => match message {
                DynamicHandlerMessage::AddDynamicHandler(uuid, mut handler) => {
                    // Before adding the new handler, give it a chance to process
                    // any pending messages.
                    let mut new_pending_messages = vec![];
                    for pending_message in pending_messages {
                        tracing::trace!(method = pending_message.method(), handler = ?handler.dyn_describe_chain(), "Retrying message");
                        let id = pending_message.id();
                        let method = pending_message.method().to_string();
                        match handler
                            .dyn_handle_dispatch_from(pending_message, connection.clone())
                            .await
                        {
                            Ok(Handled::Yes) => {
                                tracing::trace!("Message handled");
                            }
                            Ok(Handled::No {
                                message: m,
                                retry: _,
                            }) => {
                                tracing::trace!(method = m.method(), handler = ?handler.dyn_describe_chain(), "Message not handled");
                                new_pending_messages.push(m);
                            }
                            Err(err) => {
                                tracing::warn!(?err, handler = ?handler.dyn_describe_chain(), "Dynamic handler errored on pending message, reporting back");
                                report_handler_error(connection, id, method, err)?;
                            }
                        }
                    }
                    pending_messages = new_pending_messages;

                    // Add handler so it will be used for future incoming messages.
                    dynamic_handlers.insert(uuid, handler);
                }
                DynamicHandlerMessage::RemoveDynamicHandler(uuid) => {
                    dynamic_handlers.remove(&uuid);
                }
            },

            IncomingProtocolMsg::Transport(message) => match message {
                Ok(message) => match message {
                    jsonrpcmsg::Message::Request(request) => {
                        tracing::trace!(method = %request.method, id = ?request.id, "Handling request");
                        let request_method = request.method.clone();
                        let request_id = request.id.clone();
                        match dispatch_from_request(connection, request, &protocol_compat) {
                            Ok(dispatch) => {
                                dispatch_dispatch(
                                    counterpart.clone(),
                                    connection,
                                    dispatch,
                                    &mut dynamic_handlers,
                                    &mut handler,
                                    &mut pending_messages,
                                )
                                .await?;
                            }
                            Err(error) => {
                                report_handler_error(
                                    connection,
                                    request_id.map(|id| serde_json::to_value(&id).unwrap()),
                                    request_method,
                                    error,
                                )?;
                            }
                        }
                    }
                    jsonrpcmsg::Message::Response(response) => {
                        tracing::trace!(id = ?response.id, has_result = response.result.is_some(), has_error = response.error.is_some(), "Handling response");
                        if let Some(id) = response.id {
                            let result = if let Some(value) = response.result {
                                Ok(value)
                            } else if let Some(error) = response.error {
                                // Convert jsonrpcmsg::Error to crate::Error
                                Err(crate::Error::new(error.code, error.message).data(error.data))
                            } else {
                                // Response with neither result nor error - treat as null result
                                Ok(serde_json::Value::Null)
                            };

                            let id_json = serde_json::to_value(&id).unwrap();
                            if let Some(pending_reply) = pending_replies.remove(&id_json) {
                                let result = protocol_compat
                                    .incoming_response(&pending_reply.method, result);
                                // Route the response through the handler chain
                                let dispatch = dispatch_from_response(id, pending_reply, result);
                                dispatch_dispatch(
                                    counterpart.clone(),
                                    connection,
                                    dispatch,
                                    &mut dynamic_handlers,
                                    &mut handler,
                                    &mut pending_messages,
                                )
                                .await?;
                            } else {
                                tracing::warn!(
                                    ?id,
                                    "incoming_actor: received response for unknown id, no subscriber found"
                                );
                            }
                        }
                    }
                },
                Err(error) => {
                    // Parse error from transport - send error notification back to remote
                    tracing::warn!(?error, "Transport parse error, sending error notification");
                    connection.send_error_notification(error)?;
                }
            },
        }
    }
    Ok(())
}

#[derive(Debug)]
enum IncomingProtocolMsg<Counterpart: Role> {
    Transport(Result<jsonrpcmsg::Message, crate::Error>),
    DynamicHandler(DynamicHandlerMessage<Counterpart>),
    Reply(ReplyMessage),
}

/// Dispatches a JSON-RPC request to the handler.
/// Report an error back to the server if it does not get handled.
fn dispatch_from_request<Counterpart: Role>(
    connection: &ConnectionTo<Counterpart>,
    request: jsonrpcmsg::Request,
    protocol_compat: &ProtocolCompat,
) -> Result<Dispatch, crate::Error> {
    let message = UntypedMessage::new(&request.method, &request.params).expect("well-formed JSON");
    let message = protocol_compat.incoming_message(message)?;

    match &request.id {
        Some(id) => Ok(Dispatch::Request(
            message,
            Responder::new(
                connection.message_tx.clone(),
                request.method.clone(),
                id.clone(),
            ),
        )),
        None => Ok(Dispatch::Notification(message)),
    }
}

/// Dispatches a JSON-RPC response through the handler chain.
///
/// This allows handlers to intercept and process responses before they reach
/// the awaiting code. The default behavior is to forward the response to the
/// local awaiter via the oneshot channel.
fn dispatch_from_response(
    id: jsonrpcmsg::Id,
    pending_reply: PendingReply,
    result: Result<serde_json::Value, crate::Error>,
) -> Dispatch {
    let PendingReply {
        method,
        role_id,
        sender,
    } = pending_reply;

    // Create a Dispatch::Response with a ResponseRouter that routes to the oneshot
    let router = ResponseRouter::new(method.clone(), id.clone(), role_id, sender);
    Dispatch::Response(result, router)
}

#[tracing::instrument(
    skip(connection, dispatch, dynamic_handlers, handler, pending_messages),
    fields(method = dispatch.method()),
    level = "trace",
)]
async fn dispatch_dispatch<Counterpart: Role>(
    counterpart: Counterpart,
    connection: &ConnectionTo<Counterpart>,
    mut dispatch: Dispatch,
    dynamic_handlers: &mut FxHashMap<Uuid, Box<dyn DynHandleDispatchFrom<Counterpart>>>,
    handler: &mut impl HandleDispatchFrom<Counterpart>,
    pending_messages: &mut Vec<Dispatch>,
) -> Result<(), crate::Error> {
    tracing::trace!(?dispatch, "dispatch_dispatch");

    let mut retry_any = false;

    let id = dispatch.id();
    let method = dispatch.method().to_string();

    // First, apply the handlers given by the user.
    tracing::trace!(handler = ?handler.describe_chain(), "Attempting handler chain");
    match handler
        .handle_dispatch_from(dispatch, connection.clone())
        .await
    {
        Ok(Handled::Yes) => {
            tracing::trace!(?method, ?id, handler = ?handler.describe_chain(), "Handler accepted message");
            return Ok(());
        }

        Ok(Handled::No { message: m, retry }) => {
            tracing::trace!(?method, ?id, handler = ?handler.describe_chain(), "Handler declined message");
            dispatch = m;
            retry_any |= retry;
        }

        Err(err) => {
            tracing::warn!(?method, ?id, ?err, handler = ?handler.describe_chain(), "Handler errored, reporting back to remote");
            return report_handler_error(connection, id, method, err);
        }
    }

    // Next, apply any dynamic handlers.
    for dynamic_handler in dynamic_handlers.values_mut() {
        tracing::trace!(handler = ?dynamic_handler.dyn_describe_chain(), "Attempting dynamic handler");
        match dynamic_handler
            .dyn_handle_dispatch_from(dispatch, connection.clone())
            .await
        {
            Ok(Handled::Yes) => {
                tracing::trace!(?method, ?id, handler = ?dynamic_handler.dyn_describe_chain(), "Dynamic handler accepted message");
                return Ok(());
            }

            Ok(Handled::No { message: m, retry }) => {
                tracing::trace!(?method, ?id, handler = ?dynamic_handler.dyn_describe_chain(),  "Dynamic handler declined message");
                retry_any |= retry;
                dispatch = m;
            }

            Err(err) => {
                tracing::warn!(?method, ?id, ?err, handler = ?dynamic_handler.dyn_describe_chain(), "Dynamic handler errored, reporting back to remote");
                return report_handler_error(connection, id, method, err);
            }
        }
    }

    // Finally, apply the default handler for the role.
    tracing::trace!(role = ?counterpart, "Attempting default handler");
    match counterpart
        .default_handle_dispatch_from(dispatch, connection.clone())
        .await
    {
        Ok(Handled::Yes) => {
            tracing::trace!(?method, handler = "default", "Role accepted message");
            return Ok(());
        }
        Ok(Handled::No { message: m, retry }) => {
            tracing::trace!(?method, handler = "default", "Role declined message");
            dispatch = m;
            retry_any |= retry;
        }
        Err(err) => {
            tracing::warn!(
                ?method,
                ?id,
                ?err,
                handler = "default",
                "Default handler errored, reporting back to remote"
            );
            return report_handler_error(connection, id, method, err);
        }
    }

    // If the message was never handled, check whether the retry flag was set.
    // If so, enqueue it for later processing. Else, reject it.
    if retry_any {
        tracing::debug!(
            ?method,
            "Retrying message as new dynamic handlers are added"
        );
        pending_messages.push(dispatch);
        Ok(())
    } else {
        match dispatch {
            Dispatch::Request(..) | Dispatch::Notification(_) => {
                tracing::info!(?method, "Rejecting message with error, no handler");
                let method = dispatch.method().to_string();
                dispatch.respond_with_error(
                    crate::Error::method_not_found().data(method),
                    connection.clone(),
                )
            }
            Dispatch::Response(result, router) => {
                tracing::trace!(?method, "Forwarding response");
                router.respond_with_result(result)
            }
        }
    }
}

/// When a handler returns an error, report it back to the remote side instead
/// of propagating it and tearing down the connection.
///
/// For requests (which have an id), sends a JSON-RPC error response.
/// For notifications (no id), sends an out-of-band error notification.
/// For responses, forwards the error to the local awaiter.
fn report_handler_error<Counterpart: Role>(
    connection: &ConnectionTo<Counterpart>,
    id: Option<serde_json::Value>,
    method: String,
    error: crate::Error,
) -> Result<(), crate::Error> {
    match id {
        Some(id) => {
            // Request: send error response with the original request id
            let jsonrpc_id = serde_json::from_value(id).unwrap_or(jsonrpcmsg::Id::Null);
            send_raw_message(
                &connection.message_tx,
                OutgoingMessage::Response {
                    id: jsonrpc_id,
                    method,
                    response: Err(error),
                },
            )
        }
        None => {
            // Notification or response without id: send error notification
            connection.send_error_notification(error)
        }
    }
}
