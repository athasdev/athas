//! ACP sign-in: which methods the user can pick from, which one Athas may use on its own, and
//! how terminal methods are launched.
//!
//! `agent` methods are completed by calling `authenticate` with the method id. `terminal`
//! methods, and agent methods that carry the older `_meta["terminal-auth"]` launch, are
//! completed by the user in a terminal and are never passed to `authenticate`.

use super::types::{AcpAuthMethod, AcpAuthMethodKind, AcpTerminalAuthLaunch, AgentConfig};
use agent_client_protocol::schema::v1 as acp;
use anyhow::{Result, bail};
use serde::Deserialize;
use std::{collections::HashMap, time::Duration};

/// How long an `authenticate` call may take. Agents often wait on a browser sign-in here.
pub(super) const ACP_AUTHENTICATE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Client capability `_meta` key that tells agents predating `auth.terminal` that Athas can run
/// their terminal sign-in, and the method `_meta` key those agents describe it under.
pub(super) const LEGACY_TERMINAL_AUTH_META_KEY: &str = "terminal-auth";

/// The agent needs the user to choose how to sign in.
#[derive(Debug)]
pub(super) struct AuthenticationRequired;

impl std::fmt::Display for AuthenticationRequired {
   fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
      f.write_str("Authentication required: choose how to sign in to the agent")
   }
}

impl std::error::Error for AuthenticationRequired {
}

#[derive(Deserialize)]
struct LegacyTerminalAuth {
   #[serde(default)]
   label: Option<String>,
   command: String,
   #[serde(default)]
   args: Vec<String>,
   #[serde(default)]
   env: HashMap<String, String>,
}

/// The launch an agent method describes in `_meta["terminal-auth"]`, the form used before
/// terminal methods were part of the protocol.
fn legacy_terminal_launch(method: &acp::AuthMethod) -> Option<AcpTerminalAuthLaunch> {
   let acp::AuthMethod::Agent(method) = method else {
      return None;
   };
   let value = method
      .meta
      .as_ref()?
      .get(LEGACY_TERMINAL_AUTH_META_KEY)?
      .clone();
   let legacy = serde_json::from_value::<LegacyTerminalAuth>(value).ok()?;
   if legacy.command.trim().is_empty() {
      return None;
   }
   Some(AcpTerminalAuthLaunch {
      label: legacy.label.unwrap_or_else(|| method.name.clone()),
      command: legacy.command,
      args: legacy.args,
      env: legacy.env,
   })
}

/// A terminal method runs the agent's own command with the method's extra arguments and
/// environment, which override the launch configuration's.
fn terminal_launch(
   method: &acp::AuthMethodTerminal,
   config: &AgentConfig,
) -> AcpTerminalAuthLaunch {
   let command = config
      .binary_path
      .clone()
      .unwrap_or_else(|| config.binary_name.clone());
   let args = config.args.iter().chain(&method.args).cloned().collect();
   let mut env = config.env_vars.clone();
   env.extend(method.env.clone());
   AcpTerminalAuthLaunch {
      label: method.name.clone(),
      command,
      args,
      env,
   }
}

/// Whether the method is completed by calling `authenticate`.
fn uses_authenticate(method: &acp::AuthMethod) -> bool {
   matches!(method, acp::AuthMethod::Agent(_)) && legacy_terminal_launch(method).is_none()
}

/// Describes the methods for the frontend. Method kinds this client does not know are left out,
/// since it could not complete them.
pub(super) fn describe_auth_methods(
   methods: &[acp::AuthMethod],
   config: &AgentConfig,
) -> Vec<AcpAuthMethod> {
   methods
      .iter()
      .filter_map(|method| {
         let terminal = match method {
            acp::AuthMethod::Terminal(terminal) => Some(terminal_launch(terminal, config)),
            acp::AuthMethod::Agent(_) => legacy_terminal_launch(method),
            _ => return None,
         };
         Some(AcpAuthMethod {
            id: method.id().to_string(),
            name: method.name().to_string(),
            description: method.description().map(ToString::to_string),
            kind: if terminal.is_some() {
               AcpAuthMethodKind::Terminal
            } else {
               AcpAuthMethodKind::Agent
            },
            terminal,
         })
      })
      .collect()
}

/// The method Athas may use without asking: the agent offers exactly one way to sign in, and it
/// runs through `authenticate`. Anything else is the user's choice.
pub(super) fn automatic_auth_method(methods: &[acp::AuthMethod]) -> Option<acp::AuthMethodId> {
   match methods {
      [method] if uses_authenticate(method) => Some(method.id().clone()),
      _ => None,
   }
}

/// Resolves the method the user picked for `authenticate`, refusing terminal methods.
pub(super) fn authenticate_method(
   methods: &[acp::AuthMethod],
   method_id: &str,
) -> Result<acp::AuthMethodId> {
   let Some(method) = methods
      .iter()
      .find(|method| method.id().0.as_ref() == method_id)
   else {
      bail!("The agent does not offer the sign-in method '{method_id}'");
   };
   if !uses_authenticate(method) {
      bail!(
         "'{}' signs in through a terminal, not through the agent",
         method.name()
      );
   }
   Ok(method.id().clone())
}

