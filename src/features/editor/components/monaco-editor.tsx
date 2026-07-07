import "../engines/monaco/monaco-environment";
import "../engines/monaco/language-contributions";
import "monaco-editor/min/vs/editor/editor.main.css";
import "../styles/monaco-editor.css";

import {
  editor as monacoEditor,
  KeyCode,
  KeyMod,
  MarkerSeverity,
  Range as MonacoRange,
} from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { initVimMode, type VimAdapterInstance } from "monaco-vim";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import { InlineEditPopover } from "@/features/editor/inline-edit/inline-edit-popover";
import { useInlineEdit } from "@/features/editor/inline-edit/use-inline-edit";
import { useGitBlame } from "@/features/git/hooks/use-git-blame";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { useContextMenu } from "@/ui/context-menu";
import { formatRelativeTime } from "@/utils/date";
import { isNativeTextInputTarget } from "@/utils/keyboard/text-input-target";
import EditorContextMenu from "../context-menu/context-menu";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorStateStore } from "../stores/state.store";
import { useEditorUIStore } from "../stores/ui.store";
import type { Position, Range } from "../types/editor.types";
import { getBufferById } from "../utils/buffer-index";
import { getLanguageIdFromPath } from "../utils/language-id";
import { toggleCaseText } from "../utils/text-operations";
import { editorAPI } from "../extensions/api";
import type {
  EditorCoordinateResolver,
  EditorModelPositionResolver,
} from "../view-model/view-layout";
import { syncContainedEditorFontOptions } from "../engines/monaco/contained-editors";
import {
  consumeLocalContentSnapshot,
  rememberLocalContentSnapshot,
} from "../engines/monaco/content-sync";
import { clampMonacoHoverWidgets, syncMonacoHoverBounds } from "../engines/monaco/hover-widgets";
import { toMonacoLanguageId } from "../engines/monaco/language";
import {
  buildLineOffsets,
  clampMonacoPosition,
  createModelUri,
  toClampedMonacoPosition,
  toEditorPosition,
  toEditorRange,
  toMonacoRange,
} from "../engines/monaco/position";
import { defineActiveMonacoTheme, defineMonacoTheme } from "../engines/monaco/theme";
import { useMonacoEditorSettings } from "../engines/monaco/use-monaco-editor-settings";
import { registerAthasVimCommands, toAthasVimMode } from "../engines/monaco/vim-commands";
import { registerMonacoLspProviders } from "../engines/monaco/lsp-providers";

registerMonacoLspProviders();

const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

interface MonacoEditorProps {
  bufferId?: string;
  viewStateKey?: string;
  isActiveSurface?: boolean;
  isPreviewMode?: boolean;
  readOnly?: boolean;
  scrollable?: boolean;
  backgroundLayer?: ReactNode;
  onReadonlySurfaceClick?: (position: { line: number; column: number }) => void;
  highlightMatches?: Array<{ start: number; end: number }>;
  currentHighlightIndex?: number;
  lineNumberStart?: number;
  lineNumberMap?: Array<number | null>;
  onContentChange?: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
  ) => void;
  onVisibleLineRangeChange?: (range: { startLine: number; endLine: number }) => void;
  onScrollOffsetChange?: (scrollTop: number, scrollLeft: number) => void;
  onCoordinateResolverChange?: (resolver: EditorCoordinateResolver | null) => void;
  onModelPositionResolverChange?: (resolver: EditorModelPositionResolver | null) => void;
  onMouseMove?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: () => void;
  onMouseEnter?: () => void;
  onClick?: MouseEventHandler<HTMLDivElement>;
  className?: string;
}

