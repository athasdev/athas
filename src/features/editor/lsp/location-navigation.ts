import type { Range } from "vscode-languageserver-protocol";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorStateStore } from "../stores/state.store";
import { useJumpListStore, type JumpListEntry } from "../stores/jump-list.store";
import { calculateOffsetFromContentPosition } from "../utils/position";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { isJavaClassFileUri, getJavaClassFileName } from "./java-class-file";
import { filePathFromUri } from "./workspace-edit";

export interface LspNavigationLocation {
  uri: string;
  range: Range;
}

let latestNavigationRequest = 0;

export async function navigateToLspLocation(
  target: LspNavigationLocation,
  origin?: Omit<JumpListEntry, "timestamp">,
): Promise<void> {
  const request = ++latestNavigationRequest;
  const bufferStore = useBufferStore.getState();
  const sourceBuffer = bufferStore.buffers.find(
    (buffer) => buffer.id === (origin?.bufferId ?? bufferStore.activeBufferId),
  );
  if (!sourceBuffer || sourceBuffer.type !== "editor") return;

  const editorState = useEditorStateStore.getState();
  const source = origin ?? {
    bufferId: sourceBuffer.id,
    filePath: sourceBuffer.path,
    ...editorState.cursorPosition,
    scrollTop: editorState.scrollTop,
    scrollLeft: editorState.scrollLeft,
  };
  editorState.actions.requestNavigation(null);

  const isJavaClassFile = isJavaClassFileUri(target.uri);
  const filePath = isJavaClassFile ? target.uri : filePathFromUri(target.uri);
  let targetBuffer = bufferStore.buffers.find(
    (buffer) => buffer.type === "editor" && buffer.path === filePath,
  );

  if (!targetBuffer) {
    const content = isJavaClassFile
      ? await (
          await import("./lsp-client")
        ).LspClient.getInstance().getJavaClassFileContents(sourceBuffer.path, target.uri)
      : await readFileContent(filePath);
    if (
      request !== latestNavigationRequest ||
      useBufferStore.getState().activeBufferId !== sourceBuffer.id
    )
      return;

    const actions = useBufferStore.getState().actions;
    const bufferId = isJavaClassFile
      ? actions.openContent({
          type: "editor",
          path: filePath,
          name: getJavaClassFileName(filePath),
          content,
          isVirtual: true,
          readOnly: true,
          language: "java",
        })
      : actions.openBuffer(filePath, filePath.split(/[\\/]/).pop() || "untitled", content);
    targetBuffer = useBufferStore.getState().buffers.find((buffer) => buffer.id === bufferId);
  }
  if (!targetBuffer || targetBuffer.type !== "editor") return;

  useJumpListStore.getState().actions.pushEntry(source);
  const { actions } = useBufferStore.getState();
  actions.setActiveBuffer(targetBuffer.id);
  if (targetBuffer.isPreview) actions.convertPreviewToDefinite(targetBuffer.id);

  const content = targetBuffer.content;
  const position = (point: Range["start"]) => ({
    line: point.line,
    column: point.character,
    offset: calculateOffsetFromContentPosition(content, point.line, point.character),
  });
  useEditorStateStore.getState().actions.requestNavigation({
    bufferId: targetBuffer.id,
    range: { start: position(target.range.start), end: position(target.range.end) },
  });
}
