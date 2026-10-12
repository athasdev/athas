import { resolveToolPath } from "@/features/ai/lib/open-tool-location";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import { captureBufferStoreOwner } from "@/features/editor/services/buffer-store-owner";
import { readBufferText } from "@/features/editor/services/buffer-text";
import { saveEditorBufferById } from "@/features/editor/services/editor-save-service";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import type { Position } from "@/features/editor/types/editor.types";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";
import { type EditorContent, isEditorContent } from "@/features/panes/types/pane-content.types";
import {
  closeAllClaudeDiffs,
  closeClaudeDiffByTabName,
  openClaudeDiff,
} from "./claude-ide-diff-review";

/** A tool call Claude Code made, forwarded by the IDE server to this window. */
export interface ClaudeIdeRequest {
  requestId: string;
  tool: string;
  arguments: Record<string, unknown>;
  windowLabel: string;
}

const SEVERITY_NAMES: Record<Diagnostic["severity"], string> = {
  error: "Error",
  warning: "Warning",
  info: "Information",
};

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = stringArg(args, name);
  if (value === undefined) throw new Error(`Missing required parameter: ${name}`);
  return value;
}

export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const path = decodeURIComponent(uri.slice("file://".length));
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
}

export function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(prefixed).replace(/[?#]/g, encodeURIComponent)}`;
}

function getOpenEditorBuffers(): EditorContent[] {
  return useBufferStore
    .getState()
    .buffers.filter(
      (buffer): buffer is EditorContent => isEditorContent(buffer) && !buffer.isVirtual,
    );
}

function findEditorBuffer(path: string): EditorContent | undefined {
  return getOpenEditorBuffers().find((buffer) => buffer.path === path);
}

function languageIdOf(buffer: EditorContent): string {
  return buffer.languageOverride || buffer.language || "plaintext";
}

function countLines(text: string): number {
  return text.length === 0 ? 1 : text.split("\n").length;
}

export function offsetToPosition(text: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const line = before.split("\n").length - 1;
  return { line, column: clamped - (before.lastIndexOf("\n") + 1), offset: clamped };
}

function lineStartOffset(text: string, line: number): number {
  let offset = 0;
  for (let current = 0; current < line; current++) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

function lineEndOffset(text: string, offset: number): number {
  const next = text.indexOf("\n", offset);
  return next === -1 ? text.length : next;
}

/**
 * The offsets `openFile` asks to select: from the start of `startText` to the end of `endText`
 * (searched after `startText`), or whole 1-based lines `startLine`..`endLine`. Null when the
 * arguments name nothing to select or the text is not found.
 */
export function findOpenFileSelection(
  text: string,
  args: Record<string, unknown>,
): { from: number; to: number } | null {
  const startText = stringArg(args, "startText");
  if (startText) {
    const from = text.indexOf(startText);
    if (from === -1) return null;
    let to = from + startText.length;
    const endText = stringArg(args, "endText");
    if (endText) {
      const endIndex = text.indexOf(endText, from + startText.length);
      if (endIndex !== -1) to = endIndex + endText.length;
    }
    if (args.selectToEndOfLine === true) to = lineEndOffset(text, to);
    return { from, to };
  }

  const startLine = numberArg(args, "startLine");
  if (startLine === undefined) return null;
  const endLine = numberArg(args, "endLine") ?? startLine;
  const from = lineStartOffset(text, Math.max(0, startLine - 1));
  const to = lineEndOffset(text, lineStartOffset(text, Math.max(0, endLine - 1)));
  return { from, to: Math.max(from, to) };
}

async function openFile(args: Record<string, unknown>): Promise<string[]> {
  const filePath = await resolveToolPath(requireString(args, "filePath"));
  await useFileSystemStore.getState().handleFileSelect(filePath, false);

  const buffer = findEditorBuffer(filePath);
  if (buffer) {
    const text = readBufferText(buffer);
    const selection = findOpenFileSelection(text, args);
    if (selection) {
      useEditorStateStore.getState().actions.requestNavigation({
        bufferId: buffer.id,
        range: {
          start: offsetToPosition(text, selection.from),
          end: offsetToPosition(text, selection.to),
        },
        focus: false,
      });
    }
  }

  if (args.makeFrontmost === false) {
    return [
      JSON.stringify({
        success: true,
        filePath,
        languageId: buffer ? languageIdOf(buffer) : "plaintext",
        lineCount: buffer ? countLines(readBufferText(buffer)) : 0,
      }),
    ];
  }
  return [`Opened file: ${filePath}`];
}

function getOpenEditors(): string[] {
  const activeBufferId = getActiveBufferId();
  const tabs = getOpenEditorBuffers().map((buffer) => ({
    uri: pathToFileUri(buffer.path),
    isActive: buffer.id === activeBufferId,
    label: buffer.name,
    languageId: languageIdOf(buffer),
    isDirty: buffer.isDirty,
    fileName: buffer.path,
    isUntitled: false,
    lineCount: countLines(readBufferText(buffer)),
  }));
  return [JSON.stringify({ tabs })];
}

function getDiagnostics(args: Record<string, unknown>): string[] {
  const uri = stringArg(args, "uri");
  const { diagnosticsByFile } = useDiagnosticsStore.getState();
  const entries = uri
    ? [[fileUriToPath(uri), diagnosticsByFile.get(fileUriToPath(uri)) ?? []] as const]
    : [...diagnosticsByFile.entries()];

  const files = entries
    .filter(([, diagnostics]) => uri !== undefined || diagnostics.length > 0)
    .map(([filePath, diagnostics]) => ({
      uri: pathToFileUri(filePath),
      diagnostics: diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        severity: SEVERITY_NAMES[diagnostic.severity],
        range: {
          start: { line: diagnostic.line, character: diagnostic.column },
          end: { line: diagnostic.endLine, character: diagnostic.endColumn },
        },
        source: diagnostic.source,
        code: diagnostic.code,
      })),
    }));
  return [JSON.stringify(files)];
}

