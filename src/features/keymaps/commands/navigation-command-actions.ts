import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { getJavaClassFileName, isJavaClassFileUri } from "@/features/editor/lsp/java-class-file";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { setOutlineVisibilityPreference } from "@/features/outline/actions/outline-visibility";
import { navigateToJumpEntry } from "@/features/editor/utils/jump-navigation";
import {
  calculateOffsetFromContentPosition,
  getLineTextFromContent,
  getLineTextsFromContent,
} from "@/features/editor/utils/position";
import { useReferencesStore } from "@/features/references/stores/references.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { showChoiceDialog } from "@/ui/dialog";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { toast } from "sonner";
import type { CallHierarchyItem, Range, TypeHierarchyItem } from "vscode-languageserver-protocol";

type LspNavigationLocation = {
  uri: string;
  range: Range;
};

type LspNavigationClient = {
  getDefinition: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<LspNavigationLocation[] | null>;
  getImplementation: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<LspNavigationLocation[] | null>;
  getTypeDefinition: (
    filePath: string,
    line: number,
    character: number,
  ) => Promise<LspNavigationLocation[] | null>;
};

function getActiveEditorContext() {
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);

  if (!activeBuffer || activeBuffer.type !== "editor" || !activeBuffer.path) return null;

  return {
    activeBuffer,
    bufferStore,
    editorState: useEditorStateStore.getState(),
  };
}

async function navigateToLspLocation(target: LspNavigationLocation): Promise<void> {
  const context = getActiveEditorContext();
  if (!context) return;

  const { activeBuffer, bufferStore, editorState } = context;
  const [{ LspClient }, { readFileContent }, { filePathFromUri }] = await Promise.all([
    import("@/features/editor/lsp/lsp-client"),
    import("@/features/file-system/controllers/file-operations"),
    import("@/features/editor/lsp/workspace-edit"),
  ]);

  useJumpListStore.getState().actions.pushEntry({
    bufferId: activeBuffer.id,
    filePath: activeBuffer.path,
    line: editorState.cursorPosition.line,
    column: editorState.cursorPosition.column,
    offset: editorState.cursorPosition.offset,
    scrollTop: editorState.scrollTop,
    scrollLeft: editorState.scrollLeft,
  });

  const isJavaClassFile = isJavaClassFileUri(target.uri);
  const filePath = isJavaClassFile ? target.uri : filePathFromUri(target.uri);
  const existingBuffer = bufferStore.buffers.find((b) => b.path === filePath);

  if (existingBuffer) {
    bufferStore.actions.setActiveBuffer(existingBuffer.id);
  } else if (isJavaClassFile) {
    const content = await LspClient.getInstance().getJavaClassFileContents(
      activeBuffer.path,
      target.uri,
    );
    const bufferId = bufferStore.actions.openContent({
      type: "editor",
      path: target.uri,
      name: getJavaClassFileName(target.uri),
      content,
      isVirtual: true,
      readOnly: true,
      language: "java",
    });
    bufferStore.actions.setActiveBuffer(bufferId);
  } else {
    const content = await readFileContent(filePath);
    const fileName = filePath.split("/").pop() || "untitled";
    const bufferId = bufferStore.actions.openBuffer(filePath, fileName, content);
    bufferStore.actions.setActiveBuffer(bufferId);
  }

  setTimeout(() => {
    const content = editorAPI.getContent();
    const offset = calculateOffsetFromContentPosition(
      content,
      target.range.start.line,
      target.range.start.character,
    );

    editorAPI.setCursorPosition({
      line: target.range.start.line,
      column: target.range.start.character,
      offset,
    });
  }, 100);
}

async function goToActiveLspLocation(
  label: string,
  resolveLocations: (
    lspClient: LspNavigationClient,
    filePath: string,
    line: number,
    character: number,
  ) => Promise<LspNavigationLocation[] | null>,
): Promise<void> {
  const { LspClient } = await import("@/features/editor/lsp/lsp-client");

  const lspClient = LspClient.getInstance();
  const context = getActiveEditorContext();
  if (!context) return;

  const { activeBuffer, editorState } = context;
  const cursorPosition = editorState.cursorPosition;

  const locations = await resolveLocations(
    lspClient,
    activeBuffer.path,
    cursorPosition.line,
    cursorPosition.column,
  );

  if (!locations || locations.length === 0) {
    toast.info(`No ${label} found.`);
    return;
  }

  await navigateToLspLocation(locations[0]);
}

