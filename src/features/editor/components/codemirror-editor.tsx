import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { editorAPI } from "../extensions/api";
import { useEditorViewSettings } from "../hooks/use-editor-view-settings";
import {
  detectLineSeparator,
  minimalReplacement,
  toBufferText,
  toModelContentChangeEvent,
  type LineSeparator,
} from "../engines/codemirror/document-change";
import {
  createCodeMirrorEditorAdapter,
  createCodeMirrorFindAdapter,
} from "../engines/codemirror/editor-adapter";
import { loadCodeMirrorLanguage } from "../engines/codemirror/languages";
import { matchHighlightsField, setMatchHighlights } from "../engines/codemirror/match-highlights";
import {
  fromBufferOffset,
  fromEditorPosition,
  fromEditorRange,
  toEditorPosition,
  toEditorRange,
} from "../engines/codemirror/position";
import { createCodeMirrorPositionResolver } from "../engines/codemirror/position-resolver";
import { athasEditorTheme } from "../engines/codemirror/theme";
import {
  type CodeMirrorViewOptions,
  codeMirrorViewExtensions,
} from "../engines/codemirror/view-options";
import { applyBufferHistory } from "../services/buffer-history-service";
import { captureBufferStoreOwner } from "../services/buffer-store-owner";
import { deliverModelContentChange } from "../services/document-change-batch";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorStateStore } from "../stores/state.store";
import type { CodeEditorViewProps } from "../types/code-editor-view.types";
import { getBufferById } from "../utils/buffer-index";
import { getLanguageIdFromPath } from "../utils/language-id";

let nextEditorSourceId = 1;

interface EditorSession {
  view: EditorView;
  separator: LineSeparator;
  modelSessionId: string;
  versionId: number;
  bufferMatchesModel: boolean;
  appliedContentRevision: number;
  /** Set while the editor applies a buffer update, so it is not sent back as an edit. */
  applyingExternalUpdate: boolean;
}

