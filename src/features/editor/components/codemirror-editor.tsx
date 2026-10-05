import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers as lineNumbersGutter,
  rectangularSelection,
} from "@codemirror/view";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { cn } from "@/utils/cn";
import { useEditorViewSettings } from "../hooks/use-editor-view-settings";
import {
  detectLineSeparator,
  minimalReplacement,
  toBufferText,
  toModelContentChangeEvent,
  type LineSeparator,
} from "../engines/codemirror/document-change";
import { loadCodeMirrorLanguage } from "../engines/codemirror/languages";
import {
  fromEditorPosition,
  fromEditorRange,
  toEditorPosition,
  toEditorRange,
} from "../engines/codemirror/position";
import {
  athasEditorFont,
  athasEditorTheme,
  athasSyntaxHighlighting,
} from "../engines/codemirror/theme";
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
  onContentChange,
  onDocumentChange,
  onScrollOffsetChange,
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
  const { setCursorAndSelection, setScrollForBuffer } = useEditorStateStore.use.actions();
  const isReadOnly = readOnly || isPreviewMode;

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
      font: new Compartment(),
      highlighting: new Compartment(),
      lineNumbers: new Compartment(),
      wrap: new Compartment(),
      tabSize: new Compartment(),
      whitespace: new Compartment(),
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
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
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
          compartments.font.of(
            athasEditorFont(settings.fontFamily, settings.fontSize, settings.lineHeight),
          ),
          compartments.highlighting.of(athasSyntaxHighlighting(settings.editorItalicComments)),
          compartments.lineNumbers.of(settings.lineNumbers ? lineNumbersGutter() : []),
          compartments.wrap.of(settings.wordWrap ? EditorView.lineWrapping : []),
          compartments.tabSize.of(tabSizeExtension(settings.tabSize)),
          compartments.whitespace.of(
            settings.renderWhitespace === "none" ? [] : highlightWhitespace(),
          ),
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
    const session = sessionRef.current;
    if (!session) return;
    session.view.dispatch({
      effects: [
        compartments.readOnly.reconfigure(readOnlyExtension(isReadOnly)),
        compartments.font.reconfigure(
          athasEditorFont(settings.fontFamily, settings.fontSize, settings.lineHeight),
        ),
        compartments.highlighting.reconfigure(
          athasSyntaxHighlighting(settings.editorItalicComments),
        ),
        compartments.lineNumbers.reconfigure(settings.lineNumbers ? lineNumbersGutter() : []),
        compartments.wrap.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
        compartments.tabSize.reconfigure(tabSizeExtension(settings.tabSize)),
        compartments.whitespace.reconfigure(
          settings.renderWhitespace === "none" ? [] : highlightWhitespace(),
        ),
      ],
    });
  }, [
    compartments,
    isReadOnly,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.editorItalicComments,
    settings.lineNumbers,
    settings.wordWrap,
    settings.tabSize,
    settings.renderWhitespace,
  ]);

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

  useEffect(() => {
    if (isActiveSurface) sessionRef.current?.view.focus();
  }, [isActiveSurface, buffer?.id]);

  return (
    <div
      ref={containerRef}
      data-editor-engine="codemirror"
      className={cn("size-full overflow-hidden", className)}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    />
  );
}

function readOnlyExtension(isReadOnly: boolean): Extension {
  return [EditorState.readOnly.of(isReadOnly), EditorView.editable.of(!isReadOnly)];
}

function tabSizeExtension(tabSize: number): Extension {
  return [EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize))];
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
    bufferOffsetToDocPosition(current, bufferOffset, separator);
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

/** Converts an offset in the buffer's text (CRLF counting twice) to a document position. */
function bufferOffsetToDocPosition(bufferText: string, offset: number, separator: LineSeparator) {
  if (separator === "\n") return offset;
  let crlfBefore = 0;
  for (let index = bufferText.indexOf("\r\n"); index !== -1 && index < offset;) {
    crlfBefore++;
    index = bufferText.indexOf("\r\n", index + 2);
  }
  return offset - crlfBefore;
}
