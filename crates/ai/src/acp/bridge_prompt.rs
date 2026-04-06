use super::types::{AcpEvent, StopReason};
use acp::Agent;
use agent_client_protocol as acp;
use anyhow::{Context, Result, bail};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub(super) async fn run_prompt(
   connection: Arc<acp::ClientSideConnection>,
   session_id: acp::SessionId,
   app_handle: AppHandle,
   prompt: String,
   auth_method_id: Option<String>,
) -> Result<()> {
   let prompt_request = acp::PromptRequest::new(
      session_id.clone(),
      vec![acp::ContentBlock::Text(acp::TextContent::new(prompt))],
   );
   let response = send_prompt_with_auth_retry(connection, prompt_request, auth_method_id).await?;

   let stop_reason: StopReason = response.stop_reason.into();
   if let Err(e) = app_handle.emit(
      "acp-event",
      AcpEvent::PromptComplete {
         session_id: session_id.to_string(),
         stop_reason,
      },
   ) {
      log::warn!("Failed to emit prompt complete event: {}", e);
   }

   Ok(())
}

async fn send_prompt_with_auth_retry(
   connection: Arc<acp::ClientSideConnection>,
   prompt_request: acp::PromptRequest,
   auth_method_id: Option<String>,
) -> Result<acp::PromptResponse> {
   let mut prompt_result = send_prompt(connection.clone(), prompt_request.clone()).await;

   if let Ok(Err(err)) = &prompt_result
      && matches!(err.code, acp::ErrorCode::AuthRequired)
   {
      let Some(auth_method_id) = auth_method_id else {
         bail!("Authentication required before sending prompt");
      };

      let auth_request = acp::AuthenticateRequest::new(auth_method_id);
      match tokio::time::timeout(
         std::time::Duration::from_secs(30),
         connection.authenticate(auth_request),
      )
      .await
      {
         Ok(Ok(_)) => {
            log::info!("ACP prompt authentication succeeded, retrying prompt");
            prompt_result = send_prompt(connection.clone(), prompt_request).await;
         }
         Ok(Err(err)) => bail!("Authentication required: {}", err),
         Err(_) => bail!("Authentication required but timed out"),
      }
   }

   match prompt_result {
      Ok(Ok(response)) => Ok(response),
      Ok(Err(err)) if matches!(err.code, acp::ErrorCode::AuthRequired) => {
         bail!("Authentication required before sending prompt")
      }
      Ok(Err(err)) => Err(err).context("Failed to send prompt"),
      Err(_) => bail!("Timed out while sending prompt"),
   }
}

async fn send_prompt(
   connection: Arc<acp::ClientSideConnection>,
   prompt_request: acp::PromptRequest,
) -> Result<Result<acp::PromptResponse, acp::Error>, tokio::time::error::Elapsed> {
   tokio::time::timeout(
      std::time::Duration::from_secs(30),
      connection.prompt(prompt_request),
   )
   .await
}
