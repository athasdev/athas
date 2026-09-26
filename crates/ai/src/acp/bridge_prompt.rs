use super::{
   AcpConnection,
   auth::ACP_AUTHENTICATE_TIMEOUT,
   types::{AcpAuthMethod, AcpEvent, AcpTurnUsage, StopReason},
};
use crate::runtime::AthasAppHandle as AppHandle;
use agent_client_protocol::schema::v1 as acp;
use anyhow::{Context, Result, bail};
use std::{sync::Arc, time::Duration};
use tauri::Emitter;

const ACP_PROMPT_TURN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// How long a timed-out turn gets to wind down after `session/cancel` before it is reported.
const ACP_PROMPT_CANCEL_GRACE: Duration = Duration::from_secs(10);

/// How a prompt signs in when the agent asks for it.
pub(super) struct PromptAuth {
   pub agent_id: String,
   /// The method used without asking, if any; otherwise the user is shown `methods`.
   pub automatic_method_id: Option<acp::AuthMethodId>,
   pub methods: Vec<AcpAuthMethod>,
}

pub(super) async fn run_prompt(
   connection: Arc<AcpConnection>,
   session_id: acp::SessionId,
   app_handle: AppHandle,
   prompt: Vec<serde_json::Value>,
   auth: PromptAuth,
) -> Result<()> {
   let prompt = prompt
      .into_iter()
      .map(serde_json::from_value)
      .collect::<Result<Vec<acp::ContentBlock>, _>>()
      .context("Failed to decode ACP prompt content blocks")?;
   let prompt_request = acp::PromptRequest::new(session_id.clone(), prompt);
   let response =
      send_prompt_with_auth_retry(connection, prompt_request, auth, &app_handle).await?;

   if let Err(e) = app_handle.emit(
      "acp-event",
      prompt_complete_event(session_id.to_string(), response),
   ) {
      log::warn!("Failed to emit prompt complete event: {}", e);
   }

   Ok(())
}

/// The event that ends a turn in the chat, with the turn's token usage when the agent sent it.
fn prompt_complete_event(session_id: String, response: acp::PromptResponse) -> AcpEvent {
   let stop_reason: StopReason = response.stop_reason.into();
   AcpEvent::PromptComplete {
      session_id,
      stop_reason,
      usage: response.usage.map(|usage| AcpTurnUsage {
         total_tokens: usage.total_tokens,
         input_tokens: usage.input_tokens,
         output_tokens: usage.output_tokens,
         thought_tokens: usage.thought_tokens,
         cached_read_tokens: usage.cached_read_tokens,
         cached_write_tokens: usage.cached_write_tokens,
      }),
   }
}

async fn send_prompt_with_auth_retry(
   connection: Arc<AcpConnection>,
   prompt_request: acp::PromptRequest,
   auth: PromptAuth,
   app_handle: &AppHandle,
) -> Result<acp::PromptResponse> {
   let mut prompt_result = send_prompt(connection.clone(), prompt_request.clone()).await;

   if let Ok(Err(err)) = &prompt_result
      && matches!(err.code, acp::ErrorCode::AuthRequired)
   {
      let Some(auth_method_id) = auth.automatic_method_id else {
         // The user picks a method in the chat; the prompt is sent again once they signed in.
         if let Err(error) = app_handle.emit(
            "acp-event",
            AcpEvent::AuthRequired {
               agent_id: auth.agent_id,
               session_id: Some(prompt_request.session_id.to_string()),
               methods: auth.methods,
            },
         ) {
            log::warn!("Failed to emit ACP auth required event: {}", error);
         }
         bail!("Authentication required before sending prompt");
      };

      let auth_request = acp::AuthenticateRequest::new(auth_method_id);
      match tokio::time::timeout(
         ACP_AUTHENTICATE_TIMEOUT,
         connection.send_request(auth_request).block_task(),
      )
      .await
      {
         Ok(Ok(_)) => {
            log::info!("ACP prompt authentication succeeded, retrying prompt");
            prompt_result = send_prompt(connection.clone(), prompt_request).await;
         }
         Ok(Err(err)) => bail!("Authentication required: {}", err),
         Err(_) => bail!("Authentication required but the ACP adapter did not respond in time"),
      }
   }

   match prompt_result {
      Ok(Ok(response)) => Ok(response),
      Ok(Err(err)) if matches!(err.code, acp::ErrorCode::AuthRequired) => {
         bail!("Authentication required before sending prompt")
      }
      Ok(Err(err)) => Err(err).context("Failed to send prompt"),
      Err(TurnTimedOut) => bail!(
         "The agent did not finish the turn within {} minutes, so Athas cancelled it",
         ACP_PROMPT_TURN_TIMEOUT.as_secs() / 60
      ),
   }
}