function documentNotOpen(filePath: string): string[] {
  return [JSON.stringify({ success: false, message: `Document not open: ${filePath}` })];
}

function checkDocumentDirty(args: Record<string, unknown>): string[] {
  const filePath = requireString(args, "filePath");
  const buffer = findEditorBuffer(filePath);
  if (!buffer) return documentNotOpen(filePath);
  return [JSON.stringify({ success: true, filePath, isDirty: buffer.isDirty, isUntitled: false })];
}

async function saveDocument(args: Record<string, unknown>): Promise<string[]> {
  const filePath = requireString(args, "filePath");
  const buffer = findEditorBuffer(filePath);
  if (!buffer) return documentNotOpen(filePath);
  const saved = await saveEditorBufferById(captureBufferStoreOwner(), buffer.id, "save");
  return [
    JSON.stringify(
      saved
        ? { success: true, filePath, saved: true, message: "Document saved successfully" }
        : { success: false, filePath, message: "Failed to save file" },
    ),
  ];
}

function closeTab(args: Record<string, unknown>): string[] {
  const tabName = requireString(args, "tab_name");
  if (!closeClaudeDiffByTabName(tabName)) {
    const buffer = getOpenEditorBuffers().find(
      (item) => item.name === tabName || item.path === tabName,
    );
    if (buffer) useBufferStore.getState().actions.closeBuffer(buffer.id);
  }
  return ["TAB_CLOSED"];
}

/** Runs one of the editor tools Claude Code calls and returns the text items of its result. */
export async function runClaudeIdeTool(request: ClaudeIdeRequest): Promise<string[]> {
  const args = request.arguments ?? {};
  switch (request.tool) {
    case "openFile":
      return openFile(args);
    case "openDiff":
      return openClaudeDiff({
        requestId: request.requestId,
        oldFilePath: requireString(args, "old_file_path"),
        newFilePath: requireString(args, "new_file_path"),
        newContents: requireString(args, "new_file_contents"),
        tabName: requireString(args, "tab_name"),
      });
    case "getOpenEditors":
      return getOpenEditors();
    case "getDiagnostics":
      return getDiagnostics(args);
    case "checkDocumentDirty":
      return checkDocumentDirty(args);
    case "saveDocument":
      return saveDocument(args);
    case "close_tab":
      return closeTab(args);
    case "closeAllDiffTabs":
      return [`CLOSED_${closeAllClaudeDiffs()}_DIFF_TABS`];
    default:
      throw new Error(`Athas does not support the ${request.tool} tool`);
  }
}
