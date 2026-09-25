use super::{
   bridge::{AcpWorker, ResponderRegistry, Shutdown, connection_key},
   bridge_init::{
      ACP_STARTUP_STOPPED, OpenedSession, SessionTarget, StartedConnection, start_connection,
   },
   mcp_servers::McpServerConfig,
   sessions::{ConnectionKey, Startups},
   traffic::TrafficInspector,
   types::{AcpAgentStatus, AcpOpenedSession, AcpSessionList, AgentConfig, SessionConfigValue},
};
use crate::runtime::AthasAppHandle as AppHandle;
use anyhow::Result;
use athas_terminal::TerminalManager;
use std::{sync::Arc, time::Instant};
use tokio::sync::{Mutex, mpsc, oneshot};

type Response<T> = oneshot::Sender<Result<T>>;

/// A chat asking for its session on an agent.
pub(super) struct OpenRequest {
   /// The session the chat asks for.
   pub target: SessionTarget,
   /// The sign-in method the user picked after an earlier attempt needed one.
   pub auth_method_id: Option<String>,
   pub mcp_servers: Vec<McpServerConfig>,
   pub response_tx: Response<AcpOpenedSession>,
}

/// Commands that can be sent to the ACP worker thread
pub(super) enum AcpCommand {
   OpenSession {
      agent_id: String,
      workspace_path: Option<String>,
      config: Box<AgentConfig>,
      terminal_manager: Arc<TerminalManager>,
      request: OpenRequest,
   },
   SendPrompt {
      session_id: String,
      prompt: Vec<serde_json::Value>,
      response_tx: Response<()>,
   },
   SetMode {
      session_id: String,
      mode_id: String,
      response_tx: Response<()>,
   },
   SetConfigOption {
      session_id: String,
      config_id: String,
      value: SessionConfigValue,
      response_tx: Response<()>,
   },
   CloseSession {
      session_id: String,
      response_tx: Response<()>,
   },
   ListSessions {
      key: ConnectionKey,
      cwd: Option<String>,
      cursor: Option<String>,
      response_tx: Response<AcpSessionList>,
   },
   DeleteSession {
      key: ConnectionKey,
      session_id: String,
      response_tx: Response<()>,
   },
   Logout {
      key: ConnectionKey,
      response_tx: Response<()>,
   },
   Authenticate {
      key: ConnectionKey,
      method_id: String,
      response_tx: Response<()>,
   },
   /// Cancels `session_id`'s turn, or stops the startup of `key` when that session is not open.
   CancelPrompt {
      session_id: Option<String>,
      key: Option<ConnectionKey>,
      response_tx: Response<()>,
   },
   /// Stops the agent for `key`, or every agent.
   Stop {
      key: Option<ConnectionKey>,
      response_tx: Response<()>,
   },
}

/// Work that a background agent request hands back to the worker loop,
/// which owns the worker state.
pub(super) enum WorkerFollowUp {
   Started {
      key: ConnectionKey,
      startup_id: u64,
      result: Result<Box<StartedConnection>>,
   },
   SessionOpened {
      connection_id: u64,
      requested_session_id: Option<String>,
      signed_in_with_choice: bool,
      result: Result<OpenedSession>,
      response_tx: Response<AcpOpenedSession>,
   },
   PromptFinished {
      session_id: String,
   },
   SessionDeleted {
      session_id: String,
      response_tx: Response<()>,
   },
}

/// Runs a prepared agent request off the worker loop and answers the caller
/// when it finishes. Agent requests can take a while (or never answer), and
/// awaiting them inline would leave Cancel and Stop queued behind them.
fn respond_in_background<T: 'static>(
   prepared: Result<impl Future<Output = Result<T>> + 'static>,
   response_tx: Response<T>,
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

fn reject_stopped_startup(waiters: Vec<OpenRequest>) {
   for waiter in waiters {
      let _ = waiter
         .response_tx
         .send(Err(anyhow::anyhow!(ACP_STARTUP_STOPPED)));
   }
}

pub(super) async fn run_worker_loop(
   mut command_rx: mpsc::Receiver<AcpCommand>,
   status: Arc<Mutex<Vec<AcpAgentStatus>>>,
   app_handle: AppHandle,
   responders: ResponderRegistry,
   traffic: TrafficInspector,
) {
   let (followup_tx, mut followup_rx) = mpsc::unbounded_channel::<WorkerFollowUp>();
   let mut worker = AcpWorker::new(app_handle, responders, traffic, followup_tx.clone());
   let mut startups = Startups::<OpenRequest>::default();
   let mut health_check = tokio::time::interval(std::time::Duration::from_secs(1));
   health_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

   loop {
      tokio::select! {
         maybe_cmd = command_rx.recv() => {
            let Some(cmd) = maybe_cmd else {
               break;
            };
            handle_command(cmd, &mut worker, &mut startups, &followup_tx);
         }
         Some(followup) = followup_rx.recv() => {
            handle_followup(followup, &mut worker, &mut startups);
         }
         _ = health_check.tick() => {
            worker.sweep(Instant::now());
         }
      }
      *status.lock().await = worker.statuses();
   }
}

