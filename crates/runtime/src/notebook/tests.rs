use super::*;
use std::path::PathBuf;

#[cfg(unix)]
fn exit_status(code: i32) -> ExitStatus {
   use std::os::unix::process::ExitStatusExt;
   ExitStatus::from_raw(code << 8)
}

#[cfg(unix)]
fn fake_program(dir: &Path, name: &str, body: &str) -> PathBuf {
   let path = dir.join(name);
   athas_test_support::write_script(&path, body);
   path
}

#[cfg(unix)]
#[test]
fn prefers_the_runner_report_and_falls_back_to_raw_output() {
   let report = r#"{"stdout":"hi\n","stderr":"","status":0,"displayData":[{"outputType":"execute_result","data":{"text/plain":"2"},"metadata":{}}]}"#;
   let result = python_cell_result(exit_status(0), report.as_bytes(), b"process stderr");
   assert_eq!(result.stdout, "hi\n");
   assert_eq!(result.stderr, "process stderr");
   assert_eq!(result.status, Some(0));
   assert_eq!(result.display_data.len(), 1);
   assert_eq!(
      result.display_data[0].output_type.as_deref(),
      Some("execute_result")
   );

   let failed = r#"{"stdout":"","stderr":"Traceback","status":1,"displayData":[]}"#;
   let result = python_cell_result(exit_status(0), failed.as_bytes(), b"ignored");
   assert_eq!(result.stderr, "Traceback");
   assert_eq!(result.status, Some(1));

   let raw = python_cell_result(exit_status(2), b"not json", b"SyntaxError");
   assert_eq!(raw.stdout, "not json");
   assert_eq!(raw.stderr, "SyntaxError");
   assert_eq!(raw.status, Some(2));
   assert!(!raw.timed_out && raw.display_data.is_empty());
}

#[test]
fn quotes_paths_in_the_r_runner() {
   let script = r_runner_script(
      Path::new(r#"/tmp/a "b"/setup.R"#),
      Path::new(r"C:\cells\cell.R"),
   );

   assert!(script.contains(r#"run_file("/tmp/a \"b\"/setup.R", TRUE)"#));
   assert!(script.contains(r#"run_file("C:\\cells\\cell.R", FALSE)"#));
}

#[cfg(unix)]
#[tokio::test]
async fn passes_setup_and_cell_code_to_python_in_the_working_directory() {
   let bin = tempfile::tempdir().unwrap();
   let work = tempfile::tempdir().unwrap();
   let python = fake_program(
      bin.path(),
      "python3",
      r#"[ "$1" = "-c" ] || exit 9
printf '{"stdout":"%s|%s|%s","stderr":"","status":0,"displayData":[]}' "$3" "$4" "$(pwd -P)""#,
   );
   let kernel = NotebookKernel::with_programs(python, "Rscript");

   let result = kernel
      .run_python_cell(
         "print(1)".into(),
         Some(work.path().to_string_lossy().into_owned()),
         Some("import os".into()),
      )
      .await
      .unwrap();

   assert_eq!(
      result.stdout,
      format!(
         "import os|print(1)|{}",
         work.path().canonicalize().unwrap().display()
      )
   );
   assert_eq!(result.status, Some(0));
}

#[cfg(unix)]
#[tokio::test]
async fn times_out_runaway_cells() {
   let bin = tempfile::tempdir().unwrap();
   let python = fake_program(bin.path(), "python3", "exec sleep 30");
   let rscript = fake_program(bin.path(), "Rscript", "exec sleep 30");
   let kernel =
      NotebookKernel::with_programs(python, rscript).with_timeout(Duration::from_millis(200));

   let python = kernel
      .run_python_cell("while True: pass".into(), None, None)
      .await
      .unwrap();
   assert!(python.timed_out);
   assert_eq!(python.status, None);
   assert_eq!(python.stderr, "Cell execution timed out after 0 seconds.");

   let r = kernel
      .run_r_cell("repeat {}".into(), Some(" ".into()), None)
      .await
      .unwrap();
   assert!(r.timed_out);
   assert!(r.stderr.starts_with("R cell execution timed out"));
}

#[cfg(unix)]
#[tokio::test]
async fn runs_r_cells_through_a_generated_runner_script() {
   let bin = tempfile::tempdir().unwrap();
   let rscript = fake_program(
      bin.path(),
      "Rscript",
      r#"[ "$1" = "--vanilla" ] || exit 9
setup=$(sed -n 's/^run_file("\(.*\)", TRUE)$/\1/p' "$2")
cell=$(sed -n 's/^run_file("\(.*\)", FALSE)$/\1/p' "$2")
printf '%s/%s' "$(cat "$setup")" "$(cat "$cell")"
echo warn >&2
exit 3"#,
   );
   let kernel = NotebookKernel::with_programs("python3", rscript);

   let result = kernel
      .run_r_cell("x + 1".into(), None, Some("x <- 1".into()))
      .await
      .unwrap();

   assert_eq!(result.stdout, "x <- 1/x + 1");
   assert_eq!(result.stderr, "warn\n");
   assert_eq!(result.status, Some(3));
   assert!(!result.timed_out);
}

#[tokio::test]
async fn reports_missing_interpreters() {
   let kernel = NotebookKernel::with_programs("athas-missing-python", "athas-missing-rscript");

   assert!(
      kernel
         .run_python_cell(String::new(), None, None)
         .await
         .unwrap_err()
         .starts_with("Failed to start python3: ")
   );
   assert!(
      kernel
         .run_r_cell(String::new(), None, None)
         .await
         .unwrap_err()
         .starts_with("Failed to start Rscript: ")
   );
}

/// Exercises the real runner script when a Python interpreter is available.
#[tokio::test]
async fn real_python_reports_output_results_and_errors() {
   let Ok(python) = which::which("python3") else {
      return;
   };
   let kernel = NotebookKernel::with_programs(python, "Rscript");

   let result = kernel
      .run_python_cell(
         "print('hello')\nvalue * 2".into(),
         None,
         Some("value = 21\nprint('setup output')".into()),
      )
      .await
      .unwrap();
   assert_eq!(result.stdout, "hello\n");
   assert_eq!(result.status, Some(0));
   assert_eq!(result.display_data.len(), 1);
   assert_eq!(
      result.display_data[0].output_type.as_deref(),
      Some("execute_result")
   );
   assert_eq!(
      result.display_data[0].data.get("text/plain"),
      Some(&serde_json::json!("42"))
   );

   let error = kernel
      .run_python_cell("1 / 0".into(), None, None)
      .await
      .unwrap();
   assert_eq!(error.status, Some(1));
   assert!(
      error.stderr.contains("ZeroDivisionError"),
      "{}",
      error.stderr
   );
}
