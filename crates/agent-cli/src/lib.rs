mod agent;
mod session;
mod tui;

use anyhow::{Context, Result, bail};
use std::{env, path::PathBuf};

#[derive(Clone)]
pub struct Options {
   pub root: PathBuf,
   pub provider: String,
   pub model: String,
   pub session: Option<String>,
   pub continue_last: bool,
   pub format_json: bool,
   pub desktop_binary: PathBuf,
   pub app_identifier: String,
}

pub const HELP: &str = r#"Athas Agent

Usage:
  athas agent [--cwd DIR] [--provider athas|openai|openrouter|ollama] [--model MODEL]
  athas run [options] [--format json] <prompt>

Options:
  --cwd DIR          Workspace directory (default: current directory)
  --provider NAME    Model provider (default: athas)
  --model MODEL      Model ID (default: auto for Athas)
  --continue         Continue the most recent session in this workspace
  --session ID       Continue a specific session
  --format json      Emit JSONL events for scripts (run only)

Credentials: Athas Desktop sign-in, OPENAI_API_KEY or OPENROUTER_API_KEY.
Ollama uses its local server.
"#;

fn parse_options(args: &[String], desktop_binary: PathBuf) -> Result<(Options, Option<String>)> {
   let mut root = env::current_dir()?;
   let app_identifier =
      env::var("ATHAS_APP_IDENTIFIER").unwrap_or_else(|_| "com.code.athas".into());
   let mut provider = env::var("ATHAS_AGENT_PROVIDER").unwrap_or_else(|_| "athas".into());
   let mut model = env::var("ATHAS_AGENT_MODEL").unwrap_or_default();
   let mut session = None;
   let mut continue_last = false;
   let mut format_json = false;
   let mut prompt = Vec::new();
   let mut index = 0;
   while index < args.len() {
      match args[index].as_str() {
         "--cwd" | "--provider" | "--model" | "--session" => {
            let key = args[index].as_str();
            let value = args
               .get(index + 1)
               .context(format!("{key} needs a value"))?
               .clone();
            match key {
               "--cwd" => root = PathBuf::from(value),
               "--provider" => provider = value,
               "--model" => model = value,
               _ => session = Some(value),
            }
            index += 2;
         }
         "--continue" => {
            continue_last = true;
            index += 1;
         }
         "--format" => {
            if args.get(index + 1).is_none_or(|value| value != "json") {
               bail!("--format currently accepts only json");
            }
            format_json = true;
            index += 2;
         }
         "--" => {
            prompt.extend_from_slice(&args[index + 1..]);
            break;
         }
         value if value.starts_with('-') => bail!("Unknown option: {value}"),
         _ => {
            prompt.extend_from_slice(&args[index..]);
            break;
         }
      }
   }
   let root = root
      .canonicalize()
      .context("Workspace directory does not exist")?;
   if !root.is_dir() {
      bail!("Workspace must be a directory");
   }
   if !matches!(
      provider.as_str(),
      "athas" | "openai" | "openrouter" | "ollama"
   ) {
      bail!("Supported providers: athas, openai, openrouter, ollama");
   }
   if model.is_empty() && provider == "athas" && session.is_none() && !continue_last {
      model = "auto".into();
   }
   if model.is_empty() && !continue_last && session.is_none() {
      bail!("Select a model with --model or ATHAS_AGENT_MODEL");
   }
   Ok((
      Options {
         root,
         provider,
         model,
         session,
         continue_last,
         format_json,
         desktop_binary,
         app_identifier,
      },
      (!prompt.is_empty()).then(|| prompt.join(" ")),
   ))
}

pub fn run_cli(command: &str, args: &[String], desktop_binary: PathBuf) -> i32 {
   if args.iter().any(|arg| arg == "--help" || arg == "-h") {
      println!("{HELP}");
      return 0;
   }
   let (options, prompt) = match parse_options(args, desktop_binary) {
      Ok(parsed) => parsed,
      Err(error) => {
         eprintln!("athas {command}: {error}\nRun athas {command} --help for usage.");
         return 2;
      }
   };
   if command == "run" && prompt.is_none() {
      eprintln!("athas run: provide a prompt");
      return 2;
   }
   if command == "agent" && (prompt.is_some() || options.format_json) {
      eprintln!("athas agent: prompts and --format are available through athas run");
      return 2;
   }
   if command == "agent" && !crossterm::tty::IsTty::is_tty(&std::io::stdin()) {
      eprintln!("athas agent: an interactive terminal is required; use athas run in scripts");
      return 2;
   }
   let runtime = match tokio::runtime::Builder::new_multi_thread()
      .enable_all()
      .build()
   {
      Ok(runtime) => runtime,
      Err(error) => {
         eprintln!("athas {command}: {error}");
         return 1;
      }
   };
   let result = runtime.block_on(async {
      let mut options = options;
      let session = session::Session::open(&options)?;
      if options.model.is_empty() {
         options.model = session
            .chat
            .model_id
            .clone()
            .context("Session has no model")?;
         options.provider = session
            .chat
            .provider_id
            .clone()
            .context("Session has no provider")?;
      }
      if command == "agent" {
         tui::run(options, session).await
      } else {
         agent::run_once(&options, session, prompt.unwrap()).await
      }
   });
   match result {
      Ok(()) => 0,
      Err(error) => {
         eprintln!("athas {command}: {error:#}");
         1
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   #[test]
   fn parses_agent_options_without_consuming_prompt() {
      let cwd = env::current_dir().unwrap();
      let args = vec![
         "--model".into(),
         "test".into(),
         "--cwd".into(),
         cwd.display().to_string(),
         "fix".into(),
         "it".into(),
      ];
      let (options, prompt) = parse_options(&args, PathBuf::from("athas")).unwrap();
      assert_eq!(options.model, "test");
      assert_eq!(prompt.as_deref(), Some("fix it"));
   }

   #[test]
   fn uses_athas_automatic_model_without_an_explicit_connection() {
      let (options, prompt) = parse_options(&[], PathBuf::from("athas")).unwrap();
      assert_eq!(options.provider, "athas");
      assert_eq!(options.model, "auto");
      assert_eq!(prompt, None);
   }
}