fn handle_command(
   cmd: AcpCommand,
   worker: &mut AcpWorker,
   startups: &mut Startups<OpenRequest>,
   followup_tx: &mpsc::UnboundedSender<WorkerFollowUp>,
) {
   match cmd {
      AcpCommand::OpenSession {
         agent_id,
         workspace_path,
         config,
         terminal_manager,
         request,
      } => {
         let key = match connection_key(agent_id, workspace_path) {
            Ok(key) => key,
            Err(error) => {
               let _ = request.response_tx.send(Err(error));
               return;
            }
         };
         if let Some(connection_id) = worker.connection_by_key(&key) {
            worker.open_session_on(connection_id, request);
            return;
         }
         // Chats that need an agent already starting wait for that startup.
         let Some((startup_id, stop)) = startups.join(key.clone(), request) else {
            return;
         };
         if !config.installed {
            log::warn!(
               "Agent '{}' not marked as installed; attempting to start anyway",
               config.name
            );
         }
         let app_handle = worker.app_handle();
         let traffic = worker.traffic();
         let followup_tx = followup_tx.clone();
         tokio::task::spawn_local(async move {
            let result = start_connection(
               &config,
               key.workspace_path.clone(),
               app_handle,
               terminal_manager,
               traffic,
               stop,
            )
            .await
            .map(Box::new);
            let _ = followup_tx.send(WorkerFollowUp::Started {
               key,
               startup_id,
               result,
            });
         });
      }
      AcpCommand::SendPrompt {
         session_id,
         prompt,
         response_tx,
      } => {
         let _ = response_tx.send(worker.send_prompt(session_id, prompt));
      }
      AcpCommand::SetMode {
         session_id,
         mode_id,
         response_tx,
      } => {
         respond_in_background(worker.set_mode(session_id, mode_id), response_tx);
      }
      AcpCommand::SetConfigOption {
         session_id,
         config_id,
         value,
         response_tx,
      } => {
         respond_in_background(
            worker.set_config_option(session_id, config_id, value),
            response_tx,
         );
      }
      AcpCommand::CloseSession {
         session_id,
         response_tx,
      } => {
         worker.close_session(&session_id);
         let _ = response_tx.send(Ok(()));
      }
      AcpCommand::CancelPrompt {
         session_id,
         key,
         response_tx,
      } => {
         let result = match session_id {
            Some(session_id) if worker.is_session_open(&session_id) => {
               worker.cancel_prompt(&session_id)
            }
            // Before the chat's session is open there is no turn to cancel; stop the startup.
            _ => {
               if let Some(waiters) = key.as_ref().and_then(|key| startups.stop(key)) {
                  reject_stopped_startup(waiters);
               }
               Ok(())
            }
         };
         let _ = response_tx.send(result);
      }
      AcpCommand::ListSessions {
         key,
         cwd,
         cursor,
         response_tx,
      } => {
         respond_in_background(worker.list_sessions(&key, cwd, cursor), response_tx);
      }
      AcpCommand::DeleteSession {
         key,
         session_id,
         response_tx,
      } => match worker.delete_session(&key, session_id.clone()) {
         Ok(request) => {
            let followup_tx = followup_tx.clone();
            tokio::task::spawn_local(async move {
               match request.await {
                  Ok(()) => {
                     // The worker owns the open sessions, so it forgets this one before the
                     // caller hears back.
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
      AcpCommand::Logout { key, response_tx } => {
         respond_in_background(worker.logout(&key), response_tx);
      }
      AcpCommand::Authenticate {
         key,
         method_id,
         response_tx,
      } => {
         respond_in_background(worker.authenticate(&key, method_id), response_tx);
      }
      AcpCommand::Stop { key, response_tx } => {
         let stopped_startups = match &key {
            Some(key) => startups.stop(key).unwrap_or_default(),
            None => startups.stop_all(),
         };
         reject_stopped_startup(stopped_startups);
         let shutdowns: Vec<_> = worker
            .connections_matching(key.as_ref())
            .into_iter()
            .map(|id| worker.shut_down(id, Shutdown::Requested))
            .collect();
         // The caller hears back once the processes are gone, so quitting the app does not
         // leave agents behind; the worker keeps serving other chats meanwhile.
         tokio::task::spawn_local(async move {
            for shutdown in shutdowns {
               shutdown.await;
            }
            let _ = response_tx.send(Ok(()));
         });
      }
   }
}

fn handle_followup(
   followup: WorkerFollowUp,
   worker: &mut AcpWorker,
   startups: &mut Startups<OpenRequest>,
) {
   match followup {
      WorkerFollowUp::Started {
         key,
         startup_id,
         result,
      } => match (startups.finish(&key, startup_id), result) {
         (Some(waiters), Ok(started)) => {
            let connection_id = worker.adopt(key, *started);
            for waiter in waiters {
               worker.open_session_on(connection_id, waiter);
            }
         }
         (Some(waiters), Err(error)) => {
            let message = error.to_string();
            let mut error = Some(error);
            for waiter in waiters {
               let error = error
                  .take()
                  .unwrap_or_else(|| anyhow::anyhow!(message.clone()));
               let _ = waiter.response_tx.send(Err(error));
            }
         }
         (None, Ok(started)) => {
            // Stop (or a newer start) arrived as this one finished; its waiters were told.
            tokio::task::spawn_local(started.shut_down());
         }
         (None, Err(_)) => {}
      },
      WorkerFollowUp::SessionOpened {
         connection_id,
         requested_session_id,
         signed_in_with_choice,
         result,
         response_tx,
      } => {
         worker.finish_session_open(
            connection_id,
            requested_session_id,
            signed_in_with_choice,
            result,
            response_tx,
         );
      }
      WorkerFollowUp::PromptFinished { session_id } => {
         worker.finish_prompt(&session_id);
      }
      WorkerFollowUp::SessionDeleted {
         session_id,
         response_tx,
      } => {
         worker.forget_session(&session_id);
         let _ = response_tx.send(Ok(()));
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
