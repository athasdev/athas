//! The `.ipynb` document (`notebook-model.ts`): the JSON is kept as is, so fields Athas does not
//! know survive a save, and every change writes the whole notebook back to the buffer.

use serde_json::{Map, Value, json};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CellType {
    Code,
    Markdown,
}

impl CellType {
    fn name(self) -> &'static str {
        match self {
            CellType::Code => "code",
            CellType::Markdown => "markdown",
        }
    }
}

/// The notebook in `content`, or why it cannot be shown.
pub(crate) fn parse(content: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(content).map_err(|error| error.to_string())?;
    if !value.is_object() {
        return Err("Notebook file is not a JSON object.".into());
    }
    if !value.get("cells").is_some_and(Value::is_array) {
        return Err("Notebook file does not contain a cells array.".into());
    }
    Ok(value)
}

pub(crate) fn serialize(notebook: &Value) -> String {
    format!("{}\n", serde_json::to_string_pretty(notebook).unwrap_or_default())
}

pub(crate) fn cells(notebook: &Value) -> &[Value] {
    notebook.get("cells").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn cells_mut(notebook: &mut Value) -> &mut Vec<Value> {
    if !notebook.get("cells").is_some_and(Value::is_array) {
        notebook["cells"] = json!([]);
    }
    notebook["cells"].as_array_mut().expect("cells is an array")
}

/// A string, or the strings of a list joined.
pub(crate) fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts.iter().filter_map(Value::as_str).collect(),
        _ => String::new(),
    }
}

pub(crate) fn cell_type(cell: &Value) -> &str {
    cell.get("cell_type").and_then(Value::as_str).unwrap_or("")
}

pub(crate) fn cell_source(cell: &Value) -> String {
    text(cell.get("source"))
}

pub(crate) fn execution_count(cell: &Value) -> Option<i64> {
    cell.get("execution_count").and_then(Value::as_i64)
}