function hierarchyItemLabel(direction: string, item: CallHierarchyItem | TypeHierarchyItem) {
  const detail = item.detail ? ` — ${item.detail}` : "";
  return `${direction} ${item.name}${detail}`;
}

async function chooseHierarchyItem<T extends CallHierarchyItem | TypeHierarchyItem>(
  title: string,
  message: string,
  items: Array<{ direction: string; item: T }>,
): Promise<T | null> {
  if (items.length === 0) {
    toast.info(`No ${title.toLowerCase()} entries found.`);
    return null;
  }

  const boundedItems = items.slice(0, 50);
  const selected = await showChoiceDialog(message, {
    title,
    choices: boundedItems.map(({ direction, item }, index) => ({
      value: String(index),
      label: hierarchyItemLabel(direction, item),
    })),
  });

  return selected === null ? null : (boundedItems[Number(selected)]?.item ?? null);
}

export function openOutlinePicker(): void {
  if (!useSettingsStore.getState().settings.coreFeatures.outline) return;
  useUIState.getState().openCommandPaletteView("outline");
}

export function openOutlineSidebar(): void {
  if (!useSettingsStore.getState().settings.coreFeatures.outline) return;
  setOutlineVisibilityPreference(true);
}

export async function goToDefinition(): Promise<void> {
  await goToActiveLspLocation("definition", (lspClient, filePath, line, character) =>
    lspClient.getDefinition(filePath, line, character),
  );
}

export async function goToImplementation(): Promise<void> {
  await goToActiveLspLocation("implementation", (lspClient, filePath, line, character) =>
    lspClient.getImplementation(filePath, line, character),
  );
}

export async function goToTypeDefinition(): Promise<void> {
  await goToActiveLspLocation("type definition", (lspClient, filePath, line, character) =>
    lspClient.getTypeDefinition(filePath, line, character),
  );
}

export async function goToReferences(): Promise<void> {
  const [{ LspClient }, { readFileContent }, { filePathFromUri }] = await Promise.all([
    import("@/features/editor/lsp/lsp-client"),
    import("@/features/file-system/controllers/file-operations"),
    import("@/features/editor/lsp/workspace-edit"),
  ]);

  const lspClient = LspClient.getInstance();
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
  const cursorPosition = useEditorStateStore.getState().cursorPosition;

  if (!activeBuffer?.path) return;

  const currentLine = getLineTextFromContent(editorAPI.getContent(), cursorPosition.line);
  const wordMatch = currentLine.slice(0, cursorPosition.column + 1).match(/[\w$]+$/);
  const wordEnd = currentLine.slice(cursorPosition.column).match(/^[\w$]*/);
  const symbol = (wordMatch?.[0] || "") + (wordEnd?.[0]?.slice(1) || "");

  const referencesActions = useReferencesStore.getState().actions;
  referencesActions.setIsLoading(true);
  bufferStore.actions.openReferencesBuffer();

  const references = await lspClient.getReferences(
    activeBuffer.path,
    cursorPosition.line,
    cursorPosition.column,
  );

  const origin = {
    symbol: symbol || "symbol",
    filePath: activeBuffer.path,
    line: cursorPosition.line,
    column: cursorPosition.column,
  };

  if (!references || references.length === 0) {
    referencesActions.setReferences(origin, []);
    return;
  }

  const lineContextCache = new Map<string, Map<number, string>>();
  const referenceLinesByFile = new Map<string, Set<number>>();

  for (const ref of references) {
    const filePath = filePathFromUri(ref.uri);
    const lineNumbers = referenceLinesByFile.get(filePath) ?? new Set<number>();
    lineNumbers.add(ref.range.start.line);
    referenceLinesByFile.set(filePath, lineNumbers);
  }

  const lineContextEntries = await Promise.all(
    Array.from(referenceLinesByFile, async ([filePath, lineNumbers]) => {
      let content = "";
      const buffer = bufferStore.buffers.find((b) => b.path === filePath);

      if (buffer && "content" in buffer && typeof buffer.content === "string") {
        content = buffer.content;
      } else {
        try {
          content = await readFileContent(filePath);
        } catch {
          content = "";
        }
      }

      return [filePath, getLineTextsFromContent(content, lineNumbers)] as const;
    }),
  );

  for (const [filePath, lines] of lineContextEntries) {
    lineContextCache.set(filePath, lines);
  }

  const converted = references.map((ref) => {
    const filePath = filePathFromUri(ref.uri);
    const fileLines = lineContextCache.get(filePath);
    return {
      filePath,
      line: ref.range.start.line,
      column: ref.range.start.character,
      endLine: ref.range.end.line,
      endColumn: ref.range.end.character,
      lineContent: fileLines?.get(ref.range.start.line) || "",
    };
  });

  referencesActions.setReferences(origin, converted);
}