export function MonacoEditor({
  bufferId: propBufferId,
  viewStateKey,
  isActiveSurface = true,
  isPreviewMode = false,
  readOnly = false,
  scrollable = true,
  backgroundLayer,
  onReadonlySurfaceClick,
  highlightMatches,
  currentHighlightIndex,
  lineNumberStart,
  lineNumberMap,
  onContentChange,
  onVisibleLineRangeChange,
  onScrollOffsetChange,
  onCoordinateResolverChange,
  onModelPositionResolverChange,
  onMouseMove,
  onMouseLeave,
  onMouseEnter,
  onClick,
  className,
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const vimAdapterRef = useRef<VimAdapterInstance | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const applyingExternalChangeRef = useRef(false);
  const previousContentRef = useRef("");
  const pendingLocalContentSnapshotsRef = useRef<string[]>([]);
  const decorationsRef = useRef<string[]>([]);
  const gitBlameDecorationRef = useRef<string[]>([]);
  const latestContentChangeRef = useRef(onContentChange);
  const activeBufferId = useBufferStore((state) => propBufferId ?? state.activeBufferId);
  const activeBuffer = useBufferStore(
    useCallback((state) => getBufferById(state.buffers, activeBufferId), [activeBufferId]),
  );
  const buffer = activeBuffer && activeBuffer.type === "editor" ? activeBuffer : null;
  const content = buffer?.content ?? "";
  const filePath = buffer?.path ?? "";
  const languageId = buffer?.languageOverride ?? getLanguageIdFromPath(filePath);
  const monacoLanguageId = toMonacoLanguageId(languageId);
  const {
    fontFamily,
    fontSize,
    lineHeight,
    tabSize,
    wordWrap,
    lineNumbers,
    renderWhitespace,
    renderIndentGuides,
    highlightOccurrences,
    themeId,
  } = useMonacoEditorSettings();
  const minimapEnabled = useSettingsStore((state) => state.settings.showMinimap);
  const autoCompletion = useSettingsStore((state) => state.settings.autoCompletion);
  const parameterHints = useSettingsStore((state) => state.settings.parameterHints);
  const semanticTokens = useSettingsStore((state) => state.settings.semanticTokens);
  const inlineGitBlameEnabled = useSettingsStore((state) => state.settings.enableInlineGitBlame);
  const vimModeEnabled = useSettingsStore((state) => state.settings.vimMode);
  const vimRelativeLineNumbers = useSettingsStore((state) => state.settings.vimRelativeLineNumbers);
  const vimCurrentMode = useVimStore.use.mode();
  const cursorPosition = useEditorStateStore.use.cursorPosition();
  const selection = useEditorStateStore((state) => state.selection);
  const { setCursorPosition, setSelection, setScrollForBuffer, setViewportHeight } =
    useEditorStateStore.use.actions();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentSearchMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const { getBlameForLine } = useGitBlame(inlineGitBlameEnabled && filePath ? filePath : undefined);
  const diagnosticsForFile = useDiagnosticsStore((state) =>
    filePath ? (state.diagnosticsByFile.get(filePath) ?? EMPTY_DIAGNOSTICS) : EMPTY_DIAGNOSTICS,
  );

  const modelUri = useMemo(
    () => createModelUri(activeBufferId ?? undefined, filePath),
    [activeBufferId, filePath],
  );

  latestContentChangeRef.current = onContentChange;

  const lineNumberFormatter = useCallback(
    (lineNumber: number) => {
      const mappedLine = lineNumberMap?.[lineNumber - 1];
      if (typeof mappedLine === "number") return String(mappedLine);
      if (vimModeEnabled && vimRelativeLineNumbers && !lineNumberMap) {
        const cursorLine = useEditorStateStore.getState().cursorPosition.line + 1;
        const distance = Math.abs(lineNumber - cursorLine);
        if (distance > 0) return String(distance);
      }
      return String((lineNumberStart ?? 1) + lineNumber - 1);
    },
    [lineNumberMap, lineNumberStart, vimModeEnabled, vimRelativeLineNumbers],
  );

  const updateVisibleLineRange = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor) => {
      const visibleRanges = editor.getVisibleRanges();
      const firstRange = visibleRanges[0];
      const lastRange = visibleRanges[visibleRanges.length - 1] ?? firstRange;
      if (!firstRange || !lastRange) return;

      onVisibleLineRangeChange?.({
        startLine: Math.max(0, firstRange.startLineNumber - 1 - 30),
        endLine: Math.max(0, lastRange.endLineNumber - 1 + 30),
      });
    },
    [onVisibleLineRangeChange],
  );

  const syncCursorAndSelection = useCallback(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    const position = editor.getPosition();
    if (position) {
      setCursorPosition(toEditorPosition(model, position), {
        ensureVisible: false,
      });
    }
    const selection = editor.getSelection();
    setSelection(selection ? toEditorRange(model, selection) : undefined);
  }, [setCursorPosition, setSelection]);

  const lines = useMemo(() => content.split(/\r?\n/), [content]);
  const lineOffsets = useMemo(() => buildLineOffsets(content), [content]);

  const getMonacoCursorOffset = useCallback(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    const position = editor?.getPosition();
    if (!model || !position) return null;
    return model.getOffsetAt(position);
  }, []);

  const getMonacoSelectionAnchor = useCallback(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    const currentSelection = editor?.getSelection();
    if (!model || !currentSelection) return null;

    return toEditorPosition(model, currentSelection.getPosition());
  }, []);

  const getMonacoViewportMetrics = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return null;
    const layout = editor.getLayoutInfo();
    return {
      scrollTop: 0,
      scrollLeft: 0,
      viewportWidth: layout.width,
      viewportHeight: layout.height,
    };
  }, []);

  const applyMonacoInlineEdit = useCallback(
    (edit: { range: Range; editedText: string; newCursorOffset: number }) => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model) return;

      editor.pushUndoStop();
      editor.executeEdits("inline-edit", [
        {
          range: toMonacoRange(model, edit.range),
          text: edit.editedText,
          forceMoveMarkers: true,
        },
      ]);
      const nextPosition = model.getPositionAt(edit.newCursorOffset);
      editor.setSelection(
        new MonacoRange(
          nextPosition.lineNumber,
          nextPosition.column,
          nextPosition.lineNumber,
          nextPosition.column,
        ),
      );
      editor.setPosition(nextPosition);
      editor.revealPositionInCenterIfOutsideViewport(nextPosition);
      editor.pushUndoStop();
      syncCursorAndSelection();
    },
    [syncCursorAndSelection],
  );

  const inlineEditState = useInlineEdit({
    enabled: isActiveSurface && !readOnly && !isPreviewMode,
    viewKey: viewStateKey ?? activeBufferId ?? null,
    buffer: buffer
      ? {
          id: buffer.id,
          content: buffer.content,
          path: buffer.path,
          language: languageId ?? "",
        }
      : undefined,
    selection,
    lines,
    lineOffsets,
    fontSize,
    fontFamily,
    lineHeight,
    tabSize,
    lastScrollRef: { current: { top: 0, left: 0 } } as React.RefObject<{
      top: number;
      left: number;
    }>,
    resolveModelPosition: (line, column) => {
      const editor = editorRef.current;
      const model = modelRef.current;
      if (!editor || !model || model.isDisposed()) return null;
      const position = clampMonacoPosition(model, {
        lineNumber: line + 1,
        column: column + 1,
      });
      const top = editor.getTopForLineNumber(position.lineNumber) - editor.getScrollTop();
      const left =
        editor.getOffsetForColumn(position.lineNumber, position.column) - editor.getScrollLeft();
      const lineLength = model.getLineLength(position.lineNumber);
      const modelLine = position.lineNumber - 1;
      return {
        ...toEditorPosition(model, position),
        viewLine: modelLine,
        modelLine,
        top,
        left,
        height: lineHeight,
        segment: {
          viewLine: modelLine,
          modelLine,
          startColumn: 0,
          endColumn: lineLength,
          top,
          height: lineHeight,
        },
      };
    },
    getCursorOffset: getMonacoCursorOffset,
    getSelectionAnchor: getMonacoSelectionAnchor,
    getViewportMetrics: getMonacoViewportMetrics,
    applyInlineEdit: applyMonacoInlineEdit,
    setCursorPosition,
    setSelection,
  });
  const contextMenu = useContextMenu();

  const executeEditorCommand = useCallback((commandId: string) => {
    void keymapRegistry.executeCommand(commandId);
  }, []);

  const triggerMonacoAction = useCallback(
    (actionId: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      editor.trigger("athas-context-menu", actionId, null);
      editor.focus();
      syncCursorAndSelection();
    },
    [syncCursorAndSelection],
  );

  const toggleMonacoSelectionCase = useCallback(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    const selection = editor?.getSelection();
    if (!editor || !model || !selection || selection.isEmpty()) return;

    const startOffset = model.getOffsetAt(selection.getStartPosition());
    const endOffset = model.getOffsetAt(selection.getEndPosition());
    const result = toggleCaseText(model.getValue(), startOffset, endOffset);
    const replacement = result.content.slice(result.selectionStart, result.selectionEnd);

    editor.pushUndoStop();
    editor.executeEdits("athas-context-menu", [
      { range: selection, text: replacement, forceMoveMarkers: true },
    ]);
    editor.setSelection(selection);
    editor.pushUndoStop();
    editor.focus();
    syncCursorAndSelection();
  }, [syncCursorAndSelection]);

  useOnClickOutside(inlineEditState.inlineEditPopoverRef as RefObject<HTMLElement>, (event) => {
    if (!inlineEditState.inlineEditVisible) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(".inline-edit-model-selector-menu") ||
      target?.closest(".inline-edit-model-command")
    ) {
      return;
    }
    inlineEditState.inlineEditToolbarActions.hide();
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !buffer) return;
    const fontOptions = { fontFamily, fontSize, lineHeight };
    syncMonacoHoverBounds(container);

    const model = monacoEditor.createModel(content, monacoLanguageId, modelUri);
    const editor = monacoEditor.create(container, {
      model,
      automaticLayout: true,
      fontFamily,
      fontSize,
      lineHeight,
      tabSize,
      insertSpaces: true,
      readOnly: readOnly || isPreviewMode,
      domReadOnly: readOnly || isPreviewMode,
      minimap: { enabled: minimapEnabled },
      scrollBeyondLastLine: true,
      lineNumbers: lineNumbers ? lineNumberFormatter : "off",
      renderWhitespace: renderWhitespace === "none" ? "none" : renderWhitespace,
      wordWrap: wordWrap ? "on" : "off",
      guides: {
        indentation: renderIndentGuides,
        highlightActiveIndentation: renderIndentGuides,
      },
      occurrencesHighlight: highlightOccurrences ? "singleFile" : "off",
      selectionHighlight: highlightOccurrences,
      quickSuggestions: autoCompletion,
      suggestOnTriggerCharacters: autoCompletion,
      parameterHints: { enabled: parameterHints },
      theme: defineMonacoTheme(themeId),
      cursorStyle: vimModeEnabled && vimCurrentMode === "normal" ? "block" : "line",
      cursorBlinking: vimModeEnabled && vimCurrentMode === "normal" ? "solid" : "blink",
      contextmenu: false,
      overviewRulerLanes: 0,
      fixedOverflowWidgets: false,
      "semanticHighlighting.enabled": semanticTokens,
      scrollbar: {
        vertical: scrollable ? "auto" : "hidden",
        horizontal: scrollable ? "auto" : "hidden",
      },
    });

    editorRef.current = editor;
    modelRef.current = model;
    previousContentRef.current = content;
    pendingLocalContentSnapshotsRef.current = [];
    editorAPI.setTextareaRef(null);
    editorAPI.setViewportRef(container);

    let hoverClampRaf: number | null = null;
    const scheduleMonacoHoverClamp = () => {
      if (hoverClampRaf !== null) return;
      hoverClampRaf = requestAnimationFrame(() => {
        hoverClampRaf = null;
        clampMonacoHoverWidgets(container);
      });
    };
    const hoverMutationObserver = new MutationObserver(scheduleMonacoHoverClamp);
    hoverMutationObserver.observe(container, {
      attributes: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: true,
    });
    const hoverResizeObserver = new ResizeObserver(scheduleMonacoHoverClamp);
    hoverResizeObserver.observe(container);
    scheduleMonacoHoverClamp();

    const adapterOwnerId = viewStateKey ?? activeBufferId ?? modelUri.toString();
    const selectEntireModel = () => {
      editor.setSelection(model.getFullModelRange());
      editor.focus();
      syncCursorAndSelection();
    };
    const runMonacoSelectionAction = (actionId: string) => {
      editor.trigger("athas-keybinding", actionId, null);
      editor.focus();
      syncCursorAndSelection();
    };

    const syncNestedEditorFonts = () => syncContainedEditorFontOptions(container, fontOptions);
    const createdEditorDisposable = monacoEditor.onDidCreateEditor((createdEditor) => {
      requestAnimationFrame(() => {
        const editorElement = createdEditor.getDomNode();
        if (!editorElement || !container.contains(editorElement)) return;
        createdEditor.updateOptions(fontOptions);
      });
    });
    requestAnimationFrame(syncNestedEditorFonts);

    if (isActiveSurface && !readOnly && !isPreviewMode) {
      const executeTextEdit = (range: Monaco.Range, text: string) => {
        const startOffset = model.getOffsetAt(range.getStartPosition());
        editor.pushUndoStop();
        editor.executeEdits("athas-api", [{ range, text, forceMoveMarkers: true }]);
        const nextPosition = model.getPositionAt(startOffset + text.length);
        editor.setSelection(
          new MonacoRange(
            nextPosition.lineNumber,
            nextPosition.column,
            nextPosition.lineNumber,
            nextPosition.column,
          ),
        );
        editor.setPosition(nextPosition);
        editor.pushUndoStop();
        syncCursorAndSelection();
      };

      editorAPI.setActiveEditorAdapter({
        ownerId: adapterOwnerId,
        insertText: (text, position) => {
          if (position) {
            const monacoPosition = toClampedMonacoPosition(model, position);
            executeTextEdit(
              new MonacoRange(
                monacoPosition.lineNumber,
                monacoPosition.column,
                monacoPosition.lineNumber,
                monacoPosition.column,
              ),
              text,
            );
            return;
          }

          const selection = editor.getSelection();
          if (selection && !selection.isEmpty()) {
            executeTextEdit(selection, text);
            return;
          }

          const currentPosition = editor.getPosition() ?? {
            lineNumber: 1,
            column: 1,
          };
          executeTextEdit(
            new MonacoRange(
              currentPosition.lineNumber,
              currentPosition.column,
              currentPosition.lineNumber,
              currentPosition.column,
            ),
            text,
          );
        },
        deleteRange: (range) => executeTextEdit(toMonacoRange(model, range), ""),
        replaceRange: (range, text) => executeTextEdit(toMonacoRange(model, range), text),
        selectAll: selectEntireModel,
        addSelectionToNextFindMatch: () =>
          runMonacoSelectionAction("editor.action.addSelectionToNextFindMatch"),
        addSelectionToPreviousFindMatch: () =>
          runMonacoSelectionAction("editor.action.addSelectionToPreviousFindMatch"),
        selectAllFindMatches: () => runMonacoSelectionAction("editor.action.selectHighlights"),
        undo: () => {
          editor.trigger("athas-api", "undo", null);
          syncCursorAndSelection();
        },
        redo: () => {
          editor.trigger("athas-api", "redo", null);
          syncCursorAndSelection();
        },
      });
    }

    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyA, selectEntireModel);

    const handleWindowSelectAllShortcut = (event: KeyboardEvent) => {
      const isSelectAllShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "a";

      if (!isSelectAllShortcut) return;

      const target = event.target;
      const activeElement = document.activeElement;
      if (isNativeTextInputTarget(target, activeElement)) return;

      const isInsideEditor =
        editor.hasTextFocus() ||
        (target instanceof Node && container.contains(target)) ||
        (activeElement instanceof Node && container.contains(activeElement));

      if (!isInsideEditor) {
        const targetElement = target instanceof HTMLElement ? target : null;
        if (targetElement?.closest(".terminal-container")) return;
        if (!isActiveSurface) return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      selectEntireModel();
    };

    window.addEventListener("keydown", handleWindowSelectAllShortcut, true);

    const disposables = [
      editor.onContextMenu((event) => {
        event.event.preventDefault();
        event.event.stopPropagation();

        if (event.target.position) {
          const currentSelection = editor.getSelection();
          if (!currentSelection?.containsPosition(event.target.position)) {
            editor.setPosition(event.target.position);
            editor.setSelection(
              new MonacoRange(
                event.target.position.lineNumber,
                event.target.position.column,
                event.target.position.lineNumber,
                event.target.position.column,
              ),
            );
            syncCursorAndSelection();
          }
        }

        editor.focus();
        contextMenu.openAt({ x: event.event.posx, y: event.event.posy });
      }),
      editor.onKeyDown((event) => {
        const browserEvent = event.browserEvent;
        const isSelectAllShortcut =
          (browserEvent.metaKey || browserEvent.ctrlKey) &&
          !browserEvent.altKey &&
          !browserEvent.shiftKey &&
          browserEvent.key.toLowerCase() === "a";

        if (!isSelectAllShortcut) return;

        event.preventDefault();
        event.stopPropagation();
        selectEntireModel();
      }),
      editor.onDidChangeModelContent(() => {
        if (applyingExternalChangeRef.current) return;
        const nextContent = model.getValue();
        const previousContent = previousContentRef.current;
        const editorState = useEditorStateStore.getState();
        previousContentRef.current = nextContent;
        rememberLocalContentSnapshot(pendingLocalContentSnapshotsRef.current, nextContent);
        latestContentChangeRef.current?.(
          nextContent,
          previousContent,
          editorState.cursorPosition,
          editorState.selection,
        );
        syncCursorAndSelection();
      }),
      editor.onDidChangeCursorSelection(syncCursorAndSelection),
      editor.onDidScrollChange((event) => {
        const viewKey = viewStateKey ?? activeBufferId ?? null;
        setScrollForBuffer(viewKey, event.scrollTop, event.scrollLeft);
        onScrollOffsetChange?.(event.scrollTop, event.scrollLeft);
        scheduleMonacoHoverClamp();
        updateVisibleLineRange(editor);
      }),
      editor.onDidLayoutChange((info) => {
        setViewportHeight(info.height);
        scheduleMonacoHoverClamp();
        updateVisibleLineRange(editor);
      }),
      editor.onMouseMove(scheduleMonacoHoverClamp),
    ];

    const unsubscribeCursor = editorAPI.on("cursorChange", (position) => {
      if (!modelRef.current || editorRef.current !== editor) return;
      const monacoPosition = toClampedMonacoPosition(model, position);
      editor.setPosition(monacoPosition);
      editor.revealPositionInCenterIfOutsideViewport(monacoPosition);
    });
    const unsubscribeSelection = editorAPI.on("selectionChange", (selection) => {
      if (!modelRef.current || editorRef.current !== editor) return;
      if (selection) {
        editor.setSelection(toMonacoRange(model, selection));
      } else {
        const position = editor.getPosition();
        if (position) {
          editor.setSelection(
            new MonacoRange(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
          );
        }
      }
    });

    updateVisibleLineRange(editor);
    if (isActiveSurface && !readOnly && !isPreviewMode) {
      setTimeout(() => editor.focus(), 0);
    }

    return () => {
      onCoordinateResolverChange?.(null);
      onModelPositionResolverChange?.(null);
      unsubscribeCursor();
      unsubscribeSelection();
      window.removeEventListener("keydown", handleWindowSelectAllShortcut, true);
      for (const disposable of disposables) {
        disposable.dispose();
      }
      hoverMutationObserver.disconnect();
      hoverResizeObserver.disconnect();
      if (hoverClampRaf !== null) {
        cancelAnimationFrame(hoverClampRaf);
      }
      createdEditorDisposable.dispose();
      if (editorRef.current === editor) editorRef.current = null;
      if (modelRef.current === model) modelRef.current = null;
      editor.dispose();
      model.dispose();
      editorAPI.setViewportRef(null);
      editorAPI.clearActiveEditorAdapter(adapterOwnerId);
    };
  }, [
    activeBufferId,
    autoCompletion,
    contextMenu.openAt,
    filePath,
    fontFamily,
    fontSize,
    highlightOccurrences,
    isActiveSurface,
    isPreviewMode,
    lineHeight,
    lineNumbers,
    lineNumberFormatter,
    minimapEnabled,
    modelUri,
    monacoLanguageId,
    onScrollOffsetChange,
    parameterHints,
    readOnly,
    renderIndentGuides,
    renderWhitespace,
    scrollable,
    semanticTokens,
    setScrollForBuffer,
    setViewportHeight,
    syncCursorAndSelection,
    tabSize,
    themeId,
    updateVisibleLineRange,
    viewStateKey,
    wordWrap,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    monacoEditor.setModelLanguage(model, monacoLanguageId);
  }, [monacoLanguageId]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    monacoEditor.setModelMarkers(
      model,
      "athas",
      diagnosticsForFile.map((diagnostic) => ({
        severity:
          diagnostic.severity === "error"
            ? MarkerSeverity.Error
            : diagnostic.severity === "warning"
              ? MarkerSeverity.Warning
              : MarkerSeverity.Info,
        message: diagnostic.message,
        source: diagnostic.source,
        code: diagnostic.code,
        startLineNumber: diagnostic.line + 1,
        startColumn: diagnostic.column + 1,
        endLineNumber: diagnostic.endLine + 1,
        endColumn: Math.max(diagnostic.endColumn + 1, diagnostic.column + 2),
      })),
    );

    return () => {
      if (!model.isDisposed()) {
        monacoEditor.setModelMarkers(model, "athas", []);
      }
    };
  }, [diagnosticsForFile]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    const modelValue = model.getValue();
    if (modelValue === content) {
      consumeLocalContentSnapshot(pendingLocalContentSnapshotsRef.current, content);
      previousContentRef.current = content;
      return;
    }

    // React can deliver older store echoes after Monaco has already accepted more typing.
    if (consumeLocalContentSnapshot(pendingLocalContentSnapshotsRef.current, content)) {
      return;
    }

    applyingExternalChangeRef.current = true;
    const selection = editor.getSelection();
    model.setValue(content);
    if (selection) editor.setSelection(selection);
    previousContentRef.current = content;
    applyingExternalChangeRef.current = false;
  }, [content]);

  useEffect(() => {
    if (!isActiveSurface || readOnly || isPreviewMode) return;

    const handleTriggerSuggest = () => {
      const editor = editorRef.current;
      if (!editor) return;

      editor.focus();
      editor.trigger("athas", "editor.action.triggerSuggest", {});
    };

    window.addEventListener("editor-trigger-suggest", handleTriggerSuggest);
    return () => window.removeEventListener("editor-trigger-suggest", handleTriggerSuggest);
  }, [isActiveSurface, isPreviewMode, readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (!vimModeEnabled || !vimRelativeLineNumbers || lineNumberMap) return;

    editor.updateOptions({
      lineNumbers: lineNumbers ? lineNumberFormatter : "off",
    });
  }, [
    cursorPosition.line,
    lineNumberFormatter,
    lineNumberMap,
    lineNumbers,
    vimModeEnabled,
    vimRelativeLineNumbers,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    const container = containerRef.current;
    if (!editor) return;
    const fontOptions = { fontFamily, fontSize, lineHeight };

    const applyTheme = (nextThemeId?: string) => {
      monacoEditor.setTheme(
        nextThemeId ? defineMonacoTheme(nextThemeId) : defineActiveMonacoTheme(themeId),
      );
    };

    applyTheme();
    editor.updateOptions({
      ...fontOptions,
      tabSize,
      readOnly: readOnly || isPreviewMode,
      domReadOnly: readOnly || isPreviewMode,
      lineNumbers: lineNumbers ? lineNumberFormatter : "off",
      minimap: { enabled: minimapEnabled },
      renderWhitespace: renderWhitespace === "none" ? "none" : renderWhitespace,
      wordWrap: wordWrap ? "on" : "off",
      guides: {
        indentation: renderIndentGuides,
        highlightActiveIndentation: renderIndentGuides,
      },
      occurrencesHighlight: highlightOccurrences ? "singleFile" : "off",
      selectionHighlight: highlightOccurrences,
      quickSuggestions: autoCompletion,
      suggestOnTriggerCharacters: autoCompletion,
      parameterHints: { enabled: parameterHints },
      cursorStyle: vimModeEnabled && vimCurrentMode === "normal" ? "block" : "line",
      cursorBlinking: vimModeEnabled && vimCurrentMode === "normal" ? "solid" : "blink",
      "semanticHighlighting.enabled": semanticTokens,
      scrollbar: {
        vertical: scrollable ? "auto" : "hidden",
        horizontal: scrollable ? "auto" : "hidden",
      },
    });
    if (container) syncContainedEditorFontOptions(container, fontOptions);

    const unsubscribeRegistry = themeRegistry.onRegistryChange(applyTheme);
    const unsubscribeTheme = themeRegistry.onThemeChange(applyTheme);
    const unsubscribeReady = themeRegistry.onReady(applyTheme);

    return () => {
      unsubscribeRegistry();
      unsubscribeTheme();
      unsubscribeReady();
    };
  }, [
    autoCompletion,
    fontFamily,
    fontSize,
    highlightOccurrences,
    isPreviewMode,
    lineHeight,
    lineNumbers,
    lineNumberFormatter,
    minimapEnabled,
    parameterHints,
    readOnly,
    renderIndentGuides,
    renderWhitespace,
    scrollable,
    semanticTokens,
    tabSize,
    themeId,
    vimCurrentMode,
    vimModeEnabled,
    wordWrap,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    const container = containerRef.current;
    const { setMode } = useVimStore.getState().actions;

    vimAdapterRef.current?.dispose();
    vimAdapterRef.current = null;
    vimStatusRef.current?.remove();
    vimStatusRef.current = null;

    if (!editor || !container || !vimModeEnabled || readOnly || isPreviewMode) {
      return;
    }

    registerAthasVimCommands();

    const statusNode = document.createElement("div");
    statusNode.className = "monaco-vim-statusbar";
    statusNode.setAttribute("aria-live", "polite");
    container.appendChild(statusNode);

    const adapter = initVimMode(editor, statusNode);
    adapter.on("vim-mode-change", (event: { mode: string }) => {
      setMode(toAthasVimMode(event.mode));
    });
    adapter.on("dispose", () => {
      useVimStore.getState().actions.setMode("normal");
    });

    vimAdapterRef.current = adapter;
    vimStatusRef.current = statusNode;
    setMode("normal");

    return () => {
      adapter.dispose();
      if (vimAdapterRef.current === adapter) vimAdapterRef.current = null;
      statusNode.remove();
      if (vimStatusRef.current === statusNode) vimStatusRef.current = null;
    };
  }, [isPreviewMode, readOnly, vimModeEnabled]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    const matches = highlightMatches ?? searchMatches;
    const activeIndex = currentHighlightIndex ?? currentSearchMatchIndex;
    const decorations = matches.map((match, index) => {
      const start = model.getPositionAt(match.start);
      const end = model.getPositionAt(match.end);
      return {
        range: new MonacoRange(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          className:
            index === activeIndex
              ? "monaco-search-match monaco-search-match-current"
              : "monaco-search-match",
          overviewRuler: undefined,
        },
      };
    });

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [currentHighlightIndex, currentSearchMatchIndex, highlightMatches, searchMatches]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    const clearDecoration = () => {
      gitBlameDecorationRef.current = editor.deltaDecorations(gitBlameDecorationRef.current, []);
    };

    if (!inlineGitBlameEnabled || !isActiveSurface || !filePath) {
      clearDecoration();
      return;
    }

    const lineIndex = cursorPosition.line;
    const lineNumber = lineIndex + 1;
    if (lineNumber < 1 || lineNumber > model.getLineCount()) {
      clearDecoration();
      return;
    }

    const blameLine = getBlameForLine(lineIndex);
    if (!blameLine) {
      clearDecoration();
      return;
    }

    const column = model.getLineMaxColumn(lineNumber);
    gitBlameDecorationRef.current = editor.deltaDecorations(gitBlameDecorationRef.current, [
      {
        range: new MonacoRange(lineNumber, column, lineNumber, column),
        options: {
          after: {
            content: `  ${blameLine.author}, ${formatRelativeTime(blameLine.time)}`,
            inlineClassName: "monaco-inline-git-blame",
            cursorStops: monacoEditor.InjectedTextCursorStops.None,
          },
          showIfCollapsed: false,
        },
      },
    ]);
  }, [cursorPosition.line, filePath, getBlameForLine, inlineGitBlameEnabled, isActiveSurface]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) {
      onCoordinateResolverChange?.(null);
      onModelPositionResolverChange?.(null);
      return;
    }

    onCoordinateResolverChange?.((clientX, clientY) => {
      if (model.isDisposed()) return null;
      const target = editor.getTargetAtClientPoint(clientX, clientY);
      const position = target?.position;
      if (!position) return null;
      const editorPosition = toEditorPosition(model, position);
      const top = editor.getTopForLineNumber(position.lineNumber);
      const left = editor.getOffsetForColumn(position.lineNumber, position.column);
      return {
        ...editorPosition,
        viewLine: position.lineNumber - 1,
        modelLine: editorPosition.line,
        top,
        left,
        height: lineHeight,
        segment: {
          viewLine: position.lineNumber - 1,
          modelLine: editorPosition.line,
          startColumn: 0,
          endColumn: model.getLineLength(position.lineNumber),
          top,
          height: lineHeight,
        },
      };
    });

    onModelPositionResolverChange?.((line, column) => {
      if (model.isDisposed()) return null;
      const position = clampMonacoPosition(model, {
        lineNumber: line + 1,
        column: column + 1,
      });
      let editorPosition: Position;
      let top: number;
      let left: number;
      let lineLength: number;

      try {
        editorPosition = toEditorPosition(model, position);
        top = editor.getTopForLineNumber(position.lineNumber);
        left = editor.getOffsetForColumn(position.lineNumber, position.column);
        lineLength = model.getLineLength(position.lineNumber);
      } catch (error) {
        if (model.isDisposed()) return null;
        throw error;
      }
      const modelLine = position.lineNumber - 1;

      return {
        ...editorPosition,
        viewLine: modelLine,
        modelLine,
        top,
        left,
        height: lineHeight,
        segment: {
          viewLine: modelLine,
          modelLine,
          startColumn: 0,
          endColumn: lineLength,
          top,
          height: lineHeight,
        },
      };
    });

    return () => {
      onCoordinateResolverChange?.(null);
      onModelPositionResolverChange?.(null);
    };
  }, [lineHeight, onCoordinateResolverChange, onModelPositionResolverChange]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isActiveSurface) return;

    const cached = useEditorStateStore
      .getState()
      .actions.getCachedViewState(viewStateKey ?? activeBufferId ?? "");
    if (cached) {
      editor.setScrollPosition({
        scrollTop: cached.scrollTop,
        scrollLeft: cached.scrollLeft,
      });
      const model = editor.getModel();
      if (!model) return;

      editor.setPosition(toClampedMonacoPosition(model, cached.cursor));
      if (cached.selection) editor.setSelection(toMonacoRange(model, cached.selection));
    }
  }, [activeBufferId, isActiveSurface, viewStateKey]);

  if (!buffer) return null;

  const shellStyle = {
    "--athas-monaco-font-family": fontFamily,
    "--athas-monaco-font-size": `${fontSize}px`,
    "--athas-monaco-line-height": `${lineHeight}px`,
  } as CSSProperties;
  const canEdit = !readOnly && !isPreviewMode;

  return (
    <>
      <div
        className={`monaco-editor-shell absolute inset-0 min-h-0 bg-primary-bg ${className ?? ""}`}
        style={shellStyle}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseEnter={onMouseEnter}
        onClick={(event) => {
          if (readOnly && onReadonlySurfaceClick) {
            const editor = editorRef.current;
            const model = modelRef.current;
            const target = editor?.getTargetAtClientPoint(event.clientX, event.clientY);
            if (target?.position && model) {
              onReadonlySurfaceClick({
                line: target.position.lineNumber - 1,
                column: target.position.column - 1,
              });
            }
          }
          onClick?.(event);
        }}
      >
        {backgroundLayer}
        <div
          ref={containerRef}
          className="absolute inset-0"
          data-monaco-editor-scroll
          data-line-number-start={lineNumberStart}
          data-line-number-map={lineNumberMap?.length ?? undefined}
        />
        <InlineEditPopover state={inlineEditState} selection={selection} />
      </div>
      {contextMenu.isOpen &&
        createPortal(
          <EditorContextMenu
            isOpen={contextMenu.isOpen}
            position={contextMenu.position}
            onClose={contextMenu.close}
            onCopy={() => executeEditorCommand("editor.copy")}
            onCut={canEdit ? () => executeEditorCommand("editor.cut") : undefined}
            onPaste={canEdit ? () => executeEditorCommand("editor.paste") : undefined}
            onSelectAll={() => executeEditorCommand("editor.selectAll")}
            onDelete={
              canEdit
                ? () => {
                    const currentSelection = editorAPI.getSelection();
                    if (currentSelection) editorAPI.deleteRange(currentSelection);
                  }
                : undefined
            }
            onFind={() => executeEditorCommand("workbench.showFind")}
            onGoToLine={() => executeEditorCommand("editor.goToLine")}
            onDuplicate={canEdit ? () => executeEditorCommand("editor.duplicateLine") : undefined}
            onSelectNextOccurrence={() => executeEditorCommand("editor.selectNextOccurrence")}
            onSelectAllOccurrences={() => executeEditorCommand("editor.selectAllOccurrences")}
            onIndent={canEdit ? () => triggerMonacoAction("editor.action.indentLines") : undefined}
            onOutdent={
              canEdit ? () => triggerMonacoAction("editor.action.outdentLines") : undefined
            }
            onToggleComment={
              canEdit ? () => executeEditorCommand("editor.toggleComment") : undefined
            }
            onFormat={canEdit ? () => executeEditorCommand("editor.formatDocument") : undefined}
            onFormatSelection={
              canEdit ? () => executeEditorCommand("editor.formatSelection") : undefined
            }
            onToggleCase={canEdit ? toggleMonacoSelectionCase : undefined}
            onMoveLineUp={canEdit ? () => executeEditorCommand("editor.moveLineUp") : undefined}
            onMoveLineDown={canEdit ? () => executeEditorCommand("editor.moveLineDown") : undefined}
            onGoToDefinition={() => executeEditorCommand("editor.goToDefinition")}
            onGoToTypeDefinition={() => executeEditorCommand("editor.goToTypeDefinition")}
            onFindReferences={() => executeEditorCommand("editor.goToReferences")}
            onRenameSymbol={canEdit ? () => executeEditorCommand("editor.renameSymbol") : undefined}
            onQuickFix={canEdit ? () => executeEditorCommand("editor.quickFix") : undefined}
            onShowHover={() => executeEditorCommand("editor.showHover")}
            onTriggerSuggest={
              canEdit ? () => executeEditorCommand("editor.triggerSuggest") : undefined
            }
          />,
          document.body,
        )}
    </>
  );
}
