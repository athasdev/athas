//! Reads the GitHub token owned by the user's `gh` CLI installation.
//!
//! The token is read on demand and never persisted by Athas: `gh auth switch`,
//! `gh auth logout` and token rotation must take effect immediately, and Athas
//! should not hold a second copy of a credential it did not mint.

use athas_exec_path::{find_executable, probe_command, user_shell_path};
use std::{process::Command, time::Duration};

/// `gh auth token` reads a local keyring entry; it never blocks on the network.
const GH_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

fn gh_command() -> Option<Command> {
   let binary = find_executable("gh")?;
   let mut command = Command::new(binary);
   // A GUI launch inherits a minimal PATH, so `gh` would not find `git`.
   if let Some(path) = user_shell_path() {
      command.env("PATH", path);
   }
   // `gh` renders hints and spinners when it believes a human is watching.
   command.env("GH_NO_UPDATE_NOTIFIER", "1");
   command.env("NO_COLOR", "1");
   Some(command)
}

fn run_gh(args: &[&str]) -> Option<String> {
   let mut command = gh_command()?;
   command.args(args);
   let output = probe_command(&mut command, GH_COMMAND_TIMEOUT)
      .inspect_err(|error| log::warn!("Failed to run gh {}: {error}", args.join(" ")))
      .ok()?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      log::debug!(
         "gh {} exited unsuccessfully: {}",
         args.join(" "),
         stderr.trim()
      );
      return None;
   }

   String::from_utf8(output.stdout).ok()
}

/// True when a `gh` binary is discoverable, regardless of whether it is logged in.
pub fn is_gh_cli_installed() -> bool {
   find_executable("gh").is_some()
}

/// Extracts a credential from `gh auth token` output.
///
/// `gh` prints the bare token on success, so anything carrying whitespace is a
/// message rather than a credential and must not be sent to GitHub as one.
fn parse_gh_token_output(output: &str) -> Option<String> {
   let token = output.trim();

   if token.is_empty() || token.split_whitespace().count() != 1 {
      return None;
   }

   Some(token.to_string())
}

/// The token for the active `gh` account, or `None` when `gh` is missing or logged out.
pub fn gh_cli_token() -> Option<String> {
   parse_gh_token_output(&run_gh(&["auth", "token"])?)
}

#[cfg(test)]
mod tests {
   use super::parse_gh_token_output;

   #[test]
   fn reads_the_token_gh_prints_on_success() {
      assert_eq!(
         parse_gh_token_output("gho_exampletoken\n").as_deref(),
         Some("gho_exampletoken")
      );
   }

   #[test]
   fn rejects_output_that_is_a_message_rather_than_a_token() {
      // A logged-out `gh` can still exit zero while explaining itself on stdout.
      assert_eq!(parse_gh_token_output("no oauth token found"), None);
      assert_eq!(parse_gh_token_output(""), None);
      assert_eq!(parse_gh_token_output("   \n"), None);
   }
}
