//! `initialize` and session setup against a scripted in-process agent, plus the agent process
//! helpers that need no Tauri app.

use super::*;
use crate::acp::{
   auth::AuthenticationRequired,
   bridge::map_config_options,
   fake_agent::{FakeAgent, connect_fake_agent},
};
use serde_json::Value;
use tokio::task::LocalSet;

const CWD: &str = "/work/app";

fn auth_error() -> Value {
   json!({ "error": { "code": -32000, "message": "Authentication required" } })
}

fn not_found() -> Value {
   json!({ "error": { "code": -32002, "message": "Session not found" } })
}

fn internal_error(message: &str) -> Value {
   json!({ "error": { "code": -32603, "message": message } })
}

fn new_session(session_id: &str) -> Value {
   json!({
      "result": {
         "sessionId": session_id,
         "modes": {
            "currentModeId": "code",
            "availableModes": [
               { "id": "code", "name": "Code", "description": "Writes code" },
               { "id": "ask", "name": "Ask" }
            ]
         },
         "configOptions": [
            serde_json::to_value(acp::SessionConfigOption::boolean("streaming", "Streaming", true))
               .unwrap()
         ]
      }
   })
}

fn login_method() -> acp::AuthMethod {
   acp::AuthMethod::Agent(acp::AuthMethodAgent::new("login", "Log in"))
}

struct Setup {
   auth_methods: Vec<acp::AuthMethod>,
   startup_auth: StartupAuth,
   can_load: bool,
   can_resume: bool,
   roots: Vec<PathBuf>,
}

impl Default for Setup {
   fn default() -> Self {
      Self {
         auth_methods: Vec::new(),
         startup_auth: StartupAuth {
            chosen_method_id: None,
            allow_automatic: true,
         },
         can_load: true,
         can_resume: true,
         roots: Vec::new(),
      }
   }
}

/// Runs `bootstrap_session` for `target` against an agent following `script`.
async fn bootstrap(
   script: Value,
   target: SessionTarget,
   setup: Setup,
) -> (Result<SessionBootstrap>, FakeAgent) {
   let (connection, agent) = connect_fake_agent(script).await;
   let replay = ReplayRouter::default();
   let result = bootstrap_session(
      connection,
      PathBuf::from(CWD),
      target,
      SessionBootstrapContext {
         auth_methods: &setup.auth_methods,
         startup_auth: setup.startup_auth,
         can_load_session: setup.can_load,
         can_resume_session: setup.can_resume,
         replay: &replay,
         scope: SessionScope {
            mcp_servers: &[],
            additional_directories: &setup.roots,
         },
         map_config_options,
      },
   )
   .await;
   (result, agent)
}

fn local<F: Future>(future: F) -> F::Output {
   tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .unwrap()
      .block_on(LocalSet::new().run_until(future))
}

#[test]
fn initializes_with_athas_client_capabilities() {
   local(async {
      let (connection, agent) = connect_fake_agent(json!({
         "initialize": {
            "result": serde_json::to_value(
               acp::InitializeResponse::new(ProtocolVersion::V1)
                  .agent_capabilities(acp::AgentCapabilities::new().load_session(true))
            ).unwrap()
         }
      }))
      .await;

      let response = initialize_connection(connection).await.unwrap();

      assert!(response.agent_capabilities.load_session);
      let params = &agent.params("initialize")[0];
      assert_eq!(params["protocolVersion"], 1);
      assert_eq!(params["clientInfo"]["name"], "athas");
      assert_eq!(params["clientCapabilities"]["terminal"], true);
      assert_eq!(params["clientCapabilities"]["fs"]["readTextFile"], true);
   });
}

#[test]
fn initialize_rejects_other_protocol_versions_and_agent_errors() {
   local(async {
      let mut response =
         serde_json::to_value(acp::InitializeResponse::new(ProtocolVersion::V1)).unwrap();
      response["protocolVersion"] = json!(2);
      let (connection, _agent) =
         connect_fake_agent(json!({ "initialize": { "result": response } })).await;
      let error = initialize_connection(connection).await.unwrap_err();
      assert!(
         error.to_string().contains("ACP protocol version 2"),
         "{error}"
      );

      let (connection, _agent) =
         connect_fake_agent(json!({ "initialize": internal_error("bad flags") })).await;
      let error = initialize_connection(connection).await.unwrap_err();
      assert!(
         error
            .to_string()
            .starts_with("Failed to initialize ACP connection"),
         "{error}"
      );
      assert!(error.to_string().contains("bad flags"), "{error}");
   });
}

