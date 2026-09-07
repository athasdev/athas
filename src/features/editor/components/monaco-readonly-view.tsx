import "../engines/monaco/monaco-environment";
import "monaco-editor/min/vs/editor/editor.main.css";
import "../styles/monaco-editor.css";
import { editor as monacoEditor, Uri } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { cn } from "@/utils/cn";
import { getMonacoScrollbarOptions } from "../engines/monaco/scrollbar-options";
import { defineMonacoTheme } from "../engines/monaco/theme";
import { useMonacoEditorSettings } from "../engines/monaco/use-monaco-editor-settings";
import { editorAPI } from "../extensions/api";

export type MonacoReadonlyEditor = Monaco.editor.IStandaloneCodeEditor;

interface MonacoReadonlyViewProps {
  content: string;
  languageId?: string;
  wordWrap?: boolean;
  folding?: boolean;
  glyphMargin?: boolean;
  lineNumberFormatter?: (lineNumber: number) => string;
  ariaLabel?: string;
  className?: string;
  /**
   * Called once the editor exists. Return a cleanup that runs before the editor
   * is disposed, so callers can remove decorations and listeners they added.
   */
  onReady?: (editor: MonacoReadonlyEditor) => void | (() => void);
  /**
   * Called after the model text changed with the editor and whether the change
   * was an append (the previous text is a prefix of the new one).
   */
  onContentApplied?: (editor: MonacoReadonlyEditor, appended: boolean) => void;
}

/**
 * A read-only Monaco surface that owns its own text model instead of going
 * through the buffer store. Meant for large generated text such as CI logs:
 * Monaco virtualises the lines, and appended content is applied as an edit so
 * scroll position and decorations survive live updates.
 */
export function MonacoReadonlyView({
  content,
  languageId = "plaintext",
  wordWrap = false,
  folding = false,
  glyphMargin = false,
  lineNumberFormatter,
  ariaLabel,
  className,
  onReady,
  onContentApplied,
}: MonacoReadonlyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoReadonlyEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const contentRef = useRef(content);
  const onReadyRef = useRef(onReady);
  const onContentAppliedRef = useRef(onContentApplied);
  const lineNumberFormatterRef = useRef(lineNumberFormatter);
  const instanceId = useId();
  const { fontFamily, fontSize, lineHeight, themeId, editorItalicComments } =
    useMonacoEditorSettings();

  contentRef.current = content;
  onReadyRef.current = onReady;
  onContentAppliedRef.current = onContentApplied;
  lineNumberFormatterRef.current = lineNumberFormatter;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const uri = Uri.parse(`athas-readonly://view/${instanceId.replace(/[^a-zA-Z0-9]/g, "")}`);
    const model = monacoEditor.createModel(contentRef.current, languageId, uri);
    const editor = monacoEditor.create(container, {
      model,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      ariaLabel,
      fontFamily,
      fontSize,
      lineHeight,
      theme: defineMonacoTheme(themeId, editorItalicComments),
      wordWrap: wordWrap ? "on" : "off",
      folding,
      showFoldingControls: "always",
      glyphMargin,
      lineNumbers: (lineNumber) =>
        lineNumberFormatterRef.current
          ? lineNumberFormatterRef.current(lineNumber)
          : String(lineNumber),
      lineDecorationsWidth: 12,
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      occurrencesHighlight: "off",
      selectionHighlight: false,
      renderWhitespace: "none",
      guides: { indentation: false },
      quickSuggestions: false,
      wordBasedSuggestions: "off",
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
      contextmenu: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: getMonacoScrollbarOptions(true),
    });

    editorRef.current = editor;
    modelRef.current = model;

    const ownerId = uri.toString();
    const focusDisposable = editor.onDidFocusEditorWidget(() => {
      editorAPI.setActiveFindAdapter({
        ownerId,
        openFind: () => editor.trigger("athas-keybinding", "actions.find", null),
      });
    });
    const blurDisposable = editor.onDidBlurEditorWidget(() => {
      editorAPI.clearActiveFindAdapter(ownerId);
    });

    const cleanup = onReadyRef.current?.(editor);

    return () => {
      cleanup?.();
      focusDisposable.dispose();
      blurDisposable.dispose();
      editorAPI.clearActiveFindAdapter(ownerId);
      editorRef.current = null;
      modelRef.current = null;
      editor.dispose();
      model.dispose();
    };
    // The editor is created once per language; everything else is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, languageId]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || model.isDisposed()) return;

    const previous = model.getValue();
    if (previous === content) return;

    const appended = previous.length > 0 && content.startsWith(previous);
    if (appended) {
      const lastLine = model.getLineCount();
      const lastColumn = model.getLineMaxColumn(lastLine);
      model.applyEdits([
        {
          range: {
            startLineNumber: lastLine,
            startColumn: lastColumn,
            endLineNumber: lastLine,
            endColumn: lastColumn,
          },
          text: content.slice(previous.length),
        },
      ]);
    } else {
      model.setValue(content);
    }
    onContentAppliedRef.current?.(editor, appended);
  }, [content]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontFamily,
      fontSize,
      lineHeight,
      wordWrap: wordWrap ? "on" : "off",
      folding,
      glyphMargin,
      ariaLabel,
    });
  }, [ariaLabel, folding, fontFamily, fontSize, glyphMargin, lineHeight, wordWrap]);

  useEffect(() => {
    monacoEditor.setTheme(defineMonacoTheme(themeId, editorItalicComments));
  }, [editorItalicComments, themeId]);

  return (
    <div
      ref={containerRef}
      className={cn("monaco-editor-shell size-full min-h-0 min-w-0", className)}
      data-monaco-readonly-view
    />
  );
}
