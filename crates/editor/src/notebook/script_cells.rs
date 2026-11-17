//! Runnable pieces of plain files: `# %%` cells in Python scripts (`python-script-cells.ts`) and
//! R chunks in R Markdown (`rmarkdown-chunks.ts`), whose output is written back under the chunk.

use std::sync::LazyLock;

use regex::Regex;

static PYTHON_CELL_MARKER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*#\s*%%(?:\s*(.*))?$").unwrap());
static OPENING_FENCE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*```\s*(?:\{\s*([A-Za-z0-9_-]+)([^}]*)\}|([A-Za-z0-9_-]+)(.*))$").unwrap());
static CLOSING_FENCE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*```\s*$").unwrap());
static OUTPUT_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*<!--\s*athas:r-output:start\b.*-->\s*$").unwrap());
static OUTPUT_END: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*<!--\s*athas:r-output:end\s*-->\s*$").unwrap());
static WARNING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^\s*Warning( message| messages)?:").unwrap());

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PythonScriptCell {
    pub index: usize,
    /// The `# %%` line, where the "Run cell" lens sits.
    pub marker_line: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub start_offset: usize,
    pub end_offset: usize,
    pub title: String,
    pub code: String,
    /// The cells above, run first so the cell sees their names.
    pub setup_code: String,
}

fn line_starts(content: &str) -> Vec<usize> {
    std::iter::once(0).chain(content.match_indices('\n').map(|(index, _)| index + 1)).collect()
}

fn line_end(content: &str, start: usize) -> usize {
    content[start..].find('\n').map(|index| start + index + 1).unwrap_or(content.len())
}

fn line_at(starts: &[usize], offset: usize) -> usize {
    starts.partition_point(|start| *start <= offset).saturating_sub(1)
}

fn join_setup(parts: &[String]) -> String {
    parts.iter().filter(|part| !part.trim().is_empty()).cloned().collect::<Vec<_>>().join("\n")
}

