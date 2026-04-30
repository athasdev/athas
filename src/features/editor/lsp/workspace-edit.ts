export interface LspPosition {
  line: number;
  character: number;
}

export interface LspTextEdit {
  range: {
    start: LspPosition;
    end: LspPosition;
  };
  newText: string;
}

interface TextDocumentEdit {
  textDocument: {
    uri: string;
  };
  edits: LspTextEdit[];
}

export interface WorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<TextDocumentEdit | unknown>;
}

export interface WorkspaceEditApplyResult {
  editedFiles: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextEdit(value: unknown): value is LspTextEdit {
  return (
    isObject(value) &&
    isObject(value.range) &&
    isObject(value.range.start) &&
    typeof value.range.start.line === "number" &&
    typeof value.range.start.character === "number" &&
    isObject(value.range.end) &&
    typeof value.range.end.line === "number" &&
    typeof value.range.end.character === "number" &&
    typeof value.newText === "string"
  );
}

function isTextDocumentEdit(value: unknown): value is TextDocumentEdit {
  return (
    isObject(value) &&
    isObject(value.textDocument) &&
    typeof value.textDocument.uri === "string" &&
    Array.isArray(value.edits) &&
    value.edits.every(isTextEdit)
  );
}

export function isWorkspaceEdit(value: unknown): value is WorkspaceEdit {
  if (!isObject(value)) return false;

  const hasChanges =
    isObject(value.changes) &&
    Object.values(value.changes).every((edits) => Array.isArray(edits) && edits.every(isTextEdit));
  const hasDocumentChanges =
    Array.isArray(value.documentChanges) && value.documentChanges.some(isTextDocumentEdit);

  return hasChanges || hasDocumentChanges;
}

export function filePathFromUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;

  try {
    const url = new URL(uri);
    return decodeURIComponent(url.pathname);
  } catch {
    return decodeURIComponent(uri.replace(/^file:\/\//, ""));
  }
}

export function offsetFromPosition(content: string, position: LspPosition): number {
  const lines = content.split("\n");
  let offset = 0;

  for (let index = 0; index < Math.min(position.line, lines.length); index++) {
    offset += lines[index].length + 1;
  }

  const line = lines[position.line] ?? "";
  return offset + Math.max(0, Math.min(position.character, line.length));
}

export function applyTextEditsToContent(content: string, edits: LspTextEdit[]): string {
  const sortedEdits = [...edits].sort((a, b) => {
    const aOffset = offsetFromPosition(content, a.range.start);
    const bOffset = offsetFromPosition(content, b.range.start);
    return bOffset - aOffset;
  });

  return sortedEdits.reduce((nextContent, edit) => {
    const startOffset = offsetFromPosition(nextContent, edit.range.start);
    const endOffset = offsetFromPosition(nextContent, edit.range.end);

    return nextContent.slice(0, startOffset) + edit.newText + nextContent.slice(endOffset);
  }, content);
}

export function collectWorkspaceTextEdits(edit: WorkspaceEdit): Map<string, LspTextEdit[]> {
  const editsByFile = new Map<string, LspTextEdit[]>();

  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    editsByFile.set(filePathFromUri(uri), [...edits]);
  }

  for (const documentChange of edit.documentChanges ?? []) {
    if (!isTextDocumentEdit(documentChange)) continue;

    const filePath = filePathFromUri(documentChange.textDocument.uri);
    const existing = editsByFile.get(filePath) ?? [];
    editsByFile.set(filePath, [...existing, ...documentChange.edits]);
  }

  return editsByFile;
}

async function readEditableSource(
  filePath: string,
): Promise<{ bufferId: string | null; content: string }> {
  const { useBufferStore } = await import("../stores/buffer-store");
  const { readFile } = await import("@/features/file-system/controllers/platform");
  const { buffers } = useBufferStore.getState();
  const openBuffer = buffers.find(
    (buffer) => buffer.type === "editor" && !buffer.isVirtual && buffer.path === filePath,
  );

  if (openBuffer?.type === "editor") {
    return { bufferId: openBuffer.id, content: openBuffer.content };
  }

  return { bufferId: null, content: await readFile(filePath) };
}

async function writeEditableSource(filePath: string, bufferId: string | null, content: string) {
  const { useBufferStore } = await import("../stores/buffer-store");
  const { writeFile } = await import("@/features/file-system/controllers/platform");

  if (bufferId) {
    useBufferStore.getState().actions.updateBufferContent(bufferId, content, true);
    return;
  }

  await writeFile(filePath, content);
}

export async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<WorkspaceEditApplyResult> {
  const editsByFile = collectWorkspaceTextEdits(edit);

  for (const [filePath, edits] of editsByFile) {
    const source = await readEditableSource(filePath);
    const nextContent = applyTextEditsToContent(source.content, edits);
    await writeEditableSource(filePath, source.bufferId, nextContent);
  }

  return { editedFiles: editsByFile.size };
}