pub(crate) fn outputs(cell: &Value) -> &[Value] {
    cell.get("outputs").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

/// The source split after each newline, as notebooks store it.
pub(crate) fn source_lines(source: &str) -> Vec<Value> {
    source.split_inclusive('\n').map(|line| Value::String(line.to_string())).collect()
}

pub(crate) fn create_cell(cell_type: CellType, source: &str) -> Value {
    let mut cell = Map::new();
    cell.insert("cell_type".into(), cell_type.name().into());
    cell.insert("metadata".into(), json!({}));
    cell.insert("source".into(), Value::Array(source_lines(source)));
    if cell_type == CellType::Code {
        cell.insert("execution_count".into(), Value::Null);
        cell.insert("outputs".into(), json!([]));
    }
    Value::Object(cell)
}

pub(crate) fn set_source(notebook: &mut Value, index: usize, source: &str) {
    if let Some(cell) = cells_mut(notebook).get_mut(index).and_then(Value::as_object_mut) {
        cell.insert("source".into(), Value::Array(source_lines(source)));
    }
}

pub(crate) fn set_outputs(notebook: &mut Value, index: usize, outputs: Vec<Value>, execution_count: Option<i64>) {
    if let Some(cell) = cells_mut(notebook).get_mut(index).and_then(Value::as_object_mut) {
        cell.insert("execution_count".into(), execution_count.map(Value::from).unwrap_or(Value::Null));
        cell.insert("outputs".into(), Value::Array(outputs));
    }
}

pub(crate) fn set_type(notebook: &mut Value, index: usize, cell_type: CellType) {
    let Some(cell) = cells_mut(notebook).get_mut(index).and_then(Value::as_object_mut) else { return };
    cell.insert("cell_type".into(), cell_type.name().into());
    if cell_type == CellType::Code {
        let count = cell.get("execution_count").filter(|count| count.is_number()).cloned().unwrap_or(Value::Null);
        cell.insert("execution_count".into(), count);
        let outputs = cell.get("outputs").filter(|outputs| outputs.is_array()).cloned().unwrap_or(json!([]));
        cell.insert("outputs".into(), outputs);
    } else {
        cell.shift_remove("execution_count");
        cell.shift_remove("outputs");
    }
}

pub(crate) fn insert_cell(notebook: &mut Value, index: usize, cell_type: CellType) {
    let cells = cells_mut(notebook);
    let index = index.min(cells.len());
    cells.insert(index, create_cell(cell_type, ""));
}

pub(crate) fn delete_cell(notebook: &mut Value, index: usize) {
    let cells = cells_mut(notebook);
    if index < cells.len() {
        cells.remove(index);
    }
}

pub(crate) fn move_cell(notebook: &mut Value, from: usize, to: usize) -> bool {
    let cells = cells_mut(notebook);
    if from == to || from >= cells.len() || to >= cells.len() {
        return false;
    }
    let cell = cells.remove(from);
    cells.insert(to, cell);
    true
}

/// The kernel's language, for highlighting code cells.
pub(crate) fn language(notebook: &Value) -> String {
    notebook
        .pointer("/metadata/language_info/name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("python")
        .to_string()
}

pub(crate) fn max_execution_count(notebook: &Value) -> i64 {
    cells(notebook).iter().filter_map(execution_count).max().unwrap_or(0).max(0)
}

/// Where `index` goes when the cell at `from` moves to `to`.
pub(crate) fn remap_moved(index: usize, from: usize, to: usize) -> usize {
    if index == from {
        to
    } else if from < to && index > from && index <= to {
        index - 1
    } else if from > to && index >= to && index < from {
        index + 1
    } else {
        index
    }
}

/// What a cell run printed and displayed.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CellRun {
    pub stdout: String,
    pub stderr: String,
    pub status: Option<i32>,
    pub timed_out: bool,
    /// `{ outputType, data, metadata }` for each displayed value.
    pub display_data: Vec<Value>,
}

impl CellRun {
    /// The runner's camelCase result (`NotebookRunResult`).
    #[cfg(not(target_family = "wasm"))]
    pub fn from_json(value: &Value) -> Self {
        Self {
            stdout: value.get("stdout").and_then(Value::as_str).unwrap_or_default().to_string(),
            stderr: value.get("stderr").and_then(Value::as_str).unwrap_or_default().to_string(),
            status: value.get("status").and_then(Value::as_i64).map(|status| status as i32),
            timed_out: value.get("timedOut").and_then(Value::as_bool).unwrap_or(false),
            display_data: value.get("displayData").and_then(Value::as_array).cloned().unwrap_or_default(),
        }
    }
}

/// A run's outputs as notebook outputs.
pub(crate) fn run_outputs(run: &CellRun) -> Vec<Value> {
    let mut outputs = Vec::new();
    if !run.stdout.is_empty() {
        outputs.push(json!({ "output_type": "stream", "name": "stdout", "text": run.stdout }));
    }
    if !run.stderr.is_empty() || run.status != Some(0) || run.timed_out {
        let message = if run.timed_out {
            "Cell execution timed out.".to_string()
        } else if !run.stderr.is_empty() {
            run.stderr.clone()
        } else {
            format!("Python exited with status {}.", run.status.map(|status| status.to_string()).unwrap_or_else(|| "null".into()))
        };
        let traceback: Vec<&str> = if message.is_empty() { Vec::new() } else { message.split('\n').collect() };
        outputs.push(json!({
            "output_type": "error",
            "ename": if run.timed_out { "TimeoutError" } else { "PythonError" },
            "evalue": message.trim(),
            "traceback": traceback,
        }));
    }
    for display in &run.display_data {
        let kind = if display.get("outputType").and_then(Value::as_str) == Some("execute_result") { "execute_result" } else { "display_data" };
        outputs.push(json!({
            "output_type": kind,
            "data": display.get("data").cloned().unwrap_or(json!({})),
            "metadata": display.get("metadata").filter(|metadata| !metadata.is_null()).cloned().unwrap_or(json!({})),
        }));
    }
    outputs
}

pub(crate) fn error_output(message: &str) -> Value {
    json!({ "output_type": "error", "ename": "ExecutionError", "evalue": message, "traceback": [message] })
}

/// The text of `mime` in an output's data: strings joined, other JSON pretty-printed.
pub(crate) fn data_text(output: &Value, mime: &str) -> String {
    match output.get("data").and_then(|data| data.get(mime)) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) if parts.iter().all(Value::is_string) => parts.iter().filter_map(Value::as_str).collect(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(value @ (Value::Object(_) | Value::Array(_))) => serde_json::to_string_pretty(value).unwrap_or_default(),
        _ => String::new(),
    }
}