/// The method startup authenticates with when the agent asks for it: the user's pick, or the
/// automatic one unless the user just logged out and should choose again.
pub(super) fn startup_auth_method(
   methods: &[acp::AuthMethod],
   chosen: Option<&str>,
   allow_automatic: bool,
) -> Result<Option<acp::AuthMethodId>> {
   if let Some(method_id) = chosen {
      return authenticate_method(methods, method_id).map(Some);
   }
   Ok(allow_automatic
      .then(|| automatic_auth_method(methods))
      .flatten())
}

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   fn config() -> AgentConfig {
      let mut config = AgentConfig::new("test-agent", "Test Agent", "test-agent");
      config.binary_path = Some("/opt/test-agent".to_string());
      config.args = vec!["--acp".to_string()];
      config.env_vars = HashMap::from([
         ("MODE".to_string(), "acp".to_string()),
         ("KEEP".to_string(), "1".to_string()),
      ]);
      config
   }

   fn agent(id: &str) -> acp::AuthMethod {
      acp::AuthMethod::Agent(acp::AuthMethodAgent::new(
         id.to_string(),
         format!("Agent {id}"),
      ))
   }

   fn terminal(id: &str) -> acp::AuthMethod {
      acp::AuthMethod::Terminal(
         acp::AuthMethodTerminal::new(id.to_string(), "Log in")
            .args(vec!["login".to_string()])
            .env(HashMap::from([("MODE".to_string(), "login".to_string())])),
      )
   }

   fn legacy(id: &str, terminal_auth: serde_json::Value) -> acp::AuthMethod {
      let meta = acp::Meta::from_iter([(LEGACY_TERMINAL_AUTH_META_KEY.to_string(), terminal_auth)]);
      acp::AuthMethod::Agent(acp::AuthMethodAgent::new(id.to_string(), "Legacy login").meta(meta))
   }

   #[test]
   fn terminal_methods_never_go_to_authenticate() {
      let methods = vec![terminal("tui"), agent("key")];
      let error = authenticate_method(&methods, "tui").unwrap_err();
      assert!(error.to_string().contains("terminal"), "{error}");
      assert!(startup_auth_method(&methods, Some("tui"), true).is_err());
      assert_eq!(automatic_auth_method(&[terminal("tui")]), None);
   }

   #[test]
   fn legacy_terminal_meta_is_treated_as_a_terminal_method() {
      let method = legacy(
         "claude-login",
         json!({ "label": "claude /login", "command": "claude", "args": ["/login"], "env": { "A": "1" } }),
      );
      assert!(authenticate_method(std::slice::from_ref(&method), "claude-login").is_err());
      assert_eq!(automatic_auth_method(std::slice::from_ref(&method)), None);

      let described = describe_auth_methods(&[method], &config());
      assert_eq!(described[0].kind, AcpAuthMethodKind::Terminal);
      assert_eq!(
         described[0].terminal,
         Some(AcpTerminalAuthLaunch {
            label: "claude /login".to_string(),
            command: "claude".to_string(),
            args: vec!["/login".to_string()],
            env: HashMap::from([("A".to_string(), "1".to_string())]),
         })
      );
   }

   #[test]
   fn invalid_legacy_meta_leaves_an_agent_method() {
      for meta in [
         json!({ "label": "No command" }),
         json!("yes"),
         json!({ "command": " " }),
      ] {
         let method = legacy("login", meta);
         assert_eq!(legacy_terminal_launch(&method), None);
         assert_eq!(
            authenticate_method(std::slice::from_ref(&method), "login")
               .unwrap()
               .to_string(),
            "login"
         );
      }
   }

   #[test]
   fn legacy_label_defaults_to_the_method_name() {
      let method = legacy("login", json!({ "command": "agent" }));
      assert_eq!(
         legacy_terminal_launch(&method).unwrap().label,
         "Legacy login"
      );
   }

   #[test]
   fn terminal_launch_extends_the_agent_invocation() {
      let described = describe_auth_methods(&[terminal("tui")], &config());
      let launch = described[0].terminal.clone().unwrap();
      assert_eq!(launch.command, "/opt/test-agent");
      assert_eq!(launch.args, vec!["--acp".to_string(), "login".to_string()]);
      assert_eq!(launch.env["MODE"], "login");
      assert_eq!(launch.env["KEEP"], "1");
   }

   #[test]
   fn only_a_single_agent_method_is_used_automatically() {
      assert_eq!(
         automatic_auth_method(&[agent("oauth")]).map(|id| id.to_string()),
         Some("oauth".to_string())
      );
      assert_eq!(automatic_auth_method(&[agent("a"), agent("b")]), None);
      assert_eq!(automatic_auth_method(&[agent("a"), terminal("tui")]), None);
      assert_eq!(automatic_auth_method(&[]), None);
   }

   #[test]
   fn startup_prefers_the_users_pick_and_skips_automatic_after_logout() {
      let methods = vec![agent("oauth")];
      assert_eq!(
         startup_auth_method(&methods, None, true)
            .unwrap()
            .map(|id| id.to_string()),
         Some("oauth".to_string())
      );
      assert_eq!(startup_auth_method(&methods, None, false).unwrap(), None);
      assert_eq!(
         startup_auth_method(&methods, Some("oauth"), false)
            .unwrap()
            .map(|id| id.to_string()),
         Some("oauth".to_string())
      );
      assert!(startup_auth_method(&methods, Some("missing"), true).is_err());
   }
}
