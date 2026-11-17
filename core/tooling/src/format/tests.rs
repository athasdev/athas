use super::*;
use std::io::Write;
use tempfile::Builder;

/// Deliberately misformatted so a real formatter has something to change.
const UNFORMATTED: &str = "fn  main( )  {  let  x=1;  }\n";

fn config(input_method: Option<&str>, output_method: Option<&str>) -> FormatterConfig {
   FormatterConfig {
      command: "formatter".to_string(),
      args: None,
      env: None,
      input_method: input_method.map(ToString::to_string),
      output_method: output_method.map(ToString::to_string),
   }
}

fn request(formatter: &str, config: Option<FormatterConfig>) -> FormatRequest {
   FormatRequest {
      content: UNFORMATTED.to_string(),
      language: "rust".to_string(),
      formatter: formatter.to_string(),
      formatter_config: config,
      file_path: None,
      workspace_folder: None,
   }
}

/// rustfmt is used as the stand-in file formatter because it is already a
/// hard requirement of this workspace (`cargo fmt --check` gates CI), so the
/// test does not depend on any optional tool being installed.
fn rustfmt_file_formatter(args: &[&str]) -> FormatterConfig {
   FormatterConfig {
      command: "rustfmt".to_string(),
      args: Some(args.iter().map(|arg| arg.to_string()).collect()),
      env: None,
      input_method: Some("file".to_string()),
      output_method: Some("file".to_string()),
   }
}

#[test]
fn returns_file_contents_for_file_output_method() {
   let mut file = Builder::new()
      .suffix(".rs")
      .tempfile()
      .expect("create temp file");
   file
      .write_all(UNFORMATTED.as_bytes())
      .expect("seed temp file");
   file.flush().expect("flush temp file");
   let path = file.path().to_string_lossy().into_owned();

   let config = rustfmt_file_formatter(&["--emit", "files", "${file}"]);
   let response = format_with_config(UNFORMATTED, &config, Some(&path), None)
      .expect("file output should succeed");

   assert!(response.success, "unexpected error: {:?}", response.error);
   // The formatter rewrote the file in place, so the reply must be the file
   // as it now stands on disk rather than the input we started from.
   assert_eq!(
      response.formatted_content,
      std::fs::read_to_string(&path).expect("read formatted file back"),
   );
   assert_ne!(
      response.formatted_content, UNFORMATTED,
      "formatter did not rewrite the file, so this assertion proves nothing",
   );
}

#[test]
fn rejects_file_output_method_without_a_file_path() {
   // `--version` exits successfully without touching any file, which reaches
   // the file branch with no path to read.
   let config = rustfmt_file_formatter(&["--version"]);

   let error = format_with_config(UNFORMATTED, &config, None, None)
      .expect_err("file output without a path must fail");

   assert_eq!(error, "file_path required for file output method");
}

#[test]
fn rejects_unsafe_formatter_configs_before_running_them() {
   let mut shell = config(None, None);
   shell.command = "bash".to_string();
   let mut nul_args = config(None, None);
   nul_args.args = Some(vec!["--write\0".to_string()]);
   let mut preload = config(None, None);
   preload.env = Some(HashMap::from([(
      "DYLD_INSERT_LIBRARIES".to_string(),
      "/x.dylib".to_string(),
   )]));

   for config in [shell, nul_args, preload] {
      let error = format_code(&request("custom", Some(config))).expect_err("unsafe config");
      assert!(error.starts_with("Invalid formatter config: "), "{error}");
   }
}

#[test]
fn reports_missing_formatters_without_changing_the_content() {
   let mut missing = config(None, None);
   missing.command = "athas-definitely-missing-formatter".to_string();

   let response = format_code(&request("custom", Some(missing))).unwrap();

   assert!(!response.success);
   assert_eq!(response.formatted_content, UNFORMATTED);
   assert!(
      response.error.as_deref().is_some_and(|error| error
         .starts_with("Formatter not available: athas-definitely-missing-formatter - ")),
      "{response:?}"
   );
}

