import "../monaco/monaco-environment";
import "monaco-editor/min/vs/editor/editor.main.css";
import "../styles/monaco-editor.css";

import { editor as monacoEditor, KeyCode, KeyMod, Range as MonacoRange, Uri } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorUIStore } from "../stores/ui-store";
import type { Position, Range } from "../types/editor";
import { getLanguageIdFromPath } from "../utils/language-id";
import { calculateLineHeight } from "../utils/lines";
import { editorAPI } from "../extensions/api";
import type {
  EditorCoordinateResolver,
  EditorModelPositionResolver,
} from "../view-model/view-layout";
import { toMonacoLanguageId } from "../monaco/language";

interface MonacoBackedEditorProps {
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

function toEditorPosition(model: Monaco.editor.ITextModel, position: Monaco.IPosition): Position {
  return {
    line: position.lineNumber - 1,
    column: position.column - 1,
    offset: model.getOffsetAt(position),
  };
}

function toMonacoPosition(position: Position): Monaco.IPosition {
  return {
    lineNumber: position.line + 1,
    column: position.column + 1,
  };
}

function toEditorRange(
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection,
): Range | undefined {
  if (selection.isEmpty()) return undefined;

  const start = selection.getStartPosition();
  const end = selection.getEndPosition();
  return {
    start: toEditorPosition(model, start),
    end: toEditorPosition(model, end),
  };
}

function toMonacoRange(range: Range): Monaco.Range {
  return new MonacoRange(
    range.start.line + 1,
    range.start.column + 1,
    range.end.line + 1,
    range.end.column + 1,
  );
}

function createModelUri(bufferId: string | undefined, filePath: string): Monaco.Uri {
  const sanitizedPath = filePath.replace(/^\/+/, "");
  const path = sanitizedPath.length > 0 ? sanitizedPath : `${bufferId ?? "untitled"}.txt`;
  return Uri.parse(`athas://editor/${encodeURIComponent(bufferId ?? path)}/${path}`);
}

function getThemeId(theme: string): string {
  return theme.includes("light") ? "vs" : "vs-dark";
}

export function MonacoBackedEditor({
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
}: MonacoBackedEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const applyingExternalChangeRef = useRef(false);
  const previousContentRef = useRef("");
  const decorationsRef = useRef<string[]>([]);
  const latestContentChangeRef = useRef(onContentChange);
  const activeBufferId = useBufferStore((state) => propBufferId ?? state.activeBufferId);
  const activeBuffer = useBufferStore(
    useCallback(
      (state) =>
        activeBufferId
          ? state.buffers.find((buffer) => buffer.id === activeBufferId) || null
          : null,
      [activeBufferId],
    ),
  );
  const buffer = activeBuffer && activeBuffer.type === "editor" ? activeBuffer : null;
  const content = buffer?.content ?? "";
  const filePath = buffer?.path ?? "";
  const languageId = buffer?.languageOverride ?? getLanguageIdFromPath(filePath);
  const monacoLanguageId = toMonacoLanguageId(languageId);
  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const editorLineHeight = useEditorSettingsStore.use.lineHeight();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const wordWrap = useEditorSettingsStore.use.wordWrap();
  const lineNumbers = useEditorSettingsStore.use.lineNumbers();
  const renderWhitespace = useEditorSettingsStore.use.renderWhitespace();
  const theme = useEditorSettingsStore.use.theme();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const settingsTheme = useSettingsStore((state) => state.settings.theme);
  const minimapEnabled = useSettingsStore((state) => state.settings.showMinimap);
  const { setCursorPosition, setSelection, setScrollForBuffer, setViewportHeight } =
    useEditorStateStore.use.actions();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentSearchMatchIndex = useEditorUIStore.use.currentMatchIndex();

  const fontSize = baseFontSize * zoomLevel;
  const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
  const modelUri = useMemo(
    () => createModelUri(activeBufferId ?? undefined, filePath),
    [activeBufferId, filePath],
  );

  latestContentChangeRef.current = onContentChange;

  const lineNumberFormatter = useCallback(
    (lineNumber: number) => {
      const mappedLine = lineNumberMap?.[lineNumber - 1];
      if (typeof mappedLine === "number") return String(mappedLine);
      return String((lineNumberStart ?? 1) + lineNumber - 1);
    },
    [lineNumberMap, lineNumberStart],
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
      setCursorPosition(toEditorPosition(model, position), { ensureVisible: false });
    }
    const selection = editor.getSelection();
    setSelection(selection ? toEditorRange(model, selection) : undefined);
  }, [setCursorPosition, setSelection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !buffer) return;

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
      scrollBeyondLastLine: false,
      lineNumbers: lineNumbers ? lineNumberFormatter : "off",
      renderWhitespace: renderWhitespace === "none" ? "none" : renderWhitespace,
      wordWrap: wordWrap ? "on" : "off",
      theme: getThemeId(settingsTheme || theme),
      contextmenu: false,
      overviewRulerLanes: 0,
      fixedOverflowWidgets: true,
      scrollbar: {
        vertical: scrollable ? "auto" : "hidden",
        horizontal: scrollable ? "auto" : "hidden",
      },
    });

    editorRef.current = editor;
    modelRef.current = model;
    previousContentRef.current = content;
    editorAPI.setTextareaRef(null);
    editorAPI.setViewportRef(container);

    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyA, () => {
      editor.setSelection(model.getFullModelRange());
      syncCursorAndSelection();
    });

    const disposables = [
      editor.onDidChangeModelContent(() => {
        if (applyingExternalChangeRef.current) return;
        const nextContent = model.getValue();
        const previousContent = previousContentRef.current;
        const editorState = useEditorStateStore.getState();
        previousContentRef.current = nextContent;
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
        updateVisibleLineRange(editor);
      }),
      editor.onDidLayoutChange((info) => {
        setViewportHeight(info.height);
        updateVisibleLineRange(editor);
      }),
    ];

    const unsubscribeCursor = editorAPI.on("cursorChange", (position) => {
      if (!modelRef.current || editorRef.current !== editor) return;
      const monacoPosition = toMonacoPosition(position);
      editor.setPosition(monacoPosition);
      editor.revealPositionInCenterIfOutsideViewport(monacoPosition);
    });
    const unsubscribeSelection = editorAPI.on("selectionChange", (selection) => {
      if (!modelRef.current || editorRef.current !== editor) return;
      if (selection) {
        editor.setSelection(toMonacoRange(selection));
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
      unsubscribeCursor();
      unsubscribeSelection();
      for (const disposable of disposables) {
        disposable.dispose();
      }
      if (editorRef.current === editor) editorRef.current = null;
      if (modelRef.current === model) modelRef.current = null;
      editor.dispose();
      model.dispose();
      editorAPI.setViewportRef(null);
    };
  }, [
    activeBufferId,
    filePath,
    fontFamily,
    fontSize,
    isActiveSurface,
    isPreviewMode,
    lineHeight,
    lineNumbers,
    lineNumberFormatter,
    minimapEnabled,
    modelUri,
    monacoLanguageId,
    onScrollOffsetChange,
    readOnly,
    renderWhitespace,
    scrollable,
    setScrollForBuffer,
    setViewportHeight,
    settingsTheme,
    syncCursorAndSelection,
    tabSize,
    theme,
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
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || model.getValue() === content) return;

    applyingExternalChangeRef.current = true;
    const selection = editor.getSelection();
    model.setValue(content);
    if (selection) editor.setSelection(selection);
    previousContentRef.current = content;
    applyingExternalChangeRef.current = false;
  }, [content]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    monacoEditor.setTheme(getThemeId(settingsTheme || theme));
    editor.updateOptions({
      fontFamily,
      fontSize,
      lineHeight,
      tabSize,
      readOnly: readOnly || isPreviewMode,
      domReadOnly: readOnly || isPreviewMode,
      lineNumbers: lineNumbers ? lineNumberFormatter : "off",
      minimap: { enabled: minimapEnabled },
      renderWhitespace: renderWhitespace === "none" ? "none" : renderWhitespace,
      wordWrap: wordWrap ? "on" : "off",
      scrollbar: {
        vertical: scrollable ? "auto" : "hidden",
        horizontal: scrollable ? "auto" : "hidden",
      },
    });
  }, [
    fontFamily,
    fontSize,
    isPreviewMode,
    lineHeight,
    lineNumbers,
    lineNumberFormatter,
    minimapEnabled,
    readOnly,
    renderWhitespace,
    scrollable,
    settingsTheme,
    tabSize,
    theme,
    wordWrap,
  ]);

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
    if (!editor || !model) {
      onCoordinateResolverChange?.(null);
      onModelPositionResolverChange?.(null);
      return;
    }

    onCoordinateResolverChange?.((clientX, clientY) => {
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
      const lineNumber = Math.max(1, line + 1);
      const monacoColumn = Math.max(1, column + 1);
      const position = { lineNumber, column: monacoColumn };
      const editorPosition = toEditorPosition(model, position);
      const top = editor.getTopForLineNumber(lineNumber);
      const left = editor.getOffsetForColumn(lineNumber, monacoColumn);
      return {
        ...editorPosition,
        viewLine: line,
        modelLine: line,
        top,
        left,
        height: lineHeight,
        segment: {
          viewLine: line,
          modelLine: line,
          startColumn: 0,
          endColumn: model.getLineLength(lineNumber),
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
      editor.setScrollPosition({ scrollTop: cached.scrollTop, scrollLeft: cached.scrollLeft });
      editor.setPosition(toMonacoPosition(cached.cursor));
      if (cached.selection) editor.setSelection(toMonacoRange(cached.selection));
    }
  }, [activeBufferId, isActiveSurface, viewStateKey]);

  if (!buffer) return null;

  return (
    <div
      className={`monaco-editor-shell absolute inset-0 min-h-0 bg-primary-bg ${className ?? ""}`}
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
    </div>
  );
}