#[test]
fn creates_a_new_session_with_modes_config_and_scope() {
   local(async {
      let (result, agent) = bootstrap(
         json!({ "session/new": new_session("s-new") }),
         SessionTarget::New,
         Setup {
            roots: vec![PathBuf::from("/work/docs")],
            ..Setup::default()
         },
      )
      .await;
      let session = result.unwrap();

      assert_eq!(session.session_id.to_string(), "s-new");
      assert!(!session.context_lost);
      assert!(session.history.is_empty());
      let modes = session.initial_modes.unwrap();
      assert_eq!(modes.current_mode_id.as_deref(), Some("code"));
      assert_eq!(modes.available_modes.len(), 2);
      assert_eq!(
         modes.available_modes[0].description.as_deref(),
         Some("Writes code")
      );
      let options = session.initial_config_options.unwrap();
      assert_eq!(options[0].id, "streaming");

      assert_eq!(agent.methods(), vec!["session/new"]);
      let params = &agent.params("session/new")[0];
      assert_eq!(params["cwd"], CWD);
      assert_eq!(params["additionalDirectories"], json!(["/work/docs"]));
      assert_eq!(params["mcpServers"], json!([]));
   });
}

#[test]
fn reattaches_by_resume_before_load() {
   local(async {
      let (result, agent) = bootstrap(
         json!({ "session/resume": { "result": {} } }),
         SessionTarget::Reattach("s1".to_string()),
         Setup::default(),
      )
      .await;
      let session = result.unwrap();
      assert_eq!(session.session_id.to_string(), "s1");
      assert!(!session.context_lost);
      assert_eq!(agent.methods(), vec!["session/resume"]);
      assert_eq!(agent.params("session/resume")[0]["sessionId"], "s1");

      let (result, agent) = bootstrap(
         json!({ "session/load": { "result": { "modes": {
            "currentModeId": "ask",
            "availableModes": [{ "id": "ask", "name": "Ask" }]
         } } } }),
         SessionTarget::Reattach("s2".to_string()),
         Setup {
            can_resume: false,
            ..Setup::default()
         },
      )
      .await;
      let session = result.unwrap();
      assert_eq!(session.session_id.to_string(), "s2");
      assert_eq!(
         session.initial_modes.unwrap().current_mode_id.as_deref(),
         Some("ask")
      );
      assert_eq!(agent.methods(), vec!["session/load"]);
   });
}

#[test]
fn falls_back_to_a_new_session_when_the_old_one_is_gone() {
   local(async {
      let (result, agent) = bootstrap(
         json!({
            "session/load": not_found(),
            "session/new": new_session("s-fresh")
         }),
         SessionTarget::Reattach("s-old".to_string()),
         Setup::default(),
      )
      .await;
      let session = result.unwrap();

      assert_eq!(session.session_id.to_string(), "s-fresh");
      assert!(
         session.context_lost,
         "the chat must hear its context is gone"
      );
      // session/resume is unscripted, so the agent answers Method not found and load is tried.
      assert_eq!(
         agent.methods(),
         vec!["session/resume", "session/load", "session/new"]
      );

      let (result, agent) = bootstrap(
         json!({ "session/new": new_session("s-fresh") }),
         SessionTarget::Reattach("s-old".to_string()),
         Setup {
            can_load: false,
            can_resume: false,
            ..Setup::default()
         },
      )
      .await;
      assert!(result.unwrap().context_lost);
      assert_eq!(agent.methods(), vec!["session/new"]);
   });
}

#[test]
fn reports_reopen_failures_other_than_a_missing_session() {
   local(async {
      let (result, agent) = bootstrap(
         json!({ "session/resume": internal_error("disk full") }),
         SessionTarget::Reattach("s1".to_string()),
         Setup::default(),
      )
      .await;
      let error = result.err().unwrap().to_string();
      assert!(
         error.starts_with("Failed to resume ACP session s1"),
         "{error}"
      );
      assert!(error.contains("disk full"), "{error}");
      assert_eq!(agent.methods(), vec!["session/resume"]);
   });
}

