// Types re-exported from crate root
use jsonrpcmsg::Params;

use crate::{
    ConnectionTo, Responder, JsonRpcNotification, JsonRpcRequest, UntypedMessage,
    util::json_cast,
};

/// Utility class for handling untyped requests.
#[must_use]
pub struct TypeRequest {
    state: Option<TypeMessageState>,
}

enum TypeMessageState {
    Unhandled(String, Option<Params>, Responder<serde_json::Value>),
    Handled(Result<(), crate::Error>),
}

impl TypeRequest {
    pub fn new(request: UntypedMessage, responder: Responder<serde_json::Value>) -> Self {
        let UntypedMessage { method, params } = request;
        let params: Option<Params> = json_cast(params).expect("valid params");
        Self {
            state: Some(TypeMessageState::Unhandled(method, params, responder)),
        }
    }

    pub async fn handle_if<R: JsonRpcRequest>(
        mut self,
        op: impl AsyncFnOnce(R, Responder<R::Response>) -> Result<(), crate::Error>,
    ) -> Self {
        self.state = Some(match self.state.take().expect("valid state") {
            TypeMessageState::Unhandled(method, params, responder) => {
                match R::parse_message(&method, &params) {
                    Some(Ok(request)) => {
                        TypeMessageState::Handled(op(request, responder.cast()).await)
                    }

                    Some(Err(err)) => TypeMessageState::Handled(responder.respond_with_error(err)),

                    None => TypeMessageState::Unhandled(method, params, responder),
                }
            }

            TypeMessageState::Handled(err) => TypeMessageState::Handled(err),
        });
        self
    }

    pub async fn otherwise(
        mut self,
        op: impl AsyncFnOnce(UntypedMessage, Responder<serde_json::Value>) -> Result<(), crate::Error>,
    ) -> Result<(), crate::Error> {
        match self.state.take().expect("valid state") {
            TypeMessageState::Unhandled(method, params, responder) => {
                match UntypedMessage::new(&method, params) {
                    Ok(m) => op(m, responder).await,
                    Err(err) => responder.respond_with_error(err),
                }
            }
            TypeMessageState::Handled(r) => r,
        }
    }
}

/// Utility class for handling untyped notifications.
#[must_use]
pub struct TypeNotification {
    cx: ConnectionTo,
    state: Option<TypeNotificationState>,
}

enum TypeNotificationState {
    Unhandled(String, Option<Params>),
    Handled(Result<(), crate::Error>),
}

impl TypeNotification {
    pub fn new(request: UntypedMessage, cx: &ConnectionTo) -> Self {
        let UntypedMessage { method, params } = request;
        let params: Option<Params> = json_cast(params).expect("valid params");
        Self {
            cx: cx.clone(),
            state: Some(TypeNotificationState::Unhandled(method, params)),
        }
    }

    pub async fn handle_if<N: JsonRpcNotification>(
        mut self,
        op: impl AsyncFnOnce(N) -> Result<(), crate::Error>,
    ) -> Self {
        self.state = Some(match self.state.take().expect("valid state") {
            TypeNotificationState::Unhandled(method, params) => {
                match N::parse_message(&method, &params) {
                    Some(Ok(request)) => TypeNotificationState::Handled(op(request).await),

                    Some(Err(err)) => {
                        TypeNotificationState::Handled(self.cx.send_error_notification(err))
                    }

                    None => TypeNotificationState::Unhandled(method, params),
                }
            }

            TypeNotificationState::Handled(err) => TypeNotificationState::Handled(err),
        });
        self
    }

    pub async fn otherwise(
        mut self,
        op: impl AsyncFnOnce(UntypedMessage) -> Result<(), crate::Error>,
    ) -> Result<(), crate::Error> {
        match self.state.take().expect("valid state") {
            TypeNotificationState::Unhandled(method, params) => {
                match UntypedMessage::new(&method, params) {
                    Ok(m) => op(m).await,
                    Err(err) => self.cx.send_error_notification(err),
                }
            }
            TypeNotificationState::Handled(r) => r,
        }
    }
}
