//! "Run cell" and "Run chunk" lenses (`code-editor.tsx`): Python `# %%` cells and R Markdown
//! chunks, run like notebook cells; R output is written back under its chunk.

use gpui::Context;

use super::{ChunkOutput, apply_chunk_options, clear_chunk_output, format_chunk_output, python_script_cells, rmarkdown_chunks, run_python_cell, run_r_cell, update_chunk_output, working_directory};
use crate::{
    Editor,
    code_lens::{CodeLens, LensAction},
    document::Target,
    history::EditKind,
    notebook::minimal_edit,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum ScriptKind {
    Python,
    RMarkdown,
}

fn truncate(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= 180 { trimmed.to_string() } else { format!("{}...", trimmed.chars().take(177).collect::<String>()) }
}

impl Editor {
    fn script_kind(&self) -> Option<ScriptKind> {
        let name = self.path.to_string_lossy().to_lowercase();
        if name.ends_with(".py") || name.ends_with(".ipy") {
            Some(ScriptKind::Python)
        } else if name.ends_with(".rmd") {
            Some(ScriptKind::RMarkdown)
        } else {
            None
        }
    }

    /// Parses the file's cells or chunks again for their lenses.
    pub(crate) fn refresh_script_cells(&mut self) {
        let Some(kind) = self.script_kind() else { return };
        let text = self.document.buffer.text();
        let buffer = &self.document.buffer;
        let (lines, title): (Vec<usize>, &str) = match kind {
            ScriptKind::Python => (python_script_cells(&text).iter().map(|cell| cell.marker_line).collect(), "Run cell"),
            ScriptKind::RMarkdown => (rmarkdown_chunks(&text).iter().map(|chunk| chunk.marker_line).collect(), "Run chunk"),
        };
        self.code_lens.cells = lines
            .into_iter()
            .enumerate()
            .map(|(index, line)| CodeLens { offset: buffer.line_start(line), title: title.into(), action: LensAction::Cell(index) })
            .collect();
    }

    pub(crate) fn run_script_lens(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(kind) = self.script_kind() else { return };
        let text = self.document.buffer.text();
        let cwd = working_directory(&self.path, self.fs.is_local());
        match kind {
            ScriptKind::Python => {
                let Some(cell) = python_script_cells(&text).into_iter().nth(index) else { return };
                let run = run_python_cell(cell.code, cwd, Some(cell.setup_code));
                cx.spawn(async move |_, cx| {
                    let result = run.await;
                    cx.update(|cx| match result {
                        Err(error) => {
                            notifications::error(cx, error, None);
                        }
                        Ok(run) if run.timed_out => {
                            notifications::error(cx, "Python cell timed out.", None);
                        }
                        Ok(run) if run.status != Some(0) || !run.stderr.trim().is_empty() => {
                            let message = if run.stderr.is_empty() { format!("Python exited with status {}.", run.status.map(|status| status.to_string()).unwrap_or_else(|| "null".into())) } else { run.stderr };
                            notifications::error(cx, truncate(&message), None);
                        }
                        Ok(run) => {
                            let stdout = truncate(&run.stdout);
                            let message = if !stdout.is_empty() {
                                format!("Python cell output: {stdout}")
                            } else if !run.display_data.is_empty() {
                                format!("Python cell produced {} display output(s).", run.display_data.len())
                            } else {
                                "Python cell ran.".into()
                            };
                            notifications::info(cx, message);
                        }
                    });
                })
                .detach();
            }
            ScriptKind::RMarkdown => {
                let Some(chunk) = rmarkdown_chunks(&text).into_iter().nth(index) else { return };
                if !chunk.should_evaluate() {
                    self.replace_script_text(clear_chunk_output(&text, &chunk), cx);
                    notifications::info(cx, "R chunk skipped because eval=FALSE.");
                    return;
                }
                let run = run_r_cell(chunk.code.clone(), cwd, Some(chunk.setup_code.clone()));
                cx.spawn(async move |this, cx| {
                    let result = run.await;
                    this.update(cx, |editor, cx| {
                        let run = match result {
                            Ok(run) => run,
                            Err(error) => {
                                notifications::error(cx, error, None);
                                return;
                            }
                        };
                        let text = editor.document.buffer.text();
                        let chunk = rmarkdown_chunks(&text).into_iter().nth(index).unwrap_or(chunk);
                        let output = apply_chunk_options(ChunkOutput { stdout: run.stdout.clone(), stderr: run.stderr.clone(), status: run.status, timed_out: run.timed_out }, &chunk);
                        let next = if chunk.should_persist_output() { update_chunk_output(&text, &chunk, &format_chunk_output(&output)) } else { clear_chunk_output(&text, &chunk) };
                        editor.replace_script_text(next, cx);
                        if run.timed_out {
                            notifications::error(cx, "R chunk timed out.", None);
                            return;
                        }
                        let captured = chunk.options.error == Some(true);
                        if !captured && (output.status.is_some_and(|status| status != 0) || !output.stderr.trim().is_empty()) {
                            let message = if output.stderr.is_empty() { format!("R exited with status {}.", output.status.map(|status| status.to_string()).unwrap_or_else(|| "null".into())) } else { output.stderr.clone() };
                            notifications::error(cx, truncate(&message), None);
                            return;
                        }
                        let stdout = truncate(&output.stdout);
                        if captured && !output.stderr.trim().is_empty() {
                            notifications::info(cx, "R chunk completed with captured error output.");
                        } else {
                            notifications::info(cx, if stdout.is_empty() { "R chunk ran.".to_string() } else { format!("R chunk output: {stdout}") });
                        }
                    })
                    .ok();
                })
                .detach();
            }
        }
    }

    fn replace_script_text(&mut self, text: String, cx: &mut Context<Self>) {
        let (range, new) = minimal_edit(&self.document.buffer.text(), &text);
        if range.is_empty() && new.is_empty() {
            return;
        }
        let targets = self.document.selections.iter().map(|selection| Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
        self.update_document(cx, |document| document.apply_edits(vec![(range, new)], targets, EditKind::Other));
    }
}