/// `application/json` or another `+json` type, pretty-printed.
pub(crate) fn data_json(output: &Value) -> String {
    let Some(data) = output.get("data").and_then(Value::as_object) else { return String::new() };
    let value = data.get("application/json").filter(|value| !value.is_null()).or_else(|| data.iter().find(|(mime, _)| mime.ends_with("+json")).map(|(_, value)| value));
    match value {
        Some(Value::String(text)) => serde_json::from_str::<Value>(text).ok().and_then(|value| serde_json::to_string_pretty(&value).ok()).unwrap_or_else(|| text.clone()),
        Some(Value::Null) | None => String::new(),
        Some(value) => serde_json::to_string_pretty(value).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r##"{
  "cells": [
    {
      "cell_type": "markdown",
      "id": "a",
      "metadata": {},
      "source": ["# Title\n", "text"]
    },
    {
      "cell_type": "code",
      "execution_count": 3,
      "id": "b",
      "metadata": { "custom": true },
      "outputs": [],
      "source": "print(1)"
    }
  ],
  "metadata": { "language_info": { "name": "python" } },
  "nbformat": 4,
  "nbformat_minor": 5
}"##;

    #[test]
    fn parses_and_reads_cells() {
        let notebook = parse(SAMPLE).unwrap();
        let cells = cells(&notebook);
        assert_eq!(cells.len(), 2);
        assert_eq!(cell_source(&cells[0]), "# Title\ntext");
        assert_eq!(cell_source(&cells[1]), "print(1)");
        assert_eq!(execution_count(&cells[1]), Some(3));
        assert_eq!(language(&notebook), "python");
        assert!(parse("[]").is_err());
        assert_eq!(parse("{}").unwrap_err(), "Notebook file does not contain a cells array.");
    }

    #[test]
    fn edits_keep_unknown_fields_and_key_order() {
        let mut notebook = parse(SAMPLE).unwrap();
        set_source(&mut notebook, 1, "a = 1\nb = 2\n");
        assert_eq!(cells(&notebook)[1]["source"], json!(["a = 1\n", "b = 2\n"]));
        let text = serialize(&notebook);
        assert!(text.find("\"cell_type\": \"code\"").unwrap() < text.find("\"execution_count\": 3").unwrap());
        assert!(text.contains("\"custom\": true"));
        assert!(text.contains("\"nbformat_minor\": 5"));
        assert!(text.ends_with("}\n"));
        set_type(&mut notebook, 1, CellType::Markdown);
        assert!(cells(&notebook)[1].get("outputs").is_none());
        set_type(&mut notebook, 0, CellType::Code);
        assert_eq!(cells(&notebook)[0]["outputs"], json!([]));
        assert_eq!(cells(&notebook)[0]["execution_count"], Value::Null);
    }

    #[test]
    fn inserts_deletes_and_moves() {
        let mut notebook = parse(SAMPLE).unwrap();
        insert_cell(&mut notebook, 1, CellType::Code);
        assert_eq!(cells(&notebook).len(), 3);
        assert_eq!(cells(&notebook)[1], create_cell(CellType::Code, ""));
        assert!(move_cell(&mut notebook, 0, 2));
        assert_eq!(cells(&notebook)[2]["id"], "a");
        assert!(!move_cell(&mut notebook, 0, 5));
        delete_cell(&mut notebook, 2);
        assert_eq!(cells(&notebook).len(), 2);
        assert_eq!(remap_moved(0, 0, 2), 2);
        assert_eq!(remap_moved(1, 0, 2), 0);
        assert_eq!(remap_moved(1, 2, 0), 2);
        assert_eq!(remap_moved(3, 0, 2), 3);
    }

    #[test]
    fn runs_become_outputs() {
        let run = CellRun::from_json(&json!({
            "stdout": "hi\n", "stderr": "", "status": 0, "timedOut": false,
            "displayData": [{ "outputType": "execute_result", "data": { "text/plain": "2" }, "metadata": {} }],
        }));
        let outputs = run_outputs(&run);
        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0]["name"], "stdout");
        assert_eq!(outputs[1]["output_type"], "execute_result");
        assert_eq!(data_text(&outputs[1], "text/plain"), "2");
        let failed = run_outputs(&CellRun { stderr: "Traceback\nNameError".into(), status: Some(1), ..Default::default() });
        assert_eq!(failed[0]["ename"], "PythonError");
        assert_eq!(failed[0]["traceback"], json!(["Traceback", "NameError"]));
        let timed_out = run_outputs(&CellRun { timed_out: true, ..Default::default() });
        assert_eq!(timed_out[0]["evalue"], "Cell execution timed out.");
        assert_eq!(data_json(&json!({ "data": { "application/vnd+json": "{\"a\":1}" } })), "{\n  \"a\": 1\n}");
    }
}