#[test]
fn falls_back_to_builtin_formatters_by_name() {
   assert_eq!(
      format_code(&request("black", None)).unwrap_err(),
      "Unsupported formatter: black"
   );

   let eslint = format_code(&request("eslint", None)).unwrap();
   assert!(!eslint.success);
   assert_eq!(eslint.formatted_content, UNFORMATTED);
   assert_eq!(
      eslint.error.as_deref(),
      Some("ESLint formatting requires file-based operation (not yet implemented)")
   );

   let command_line = |formatter: &str, language: &str| {
      let (command, command_name, display_name) =
         builtin_formatter_command(formatter, language).unwrap();
      let args = command
         .get_args()
         .map(|arg| arg.to_string_lossy().into_owned())
         .collect::<Vec<_>>();
      (
         command.get_program().to_string_lossy().into_owned(),
         args,
         command_name,
         display_name,
      )
   };
   assert_eq!(
      command_line("prettier", "ts"),
      (
         "npx".to_string(),
         vec![
            "prettier".to_string(),
            "--parser".to_string(),
            "typescript".to_string(),
            "--stdin-filepath".to_string(),
            "temp.ts".to_string(),
         ],
         "prettier",
         "Prettier",
      )
   );
   assert_eq!(command_line("prettier", "markdown").1[2], "markdown");
   assert_eq!(
      command_line("prettier", "kotlin").1[2..],
      ["babel", "--stdin-filepath", "temp.txt"]
   );
   assert_eq!(
      command_line("rustfmt", "rust"),
      (
         "rustfmt".to_string(),
         vec!["--emit".to_string(), "stdout".to_string()],
         "rustfmt",
         "rustfmt",
      )
   );
   assert_eq!(
      command_line("gofmt", "go"),
      ("gofmt".to_string(), Vec::new(), "gofmt", "gofmt")
   );
}

#[test]
fn maps_languages_to_prettier_parsers_and_extensions() {
   for (language, parser, extension) in [
      ("javascript", "babel", "js"),
      ("js", "babel", "js"),
      ("typescript", "typescript", "ts"),
      ("json", "json", "json"),
      ("html", "html", "html"),
      ("css", "css", "css"),
      ("md", "markdown", "md"),
      ("rust", "babel", "rs"),
      ("go", "babel", "go"),
      ("py", "babel", "py"),
      ("java", "babel", "java"),
      ("c", "babel", "c"),
      ("c++", "babel", "cpp"),
      ("plaintext", "babel", "txt"),
   ] {
      assert_eq!(prettier_parser(language), parser, "{language}");
      assert_eq!(file_extension(language), extension, "{language}");
   }
}

#[test]
fn builtin_rustfmt_formats_stdin() {
   let response = format_code(&request("rustfmt", None)).unwrap();

   assert!(response.success, "{response:?}");
   assert!(
      response.formatted_content.starts_with("fn main() {\n")
         && response.formatted_content.contains(" let x = 1;\n}"),
      "{:?}",
      response.formatted_content
   );
}

#[cfg(unix)]
mod process {
   use super::*;
   use std::{fs, path::Path, time::Instant};

   const TIMEOUT: Duration = Duration::from_secs(10);

   fn script(dir: &Path, body: &str) -> Command {
      let path = dir.join("formatter");
      athas_test_support::write_script(&path, body);
      Command::new(path)
   }

   fn run(command: Command, content: &str, config: &FormatterConfig) -> FormatResponse {
      run_configured_formatter(command, content, config, None, TIMEOUT).unwrap()
   }

   #[test]
   fn pipes_content_through_stdin_and_stdout() {
      let dir = tempfile::tempdir().unwrap();
      let mut command = script(dir.path(), "printf '%s|' \"$@\"\ntr a-z A-Z");
      command.args(["--stdin-filepath", "a.ts"]);

      let response = run(command, "let x = 1", &config(None, None));

      assert!(response.success, "{response:?}");
      assert_eq!(
         response.formatted_content,
         "--stdin-filepath|a.ts|LET X = 1"
      );
      assert_eq!(response.error, None);
   }

   #[test]
   fn streams_content_larger_than_a_pipe_buffer() {
      let dir = tempfile::tempdir().unwrap();
      let content = "x".repeat(4 * 1024 * 1024);

      let response = run(script(dir.path(), "cat"), &content, &config(None, None));

      assert!(response.success, "{:?}", response.error);
      assert_eq!(response.formatted_content.len(), content.len());
   }

   #[test]
   fn keeps_the_content_when_the_formatter_fails() {
      let dir = tempfile::tempdir().unwrap();
      let command = script(
         dir.path(),
         "cat >/dev/null\necho 'formatted garbage'\necho 'unexpected token' >&2\nexit 2",
      );

      let response = run(command, "let x = 1", &config(None, None));

      assert!(!response.success);
      assert_eq!(response.formatted_content, "let x = 1");
      assert_eq!(
         response.error.as_deref(),
         Some("Formatter error: unexpected token\n")
      );
   }

