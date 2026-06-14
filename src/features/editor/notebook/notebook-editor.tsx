import "../markdown/styles.css";
import DOMPurify from "dompurify";
import {
  EyeIcon as Eye,
  PencilSimpleIcon as Edit,
  PlayIcon as Play,
  PlusIcon as Plus,
  CodeIcon as Code,
  TextTIcon as Text,
  TrashIcon as Trash,
  WarningCircleIcon as Warning,
} from "@phosphor-icons/react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  deleteNotebookCell,
  insertNotebookCell,
  moveNotebookCell,
  notebookCellSource,
  notebookLanguage,
  notebookOutputText,
  parseNotebookContent,
  previousNotebookCodeSource,
  serializeNotebook,
  updateNotebookCellType,
  updateNotebookCellOutputs,
  updateNotebookCellSource,
  type NotebookCell,
  type NotebookCellType,
  type NotebookDocument,
  type NotebookOutput,
} from "./notebook-model";

interface NotebookRunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
}

const NOTEBOOK_CELL_ID_PREFIX = "notebook-cell";

function maxExecutionCount(notebook: NotebookDocument): number {
  return notebook.cells.reduce((max, cell) => {
    const count = typeof cell.execution_count === "number" ? cell.execution_count : 0;
    return Math.max(max, count);
  }, 0);
}