#[test]
fn imports_only_sessions_the_agent_can_load() {
   local(async {
      let (result, agent) = bootstrap(
         json!({ "session/load": { "result": {} } }),
         SessionTarget::Import("s-import".to_string()),
         Setup::default(),
      )
      .await;
      let session = result.unwrap();
      assert_eq!(session.session_id.to_string(), "s-import");
      assert!(session.history.is_empty());
      assert_eq!(agent.methods(), vec!["session/load"]);

      let (result, agent) = bootstrap(
         json!({ "session/load": not_found(), "session/new": new_session("unused") }),
         SessionTarget::Import("s-import".to_string()),
         Setup::default(),
      )
      .await;
      assert_eq!(
         result.err().unwrap().to_string(),
         "The agent could not load session s-import"
      );
      assert_eq!(
         agent.methods(),
         vec!["session/load"],
         "an import never creates a new session"
      );

      let (result, agent) = bootstrap(
         json!({}),
         SessionTarget::Import("s-import".to_string()),
         Setup {
            can_load: false,
            ..Setup::default()
         },
      )
      .await;
      assert!(result.is_err());
      assert!(agent.methods().is_empty());
   });
}

#[test]
fn signs_in_automatically_and_retries_session_setup() {
   local(async {
      let (result, agent) = bootstrap(
         json!({
            "session/new": [auth_error(), new_session("s-after-login")],
            "authenticate": { "result": {} }
         }),
         SessionTarget::New,
         Setup {
            auth_methods: vec![login_method()],
            ..Setup::default()
         },
      )
      .await;

      assert_eq!(result.unwrap().session_id.to_string(), "s-after-login");
      assert_eq!(
         agent.methods(),
         vec!["session/new", "authenticate", "session/new"]
      );
      assert_eq!(agent.params("authenticate")[0]["methodId"], "login");

      let (result, agent) = bootstrap(
         json!({
            "session/load": [auth_error(), { "result": {} }],
            "authenticate": { "result": {} }
         }),
         SessionTarget::Reattach("s1".to_string()),
         Setup {
            auth_methods: vec![login_method()],
            can_resume: false,
            ..Setup::default()
         },
      )
      .await;
      assert_eq!(result.unwrap().session_id.to_string(), "s1");
      assert_eq!(
         agent.methods(),
         vec!["session/load", "authenticate", "session/load"]
      );
   });
}

#[test]
fn asks_the_user_when_sign_in_cannot_happen_automatically() {
   local(async {
      for setup in [
         Setup {
            auth_methods: vec![login_method()],
            startup_auth: StartupAuth {
               chosen_method_id: None,
               allow_automatic: false,
            },
            ..Setup::default()
         },
         Setup::default(),
      ] {
         let (result, agent) = bootstrap(
            json!({ "session/new": auth_error() }),
            SessionTarget::New,
            setup,
         )
         .await;
         assert!(result.err().unwrap().is::<AuthenticationRequired>());
         assert_eq!(agent.methods(), vec!["session/new"]);
      }

      let (result, agent) = bootstrap(
         json!({ "session/resume": auth_error() }),
         SessionTarget::Reattach("s1".to_string()),
         Setup {
            startup_auth: StartupAuth {
               chosen_method_id: None,
               allow_automatic: false,
            },
            ..Setup::default()
         },
      )
      .await;
      assert!(result.err().unwrap().is::<AuthenticationRequired>());
      assert_eq!(agent.methods(), vec!["session/resume"]);
   });
}

#[test]
fn reports_sign_in_and_session_creation_failures() {
   local(async {
      let (result, _agent) = bootstrap(
         json!({
            "session/new": auth_error(),
            "authenticate": internal_error("wrong password")
         }),
         SessionTarget::New,
         Setup {
            auth_methods: vec![login_method()],
            ..Setup::default()
         },
      )
      .await;
      let error = result.err().unwrap().to_string();
      assert!(error.starts_with("ACP authentication failed"), "{error}");

      let (result, agent) = bootstrap(
         json!({ "session/new": auth_error() }),
         SessionTarget::New,
         Setup {
            auth_methods: vec![login_method()],
            startup_auth: StartupAuth {
               chosen_method_id: Some("sso".to_string()),
               allow_automatic: true,
            },
            ..Setup::default()
         },
      )
      .await;
      assert!(
         result
            .err()
            .unwrap()
            .to_string()
            .contains("does not offer the sign-in method 'sso'")
      );
      assert_eq!(agent.methods(), vec!["session/new"]);

      let (result, _agent) = bootstrap(
         json!({ "session/new": internal_error("no capacity") }),
         SessionTarget::New,
         Setup::default(),
      )
      .await;
      let error = result.err().unwrap().to_string();
      assert!(error.starts_with("Failed to create ACP session"), "{error}");
      assert!(error.contains("no capacity"), "{error}");
   });
}