export async function showCallHierarchy(): Promise<void> {
  const context = getActiveEditorContext();
  if (!context) return;

  const { LspClient } = await import("@/features/editor/lsp/lsp-client");
  const { activeBuffer, editorState } = context;
  const cursorPosition = editorState.cursorPosition;
  const lspClient = LspClient.getInstance();
  const roots = await lspClient.prepareCallHierarchy(
    activeBuffer.path,
    cursorPosition.line,
    cursorPosition.column,
  );

  if (roots.length === 0) {
    toast.info("No call hierarchy found at the cursor.");
    return;
  }

  const [incomingCalls, outgoingCalls] = await Promise.all([
    lspClient.getIncomingCalls(activeBuffer.path, roots[0]),
    lspClient.getOutgoingCalls(activeBuffer.path, roots[0]),
  ]);
  const selected = await chooseHierarchyItem("Call Hierarchy", "Choose a related call:", [
    ...incomingCalls.map(({ from }) => ({ direction: "Caller:", item: from })),
    ...outgoingCalls.map(({ to }) => ({ direction: "Callee:", item: to })),
  ]);

  if (selected) {
    await navigateToLspLocation({ uri: selected.uri, range: selected.selectionRange });
  }
}

export async function showTypeHierarchy(): Promise<void> {
  const context = getActiveEditorContext();
  if (!context) return;

  const { LspClient } = await import("@/features/editor/lsp/lsp-client");
  const { activeBuffer, editorState } = context;
  const cursorPosition = editorState.cursorPosition;
  const lspClient = LspClient.getInstance();
  const roots = await lspClient.prepareTypeHierarchy(
    activeBuffer.path,
    cursorPosition.line,
    cursorPosition.column,
  );

  if (roots.length === 0) {
    toast.info("No type hierarchy found at the cursor.");
    return;
  }

  const [supertypes, subtypes] = await Promise.all([
    lspClient.getSupertypes(activeBuffer.path, roots[0]),
    lspClient.getSubtypes(activeBuffer.path, roots[0]),
  ]);
  const selected = await chooseHierarchyItem("Type Hierarchy", "Choose a related type:", [
    ...supertypes.map((item) => ({ direction: "Supertype:", item })),
    ...subtypes.map((item) => ({ direction: "Subtype:", item })),
  ]);

  if (selected) {
    await navigateToLspLocation({ uri: selected.uri, range: selected.selectionRange });
  }
}

export async function goBack(): Promise<void> {
  const bufferStore = useBufferStore.getState();
  const editorState = useEditorStateStore.getState();
  const activeBufferId = bufferStore.activeBufferId;
  const activeBuffer = bufferStore.buffers.find((b) => b.id === activeBufferId);

  const currentPosition =
    activeBufferId && activeBuffer?.path
      ? {
          bufferId: activeBufferId,
          filePath: activeBuffer.path,
          line: editorState.cursorPosition.line,
          column: editorState.cursorPosition.column,
          offset: editorState.cursorPosition.offset,
          scrollTop: editorState.scrollTop,
          scrollLeft: editorState.scrollLeft,
        }
      : undefined;

  const entry = useJumpListStore.getState().actions.goBack(currentPosition);
  if (entry) {
    await navigateToJumpEntry(entry);
  }
}

export async function goForward(): Promise<void> {
  const entry = useJumpListStore.getState().actions.goForward();
  if (entry) {
    await navigateToJumpEntry(entry);
  }
}