   #[test]
   fn reports_formatters_that_stop_reading_their_input() {
      let dir = tempfile::tempdir().unwrap();
      let content = "x".repeat(4 * 1024 * 1024);

      let response = run(
         script(dir.path(), "exec 0<&-\nexit 0"),
         &content,
         &config(None, None),
      );

      assert!(!response.success);
      assert_eq!(
         response.error.as_deref(),
         Some("Failed to write to formatter stdin")
      );
   }

   #[test]
   fn kills_formatters_that_run_past_the_timeout() {
      let dir = tempfile::tempdir().unwrap();
      let started = Instant::now();

      let response = run_configured_formatter(
         script(dir.path(), "exec sleep 30"),
         "let x = 1",
         &config(None, None),
         None,
         Duration::from_millis(200),
      )
      .unwrap();

      assert!(started.elapsed() < Duration::from_secs(10));
      assert!(!response.success);
      assert_eq!(response.formatted_content, "let x = 1");
      assert_eq!(
         response.error.as_deref(),
         Some("Formatter timed out after 0.2s")
      );
   }

   #[test]
   fn reads_the_rewritten_file_for_file_based_formatters() {
      let dir = tempfile::tempdir().unwrap();
      let file = dir.path().join("main.rs");
      fs::write(&file, "let x = 1").unwrap();
      let mut command = script(
         dir.path(),
         "tr a-z A-Z < \"$1\" > \"$1.tmp\"\nmv \"$1.tmp\" \"$1\"",
      );
      command.arg(&file);
      let path = file.to_string_lossy().into_owned();

      let response = run_configured_formatter(
         command,
         "let x = 1",
         &config(Some("file"), Some("file")),
         Some(&path),
         TIMEOUT,
      )
      .unwrap();

      assert!(response.success, "{response:?}");
      assert_eq!(response.formatted_content, "LET X = 1");

      let unreadable = run_configured_formatter(
         script(dir.path(), "exit 0"),
         "let x = 1",
         &config(Some("file"), Some("file")),
         Some(&dir.path().join("missing.rs").to_string_lossy()),
         TIMEOUT,
      )
      .unwrap();
      assert!(unreadable.success);
      assert_eq!(
         unreadable.formatted_content, "let x = 1",
         "an unreadable result falls back to the original content"
      );
   }

   #[test]
   fn reports_builtin_formatter_failures_under_their_display_name() {
      let dir = tempfile::tempdir().unwrap();

      let formatted = run_stdin_formatter(
         script(dir.path(), "tr a-z A-Z"),
         "package main",
         "gofmt",
         "gofmt",
         TIMEOUT,
      );
      assert!(formatted.success);
      assert_eq!(formatted.formatted_content, "PACKAGE MAIN");

      let failed = run_stdin_formatter(
         script(
            dir.path(),
            "cat >/dev/null\necho 'expected declaration' >&2\nexit 2",
         ),
         "package main",
         "gofmt",
         "gofmt",
         TIMEOUT,
      );
      assert!(!failed.success);
      assert_eq!(failed.formatted_content, "package main");
      assert_eq!(
         failed.error.as_deref(),
         Some("gofmt error: expected declaration\n")
      );

      let missing = run_stdin_formatter(
         Command::new(dir.path().join("missing-prettier")),
         "x",
         "prettier",
         "Prettier",
         TIMEOUT,
      );
      assert!(
         missing
            .error
            .as_deref()
            .is_some_and(|error| error.starts_with("Prettier not available: ")),
         "{missing:?}"
      );

      let broken = run_stdin_formatter(
         script(dir.path(), "exec 0<&-\nexit 0"),
         &"x".repeat(4 * 1024 * 1024),
         "rustfmt",
         "rustfmt",
         TIMEOUT,
      );
      assert!(
         broken
            .error
            .as_deref()
            .is_some_and(|error| error.starts_with("Failed to write to rustfmt stdin: ")),
         "{:?}",
         broken.error
      );

      let timed_out = run_stdin_formatter(
         script(dir.path(), "exec sleep 30"),
         "x",
         "prettier",
         "Prettier",
         Duration::from_millis(100),
      );
      assert_eq!(
         timed_out.error.as_deref(),
         Some("Prettier timed out after 0.1s")
      );
   }
}
