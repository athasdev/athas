use super::*;

fn config(format: Option<&str>, pattern: Option<&str>) -> LinterConfig {
   LinterConfig {
      command: "linter".to_string(),
      args: None,
      env: None,
      input_method: None,
      diagnostic_format: format.map(ToString::to_string),
      diagnostic_pattern: pattern.map(ToString::to_string),
   }
}

fn request(config: Option<LinterConfig>) -> LintRequest {
   LintRequest {
      content: "let x = 1".to_string(),
      language: "javascript".to_string(),
      linter: "eslint".to_string(),
      linter_config: config,
      file_path: Some("/workspace/src/app.js".to_string()),
      workspace_folder: Some("/workspace".to_string()),
   }
}

#[test]
fn reports_clean_content_without_a_linter_config() {
   let response = lint_code(&request(None));

   assert!(response.success);
   assert!(response.diagnostics.is_empty());
   assert_eq!(response.error, None);
}

#[test]
fn rejects_unsafe_linter_configs_before_running_them() {
   let mut shell = config(None, None);
   shell.command = "bash".to_string();
   let mut nul_args = config(None, None);
   nul_args.args = Some(vec!["--fix\0".to_string()]);
   let mut preload = config(None, None);
   preload.env = Some(HashMap::from([(
      "LD_PRELOAD".to_string(),
      "/x.so".to_string(),
   )]));

   for config in [shell, nul_args, preload] {
      let response = lint_code(&request(Some(config)));
      assert!(!response.success);
      assert!(
         response
            .error
            .as_deref()
            .is_some_and(|error| error.starts_with("Invalid linter config: ")),
         "{response:?}"
      );
   }
}

#[test]
fn reports_missing_linters() {
   let mut missing = config(None, None);
   missing.command = "athas-definitely-missing-linter".to_string();

   let response = lint_code(&request(Some(missing)));

   assert!(!response.success);
   assert!(
      response.error.as_deref().is_some_and(
         |error| error.starts_with("Linter not available: athas-definitely-missing-linter - ")
      ),
      "{response:?}"
   );
}

#[test]
fn parses_eslint_and_cargo_json_diagnostics() {
   let eslint = r#"[{"filePath":"a.js","messages":[
      {"line":1,"column":5,"endLine":1,"endColumn":6,"message":"x is unused","severity":2,"ruleId":"no-unused-vars"},
      {"line":2,"column":1,"message":"prefer const","severity":1},
      {"line":3,"column":1,"message":"fyi","severity":0},
      {"column":1,"message":"no line","severity":2}
   ]}]"#;
   let diagnostics = parse_json_diagnostics(eslint);
   assert_eq!(diagnostics.len(), 3);
   assert_eq!(diagnostics[0].severity, "error");
   assert_eq!(diagnostics[0].code.as_deref(), Some("no-unused-vars"));
   assert_eq!(diagnostics[0].end_column, Some(6));
   assert_eq!(diagnostics[0].source.as_deref(), Some("eslint"));
   assert_eq!(diagnostics[1].severity, "warning");
   assert_eq!(diagnostics[2].severity, "info");

   let cargo = r#"{"message":"unused variable","level":"warning","code":{"code":"unused_variables"},
      "spans":[{"line_start":4,"column_start":9,"line_end":4,"column_end":10}]}"#;
   let diagnostics = parse_json_diagnostics(cargo);
   assert_eq!(diagnostics.len(), 1);
   assert_eq!(diagnostics[0].line, 4);
   assert_eq!(diagnostics[0].code.as_deref(), Some("unused_variables"));
   assert_eq!(diagnostics[0].source.as_deref(), Some("clippy"));

   let cargo_array = r#"[
      {"message":"bad","level":"error","spans":[{"line_start":1,"column_start":1}]},
      {"message":"note","level":"help","spans":[{"line_start":2,"column_start":1}]},
      {"message":"no spans","level":"error","spans":[]}
   ]"#;
   let severities = parse_json_diagnostics(cargo_array)
      .into_iter()
      .map(|diagnostic| diagnostic.severity)
      .collect::<Vec<_>>();
   assert_eq!(severities, vec!["error", "info"]);
   assert!(parse_json_diagnostics("not json").is_empty());
}

