import "../markdown/styles.css";
import DOMPurify from "dompurify";
import {
  EyeIcon as Eye,
  PencilSimpleIcon as Edit,
  PlayIcon as Play,
  WarningCircleIcon as Warning,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useHighlightedMarkdown } from "@/features/editor/markdown/use-highlighted-markdown";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { HighlightedCode } from "./highlighted-code";
import { NotebookCodeCellEditor } from "./notebook-code-cell-editor";
import {
  notebookCellSource,
  notebookLanguage,
  notebookOutputText,
  parseNotebookContent,
  serializeNotebook,
  updateNotebookCellOutputs,
  updateNotebookCellSource,
  type NotebookCell,
  type NotebookDocument,
  type NotebookOutput,
} from "./notebook-model";

interface NotebookRunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
}

function maxExecutionCount(notebook: NotebookDocument): number {
  return notebook.cells.reduce((max, cell) => {
    const count = typeof cell.execution_count === "number" ? cell.execution_count : 0;
    return Math.max(max, count);
  }, 0);
}

function outputDataText(data: Record<string, string | string[]> | undefined, mime: string): string {
  return notebookOutputText(data?.[mime]);
}

function outputDataJson(data: Record<string, string | string[]> | undefined): string {
  const value = data?.["application/json"];
  if (Array.isArray(value)) return value.join("");
  if (typeof value === "string") return value;
  return "";
}

function resultToOutputs(result: NotebookRunResult): NotebookOutput[] {
  const outputs: NotebookOutput[] = [];

  if (result.stdout) {
    outputs.push({
      output_type: "stream",
      name: "stdout",
      text: result.stdout,
    });
  }

  if (result.stderr || result.status !== 0 || result.timedOut) {
    const message = result.timedOut
      ? "Cell execution timed out."
      : result.stderr || `Python exited with status ${result.status}.`;
    outputs.push({
      output_type: "error",
      ename: result.timedOut ? "TimeoutError" : "PythonError",
      evalue: message.trim(),
      traceback: message ? message.split("\n") : [],
    });
  }

  return outputs;
}

function notebookWorkingDirectory(path: string): string | null {
  if (!path || path.startsWith("remote://") || path.includes("://")) return null;
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return path.slice(0, lastSlash);
}

