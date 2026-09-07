import { editor as monacoEditor, languages, Range, Uri } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  createWorkflowLogDecorations,
  findWorkflowLogFileReferences,
  type WorkflowLogModel,
} from "../utils/github-workflow-log-model";

export const WORKFLOW_LOG_LANGUAGE_ID = "github-actions-log";
const FILE_LINK_SCHEME = "athas-workflow-log-file";
const VIEWPORT_MARGIN_LINES = 60;

interface WorkflowLogModelEntry {
  model: WorkflowLogModel;
  showTimestamps: boolean;
  repoPath: string | null;
}

const modelRegistry = new Map<string, WorkflowLogModelEntry>();

declare global {
  interface Window {
    __athasWorkflowLogLanguageInitialized?: boolean;
  }
}

function resolveFilePath(root: string | null, path: string): string {
  if (/^([A-Za-z]:[\\/]|\/)/.test(path)) return path;
  const normalized = path.replace(/^\.\//, "");
  return root ? `${root.replace(/[\\/]+$/, "")}/${normalized}` : normalized;
}

export function ensureWorkflowLogLanguage(): void {
  if (typeof window === "undefined" || window.__athasWorkflowLogLanguageInitialized) return;
  window.__athasWorkflowLogLanguageInitialized = true;

  if (!languages.getLanguages().some((language) => language.id === WORKFLOW_LOG_LANGUAGE_ID)) {
    languages.register({ id: WORKFLOW_LOG_LANGUAGE_ID, aliases: ["GitHub Actions log"] });
  }

  languages.registerFoldingRangeProvider(WORKFLOW_LOG_LANGUAGE_ID, {
    provideFoldingRanges: (model) => {
      const entry = modelRegistry.get(model.uri.toString());
      if (!entry) return [];
      return entry.model.foldRanges.map((range) => ({
        start: range.start,
        end: range.end,
        kind: languages.FoldingRangeKind.Region,
      }));
    },
  });

  languages.registerLinkProvider(WORKFLOW_LOG_LANGUAGE_ID, {
    provideLinks: (model) => {
      const entry = modelRegistry.get(model.uri.toString());
      if (!entry) return { links: [] };
      const references = findWorkflowLogFileReferences(entry.model, {
        showTimestamps: entry.showTimestamps,
      });
      return {
        links: references.map((reference) => {
          const query = new URLSearchParams({
            path: resolveFilePath(entry.repoPath, reference.path),
            line: reference.fileLine ? String(reference.fileLine) : "",
            column: reference.fileColumn ? String(reference.fileColumn) : "",
          });
          return {
            range: new Range(
              reference.line,
              reference.startColumn,
              reference.line,
              reference.endColumn,
            ),
            url: Uri.from({
              scheme: FILE_LINK_SCHEME,
              authority: "open",
              path: "/",
              query: query.toString(),
            }),
            tooltip: "Open in editor",
          };
        }),
      };
    },
  });

  monacoEditor.registerLinkOpener({
    open: (resource) => {
      if (resource.scheme !== FILE_LINK_SCHEME) return false;
      const query = new URLSearchParams(resource.query);
      const path = query.get("path");
      if (!path) return false;
      const line = Number(query.get("line")) || undefined;
      const column = Number(query.get("column")) || undefined;
      void useFileSystemStore.getState().handleFileSelect(path, false, line, column);
      return true;
    },
  });
}

export function registerWorkflowLogModel(
  editor: Monaco.editor.ICodeEditor,
  entry: WorkflowLogModelEntry,
): () => void {
  const key = editor.getModel()?.uri.toString();
  if (!key) return () => undefined;
  modelRegistry.set(key, entry);
  return () => {
    if (modelRegistry.get(key) === entry) modelRegistry.delete(key);
  };
}

interface ViewportDecorationOptions {
  model: WorkflowLogModel;
  showTimestamps: boolean;
  highlightLine: number | null;
}

/**
 * Keeps decorations limited to the lines around the viewport. Returns a
 * function that recomputes them; call it after scrolling or when the inputs
 * change.
 */
export function createViewportDecorator(editor: Monaco.editor.IStandaloneCodeEditor): {
  update: (options: ViewportDecorationOptions) => void;
  dispose: () => void;
} {
  const collection = editor.createDecorationsCollection();
  let latest: ViewportDecorationOptions | null = null;
  let frame: number | null = null;

  const apply = () => {
    frame = null;
    if (!latest || editor.getModel()?.isDisposed()) return;
    const visible = editor.getVisibleRanges();
    if (visible.length === 0) {
      collection.clear();
      return;
    }
    const fromLine = Math.max(1, visible[0].startLineNumber - VIEWPORT_MARGIN_LINES);
    const toLine = visible[visible.length - 1].endLineNumber + VIEWPORT_MARGIN_LINES;
    const decorations = createWorkflowLogDecorations(latest.model, {
      fromLine,
      toLine,
      showTimestamps: latest.showTimestamps,
      highlightLine: latest.highlightLine,
    });
    collection.set(
      decorations.map((decoration) => ({
        range: decoration.wholeLine
          ? new Range(decoration.line, 1, decoration.line, 1)
          : new Range(
              decoration.line,
              decoration.startColumn ?? 1,
              decoration.line,
              decoration.endColumn ?? 1,
            ),
        options: decoration.wholeLine
          ? { isWholeLine: true, className: decoration.className }
          : { inlineClassName: decoration.className },
      })),
    );
  };

  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(apply);
  };

  const scrollDisposable = editor.onDidScrollChange(schedule);
  const layoutDisposable = editor.onDidLayoutChange(schedule);

  return {
    update: (options) => {
      latest = options;
      schedule();
    },
    dispose: () => {
      if (frame !== null) cancelAnimationFrame(frame);
      scrollDisposable.dispose();
      layoutDisposable.dispose();
      collection.clear();
    },
  };
}
