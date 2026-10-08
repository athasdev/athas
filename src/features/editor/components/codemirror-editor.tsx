import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, Text } from "@codemirror/state";
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
import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { editorAPI } from "../services/editor-api";
import { useEditorViewSettings } from "../hooks/use-editor-view-settings";
import {
  detectLineSeparator,
  minimalReplacement,
  toBufferText,
  toBufferTextSlice,
  toModelContentChangeEvent,
  type LineSeparator,
} from "../engines/codemirror/document-change";
import {
  createCodeMirrorEditorAdapter,
  createCodeMirrorFindAdapter,
} from "../engines/codemirror/editor-adapter";
import { CodeMirrorFeatures } from "../engines/codemirror/features/codemirror-features";
import type { CodeMirrorHost } from "../engines/codemirror/host";
import { loadCodeMirrorLanguage } from "../engines/codemirror/languages";
import { lspFoldingChanged } from "../engines/codemirror/navigation/lsp-folding";
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
import { readBufferRevision, readBufferText } from "../services/buffer-text";
import { deliverModelContentChange } from "../services/document-change-batch";
import {
  getBufferTextLength,
  getLiveDocumentRevision,
  getLiveDocumentText,
  type LiveDocumentView,
  registerLiveDocumentView,
  rememberSavedDocument,
  subscribeLiveDocument,
  textRoundTrips,
} from "../services/live-document-registry";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorStateStore } from "../stores/state.store";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import type { CodeEditorViewProps } from "../types/code-editor-view.types";
import { getBufferById } from "../stores/buffer-index";
import { fileOpenBenchmark } from "../services/file-open-benchmark";
import { getLanguageIdFromPath } from "../services/language-id";
import { useBufferIdOrActive } from "@/features/panes/hooks/use-pane-buffer-state";

let nextEditorSourceId = 1;
const VIEWPORT_HEIGHT_MEASURE_KEY = {};

interface EditorSession {
  view: EditorView;
  separator: LineSeparator;
  modelSessionId: string;
  versionId: number;
  /** Whether offsets in the editor's text land at the same places in the stored text. */
  bufferMatchesModel: boolean;
  /**
   * Whether the editor reproduces the stored text exactly, so the editor can keep the text and
   * the store be skipped while typing. Text with stray CRs takes edits as deltas on the stored
   * string instead, which keeps those CRs.
   */
  liveText: boolean;
  appliedContentRevision: number;
  /** Set while the editor applies a buffer update, so it is not sent back as an edit. */
  applyingExternalUpdate: boolean;
  /**
   * Set while the editor hands its own edit to the buffer store, whose subscribers run before the
   * new revision is recorded; the buffer subscription skips those echoes.
   */
  deliveringOwnChange: boolean;
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
  const shellRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const sourceIdRef = useRef(`codemirror-editor-${nextEditorSourceId++}`);
  const activeBufferId = useBufferIdOrActive(propBufferId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const scopedWorkspaceId = useWorkspaceStoreScopeId();
  const workspaceId = scopedWorkspaceId ?? activeWorkspaceId;
  const historyOwner = useMemo(() => captureBufferStoreOwner(workspaceId), [workspaceId]);
  // The text is not part of the selection: it changes on every keystroke, and the editor follows
  // it through a store subscription below instead of re-rendering.
  const buffer = useBufferStore(
    useShallow(
      useCallback(
        (state: { buffers: PaneContent[] }) => {
          const found = getBufferById(state.buffers, activeBufferId);
          if (found?.type !== "editor") return null;
          return {
            id: found.id,
            path: found.path,
            languageOverride: found.languageOverride,
            isVirtual: found.isVirtual,
          };
        },
        [activeBufferId],
      ),
    ),
  );
  const filePath = buffer?.path ?? "";
  const languageId = buffer?.languageOverride ?? getLanguageIdFromPath(filePath);
  const settings = useEditorViewSettings();
  const relativeLineNumbers = useSettingsStore(
    (state) => state.settings.vimMode && state.settings.vimRelativeLineNumbers,
  );
  const { setCursorAndSelection, setScrollForBuffer, setViewportHeightForView } =
    useEditorStateStore.use.actions();
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

  // Measured in CodeMirror's next measure pass, by which time this view is recorded as the active
  // one when it just became so; reports from other views are dropped by the store.
  const reportViewportHeight = useCallback(
    (editorView: EditorView) => {
      editorView.requestMeasure({
        key: VIEWPORT_HEIGHT_MEASURE_KEY,
        read: (measuredView) => measuredView.scrollDOM.clientHeight,
        write: (height) => {
          const viewKey = latest.current.viewStateKey ?? latest.current.activeBufferId ?? null;
          setViewportHeightForView(viewKey, height);
        },
      });
    },
    [setViewportHeightForView],
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
      matchSessionToBufferText(session, entry.content);
      syncCursorAndSelection(session);
      return true;
    },
    [historyOwner, syncCursorAndSelection],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !buffer) return;