function MarkdownCellPreview({ source }: { source: string }) {
  const html = useHighlightedMarkdown(source);
  return (
    <div
      className="markdown-preview !block !h-auto !overflow-visible !bg-transparent !p-0 py-1.5 [&_.markdown-content]:max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function MarkdownOutput({ source }: { source: string }) {
  const html = useHighlightedMarkdown(source);
  return (
    <div
      className="markdown-preview overflow-auto rounded-md border border-border bg-secondary-bg p-2.5 [&_.markdown-content]:max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const outputClassName =
  "m-0 overflow-auto rounded-md border border-border bg-secondary-bg p-2.5 font-mono text-[0.92em] leading-[1.55] text-text";

function NotebookOutputView({ output }: { output: NotebookOutput }) {
  if (output.output_type === "stream") {
    return (
      <pre className={cn(outputClassName, "whitespace-pre-wrap")}>
        <code>{notebookOutputText(output.text)}</code>
      </pre>
    );
  }

  if (output.output_type === "error") {
    const traceback = output.traceback?.length
      ? output.traceback.join("\n")
      : [output.ename, output.evalue].filter(Boolean).join(": ");
    return (
      <pre className={cn(outputClassName, "whitespace-pre-wrap border-error/45 text-error")}>
        <code>{traceback}</code>
      </pre>
    );
  }

  if (output.output_type === "display_data" || output.output_type === "execute_result") {
    const png = outputDataText(output.data, "image/png").replace(/\s/g, "");
    if (png) {
      return (
        <div className={cn(outputClassName, "p-2.5")}>
          <img src={`data:image/png;base64,${png}`} alt="" className="block max-w-full" />
        </div>
      );
    }

    const jpeg = outputDataText(output.data, "image/jpeg").replace(/\s/g, "");
    if (jpeg) {
      return (
        <div className={cn(outputClassName, "p-2.5")}>
          <img src={`data:image/jpeg;base64,${jpeg}`} alt="" className="block max-w-full" />
        </div>
      );
    }

    const html = outputDataText(output.data, "text/html");
    if (html) {
      return (
        <div
          className="overflow-auto rounded-md border border-border bg-secondary-bg p-2.5"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />
      );
    }

    const markdown = outputDataText(output.data, "text/markdown");
    if (markdown) return <MarkdownOutput source={markdown} />;

    const json = outputDataJson(output.data);
    if (json) {
      return <HighlightedCode code={json} language="json" className={outputClassName} />;
    }

    const text = outputDataText(output.data, "text/plain");
    if (text) {
      return (
        <pre className={cn(outputClassName, "whitespace-pre-wrap")}>
          <code>{text}</code>
        </pre>
      );
    }
  }

  return null;
}

function NotebookCellView({
  cell,
  cellIndex,
  language,
  isEditing,
  isRunning,
  onEditToggle,
  onRun,
  onSourceChange,
}: {
  cell: NotebookCell;
  cellIndex: number;
  language: string;
  isEditing: boolean;
  isRunning: boolean;
  onEditToggle: (cellIndex: number) => void;
  onRun: (cellIndex: number) => void;
  onSourceChange: (cellIndex: number, source: string) => void;
}) {
  const source = notebookCellSource(cell);
  const isCode = cell.cell_type === "code";
  const isMarkdown = cell.cell_type === "markdown";
  const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];

  return (
    <section className="mb-4 grid grid-cols-[58px_minmax(0,1fr)] gap-2.5">
      <div className="pt-[31px] text-right">
        <span className="font-mono text-[0.82em] text-text-lighter">
          {isCode ? `[${cell.execution_count ?? ""}]` : ""}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex min-h-7 items-center justify-between gap-2 opacity-75 transition-opacity hover:opacity-100 focus-within:opacity-100">
          <span className="font-mono text-[0.78em] text-text-lighter">{cell.cell_type}</span>
          <div className="flex items-center gap-0.5">
            {isCode ? (
              <Button
                variant="ghost"
                compact
                className="h-6 min-w-6 text-text-lighter hover:text-text"
                onClick={() => onRun(cellIndex)}
                disabled={isRunning}
                tooltip={isRunning ? "Running cell" : "Run cell"}
                tooltipSide="bottom"
              >
                <Play weight="duotone" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              compact
              className="h-6 min-w-6 text-text-lighter hover:text-text"
              onClick={() => onEditToggle(cellIndex)}
              tooltip={isEditing ? "Preview cell" : "Edit cell"}
              tooltipSide="bottom"
            >
              {isEditing ? <Eye weight="duotone" /> : <Edit weight="duotone" />}
            </Button>
          </div>
        </div>

        {isEditing ? (
          isCode ? (
            <NotebookCodeCellEditor
              id={cell.id ?? `cell-${cellIndex}`}
              value={source}
              language={language}
              onChange={(value) => onSourceChange(cellIndex, value)}
            />
          ) : (
            <textarea
              className="m-0 block min-h-[92px] w-full resize-y rounded-md border border-border bg-secondary-bg p-2.5 font-mono text-[0.92em] leading-[1.55] text-text outline-none focus:border-accent"
              value={source}
              spellCheck={isMarkdown}
              onChange={(event) => onSourceChange(cellIndex, event.target.value)}
              rows={Math.max(3, source.split("\n").length + 1)}
            />
          )
        ) : isMarkdown ? (
          <MarkdownCellPreview source={source} />
        ) : (
          <HighlightedCode
            code={source}
            language={isCode ? language : "plaintext"}
            className={outputClassName}
          />
        )}

        {outputs.length > 0 ? (
          <div className="mt-2 grid gap-2">
            {outputs.map((output, outputIndex) => (
              <NotebookOutputView key={`${output.output_type}-${outputIndex}`} output={output} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function NotebookEditor() {
  const { bufferId, content, path } = useBufferStore(
    useShallow((state) => {
      const buffer = state.activeBufferId
        ? state.buffers.find((candidate) => candidate.id === state.activeBufferId)
        : null;
      return {
        bufferId: buffer?.id ?? null,
        content: buffer?.type === "editor" ? buffer.content : "",
        path: buffer?.type === "editor" ? buffer.path : "",
      };
    }),
  );
  const fontSize = useEditorSettingsStore.use.fontSize();
  const uiFontFamily = useSettingsStore((state) => state.settings.uiFontFamily);
  const { handleContentChange } = useEditorAppStore.use.actions();
  const [editingCells, setEditingCells] = useState<Set<number>>(new Set());
  const [runningCell, setRunningCell] = useState<number | null>(null);

  const parsed = useMemo(() => parseNotebookContent(content), [content]);

  const updateNotebook = (notebook: NotebookDocument) => {
    void handleContentChange(serializeNotebook(notebook));
  };

  const handleEditToggle = (cellIndex: number) => {
    setEditingCells((current) => {
      const next = new Set(current);
      if (next.has(cellIndex)) {
        next.delete(cellIndex);
      } else {
        next.add(cellIndex);
      }
      return next;
    });
  };

  const handleSourceChange = (cellIndex: number, source: string) => {
    if (!parsed.ok) return;
    updateNotebook(updateNotebookCellSource(parsed.notebook, cellIndex, source));
  };

  const handleRunCell = async (cellIndex: number) => {
    if (!parsed.ok || runningCell !== null) return;

    const cell = parsed.notebook.cells[cellIndex];
    if (!cell || cell.cell_type !== "code") return;

    setRunningCell(cellIndex);
    try {
      const result = await invoke<NotebookRunResult>("notebook_run_python_cell", {
        code: notebookCellSource(cell),
        cwd: notebookWorkingDirectory(path),
      });
      const executionCount = maxExecutionCount(parsed.notebook) + 1;
      const nextNotebook = updateNotebookCellOutputs(
        parsed.notebook,
        cellIndex,
        resultToOutputs(result),
        executionCount,
      );
      updateNotebook(nextNotebook);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextNotebook = updateNotebookCellOutputs(
        parsed.notebook,
        cellIndex,
        [
          {
            output_type: "error",
            ename: "ExecutionError",
            evalue: message,
            traceback: [message],
          },
        ],
        cell.execution_count ?? null,
      );
      updateNotebook(nextNotebook);
    } finally {
      setRunningCell(null);
    }
  };

  if (!bufferId) return null;

  if (!parsed.ok) {
    return (
      <div
        className="flex h-full items-center justify-center gap-2 overflow-auto bg-primary-bg px-[22px] py-[18px] pb-[calc(2rem+env(safe-area-inset-bottom))] text-text-lighter"
        style={{ fontSize, fontFamily: uiFontFamily }}
      >
        <Warning weight="duotone" />
        <span>{parsed.message}</span>
      </div>
    );
  }

  const language = notebookLanguage(parsed.notebook);

  return (
    <div
      className="h-full overflow-auto bg-primary-bg px-[22px] py-[18px] pb-[calc(2rem+env(safe-area-inset-bottom))] text-text"
      style={{ fontSize: `${fontSize}px`, fontFamily: `${uiFontFamily}, sans-serif` }}
    >
      <div className="mx-auto w-[min(100%,980px)]">
        {parsed.notebook.cells.map((cell, cellIndex) => (
          <NotebookCellView
            key={cell.id ?? cellIndex}
            cell={cell}
            cellIndex={cellIndex}
            language={language}
            isEditing={editingCells.has(cellIndex)}
            isRunning={runningCell === cellIndex}
            onEditToggle={handleEditToggle}
            onRun={handleRunCell}
            onSourceChange={handleSourceChange}
          />
        ))}
      </div>
    </div>
  );
}
