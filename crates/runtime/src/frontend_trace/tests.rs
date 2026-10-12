use super::*;
use serde_json::json;

#[test]
fn maps_frontend_levels_and_defaults_to_info() {
   assert_eq!(trace_level("debug"), log::Level::Debug);
   assert_eq!(trace_level("warn"), log::Level::Warn);
   assert_eq!(trace_level("error"), log::Level::Error);
   assert_eq!(trace_level("info"), log::Level::Info);
   assert_eq!(trace_level("trace"), log::Level::Info);
   assert_eq!(trace_level(""), log::Level::Info);
}

#[test]
fn formats_payloads_as_key_value_pairs() {
   assert_eq!(
      format_trace_line("editor", "opened", None),
      "[frontend:editor] opened"
   );
   assert_eq!(
      format_trace_line("editor", "opened", Some(&json!({}))),
      "[frontend:editor] opened"
   );
   // Keys are written in sorted order so the expectation holds whether or not serde_json keeps
   // insertion order.
   assert_eq!(
      format_trace_line(
         "editor",
         "opened",
         Some(&json!({
            "bytes": 120,
            "cached": false,
            "lines": [1, 2.5, null],
            "path": "/ws/a.rs",
            "range": {"end": 4, "start": 1},
         }))
      ),
      "[frontend:editor] opened bytes=120 cached=false lines=[1,2.5,null] path=/ws/a.rs \
       range={end=4,start=1}"
   );
   assert_eq!(
      format_trace_line("editor", "count", Some(&json!(3))),
      "[frontend:editor] count 3"
   );
   assert_eq!(
      format_trace_line("editor", "note", Some(&json!("plain"))),
      "[frontend:editor] note plain"
   );
   assert_eq!(
      format_trace_line("editor", "nothing", Some(&Value::Null)),
      "[frontend:editor] nothing null"
   );
}

#[test]
fn summarizes_benchmark_timings_and_phases() {
   let payload = json!({
      "durationMs": 7,
      "ignored": "not shown",
      "phases": [
         {"durationMs": 2, "label": "read"},
         {"detail": "rust", "durationMs": 4.5, "label": "parse"},
         {"detail": null, "durationMs": 1, "label": "paint"},
         {"durationMs": 9},
         {"label": "no-duration"},
         "not a phase",
      ],
      "totalMs": 12,
   });

   assert_eq!(
      format_trace_line(FILE_OPEN_BENCHMARK_SCOPE, "/ws/a.rs", Some(&payload)),
      "[frontend:bench:file-open] /ws/a.rs total=12ms duration=7ms phases=read=2ms > \
       parse=4.5ms(rust) > paint=1ms"
   );
   assert_eq!(
      format_trace_line("bench:startup", "boot", Some(&json!({"phases": []}))),
      "[frontend:bench:startup] boot",
      "an empty phase list prints nothing"
   );
   assert_eq!(
      format_trace_line("bench:startup", "boot", Some(&json!(42))),
      "[frontend:bench:startup] boot 42",
      "non-object benchmark payloads print like any other payload"
   );
   assert_eq!(
      format_trace_line("bench:startup", "boot", None),
      "[frontend:bench:startup] boot"
   );
}

#[test]
fn appends_file_open_benchmarks_as_json_lines() {
   let temp = tempfile::tempdir().unwrap();
   let path = temp.path().join("benchmark.jsonl");

   append_file_open_benchmark(&path, "info", "/ws/a.rs", Some(&json!({"totalMs": 3}))).unwrap();
   append_file_open_benchmark(&path, "warn", "/ws/b.rs", None).unwrap();

   let records = std::fs::read_to_string(&path)
      .unwrap()
      .lines()
      .map(|line| serde_json::from_str::<Value>(line).unwrap())
      .collect::<Vec<_>>();
   assert_eq!(records.len(), 2);
   assert_eq!(records[0]["level"], "info");
   assert_eq!(records[0]["file"], "/ws/a.rs");
   assert_eq!(records[0]["payload"], json!({"totalMs": 3}));
   assert!(records[0]["timestampMs"].as_u64().is_some_and(|ms| ms > 0));
   assert_eq!(records[1]["level"], "warn");
   assert_eq!(records[1]["payload"], Value::Null);

   assert!(
      append_file_open_benchmark(&temp.path().join("missing/b.jsonl"), "info", "x", None).is_err()
   );
}