#[test]
fn parses_regex_diagnostics_with_normalized_severities() {
   let pattern = r"(?P<file>[^:]+):(?P<line>\d+):(?:(?P<column>\d+):)?\s*(?P<severity>\w+):\s*(?P<message>.+?)(?: \[(?P<code>[^\]]+)\])?$";
   let output =
      "a.c:3:7: error: missing semicolon [E1]\na.c:9: W: shadowed\nnoise\na.c:2:1: hint: maybe";

   let diagnostics = parse_regex_diagnostics(output, pattern);

   let summary = diagnostics
      .iter()
      .map(|d| (d.line, d.column, d.severity.as_str(), d.code.as_deref()))
      .collect::<Vec<_>>();
   assert_eq!(
      summary,
      vec![
         (3, 7, "error", Some("E1")),
         (9, 1, "warning", None),
         (2, 1, "hint", None),
      ]
   );
   assert_eq!(diagnostics[0].message, "missing semicolon");
   assert!(parse_regex_diagnostics(output, "(unclosed").is_empty());
}

#[cfg(unix)]
mod process {
   use super::*;
   use std::path::Path;

   fn script(dir: &Path, body: &str) -> Command {
      let path = dir.join("linter");
      athas_test_support::write_script(&path, body);
      Command::new(path)
   }

   #[test]
   fn feeds_content_on_stdin_and_parses_json_output() {
      let dir = tempfile::tempdir().unwrap();
      let command = script(
         dir.path(),
         r#"input=$(cat)
printf '[{"messages":[{"line":1,"column":1,"message":"%s","severity":2}]}]' "$input"
exit 1"#,
      );

      let response = run_linter(command, "seen via stdin", &config(None, None));

      assert!(response.success);
      assert_eq!(response.diagnostics.len(), 1);
      assert_eq!(response.diagnostics[0].message, "seen via stdin");
   }

   #[test]
   fn reads_regex_output_without_stdin_for_file_based_linters() {
      let dir = tempfile::tempdir().unwrap();
      let command = script(dir.path(), "echo 'x.py:2: warning: unused'");
      let mut file_config = config(
         Some("regex"),
         Some(r"(?P<file>[^:]+):(?P<line>\d+): (?P<severity>\w+): (?P<message>.+)"),
      );
      file_config.input_method = Some("file".to_string());

      let response = run_linter(command, "ignored", &file_config);

      assert!(response.success);
      assert_eq!(response.diagnostics[0].line, 2);
      assert_eq!(response.diagnostics[0].severity, "warning");

      let without_pattern = run_linter(
         script(dir.path(), "echo 'x.py:2: warning: unused'"),
         "",
         &config(Some("regex"), None),
      );
      assert!(without_pattern.success && without_pattern.diagnostics.is_empty());
      let unknown_format = run_linter(
         script(dir.path(), "echo '[]'"),
         "",
         &config(Some("sarif"), None),
      );
      assert!(unknown_format.success && unknown_format.diagnostics.is_empty());
   }

   #[test]
   fn does_not_deadlock_on_a_linter_that_echoes_large_input() {
      let dir = tempfile::tempdir().unwrap();
      let content = "x".repeat(4 * 1024 * 1024);

      let response = run_linter(script(dir.path(), "cat"), &content, &config(None, None));

      assert!(response.success);
      assert!(response.diagnostics.is_empty());
   }

   #[test]
   fn stops_a_linter_that_hangs() {
      let dir = tempfile::tempdir().unwrap();

      let response = run_linter_with_timeout(
         script(dir.path(), "sleep 5"),
         "",
         &config(None, None),
         Duration::from_millis(100),
      );

      assert!(!response.success);
      assert!(
         response
            .error
            .unwrap_or_default()
            .starts_with("Linter timed out")
      );
   }

   #[test]
   fn reports_linter_crashes_that_produce_no_diagnostics() {
      let dir = tempfile::tempdir().unwrap();
      let command = script(
         dir.path(),
         "cat >/dev/null; echo 'config not found' >&2; exit 2",
      );

      let response = run_linter(command, "content", &config(None, None));

      assert!(!response.success);
      assert_eq!(
         response.error.as_deref(),
         Some("Linter error: config not found\n")
      );

      let quiet_failure = run_linter(
         script(dir.path(), "cat >/dev/null; exit 1"),
         "content",
         &config(None, None),
      );
      assert!(quiet_failure.success, "no stderr means nothing to report");
   }
}