pub fn python_script_cells(content: &str) -> Vec<PythonScriptCell> {
    let starts = line_starts(content);
    let mut markers = Vec::new();
    for (line, text) in content.split('\n').enumerate() {
        let Some(captures) = PYTHON_CELL_MARKER.captures(text.trim_end_matches('\r')) else { continue };
        let offset = starts[line];
        let title = captures.get(1).map(|title| title.as_str().trim()).filter(|title| !title.is_empty()).map(str::to_string);
        markers.push((line, offset, line_end(content, offset), title.unwrap_or_else(|| format!("Cell {}", markers.len() + 1))));
    }
    let mut cells = Vec::new();
    let mut setup: Vec<String> = Vec::new();
    for (index, (line, _, marker_end, title)) in markers.iter().enumerate() {
        let start_offset = *marker_end;
        let end_offset = markers.get(index + 1).map(|next| next.1).unwrap_or(content.len());
        let code = content[start_offset.min(end_offset)..end_offset].trim_end().to_string();
        cells.push(PythonScriptCell {
            index,
            marker_line: *line,
            start_line: line + 1,
            end_line: line_at(&starts, start_offset.max(end_offset.saturating_sub(1))),
            start_offset,
            end_offset,
            title: title.clone(),
            code: code.clone(),
            setup_code: join_setup(&setup),
        });
        setup.push(code);
    }
    cells
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChunkOptions {
    pub label: Option<String>,
    pub eval: Option<bool>,
    pub include: Option<bool>,
    pub echo: Option<bool>,
    pub warning: Option<bool>,
    pub message: Option<bool>,
    pub results: Option<String>,
    pub error: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RMarkdownChunk {
    pub index: usize,
    pub marker_line: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub start_offset: usize,
    pub end_offset: usize,
    /// Just past the closing fence's line.
    pub close_end_offset: usize,
    /// The output block written under the chunk by an earlier run.
    pub output: Option<(usize, usize)>,
    pub title: String,
    pub language: String,
    pub options: ChunkOptions,
    pub code: String,
    pub setup_code: String,
}

impl RMarkdownChunk {
    pub fn should_evaluate(&self) -> bool {
        self.options.eval != Some(false)
    }

    pub fn should_persist_output(&self) -> bool {
        self.options.include != Some(false)
    }
}

fn split_options(info: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut previous = None;
    for ch in info.chars() {
        if (ch == '\'' || ch == '"') && previous != Some('\\') {
            quote = if quote == Some(ch) { None } else { quote.or(Some(ch)) };
            current.push(ch);
        } else if ch == ',' && quote.is_none() {
            if !current.trim().is_empty() {
                parts.push(current.trim().to_string());
            }
            current.clear();
        } else {
            current.push(ch);
        }
        previous = Some(ch);
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

enum OptionValue {
    Bool(bool),
    Text(String),
    Number(String),
}

fn option_value(value: &str) -> OptionValue {
    let trimmed = value.trim();
    match trimmed.to_lowercase().as_str() {
        "true" | "t" => return OptionValue::Bool(true),
        "false" | "f" => return OptionValue::Bool(false),
        _ => {}
    }
    if trimmed.len() >= 2 && ((trimmed.starts_with('\'') && trimmed.ends_with('\'')) || (trimmed.starts_with('"') && trimmed.ends_with('"'))) {
        return OptionValue::Text(trimmed[1..trimmed.len() - 1].to_string());
    }
    if !trimmed.is_empty() && trimmed.parse::<f64>().is_ok() {
        return OptionValue::Number(trimmed.to_string());
    }
    OptionValue::Text(trimmed.to_string())
}

fn parse_options(info: &str) -> ChunkOptions {
    let mut options = ChunkOptions::default();
    for part in split_options(info.trim()) {
        let Some((key, value)) = part.split_once('=') else {
            if options.label.is_none() && !part.trim().is_empty() {
                options.label = Some(part.trim().to_string());
            }
            continue;
        };
        let value = option_value(value);
        let flag = match &value {
            OptionValue::Bool(flag) => Some(*flag),
            _ => None,
        };
        match key.trim().to_lowercase().as_str() {
            "label" => {
                if let OptionValue::Text(text) = &value {
                    options.label = Some(text.clone());
                }
            }
            "eval" if flag.is_some() => options.eval = flag,
            "include" if flag.is_some() => options.include = flag,
            "echo" if flag.is_some() => options.echo = flag,
            "warning" if flag.is_some() => options.warning = flag,
            "message" if flag.is_some() => options.message = flag,
            "error" if flag.is_some() => options.error = flag,
            "results" => {
                options.results = Some(match value {
                    OptionValue::Bool(flag) => flag.to_string(),
                    OptionValue::Text(text) | OptionValue::Number(text) => text.to_lowercase(),
                })
            }
            _ => {}
        }
    }
    options
}

fn output_range(content: &str, lines: &[&str], starts: &[usize], close_line: usize) -> Option<(usize, usize)> {
    let line = (close_line + 1..lines.len()).find(|line| !lines[*line].trim().is_empty())?;
    if !OUTPUT_START.is_match(lines[line]) {
        return None;
    }
    let end = (line + 1..lines.len()).find(|end| OUTPUT_END.is_match(lines[*end]))?;
    Some((starts[line], line_end(content, starts[end])))
}

pub fn rmarkdown_chunks(content: &str) -> Vec<RMarkdownChunk> {
    let starts = line_starts(content);
    let lines: Vec<&str> = content.split('\n').collect();
    let mut chunks = Vec::new();
    let mut setup: Vec<String> = Vec::new();
    let mut line = 0;
    while line < lines.len() {
        let Some(captures) = OPENING_FENCE.captures(lines[line]) else {
            line += 1;
            continue;
        };
        let language = captures.get(1).or(captures.get(3)).map(|language| language.as_str().to_lowercase()).unwrap_or_default();
        if language != "r" && language != "rscript" {
            line += 1;
            continue;
        }
        let options = parse_options(captures.get(2).or(captures.get(4)).map(|info| info.as_str()).unwrap_or_default());
        let title = options.label.clone().unwrap_or_else(|| format!("{language} chunk {}", chunks.len() + 1));
        let marker_end = line_end(content, starts[line]);
        let close_line = (line + 1..lines.len()).find(|candidate| CLOSING_FENCE.is_match(lines[*candidate])).unwrap_or(lines.len() - 1);
        let close_offset = starts[close_line];
        let code = content[marker_end.min(close_offset)..close_offset].trim_end().to_string();
        chunks.push(RMarkdownChunk {
            index: chunks.len(),
            marker_line: line,
            start_line: line + 1,
            end_line: (line + 1).max(close_line.saturating_sub(1)),
            start_offset: marker_end,
            end_offset: close_offset,
            close_end_offset: line_end(content, close_offset),
            output: output_range(content, &lines, &starts, close_line),
            title,
            language,
            options,
            code: code.clone(),
            setup_code: join_setup(&setup),
        });
        setup.push(code);
        line = close_line + 1;
    }
    chunks
}

/// What a chunk run printed, before it is written under the chunk.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChunkOutput {
    pub stdout: String,
    pub stderr: String,
    pub status: Option<i32>,
    pub timed_out: bool,
}

/// Drops what the chunk's `results`, `message` and `warning` options hide.
pub fn apply_chunk_options(mut output: ChunkOutput, chunk: &RMarkdownChunk) -> ChunkOutput {
    let failed = output.status.is_some_and(|status| status != 0);
    if !failed && (chunk.options.message == Some(false) || (chunk.options.warning == Some(false) && WARNING.is_match(&output.stderr))) {
        output.stderr.clear();
    }
    if chunk.options.results.as_deref() == Some("hide") {
        output.stdout.clear();
    }
    output
}

pub fn format_chunk_output(output: &ChunkOutput) -> String {
    let mut sections = Vec::new();
    if !output.stdout.trim().is_empty() {
        sections.push(output.stdout.trim_end().to_string());
    }
    if !output.stderr.trim().is_empty() {
        sections.push(format!("stderr:\n{}", output.stderr.trim_end()));
    } else if output.timed_out {
        sections.push("stderr:\nR chunk execution timed out.".into());
    } else if let Some(status) = output.status.filter(|status| *status != 0) {
        sections.push(format!("stderr:\nR exited with status {status}."));
    }
    let body = if sections.is_empty() { "R chunk ran with no output.".to_string() } else { sections.join("\n\n") };
    let longest = body
        .split(|ch| ch != '`')
        .map(str::len)
        .filter(|len| *len >= 3)
        .max()
        .unwrap_or(3);
    let fence = "`".repeat(longest + 1);
    ["<!-- athas:r-output:start -->".to_string(), format!("{fence}text"), body, fence, "<!-- athas:r-output:end -->".into(), String::new()].join("\n")
}

pub fn clear_chunk_output(content: &str, chunk: &RMarkdownChunk) -> String {
    match chunk.output {
        Some((start, end)) => format!("{}{}", &content[..start], &content[end..]),
        None => content.to_string(),
    }
}

pub fn update_chunk_output(content: &str, chunk: &RMarkdownChunk, output: &str) -> String {
    let output = if output.ends_with('\n') { output.to_string() } else { format!("{output}\n") };
    if let Some((start, end)) = chunk.output {
        return format!("{}{output}{}", &content[..start], &content[end..]);
    }
    let at = chunk.close_end_offset;
    let prefix = if at > 0 && !content[..at].ends_with('\n') { "\n" } else { "" };
    format!("{}{prefix}{output}{}", &content[..at], &content[at..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_cells_split_on_markers() {
        let text = "import os\n# %% Load\nx = 1\n\n#%%\nprint(x)\n";
        let cells = python_script_cells(text);
        assert_eq!(cells.len(), 2);
        assert_eq!(cells[0].title, "Load");
        assert_eq!(cells[0].marker_line, 1);
        assert_eq!(cells[0].code, "x = 1");
        assert_eq!(cells[0].setup_code, "");
        assert_eq!((cells[0].start_line, cells[0].end_line), (2, 3));
        assert_eq!(cells[1].title, "Cell 2");
        assert_eq!(cells[1].code, "print(x)");
        assert_eq!(cells[1].setup_code, "x = 1");
        assert!(python_script_cells("print(1)").is_empty());
    }

    #[test]
    fn rmarkdown_chunks_and_options() {
        let text = "# Doc\n```{r setup, include=FALSE}\nlibrary(x)\n```\n\nText\n```{r eval=F, results='hide'}\nsummary(x)\n```\n```python\nnope\n```\n";
        let chunks = rmarkdown_chunks(text);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].title, "setup");
        assert_eq!(chunks[0].options.include, Some(false));
        assert!(!chunks[0].should_persist_output());
        assert_eq!(chunks[0].code, "library(x)");
        assert_eq!(chunks[1].title, "r chunk 2");
        assert!(!chunks[1].should_evaluate());
        assert_eq!(chunks[1].options.results.as_deref(), Some("hide"));
        assert_eq!(chunks[1].setup_code, "library(x)");
        assert_eq!(chunks[1].marker_line, 6);
    }

    #[test]
    fn chunk_output_is_written_and_replaced() {
        let text = "```{r}\n1 + 1\n```\nafter\n";
        let chunk = &rmarkdown_chunks(text)[0];
        let output = format_chunk_output(&ChunkOutput { stdout: "[1] 2\n".into(), status: Some(0), ..Default::default() });
        assert_eq!(output, "<!-- athas:r-output:start -->\n````text\n[1] 2\n````\n<!-- athas:r-output:end -->\n");
        let written = update_chunk_output(text, chunk, &output);
        assert_eq!(written, format!("```{{r}}\n1 + 1\n```\n{output}after\n"));
        let chunk = &rmarkdown_chunks(&written)[0];
        assert!(chunk.output.is_some());
        let again = format_chunk_output(&ChunkOutput { stderr: "boom".into(), status: Some(1), ..Default::default() });
        assert_eq!(update_chunk_output(&written, chunk, &again), format!("```{{r}}\n1 + 1\n```\n{again}after\n"));
        assert_eq!(clear_chunk_output(&written, chunk), text);
        assert!(format_chunk_output(&ChunkOutput::default()).contains("R chunk ran with no output."));
    }

    #[test]
    fn chunk_options_hide_output() {
        let chunk = &rmarkdown_chunks("```{r message=FALSE, results=\"hide\"}\nx\n```\n")[0];
        let output = apply_chunk_options(ChunkOutput { stdout: "out".into(), stderr: "note".into(), status: Some(0), timed_out: false }, chunk);
        assert_eq!((output.stdout.as_str(), output.stderr.as_str()), ("", ""));
        let chunk = &rmarkdown_chunks("```{r warning=FALSE}\nx\n```\n")[0];
        let output = apply_chunk_options(ChunkOutput { stderr: "Warning message:\nbad".into(), status: Some(0), ..Default::default() }, chunk);
        assert_eq!(output.stderr, "");
        let output = apply_chunk_options(ChunkOutput { stderr: "Error".into(), status: Some(1), ..Default::default() }, chunk);
        assert_eq!(output.stderr, "Error");
    }
}