struct TurnTimedOut;

async fn send_prompt(
   connection: Arc<AcpConnection>,
   prompt_request: acp::PromptRequest,
) -> Result<Result<acp::PromptResponse, acp::Error>, TurnTimedOut> {
   let session_id = prompt_request.session_id.clone();
   let request = connection.send_request(prompt_request).block_task();
   await_turn(
      request,
      ACP_PROMPT_TURN_TIMEOUT,
      ACP_PROMPT_CANCEL_GRACE,
      || {
         if let Err(error) = connection.send_notification(acp::CancelNotification::new(session_id))
         {
            log::warn!("Failed to cancel the timed-out ACP prompt turn: {}", error);
         }
      },
   )
   .await
}

/// Waits for a prompt turn. A turn that outlives `limit` is not just abandoned: the agent is
/// told with `session/cancel` (so it stops working and releases what it holds) and gets `grace`
/// to wind down before the turn is reported as timed out.
async fn await_turn<T>(
   request: impl Future<Output = T>,
   limit: Duration,
   grace: Duration,
   cancel: impl FnOnce(),
) -> Result<T, TurnTimedOut> {
   let mut request = std::pin::pin!(request);
   if let Ok(response) = tokio::time::timeout(limit, request.as_mut()).await {
      return Ok(response);
   }
   cancel();
   let _ = tokio::time::timeout(grace, request).await;
   Err(TurnTimedOut)
}

#[cfg(test)]
mod tests {
   use super::{acp, await_turn, prompt_complete_event};
   use serde_json::json;

   #[test]
   fn the_turn_end_carries_its_token_usage() {
      let response = acp::PromptResponse::new(acp::StopReason::EndTurn)
         .usage(acp::Usage::new(1200, 1000, 200).cached_read_tokens(800));
      assert_eq!(
         serde_json::to_value(prompt_complete_event("s1".into(), response)).unwrap(),
         json!({
            "type": "prompt_complete",
            "sessionId": "s1",
            "stopReason": "end_turn",
            "usage": {
               "totalTokens": 1200,
               "inputTokens": 1000,
               "outputTokens": 200,
               "thoughtTokens": null,
               "cachedReadTokens": 800,
               "cachedWriteTokens": null,
            },
         })
      );

      let response = acp::PromptResponse::new(acp::StopReason::EndTurn);
      let event = serde_json::to_value(prompt_complete_event("s1".into(), response)).unwrap();
      assert_eq!(event["usage"], json!(null));
   }

   use std::{cell::Cell, time::Duration};

   #[tokio::test]
   async fn a_turn_that_finishes_in_time_is_not_cancelled() {
      let cancelled = Cell::new(false);
      let result = await_turn(
         async { 7 },
         Duration::from_secs(1),
         Duration::from_secs(1),
         || cancelled.set(true),
      )
      .await;
      assert_eq!(result.ok(), Some(7));
      assert!(!cancelled.get());
   }

   #[tokio::test]
   async fn a_timed_out_turn_cancels_the_agent_then_reports_the_timeout() {
      let cancelled = Cell::new(false);
      let result = await_turn(
         std::future::pending::<()>(),
         Duration::from_millis(20),
         Duration::from_millis(20),
         || cancelled.set(true),
      )
      .await;
      assert!(result.is_err());
      assert!(cancelled.get());
   }

   #[tokio::test]
   async fn a_timed_out_turn_waits_for_the_cancelled_response() {
      let finished = Cell::new(false);
      let result = await_turn(
         async {
            tokio::time::sleep(Duration::from_millis(60)).await;
            finished.set(true);
         },
         Duration::from_millis(20),
         Duration::from_secs(5),
         || {},
      )
      .await;
      assert!(result.is_err());
      assert!(finished.get(), "the grace period lets the turn wind down");
   }
}