function remapMovedIndex(index: number, fromIndex: number, toIndex: number): number {
  if (fromIndex === toIndex) return index;
  if (index === fromIndex) return toIndex;
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return index - 1;
  if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return index + 1;
  return index;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function sortableCellIds(cells: NotebookCell[]): string[] {
  const seen = new Map<string, number>();

  return cells.map((cell) => {
    const base = cell.id
      ? `${NOTEBOOK_CELL_ID_PREFIX}:${cell.id}`
      : `${NOTEBOOK_CELL_ID_PREFIX}:fallback:${hashString(
          [cell.cell_type, notebookCellSource(cell)].join("\0"),
        )}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}:${count}`;
  });
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
  cellRef,
  sortableId,
  cellIndex,
  language,
  isEditing,
  isSelected,
  isRunning,
  onSelect,
  onEditToggle,
  onTypeChange,
  onInsertBelow,
  onDelete,
  onRun,
  onSourceChange,
  onMoveSelection,
}: {
  cell: NotebookCell;
  cellRef?: (element: HTMLElement | null) => void;
  sortableId: string;
  cellIndex: number;
  language: string;
  isEditing: boolean;
  isSelected: boolean;
  isRunning: boolean;
  onSelect: (cellIndex: number) => void;
  onEditToggle: (cellIndex: number) => void;
  onTypeChange: (cellIndex: number, cellType: NotebookCellType) => void;
  onInsertBelow: (cellIndex: number, cellType: NotebookCellType) => void;
  onDelete: (cellIndex: number) => void;
  onRun: (cellIndex: number) => void;
  onSourceChange: (cellIndex: number, source: string) => void;
  onMoveSelection: (direction: -1 | 1) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId });
  const source = notebookCellSource(cell);
  const isCode = cell.cell_type === "code";
  const isMarkdown = cell.cell_type === "markdown";
  const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const setCellRef = (element: HTMLElement | null) => {
    setNodeRef(element);
    cellRef?.(element);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    if (event.target !== event.currentTarget) return;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMoveSelection(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onMoveSelection(1);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && isCode) {
      event.preventDefault();
      onRun(cellIndex);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onEditToggle(cellIndex);
    }
  };

  return (
    <section
      ref={setCellRef}
      style={style}
      tabIndex={0}
      aria-selected={isSelected}
      className={cn(
        "group relative mb-4 grid grid-cols-[58px_minmax(0,1fr)] gap-2.5 rounded-md border border-transparent py-1 pr-1 outline-none transition-colors",
        isSelected && "border-accent/45 bg-accent/5",
        isDragging && "z-10 opacity-45",
      )}
      onFocus={() => onSelect(cellIndex)}
      onMouseDown={() => onSelect(cellIndex)}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          "absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-transparent transition-colors",
          isSelected && "bg-accent",
        )}
      />
      <div className="pt-[31px] text-right">
        <div
          ref={setActivatorNodeRef}
          aria-label="Move cell"
          className="inline-flex cursor-grab touch-none items-center justify-end gap-1 rounded px-1 py-0.5 text-text-lighter transition-colors hover:bg-hover hover:text-text active:cursor-grabbing"
          onClick={() => onSelect(cellIndex)}
          {...attributes}
          {...listeners}
        >
          <span
            aria-hidden
            className="grid h-3.5 w-2 grid-cols-2 content-center gap-x-0.5 gap-y-0.5 opacity-70"
          >
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
          </span>
          <span className="font-mono text-[0.82em]">
            {isCode ? `[${cell.execution_count ?? ""}]` : ""}
          </span>
        </div>
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
              onClick={() => onTypeChange(cellIndex, isCode ? "markdown" : "code")}
              tooltip={isCode ? "Convert to Markdown" : "Convert to Code"}
              tooltipSide="bottom"
            >
              {isCode ? <Text weight="duotone" /> : <Code weight="duotone" />}
            </Button>
            <Button
              variant="ghost"
              compact
              className="h-6 min-w-6 text-text-lighter hover:text-text"
              onClick={() => onInsertBelow(cellIndex, isCode ? "code" : "markdown")}
              tooltip="Insert cell below"
              tooltipSide="bottom"
            >
              <Plus weight="duotone" />
            </Button>
            <Button
              variant="ghost"
              compact
              className="h-6 min-w-6 text-text-lighter hover:text-text"
              onClick={() => onDelete(cellIndex)}
              tooltip="Delete cell"
              tooltipSide="bottom"
            >
              <Trash weight="duotone" />
            </Button>
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
  const cellRefs = useRef<Array<HTMLElement | null>>([]);
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
  const [selectedCellIndex, setSelectedCellIndex] = useState(0);
  const [runningCell, setRunningCell] = useState<number | null>(null);

  const parsed = useMemo(() => parseNotebookContent(content), [content]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const cellIds = useMemo(
    () => (parsed.ok ? sortableCellIds(parsed.notebook.cells) : []),
    [parsed],
  );

  const updateNotebook = (notebook: NotebookDocument) => {
    void handleContentChange(serializeNotebook(notebook));
  };

  const handleEditToggle = (cellIndex: number) => {
    setSelectedCellIndex(cellIndex);
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
    setSelectedCellIndex(cellIndex);
    if (!parsed.ok) return;
    updateNotebook(updateNotebookCellSource(parsed.notebook, cellIndex, source));
  };

  const handleRunCell = async (cellIndex: number) => {
    setSelectedCellIndex(cellIndex);
    if (!parsed.ok || runningCell !== null) return;

    const cell = parsed.notebook.cells[cellIndex];
    if (!cell || cell.cell_type !== "code") return;

    setRunningCell(cellIndex);
    try {
      const result = await invoke<NotebookRunResult>("notebook_run_python_cell", {
        code: notebookCellSource(cell),
        cwd: notebookWorkingDirectory(path),
        setupCode: previousNotebookCodeSource(parsed.notebook, cellIndex),
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

  const handleInsertCell = (cellIndex: number, cellType: NotebookCellType) => {
    if (!parsed.ok) return;
    const insertIndex = Math.max(0, Math.min(parsed.notebook.cells.length, cellIndex + 1));
    updateNotebook(insertNotebookCell(parsed.notebook, insertIndex, cellType));
    setSelectedCellIndex(insertIndex);
    setEditingCells((current) => {
      const next = new Set<number>();
      current.forEach((index) => {
        next.add(index >= insertIndex ? index + 1 : index);
      });
      next.add(insertIndex);
      return next;
    });
  };

  const handleAddCell = (cellType: NotebookCellType) => {
    if (!parsed.ok) return;
    const insertIndex = parsed.notebook.cells.length;
    updateNotebook(insertNotebookCell(parsed.notebook, insertIndex, cellType));
    setSelectedCellIndex(insertIndex);
    setEditingCells((current) => new Set([...current, insertIndex]));
  };

  const handleDeleteCell = (cellIndex: number) => {
    if (!parsed.ok) return;
    updateNotebook(deleteNotebookCell(parsed.notebook, cellIndex));
    setSelectedCellIndex((current) =>
      Math.max(
        0,
        Math.min(parsed.notebook.cells.length - 2, current > cellIndex ? current - 1 : current),
      ),
    );
    setEditingCells((current) => {
      const next = new Set<number>();
      current.forEach((index) => {
        if (index === cellIndex) return;
        next.add(index > cellIndex ? index - 1 : index);
      });
      return next;
    });
  };

  const handleTypeChange = (cellIndex: number, cellType: NotebookCellType) => {
    if (!parsed.ok) return;
    updateNotebook(updateNotebookCellType(parsed.notebook, cellIndex, cellType));
    setSelectedCellIndex(cellIndex);
    setEditingCells((current) => new Set([...current, cellIndex]));
  };

  const moveSelection = (direction: -1 | 1) => {
    if (!parsed.ok || parsed.notebook.cells.length === 0) return;

    const nextIndex = Math.max(
      0,
      Math.min(parsed.notebook.cells.length - 1, selectedCellIndex + direction),
    );
    setSelectedCellIndex(nextIndex);

    requestAnimationFrame(() => {
      const nextCell = cellRefs.current[nextIndex];
      nextCell?.focus({ preventScroll: true });
      nextCell?.scrollIntoView({ block: "nearest" });
    });
  };

  const handleCellDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    const activeIndex = cellIds.indexOf(activeId);
    if (activeIndex >= 0) setSelectedCellIndex(activeIndex);
  };

  const handleCellDragEnd = (event: DragEndEvent) => {
    if (!parsed.ok || !event.over || event.active.id === event.over.id) return;

    const fromIndex = cellIds.indexOf(String(event.active.id));
    const toIndex = cellIds.indexOf(String(event.over.id));
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    updateNotebook(moveNotebookCell(parsed.notebook, fromIndex, toIndex));
    setSelectedCellIndex(toIndex);
    setEditingCells((current) => {
      const next = new Set<number>();
      current.forEach((index) => {
        next.add(remapMovedIndex(index, fromIndex, toIndex));
      });
      return next;
    });
    setRunningCell((current) =>
      current === null ? null : remapMovedIndex(current, fromIndex, toIndex),
    );

    requestAnimationFrame(() => {
      cellRefs.current[toIndex]?.focus({ preventScroll: true });
      cellRefs.current[toIndex]?.scrollIntoView({ block: "nearest" });
    });
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
        <div className="mb-3 flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            compact
            className="h-7 gap-1.5 text-text-lighter hover:text-text"
            onClick={() => handleAddCell("code")}
          >
            <Code weight="duotone" />
            Code
          </Button>
          <Button
            variant="ghost"
            compact
            className="h-7 gap-1.5 text-text-lighter hover:text-text"
            onClick={() => handleAddCell("markdown")}
          >
            <Text weight="duotone" />
            Markdown
          </Button>
        </div>
        <DndContext
          sensors={sensors}
          modifiers={[restrictToVerticalAxis]}
          collisionDetection={closestCenter}
          onDragStart={handleCellDragStart}
          onDragEnd={handleCellDragEnd}
        >
          <SortableContext items={cellIds} strategy={verticalListSortingStrategy}>
            {parsed.notebook.cells.map((cell, cellIndex) => {
              const cellId = cellIds[cellIndex];
              return (
                <NotebookCellView
                  key={cellId}
                  sortableId={cellId}
                  cellRef={(element) => {
                    cellRefs.current[cellIndex] = element;
                  }}
                  cell={cell}
                  cellIndex={cellIndex}
                  language={language}
                  isEditing={editingCells.has(cellIndex)}
                  isSelected={selectedCellIndex === cellIndex}
                  isRunning={runningCell === cellIndex}
                  onSelect={setSelectedCellIndex}
                  onEditToggle={handleEditToggle}
                  onTypeChange={handleTypeChange}
                  onInsertBelow={handleInsertCell}
                  onDelete={handleDeleteCell}
                  onRun={handleRunCell}
                  onSourceChange={handleSourceChange}
                  onMoveSelection={moveSelection}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
