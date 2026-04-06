use super::{
   bridge::AcpWorker,
   client::PermissionResponse,
   types::{AcpAgentStatus, AgentConfig},
};
use anyhow::Result;
use athas_terminal::TerminalManager;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{Mutex, mpsc, oneshot};

/// Commands that can be sent to the ACP worker thread
#[allow(clippy::large_enum_variant)]
pub(super) enum AcpCommand {
   Initialize {
      agent_id: String,
      workspace_path: Option<String>,
      session_id: Option<String>,
      config: Box<AgentConfig>,
      app_handle: AppHandle,
      terminal_manager: Arc<TerminalManager>,
      response_tx: oneshot::Sender<Result<(AcpAgentStatus, mpsc::Sender<PermissionResponse>)>>,
   },
   SendPrompt {
      prompt: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
   SetMode {
      mode_id: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
   SetConfigOption {
      config_id: String,
      value: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
   CancelPrompt {
      response_tx: oneshot::Sender<Result<()>>,
   },
   Stop {
      response_tx: oneshot::Sender<Result<()>>,
   },
}

pub(super) async fn run_worker_loop(
   mut command_rx: mpsc::Receiver<AcpCommand>,
   status: Arc<Mutex<AcpAgentStatus>>,
) {
   let mut worker = AcpWorker::new();
   let mut health_check = tokio::time::interval(std::time::Duration::from_secs(1));
   health_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

   loop {
      tokio::select! {
         maybe_cmd = command_rx.recv() => {
            let Some(cmd) = maybe_cmd else {
               break;
            };

            match cmd {
               AcpCommand::Initialize {
                  agent_id,
                  workspace_path,
                  session_id,
                  config,
                  app_handle,
                  terminal_manager,
                  response_tx,
               } => {
                  let result = worker
                     .initialize(
                        agent_id,
                        workspace_path,
                        session_id,
                        *config,
                        app_handle,
                        terminal_manager,
                     )
                     .await;

                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }

                  let _ = response_tx.send(result);
               }
               AcpCommand::SendPrompt {
                  prompt,
                  response_tx,
               } => {
                  let result = worker.send_prompt(&prompt).await;
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
                  let _ = response_tx.send(result);
               }
               AcpCommand::SetMode {
                  mode_id,
                  response_tx,
               } => {
                  let result = worker.set_mode(&mode_id).await;
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
                  let _ = response_tx.send(result);
               }
               AcpCommand::SetConfigOption {
                  config_id,
                  value,
                  response_tx,
               } => {
                  let result = worker.set_config_option(&config_id, &value).await;
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
                  let _ = response_tx.send(result);
               }
               AcpCommand::CancelPrompt { response_tx } => {
                  let result = worker.cancel_prompt().await;
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
                  let _ = response_tx.send(result);
               }
               AcpCommand::Stop { response_tx } => {
                  let result = worker.stop().await;

                  {
                     let mut s = status.lock().await;
                     *s = AcpAgentStatus::default();
                  }

                  let _ = response_tx.send(result);
               }
            }
         }
         _ = health_check.tick() => {
            if let Err(err) = worker.ensure_process_alive().await {
               log::warn!("ACP worker process health check failed: {}", err);
            }
            {
               let mut s = status.lock().await;
               *s = worker.get_status();
            }
         }
      }
   }
}