fn agent_config(binary: &Path, args: &[&str]) -> AgentConfig {
   let mut config = AgentConfig::new("fake-agent", "Fake Agent", "fake-agent");
   config.binary_path = Some(binary.to_string_lossy().into_owned());
   config.args = args.iter().map(|arg| arg.to_string()).collect();
   config
}

#[cfg(unix)]
#[test]
fn spawns_agents_with_launch_env_config_env_and_workspace_cwd() {
   local(async {
      let workspace = tempfile::tempdir().unwrap();
      let mut config = agent_config(
         Path::new("/bin/sh"),
         &["-c", "echo \"$FROM_LAUNCH $SHARED $FROM_CONFIG\"; pwd"],
      );
      config.env_vars = HashMap::from([
         ("SHARED".to_string(), "config-wins".to_string()),
         ("FROM_CONFIG".to_string(), "config".to_string()),
      ]);
      let launch_env = HashMap::from([
         ("FROM_LAUNCH".to_string(), "launch".to_string()),
         ("SHARED".to_string(), "launch-loses".to_string()),
      ]);

      let child = spawn_agent_process(&config, &launch_env, Some(workspace.path())).unwrap();
      let output = child.wait_with_output().await.unwrap();
      let stdout = String::from_utf8(output.stdout).unwrap();
      let mut lines = stdout.lines();

      assert_eq!(lines.next(), Some("launch config-wins config"));
      assert_eq!(
         std::fs::canonicalize(lines.next().unwrap()).unwrap(),
         std::fs::canonicalize(workspace.path()).unwrap()
      );

      let missing = agent_config(&workspace.path().join("missing-agent"), &[]);
      assert!(spawn_agent_process(&missing, &HashMap::new(), None).is_err());
   });
}

#[cfg(unix)]
#[test]
fn startup_errors_carry_the_agents_last_relevant_stderr() {
   local(async {
      let config = agent_config(
         Path::new("/bin/sh"),
         &[
            "-c",
            "echo 'loading config' >&2; echo 'Error:  missing   API key' >&2; echo 'bye' >&2",
         ],
      );
      let traffic = TrafficInspector::default();
      let tap = traffic.start_process(&config.id, &config.name, None, Vec::new());
      let mut child = spawn_agent_process(&config, &HashMap::new(), None).unwrap();
      let stderr = spawn_stderr_logger(&mut child, config.name.clone(), tap);
      child.wait().await.unwrap();
      let recent = stderr.drained().await;
      assert_eq!(recent.lock().await.len(), 3);

      let error = with_agent_stderr(anyhow::anyhow!("Agent exited"), &recent).await;
      assert_eq!(
         error.to_string(),
         "Agent exited. Agent stderr: Error: missing API key"
      );

      let quiet = Arc::new(Mutex::new(VecDeque::new()));
      let error = with_agent_stderr(anyhow::anyhow!("Agent exited"), &quiet).await;
      assert_eq!(error.to_string(), "Agent exited");
   });
}

#[cfg(unix)]
#[test]
fn a_failed_startup_reports_what_the_agent_printed_after_stdout_closed() {
   local(async {
      // The agent exits at once, which fails `initialize`, and the reason reaches stderr only
      // afterwards, from a process it left running that ignores the stop signal.
      let config = agent_config(
         Path::new("/bin/sh"),
         &[
            "-c",
            concat!(
               "(trap '' TERM; exec >&- <&-; sleep 0.2; ",
               "echo 'Error: the agent needs an API key' >&2) & exit 3",
            ),
         ],
      );
      let error = start_connection(AgentLaunch {
         config: Box::new(config),
         launch_env: HashMap::new(),
         workspace_path: None,
         events: Arc::new(crate::acp::host::recording::RecordingSink::default()),
         app_version: "1.0.0".to_string(),
         terminal_manager: Arc::new(TerminalManager::new()),
         traffic: TrafficInspector::default(),
         stop: CancellationToken::new(),
      })
      .await
      .err()
      .unwrap()
      .to_string();

      assert!(
         error.ends_with("Agent stderr: Error: the agent needs an API key"),
         "{error}"
      );
   });
}
