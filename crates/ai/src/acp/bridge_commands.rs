use super::{
   bridge::AcpWorker,
   bridge_init::{ACP_STARTUP_STOPPED, InitializedAcpWorker, StartupAuth, initialize_worker},
   client::ClientResponders,
   mcp_servers::McpServerConfig,
   types::{AcpAgentStatus, AcpSessionList, AgentConfig, SessionConfigValue},
};
use crate::runtime::AthasAppHandle as AppHandle;
use anyhow::Result;
use athas_terminal::TerminalManager;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_util::sync::CancellationToken;

type StartResponse = oneshot::Sender<Result<(AcpAgentStatus, ClientResponders)>>;

/// Commands that can be sent to the ACP worker thread
#[allow(clippy::large_enum_variant)]
pub(super) enum AcpCommand {
   Initialize {
      agent_id: String,
      workspace_path: Option<String>,
      session_id: Option<String>,
      auth_method_id: Option<String>,
      mcp_servers: Vec<McpServerConfig>,
      config: Box<AgentConfig>,
      app_handle: AppHandle,
      terminal_manager: Arc<TerminalManager>,
      response_tx: StartResponse,
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
   Authenticate {
      method_id: String,
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
   Started {
      startup_id: u64,
      agent_id: String,
      signed_in_with_choice: bool,
      app_handle: AppHandle,
      result: Result<Box<InitializedAcpWorker>>,
      response_tx: StartResponse,
   },
}

/// The agent startup in progress, if any. Startup runs off the worker loop so Stop can end it.
#[derive(Default)]
struct Startup {
   next_id: u64,
   current: Option<(u64, CancellationToken)>,
}

impl Startup {
   fn begin(&mut self) -> (u64, CancellationToken) {
      self.stop();
      self.next_id += 1;
      let token = CancellationToken::new();
      self.current = Some((self.next_id, token.clone()));
      (self.next_id, token)
   }

   /// Stops the startup in progress. Returns whether there was one.
   fn stop(&mut self) -> bool {
      match self.current.take() {
         Some((_, token)) => {
            token.cancel();
            true
         }
         None => false,
      }
   }

   /// Whether `startup_id` finished while still wanted; clears it either way.
   fn finish(&mut self, startup_id: u64) -> bool {
      let wanted = self
         .current
         .as_ref()
         .is_some_and(|(id, token)| *id == startup_id && !token.is_cancelled());
      if wanted {
         self.current = None;
      }
      wanted
   }
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
   let mut startup = Startup::default();
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
                  auth_method_id,
                  mcp_servers,
                  config,
                  app_handle,
                  terminal_manager,
                  response_tx,
               } => {
                  let (startup_id, stop) = startup.begin();
                  let stopped = worker.stop().await;
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
                  if let Err(error) = stopped {
                     startup.finish(startup_id);
                     let _ = response_tx.send(Err(error));
                     continue;
                  }
                  if !config.installed {
                     log::warn!(
                        "Agent '{}' not marked as installed; attempting to start anyway",
                        config.name
                     );
                  }

                  let signed_in_with_choice = auth_method_id.is_some();
                  let startup_auth = StartupAuth {
                     allow_automatic: worker.allows_automatic_auth(&agent_id),
                     chosen_method_id: auth_method_id,
                  };
                  let followup_tx = followup_tx.clone();
                  tokio::task::spawn_local(async move {
                     let result = initialize_worker(
                        &config,
                        workspace_path,
                        app_handle.clone(),
                        terminal_manager,
                        session_id,
                        startup_auth,
                        &mcp_servers,
                        AcpWorker::map_config_options,
                        stop,
                     )
                     .await
                     .map(Box::new);
                     let _ = followup_tx.send(WorkerFollowUp::Started {
                        startup_id,
                        agent_id,
                        signed_in_with_choice,
                        app_handle,
                        result,
                        response_tx,
                     });
                  });
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
                  // Before a session exists there is no turn to cancel; stop the startup.
                  if startup.stop() {
                     let _ = response_tx.send(Ok(()));
                     continue;
                  }
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
               AcpCommand::Authenticate {
                  method_id,
                  response_tx,
               } => {
                  respond_in_background(worker.authenticate(method_id).await, response_tx);
                  {
                     let mut s = status.lock().await;
                     *s = worker.get_status();
                  }
               }
               AcpCommand::Stop { response_tx } => {
                  startup.stop();
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
            WorkerFollowUp::Started {
               startup_id,
               agent_id,
               signed_in_with_choice,
               app_handle,
               result,
               response_tx,
            } => {
               let wanted = startup.finish(startup_id);
               let response = match result {
                  Ok(initialized) if wanted => {
                     if signed_in_with_choice {
                        worker.signed_in(&agent_id);
                     }
                     Ok(worker.adopt(agent_id, app_handle, *initialized))
                  }
                  Ok(initialized) => {
                     // Stop (or a newer start) arrived as this one finished.
                     initialized.shut_down().await;
                     Err(anyhow::anyhow!(ACP_STARTUP_STOPPED))
                  }
                  Err(error) => Err(error),
               };
               {
                  let mut s = status.lock().await;
                  *s = worker.get_status();
               }
               let _ = response_tx.send(response);
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
   use super::{Startup, respond_in_background};
   use tokio::sync::oneshot;

   #[test]
   fn stopping_a_startup_cancels_it_and_rejects_its_result() {
      let mut startup = Startup::default();
      assert!(!startup.stop(), "nothing to stop before a start");

      let (first, first_token) = startup.begin();
      assert!(startup.stop());
      assert!(first_token.is_cancelled());
      assert!(
         !startup.finish(first),
         "a stopped startup must not be adopted"
      );
      assert!(!startup.stop());

      let (second, _) = startup.begin();
      let (third, _) = startup.begin();
      assert!(
         !startup.finish(second),
         "a newer start supersedes the older one"
      );
      assert!(startup.finish(third));
      assert!(
         !startup.stop(),
         "a finished startup is no longer in progress"
      );
   }

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