    const initial = getBufferById(historyOwner.store.getState().buffers, buffer.id);
    const content = initial?.type === "editor" ? readBufferText(initial) : "";
    const contentRevision = initial?.type === "editor" ? readBufferRevision(initial) : 0;
    const separator = detectLineSeparator(content);
    const session: EditorSession = {
      view: null as unknown as EditorView,
      separator,
      modelSessionId: `${sourceIdRef.current}:${buffer.id}`,
      versionId: 1,
      bufferMatchesModel: true,
      liveText: true,
      appliedContentRevision: contentRevision,
      applyingExternalUpdate: false,
      deliveringOwnChange: false,
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
        session.deliveringOwnChange = true;
        try {
          const handleDocumentChange = latest.current.onDocumentChange;
          if (handleDocumentChange) {
            const event = toModelContentChangeEvent(
              update.changes,
              update.startState.doc,
              session.versionId,
              session.separator,
            );
            let sentWholeText = false;
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
              apply: (batch) => {
                if (batch.isFlush) sentWholeText = true;
                return handleDocumentChange(
                  batch,
                  editorState.cursorPosition,
                  editorState.selection,
                  batch.isFlush || !session.liveText
                    ? undefined
                    : {
                        view: liveView,
                        startDoc: update.startState.doc,
                        doc: update.state.doc,
                        changes: update.changes,
                        previousText: toBufferTextSlice(update.startState.doc, session.separator),
                        nextText: toBufferTextSlice(update.state.doc, session.separator),
                      },
                );
              },
            });
            session.bufferMatchesModel = bufferMatchesModel;
            // The store now holds the editor's own text, which always round-trips.
            if (sentWholeText && bufferMatchesModel) session.liveText = true;
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
        } finally {
          session.deliveringOwnChange = false;
        }
      }
      if (update.docChanged || update.selectionSet) syncCursorAndSelection(session);
      if (update.geometryChanged || (update.focusChanged && update.view.hasFocus)) {
        reportViewportHeight(update.view);
      }
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
          foldGutter({ foldingChanged: lspFoldingChanged }),
          EditorView.clickAddsSelectionRange.of((event) => event.altKey),
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
    fileOpenBenchmark.mark(buffer.path, "view-created", `${view.state.doc.lines} lines`);
    matchSessionToBufferText(session, content);
    const liveView: LiveDocumentView = {
      sourceId: sourceIdRef.current,
      getDoc: () => view.state.doc,
      getSeparator: () => session.separator,
    };
    const unregisterLiveView = registerLiveDocumentView(buffer.id, liveView);
    if (initial?.type === "editor" && session.liveText) {
      rememberSavedDocument(
        buffer.id,
        initial.savedContent,
        savedDocumentFrom(view.state.doc, separator, content, initial.savedContent),
        separator,
      );
    }
    syncCursorAndSelection(session);
    setView(view);

    return () => {
      unregisterLiveView();
      sessionRef.current = null;
      setView(null);
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
      fileOpenBenchmark.markOnce(filePath, "language-applied", languageId ?? "plain");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      createCodeMirrorPositionResolver(() => sessionRef.current?.view ?? null),
    );
    return () => onModelPositionResolverChange(null);
  }, [buffer?.id, onModelPositionResolverChange]);

  // Brings the editor up to date when the buffer changed elsewhere: another pane, a reload from
  // disk, undo, or an agent edit. A store update that only echoes this editor's text is ignored.
  // Subscribed directly, so typing never re-renders the editor component.
  useEffect(() => {
    const bufferId = buffer?.id;
    if (!bufferId) return;
    let lastSeen: unknown = null;
    let lastSeenContent: string | undefined;
    const sync = (buffers: PaneContent[]) => {
      const session = sessionRef.current;
      const current = getBufferById(buffers, bufferId);
      if (!session || session.deliveringOwnChange) return;
      if (current?.type !== "editor" || current === lastSeen) return;
      lastSeen = current;
      const contentChanged = current.content !== lastSeenContent;
      lastSeenContent = current.content;
      const contentRevision = current.contentRevision ?? 0;
      // Text an editor holds beyond the store is newer than anything the store says; a write that
      // only touched the dirty flag, pinning or a save must not roll the editor back to it.
      const liveRevision = getLiveDocumentRevision(bufferId);
      if (liveRevision !== undefined && liveRevision >= contentRevision) return;
      // Only text that changed is applied: a newer revision, or new text on a buffer whose writer
      // keeps no revisions.
      const newerRevision = contentRevision > session.appliedContentRevision;
      if (!newerRevision && (contentRevision > 0 || !contentChanged)) return;
      session.appliedContentRevision = Math.max(session.appliedContentRevision, contentRevision);
      replaceWithBufferText(session, current.content);
      matchSessionToBufferText(session, current.content);
      if (session.liveText && !current.isDirty && current.content === current.savedContent) {
        rememberSavedDocument(
          bufferId,
          current.savedContent,
          session.view.state.doc,
          session.separator,
        );
      }
    };
    sync(historyOwner.store.getState().buffers);
    const unsubscribeStore = historyOwner.store.subscribe((state) => sync(state.buffers));
    // Another view of this buffer typed: apply its change set, or its whole text when this view
    // missed an earlier edit.
    const unsubscribeLive = subscribeLiveDocument(bufferId, (change) => {
      const session = sessionRef.current;
      if (!session || change.sourceId === sourceIdRef.current) return;
      if (change.revision <= session.appliedContentRevision) return;
      if (
        session.appliedContentRevision === change.revision - 1 &&
        session.view.state.doc.length === change.startDoc.length
      ) {
        session.applyingExternalUpdate = true;
        try {
          session.view.dispatch({ changes: change.changes });
        } finally {
          session.applyingExternalUpdate = false;
        }
      } else {
        const text = getLiveDocumentText(bufferId);
        if (text !== undefined) replaceWithBufferText(session, text);
      }
      session.appliedContentRevision = change.revision;
    });
    return () => {
      unsubscribeStore();
      unsubscribeLive();
    };
  }, [buffer?.id, historyOwner]);

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
    // Becoming the active view changes neither geometry nor, necessarily, focus, so the height
    // the store holds would otherwise stay the previous view's.
    const activeView = getView();
    if (activeView) reportViewportHeight(activeView);
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
        effects: EditorView.scrollIntoView(head, { y: "nearest" }),
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
  }, [
    activeBufferId,
    applyHistory,
    buffer?.id,
    isActiveSurface,
    isReadOnly,
    reportViewportHeight,
    viewStateKey,
  ]);

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
    if (pendingNavigation.focus !== false) view.focus();
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

  useLayoutEffect(() => {
    if (!isActiveSurface || !filePath) return;
    return fileOpenBenchmark.finishAfterPaint(filePath, "editor-painted", () => {
      const doc = sessionRef.current?.view.state.doc;
      return {
        lineCount: doc?.lines,
        contentLength: doc?.length,
        languageId: languageId ?? undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer?.id, filePath, isActiveSurface]);

  const bufferId = buffer?.id ?? null;
  const isVirtual = Boolean(buffer?.isVirtual);
  const hasLineNumberMap = Boolean(lineNumberMap);
  const host = useMemo<CodeMirrorHost | null>(() => {
    const shell = shellRef.current;
    if (!view || !shell || !bufferId) return null;
    return {
      view,
      container: shell,
      bufferId,
      filePath,
      languageId: languageId ?? null,
      viewStateKey: viewStateKey ?? null,
      isActiveSurface,
      isReadOnly,
      isVirtual,
      hasLineNumberMap,
      getSeparator: () => sessionRef.current?.separator ?? "\n",
      applyHistory,
    };
  }, [
    applyHistory,
    bufferId,
    filePath,
    hasLineNumberMap,
    isActiveSurface,
    isReadOnly,
    isVirtual,
    languageId,
    view,
    viewStateKey,
  ]);

  if (!buffer) return null;

  return (
    <div
      ref={shellRef}
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
      {host ? <CodeMirrorFeatures host={host} /> : null}
    </div>
  );
}

/**
 * Records how the editor's text relates to `content`, the stored text it was just set from.
 * Offsets agree when every line break is one the editor counts the same way; the editor holds the
 * text exactly only when every break is the file's separator.
 */
function matchSessionToBufferText(session: EditorSession, content: string) {
  const { view, separator } = session;
  session.bufferMatchesModel = getBufferTextLength(view.state.doc, separator) === content.length;
  session.liveText = session.bufferMatchesModel && textRoundTrips(content, separator);
}

/**
 * The saved text as a document sharing every unchanged part with `doc`, so the dirty check after
 * each edit only looks at what differs. Built once when the editor opens.
 */
function savedDocumentFrom(
  doc: Text,
  separator: LineSeparator,
  content: string,
  savedContent: string,
): Text {
  const replacement = minimalReplacement(content, savedContent);
  if (!replacement) return doc;
  const splitsLineBreak = (text: string, offset: number) =>
    text[offset - 1] === "\r" && text[offset] === "\n";
  if (
    splitsLineBreak(content, replacement.from) ||
    splitsLineBreak(content, replacement.to) ||
    splitsLineBreak(savedContent, replacement.from)
  ) {
    return Text.of(savedContent.split(/\r\n|\r|\n/));
  }
  return doc.replace(
    fromBufferOffset(doc, replacement.from, separator),
    fromBufferOffset(doc, replacement.to, separator),
    Text.of(replacement.insert.split(/\r\n|\r|\n/)),
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
