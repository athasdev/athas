use super::{
   bridge::AcpWorker,
   client::ClientResponders,
   types::{AcpAgentStatus, AcpSessionList, AgentConfig, SessionConfigValue},
};
use crate::runtime::AthasAppHandle as AppHandle;
use anyhow::Result;
use athas_terminal::TerminalManager;
use std::sync::Arc;
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
      response_tx: oneshot::Sender<Result<(AcpAgentStatus, ClientResponders)>>,
   },
   SendPrompt {
      prompt: Vec<serde_json::Value>,
      response_tx: oneshot::Sender<Result<()>>,
   },
   SetMode {
      mode_id: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
   SetConfigOption {
      config_id: String,
      value: SessionConfigValue,
      response_tx: oneshot::Sender<Result<()>>,
   },
   ListSessions {
      cwd: Option<String>,
      cursor: Option<String>,
      response_tx: oneshot::Sender<Result<AcpSessionList>>,
   },
   DeleteSession {
      session_id: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
   Logout {
      response_tx: oneshot::Sender<Result<()>>,
   },
   CancelPrompt {
      response_tx: oneshot::Sender<Result<()>>,
   },
   Stop {
      response_tx: oneshot::Sender<Result<()>>,
   },
}

/// Work that a background agent request hands back to the worker loop,
/// which owns the worker state.
enum WorkerFollowUp {
   SessionDeleted {
      session_id: String,
      response_tx: oneshot::Sender<Result<()>>,
   },
}

/// Runs a prepared agent request off the worker loop and answers the caller
/// when it finishes. Agent requests can take a while (or never answer), and
/// awaiting them inline would leave Cancel and Stop queued behind them.
fn respond_in_background<T: 'static>(
   prepared: Result<impl Future<Output = Result<T>> + 'static>,
   response_tx: oneshot::Sender<Result<T>>,
) {
   match prepared {
      Ok(request) => {
         tokio::task::spawn_local(async move {
            let _ = response_tx.send(request.await);
         });
      }
      Err(error) => {
         let _ = response_tx.send(Err(error));
      }
   }
}

pub(super) async fn run_worker_loop(
   mut command_rx: mpsc::Receiver<AcpCommand>,
   status: Arc<Mutex<AcpAgentStatus>>,
) {
   let mut worker = AcpWorker::new();
   let (followup_tx, mut followup_rx) = mpsc::unbounded_channel::<WorkerFollowUp>();
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
                  let result = worker.send_prompt(prompt).await;
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
                  respond_in_background(worker.set_mode(mode_id).await, response_tx);
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
               }
               AcpCommand::SetConfigOption {
                  config_id,
                  value,
                  response_tx,
               } => {
                  respond_in_background(
                     worker.set_config_option(config_id, value).await,
                     response_tx,
                  );
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
               }
               AcpCommand::CancelPrompt { response_tx } => {
                  let result = worker.cancel_prompt().await;
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
                  let _ = response_tx.send(result);
               }
               AcpCommand::ListSessions {
                  cwd,
                  cursor,
                  response_tx,
               } => {
                  respond_in_background(worker.list_sessions(cwd, cursor).await, response_tx);
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
               }
               AcpCommand::DeleteSession {
                  session_id,
                  response_tx,
               } => match worker.delete_session(session_id.clone()).await {
                  Ok(request) => {
                     let followup_tx = followup_tx.clone();
                     tokio::task::spawn_local(async move {
                        match request.await {
                           Ok(()) => {
                              // The worker owns the active session, so it clears it
                              // before the caller hears back.
                              let _ = followup_tx.send(WorkerFollowUp::SessionDeleted {
                                 session_id,
                                 response_tx,
                              });
                           }
                           Err(error) => {
                              let _ = response_tx.send(Err(error));
                           }
                        }
                     });
                  }
                  Err(error) => {
                     let _ = response_tx.send(Err(error));
                  }
               },
               AcpCommand::Logout { response_tx } => {
                  respond_in_background(worker.logout().await, response_tx);
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
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
         Some(followup) = followup_rx.recv() => match followup {
            WorkerFollowUp::SessionDeleted {
               session_id,
               response_tx,
            } => {
               worker.forget_session(&session_id);
               {
                  let mut s = status.lock().await;
                  *s = worker.get_status();
               }
               let _ = response_tx.send(Ok(()));
            }
         },
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

#[cfg(test)]
mod tests {
   use super::respond_in_background;
   use tokio::sync::oneshot;

   #[tokio::test]
   async fn a_hung_request_does_not_block_the_caller() {
      tokio::task::LocalSet::new()
         .run_until(async {
            let (hung_tx, mut hung_rx) = oneshot::channel::<anyhow::Result<()>>();
            respond_in_background(Ok(std::future::pending::<anyhow::Result<()>>()), hung_tx);

            let (done_tx, done_rx) = oneshot::channel();
            respond_in_background(Ok(async { Ok(5) }), done_tx);

            assert_eq!(done_rx.await.unwrap().unwrap(), 5);
            assert!(hung_rx.try_recv().is_err());
         })
         .await;
   }

   #[tokio::test]
   async fn a_request_that_cannot_start_is_answered_right_away() {
      let (response_tx, mut response_rx) = oneshot::channel::<anyhow::Result<()>>();
      respond_in_background(
         Err::<std::future::Ready<anyhow::Result<()>>, _>(anyhow::anyhow!("No active session")),
         response_tx,
      );

      let error = response_rx.try_recv().unwrap().unwrap_err();
      assert_eq!(error.to_string(), "No active session");
   }
}
