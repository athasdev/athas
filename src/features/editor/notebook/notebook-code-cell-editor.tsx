import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, type Extension, Prec } from "@codemirror/state";
import {
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  detectLineSeparator,
  minimalReplacement,
  toBufferText,
  type LineSeparator,
} from "../engines/codemirror/document-change";
import { loadCodeMirrorLanguage } from "../engines/codemirror/languages";
import { athasEditorTheme } from "../engines/codemirror/theme";
import { codeMirrorViewExtensions } from "../engines/codemirror/view-options";
import { useEditorViewSettings } from "../hooks/use-editor-view-settings";

interface NotebookCodeCellEditorProps {
  id: string;
  value: string;
  language: string;
  onChange: (value: string) => void;
  /** Runs the cell, bound to Shift+Enter and Mod+Enter inside the editor. */
  onRun?: () => void;
}

const MIN_HEIGHT_PX = 92;
const MAX_HEIGHT_PX = 520;

const externalChange = Annotation.define<boolean>();

/** Notebook language names (`language_info.name`) as Athas language ids. */
function toLanguageId(language: string) {
  const normalized = language.trim().toLowerCase();
  if (normalized === "python3") return "python";
  if (normalized === "shell" || normalized === "sh") return "bash";
  return normalized;
}

/**
 * The cell grows with its content between a minimum and maximum height, with one spare line below
 * the last, instead of the page-sized padding a full editor keeps below its last line.
 */
function cellSizing(lineHeight: number): Extension {
  return EditorView.theme({
    "&.cm-editor": {
      height: "auto",
      minHeight: `${MIN_HEIGHT_PX}px`,
      maxHeight: `${MAX_HEIGHT_PX}px`,
    },
    ".cm-scroller": { overflow: "auto", overscrollBehavior: "auto" },
    ".cm-content": { paddingBottom: `${lineHeight}px !important` },
    ".cm-gutters": { minHeight: `${MIN_HEIGHT_PX}px` },
  });
}

const wordCompletions = EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]);

export function NotebookCodeCellEditor({
  id,
  value,
  language,
  onChange,
  onRun,
}: NotebookCodeCellEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const separatorRef = useRef<LineSeparator>(detectLineSeparator(value));
  const latest = useRef({ onChange, onRun });
  latest.current = { onChange, onRun };
  const settings = useEditorViewSettings();
  const languageId = toLanguageId(language);
  const compartments = useMemo(
    () => ({ language: new Compartment(), view: new Compartment() }),
    [],
  );

  const viewExtensions = useMemo<Extension>(
    () => [
      codeMirrorViewExtensions({
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        fontLigatures: settings.editorFontLigatures,
        italicComments: settings.editorItalicComments,
        tabSize: settings.tabSize,
        wordWrap: settings.wordWrap,
        lineNumbers: settings.lineNumbers,
        lineNumberOptions: {},
        renderWhitespace: settings.renderWhitespace,
        indentGuides: settings.renderIndentGuides,
        bracketPairColors: settings.editorBracketPairColorization,
        highlightOccurrences: settings.highlightOccurrences,
        scrollBeyondLastLine: false,
        scrollable: true,
        cursorStyle: settings.editorCursorStyle,
        cursorBlinking: settings.editorCursorBlinking,
      }),
      cellSizing(settings.lineHeight),
    ],
    [
      settings.editorBracketPairColorization,
      settings.editorCursorBlinking,
      settings.editorCursorStyle,
      settings.editorFontLigatures,
      settings.editorItalicComments,
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

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const run = () => {
      const handler = latest.current.onRun;
      if (!handler) return false;
      handler();
      return true;
    };

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.high(
            keymap.of([
              { key: "Shift-Enter", run, preventDefault: true },
              { key: "Mod-Enter", run, preventDefault: true },
            ]),
          ),
          history(),
          highlightSpecialChars(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          wordCompletions,
          highlightActiveLine(),
          highlightActiveLineGutter(),
          search({ top: true }),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          athasEditorTheme,
          compartments.language.of([]),
          compartments.view.of(viewExtensions),
          EditorView.contentAttributes.of({ "aria-label": "Code cell source" }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((transaction) => transaction.annotation(externalChange))) {
              return;
            }
            latest.current.onChange(toBufferText(update.state.doc, separatorRef.current));
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // The editor is rebuilt only for another cell; settings and value are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    separatorRef.current = detectLineSeparator(value);
    const current = toBufferText(view.state.doc, separatorRef.current);
    const replacement = minimalReplacement(current, value);
    if (!replacement) return;
    const toDocPosition = (offset: number) => {
      const text = current.slice(0, offset);
      return separatorRef.current === "\r\n" ? text.replace(/\r\n/g, "\n").length : offset;
    };
    view.dispatch({
      changes: {
        from: toDocPosition(replacement.from),
        to: toDocPosition(replacement.to),
        insert: replacement.insert,
      },
      annotations: externalChange.of(true),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.view.reconfigure(viewExtensions) });
  }, [compartments, viewExtensions]);

  useEffect(() => {
    let cancelled = false;
    void loadCodeMirrorLanguage(languageId).then((extension) => {
      const view = viewRef.current;
      if (cancelled || !view) return;
      view.dispatch({ effects: compartments.language.reconfigure(extension ?? []) });
    });
    return () => {
      cancelled = true;
    };
  }, [compartments, id, languageId]);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden bg-background"
      data-editor-engine="codemirror"
      data-notebook-cell-editor
    />
  );
}
