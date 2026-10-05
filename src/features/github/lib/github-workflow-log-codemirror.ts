import { foldService } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { IS_MAC } from "@/utils/platform";
import {
  createWorkflowLogDecorations,
  findWorkflowLogFileReferences,
  type WorkflowLogFileReference,
  type WorkflowLogFoldRange,
  type WorkflowLogModel,
} from "../utils/github-workflow-log-model";

const VIEWPORT_MARGIN_LINES = 60;
const FILE_LINK_CLASS = "gha-log-file-link";

export interface WorkflowLogViewState {
  model: WorkflowLogModel;
  showTimestamps: boolean;
  highlightLine: number | null;
  repoPath: string | null;
}

const setWorkflowLogState = StateEffect.define<WorkflowLogViewState>();

const workflowLogField = StateField.define<WorkflowLogViewState | null>({
  create: () => null,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setWorkflowLogState)) return effect.value;
    }
    return value;
  },
});

/** Hands the view the log model behind its text, with the options that shape decorations. */
export function updateWorkflowLog(view: EditorView, state: WorkflowLogViewState): void {
  view.dispatch({ effects: setWorkflowLogState.of(state) });
}

export function getWorkflowLogState(state: EditorState): WorkflowLogViewState | null {
  return state.field(workflowLogField, false) ?? null;
}

const foldRangesByStart = new WeakMap<WorkflowLogModel, Map<number, WorkflowLogFoldRange>>();

function foldRangeStartingAt(model: WorkflowLogModel, line: number) {
  let ranges = foldRangesByStart.get(model);
  if (!ranges) {
    ranges = new Map(model.foldRanges.map((range) => [range.start, range]));
    foldRangesByStart.set(model, ranges);
  }
  return ranges.get(line);
}

const workflowLogFolding = foldService.of((state, lineStart) => {
  const entry = getWorkflowLogState(state);
  if (!entry) return null;
  const line = state.doc.lineAt(lineStart);
  const range = foldRangeStartingAt(entry.model, line.number);
  if (!range) return null;
  const endLine = Math.min(range.end, state.doc.lines);
  if (endLine <= line.number) return null;
  return { from: line.to, to: state.doc.line(endLine).to };
});

const fileReferenceCache = new WeakMap<
  WorkflowLogModel,
  { showTimestamps: boolean; byLine: Map<number, WorkflowLogFileReference[]> }
>();

function fileReferencesByLine(model: WorkflowLogModel, showTimestamps: boolean) {
  const cached = fileReferenceCache.get(model);
  if (cached && cached.showTimestamps === showTimestamps) return cached.byLine;
  const byLine = new Map<number, WorkflowLogFileReference[]>();
  for (const reference of findWorkflowLogFileReferences(model, { showTimestamps })) {
    const list = byLine.get(reference.line);
    if (list) list.push(reference);
    else byLine.set(reference.line, [reference]);
  }
  fileReferenceCache.set(model, { showTimestamps, byLine });
  return byLine;
}

export function resolveWorkflowLogFilePath(root: string | null, path: string): string {
  if (/^([A-Za-z]:[\\/]|\/)/.test(path)) return path;
  const normalized = path.replace(/^\.\//, "");
  return root ? `${root.replace(/[\\/]+$/, "")}/${normalized}` : normalized;
}

const linkTitle = `${IS_MAC ? "Cmd" : "Ctrl"}+click to open in editor`;

/**
 * Builds decorations for the lines around the viewport only, so a hundred-thousand-line log never
 * gets a hundred thousand decorations.
 */
export function buildWorkflowLogDecorations(view: EditorView): DecorationSet {
  const entry = getWorkflowLogState(view.state);
  const { doc } = view.state;
  if (!entry || view.visibleRanges.length === 0) return Decoration.none;

  const first = view.visibleRanges[0];
  const last = view.visibleRanges[view.visibleRanges.length - 1];
  const fromLine = Math.max(1, doc.lineAt(first.from).number - VIEWPORT_MARGIN_LINES);
  const toLine = Math.min(doc.lines, doc.lineAt(last.to).number + VIEWPORT_MARGIN_LINES);
  const ranges: Range<Decoration>[] = [];

  const columnPosition = (lineNumber: number, column: number) => {
    const line = doc.line(lineNumber);
    return Math.min(line.to, line.from + Math.max(0, column - 1));
  };

  for (const decoration of createWorkflowLogDecorations(entry.model, {
    fromLine,
    toLine,
    showTimestamps: entry.showTimestamps,
    highlightLine: entry.highlightLine,
  })) {
    if (decoration.line > doc.lines) continue;
    if (decoration.wholeLine) {
      const from = doc.line(decoration.line).from;
      ranges.push(Decoration.line({ class: decoration.className }).range(from));
      continue;
    }
    const from = columnPosition(decoration.line, decoration.startColumn ?? 1);
    const to = columnPosition(decoration.line, decoration.endColumn ?? 1);
    if (to > from) ranges.push(Decoration.mark({ class: decoration.className }).range(from, to));
  }

  const references = fileReferencesByLine(entry.model, entry.showTimestamps);
  for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
    for (const reference of references.get(lineNumber) ?? []) {
      const from = columnPosition(lineNumber, reference.startColumn);
      const to = columnPosition(lineNumber, reference.endColumn);
      if (to <= from) continue;
      ranges.push(
        Decoration.mark({
          class: FILE_LINK_CLASS,
          attributes: {
            title: linkTitle,
            "data-path": resolveWorkflowLogFilePath(entry.repoPath, reference.path),
            "data-line": reference.fileLine ? String(reference.fileLine) : "",
            "data-column": reference.fileColumn ? String(reference.fileColumn) : "",
          },
        }).range(from, to),
      );
    }
  }

  return Decoration.set(ranges, true);
}

const workflowLogDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildWorkflowLogDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        getWorkflowLogState(update.startState) !== getWorkflowLogState(update.state)
      ) {
        this.decorations = buildWorkflowLogDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const workflowLogLinks = EditorView.domEventHandlers({
  mousedown: (event) => {
    if (event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) return false;
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLElement>(`.${FILE_LINK_CLASS}`);
    const path = link?.dataset.path;
    if (!path) return false;
    event.preventDefault();
    const line = Number(link.dataset.line) || undefined;
    const column = Number(link.dataset.column) || undefined;
    void useFileSystemStore.getState().handleFileSelect(path, false, line, column);
    return true;
  },
});

/**
 * Folding for `##[group]` blocks, level and ANSI colors, timestamps, the highlighted problem line,
 * and links for file references, all driven by the model passed to `updateWorkflowLog`.
 */
export const workflowLogExtension: Extension = [
  workflowLogField,
  workflowLogFolding,
  workflowLogDecorations,
  workflowLogLinks,
];