export function CodeMirrorEditor({
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
  onDocumentChange,
  onScrollOffsetChange,
  onModelPositionResolverChange,
  onMouseMove,
  onMouseLeave,
  onMouseEnter,
  onClick,
  className,
}: CodeEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const sourceIdRef = useRef(`codemirror-editor-${nextEditorSourceId++}`);
  const activeBufferId = useBufferStore((state) => propBufferId ?? state.activeBufferId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const scopedWorkspaceId = useWorkspaceStoreScopeId();
  const workspaceId = scopedWorkspaceId ?? activeWorkspaceId;
  const historyOwner = useMemo(() => captureBufferStoreOwner(workspaceId), [workspaceId]);
  const buffer = useBufferStore(
    useCallback(
      (state) => {
        const found = getBufferById(state.buffers, activeBufferId);
        return found?.type === "editor" ? found : null;
      },
      [activeBufferId],
    ),
  );
  const content = buffer?.content ?? "";
  const contentRevision = buffer?.contentRevision ?? 0;
  const filePath = buffer?.path ?? "";
  const languageId = buffer?.languageOverride ?? getLanguageIdFromPath(filePath);
  const settings = useEditorViewSettings();
  const relativeLineNumbers = useSettingsStore(
    (state) => state.settings.vimMode && state.settings.vimRelativeLineNumbers,
  );
  const { setCursorAndSelection, setScrollForBuffer } = useEditorStateStore.use.actions();
  const isReadOnly = readOnly || isPreviewMode;
  const viewOptions = useMemo<CodeMirrorViewOptions>(
    () => ({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      fontLigatures: settings.editorFontLigatures,
      italicComments: settings.editorItalicComments,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap,
      lineNumbers: settings.lineNumbers,
      lineNumberOptions: {
        start: lineNumberStart,
        map: lineNumberMap,
        relative: relativeLineNumbers,
      },
      renderWhitespace: settings.renderWhitespace,
      indentGuides: settings.renderIndentGuides,
      bracketPairColors: settings.editorBracketPairColorization,
      highlightOccurrences: isActiveSurface && settings.highlightOccurrences,
      scrollBeyondLastLine: settings.editorScrollBeyondLastLine,
      scrollable,
      cursorStyle: settings.editorCursorStyle,
      cursorBlinking: settings.editorCursorBlinking,
    }),
    [
      isActiveSurface,
      lineNumberMap,
      lineNumberStart,
      relativeLineNumbers,
      scrollable,
      settings.editorBracketPairColorization,
      settings.editorCursorBlinking,
      settings.editorCursorStyle,
      settings.editorFontLigatures,
      settings.editorItalicComments,
      settings.editorScrollBeyondLastLine,
      settings.fontFamily,
      settings.fontSize,
      settings.highlightOccurrences,
      settings.lineHeight,
      settings.lineNumbers,
      settings.renderIndentGuides,
      settings.renderWhitespace,
      settings.tabSize,
      settings.wordWrap,
    ],
  );

  const latest = useRef({
    onContentChange,
    onDocumentChange,
    onScrollOffsetChange,
    isActiveSurface,
    isReadOnly,
    activeBufferId,
    viewStateKey,
  });
  latest.current = {
    onContentChange,
    onDocumentChange,
    onScrollOffsetChange,
    isActiveSurface,
    isReadOnly,
    activeBufferId,
    viewStateKey,
  };

  const compartments = useMemo(
    () => ({
      language: new Compartment(),
      readOnly: new Compartment(),
      view: new Compartment(),
    }),
    [],
  );

  const syncCursorAndSelection = useCallback(
    (session: EditorSession) => {
      const { state } = session.view;
      const main = state.selection.main;
      setCursorAndSelection(
        toEditorPosition(state.doc, main.head, session.separator),
        toEditorRange(state.doc, main, session.separator),
      );
    },
    [setCursorAndSelection],
  );

  const applyHistory = useCallback(
    (direction: "undo" | "redo") => {
      const session = sessionRef.current;
      const bufferId = latest.current.activeBufferId;
      if (!session || !bufferId || !latest.current.isActiveSurface || latest.current.isReadOnly) {
        return false;
      }
      const { state } = session.view;
      const main = state.selection.main;
      const entry = applyBufferHistory(historyOwner, bufferId, direction, {
        cursorPosition: toEditorPosition(state.doc, main.head, session.separator),
        selection: toEditorRange(state.doc, main, session.separator),
      });
      if (!entry) return true;
      replaceWithBufferText(session, entry.content);
      const doc = session.view.state.doc;
      const cursor = fromEditorPosition(
        doc,
        entry.cursorPosition ?? { line: 0, column: 0, offset: 0 },
      );
      session.view.dispatch({
        selection: entry.selection
          ? EditorSelection.create([fromEditorRange(doc, entry.selection)])
          : EditorSelection.cursor(cursor),
        scrollIntoView: true,
      });
      session.bufferMatchesModel =
        toBufferText(session.view.state.doc, session.separator) === entry.content;
      syncCursorAndSelection(session);
      return true;
    },
    [historyOwner, syncCursorAndSelection],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !buffer) return;

    const separator = detectLineSeparator(content);
    const session: EditorSession = {
      view: null as unknown as EditorView,
      separator,
      modelSessionId: `${sourceIdRef.current}:${buffer.id}`,
      versionId: 1,
      bufferMatchesModel: true,
      appliedContentRevision: contentRevision,
      applyingExternalUpdate: false,
    };

    const historyKeymap = keymap.of([
      { key: "Mod-z", run: () => applyHistory("undo"), preventDefault: true },
      { key: "Mod-Shift-z", run: () => applyHistory("redo"), preventDefault: true },
      { key: "Mod-y", run: () => applyHistory("redo"), preventDefault: true },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !session.applyingExternalUpdate) {
        session.versionId += 1;
        const editorState = useEditorStateStore.getState();
        const handleDocumentChange = latest.current.onDocumentChange;
        if (handleDocumentChange) {
          const event = toModelContentChangeEvent(
            update.changes,
            update.startState.doc,
            session.versionId,
            session.separator,
          );
          const { result, bufferMatchesModel } = deliverModelContentChange({
            event,
            model: {
              getValue: () => toBufferText(update.state.doc, session.separator),
              getValueLength: () =>
                update.state.doc.length +
                (update.state.doc.lines - 1) * (session.separator.length - 1),
            },
            sourceId: sourceIdRef.current,
            modelSessionId: session.modelSessionId,
            bufferMatchesModel: session.bufferMatchesModel,
            apply: (batch) =>
              handleDocumentChange(batch, editorState.cursorPosition, editorState.selection),
          });
          session.bufferMatchesModel = bufferMatchesModel;
          if (result.synchronized) {
            session.appliedContentRevision = Math.max(
              session.appliedContentRevision,
              result.contentRevision,
            );
          }
        } else {
          latest.current.onContentChange?.(
            toBufferText(update.state.doc, session.separator),
            undefined,
            editorState.cursorPosition,
            editorState.selection,
          );
        }
      }
      if (update.docChanged || update.selectionSet) syncCursorAndSelection(session);
    });

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: content,
        extensions: [
          historyKeymap,
          highlightSpecialChars(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          foldGutter(),
          search({ top: true }),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          athasEditorTheme,
          compartments.language.of([]),
          compartments.readOnly.of(readOnlyExtension(isReadOnly)),
          compartments.view.of(codeMirrorViewExtensions(viewOptions)),
          matchHighlightsField,
          updateListener,
          EditorView.domEventHandlers({
            scroll: (_event, editorView) => {
              const { scrollTop, scrollLeft } = editorView.scrollDOM;
              const viewKey = latest.current.viewStateKey ?? latest.current.activeBufferId ?? null;
              setScrollForBuffer(viewKey, scrollTop, scrollLeft);
              latest.current.onScrollOffsetChange?.(scrollTop, scrollLeft);
            },
          }),
        ],
      }),
    });
    session.view = view;
    sessionRef.current = session;
    syncCursorAndSelection(session);

    return () => {
      sessionRef.current = null;
      view.destroy();
    };
    // The editor is rebuilt only for another buffer; settings and content are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer?.id]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;
    void loadCodeMirrorLanguage(languageId).then((language) => {
      if (cancelled || sessionRef.current !== session) return;
      session.view.dispatch({ effects: compartments.language.reconfigure(language ?? []) });
    });
    return () => {
      cancelled = true;
    };
  }, [buffer?.id, compartments, languageId]);

  useEffect(() => {
    sessionRef.current?.view.dispatch({
      effects: [
        compartments.readOnly.reconfigure(readOnlyExtension(isReadOnly)),
        compartments.view.reconfigure(codeMirrorViewExtensions(viewOptions)),
      ],
    });
  }, [compartments, isReadOnly, viewOptions]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.view.dispatch({
      effects: setMatchHighlights.of({
        matches: highlightMatches ?? [],
        current: currentHighlightIndex,
        separator: session.separator,
      }),
    });
  }, [buffer?.id, currentHighlightIndex, highlightMatches]);

  useEffect(() => {
    if (!onModelPositionResolverChange) return;
    onModelPositionResolverChange(
      createCodeMirrorPositionResolver(
        () => sessionRef.current?.view ?? null,
        () => sessionRef.current?.separator ?? "\n",
      ),
    );
    return () => onModelPositionResolverChange(null);
  }, [buffer?.id, onModelPositionResolverChange]);

  // Brings the editor up to date when the buffer changed elsewhere: another pane, a reload from
  // disk, undo, or an agent edit. A store update that only echoes this editor's text is ignored.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (contentRevision > 0 && contentRevision <= session.appliedContentRevision) return;
    session.appliedContentRevision = Math.max(session.appliedContentRevision, contentRevision);
    replaceWithBufferText(session, content);
    session.bufferMatchesModel =
      toBufferText(session.view.state.doc, session.separator) === content;
  }, [content, contentRevision]);

  // Before paint, so a freshly created editor never shows line 1 and then jumps.
  useLayoutEffect(() => {
    const session = sessionRef.current;
    if (!session || !isActiveSurface) return;
    const cached = useEditorStateStore
      .getState()
      .actions.getCachedViewState(viewStateKey ?? activeBufferId ?? "");
    if (!cached) return;
    const { view } = session;
    const doc = view.state.doc;
    view.dispatch({
      selection: cached.selection
        ? EditorSelection.create([fromEditorRange(doc, cached.selection)])
        : EditorSelection.cursor(fromEditorPosition(doc, cached.cursor)),
    });
    view.scrollDOM.scrollTop = cached.scrollTop;
    view.scrollDOM.scrollLeft = cached.scrollLeft;
  }, [activeBufferId, buffer?.id, isActiveSurface, viewStateKey]);

  useLayoutEffect(() => {
    if (!isActiveSurface || !buffer) return;
    const ownerId = viewStateKey ?? activeBufferId ?? buffer.id;
    const container = containerRef.current;
    const getView = () => sessionRef.current?.view ?? null;
    editorAPI.setTextareaRef(null);
    if (container) editorAPI.setViewportRef(container);
    editorAPI.setActiveFindAdapter(createCodeMirrorFindAdapter(ownerId, getView));
    if (!isReadOnly) {
      editorAPI.setActiveEditorAdapter(
        createCodeMirrorEditorAdapter(ownerId, getView, {
          undo: () => applyHistory("undo"),
          redo: () => applyHistory("redo"),
        }),
      );
    }

    const unsubscribeCursor = editorAPI.on("cursorChange", (position) => {
      const view = getView();
      if (!view) return;
      const head = fromEditorPosition(view.state.doc, position);
      view.dispatch({
        selection: EditorSelection.cursor(head),
        effects: EditorView.scrollIntoView(head, { y: "center" }),
      });
    });
    const unsubscribeSelection = editorAPI.on("selectionChange", (selection) => {
      const view = getView();
      if (!view) return;
      view.dispatch({
        selection: selection
          ? EditorSelection.create([fromEditorRange(view.state.doc, selection)])
          : EditorSelection.cursor(view.state.selection.main.head),
      });
    });

    return () => {
      unsubscribeCursor();
      unsubscribeSelection();
      editorAPI.clearActiveFindAdapter(ownerId);
      if (!isReadOnly) editorAPI.clearActiveEditorAdapter(ownerId);
      if (container && editorAPI.getViewportRef() === container) editorAPI.setViewportRef(null);
    };
  }, [activeBufferId, applyHistory, buffer?.id, isActiveSurface, isReadOnly, viewStateKey]);

  const pendingNavigation = useEditorStateStore((state) =>
    state.pendingNavigation?.bufferId === activeBufferId ? state.pendingNavigation : null,
  );

  useEffect(() => {
    const view = sessionRef.current?.view;
    if (!view || !isActiveSurface || !pendingNavigation) return;
    const range = fromEditorRange(view.state.doc, pendingNavigation.range);
    view.dispatch({
      selection: EditorSelection.create([range]),
      effects: EditorView.scrollIntoView(range, { y: "center" }),
    });
    view.focus();
    if (useEditorStateStore.getState().pendingNavigation === pendingNavigation) {
      useEditorStateStore.getState().actions.requestNavigation(null);
    }
  }, [isActiveSurface, pendingNavigation]);

  const pendingReveal = useEditorStateStore((state) =>
    state.pendingReveal?.bufferId === activeBufferId ? state.pendingReveal : null,
  );

  // Scrolls a line into view for whoever asked (the agent follower) without taking focus or
  // moving the cursor, so it works in a pane the user is not typing in.
  useEffect(() => {
    const view = sessionRef.current?.view;
    if (!view || !pendingReveal) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(1, pendingReveal.line), doc.lines));
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    if (useEditorStateStore.getState().pendingReveal === pendingReveal) {
      useEditorStateStore.getState().actions.requestReveal(null);
    }
  }, [buffer?.id, pendingReveal]);

  useEffect(() => {
    if (isActiveSurface && !isReadOnly) sessionRef.current?.view.focus();
  }, [isActiveSurface, isReadOnly, buffer?.id]);

  if (!buffer) return null;

  return (
    <div
      data-editor-engine="codemirror"
      className={`absolute inset-0 min-h-0 bg-background ${className ?? ""}`}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
      onClick={(event) => {
        const session = sessionRef.current;
        if (readOnly && onReadonlySurfaceClick && session) {
          const position = session.view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position !== null) {
            const { line, column } = toEditorPosition(
              session.view.state.doc,
              position,
              session.separator,
            );
            onReadonlySurfaceClick({ line, column });
          }
        }
        onClick?.(event);
      }}
    >
      {backgroundLayer}
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

function readOnlyExtension(isReadOnly: boolean): Extension {
  return [EditorState.readOnly.of(isReadOnly), EditorView.editable.of(!isReadOnly)];
}

/**
 * Applies the buffer's text with the smallest replacement, so the cursor and scroll position stay
 * wherever the text did not change, without sending the update back to the buffer.
 */
function replaceWithBufferText(session: EditorSession, bufferText: string) {
  const { view } = session;
  const separator = detectLineSeparator(bufferText);
  const current = toBufferText(view.state.doc, separator);
  session.separator = separator;
  const replacement = minimalReplacement(current, bufferText);
  if (!replacement) return;
  const toDocPosition = (bufferOffset: number) =>
    fromBufferOffset(view.state.doc, bufferOffset, separator);
  session.applyingExternalUpdate = true;
  try {
    view.dispatch({
      changes: {
        from: toDocPosition(replacement.from),
        to: toDocPosition(replacement.to),
        insert: replacement.insert,
      },
    });
  } finally {
    session.applyingExternalUpdate = false;
  }
}
