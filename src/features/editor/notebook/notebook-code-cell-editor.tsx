import "../engines/monaco/monaco-environment";
import "../engines/monaco/language-contributions";
import "monaco-editor/min/vs/editor/editor.main.css";
import "../styles/monaco-editor.css";

import { editor as monacoEditor, Uri } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { toMonacoLanguageId } from "../engines/monaco/language";
import { defineActiveMonacoTheme, defineMonacoTheme } from "../engines/monaco/theme";
import { useMonacoEditorSettings } from "../engines/monaco/use-monaco-editor-settings";

interface NotebookCodeCellEditorProps {
  id: string;
  value: string;
  language: string;
  onChange: (value: string) => void;
}

function editorHeight(editor: Monaco.editor.IStandaloneCodeEditor, lineHeight: number): number {
  return Math.max(92, Math.min(520, editor.getContentHeight() + lineHeight));
}

export function NotebookCodeCellEditor({
  id,
  value,
  language,
  onChange,
}: NotebookCodeCellEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const applyingExternalChangeRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const [height, setHeight] = useState(120);
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
  const monacoLanguage = toMonacoLanguageId(language);
  const modelUri = useMemo(
    () => Uri.parse(`athas://notebook-cell/${encodeURIComponent(id)}.${monacoLanguage}`),
    [id, monacoLanguage],
  );

  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const model = monacoEditor.createModel(value, monacoLanguage, modelUri);
    const editor = monacoEditor.create(container, {
      model,
      automaticLayout: true,
      fontFamily,
      fontSize,
      lineHeight,
      tabSize,
      insertSpaces: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: lineNumbers ? "on" : "off",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 8,
      lineNumbersMinChars: 3,
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      renderWhitespace: renderWhitespace === "none" ? "none" : renderWhitespace,
      wordWrap: wordWrap ? "on" : "off",
      guides: {
        indentation: renderIndentGuides,
        highlightActiveIndentation: renderIndentGuides,
      },
      occurrencesHighlight: highlightOccurrences ? "singleFile" : "off",
      selectionHighlight: highlightOccurrences,
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      parameterHints: { enabled: true },
      contextmenu: true,
      theme: defineActiveMonacoTheme(themeId),
      fixedOverflowWidgets: true,
      scrollbar: {
        vertical: "hidden",
        horizontal: "auto",
        alwaysConsumeMouseWheel: false,
      },
    });

    editorRef.current = editor;
    modelRef.current = model;
    setHeight(editorHeight(editor, lineHeight));

    const contentDisposable = editor.onDidChangeModelContent(() => {
      if (applyingExternalChangeRef.current) return;
      onChangeRef.current(model.getValue());
    });
    const sizeDisposable = editor.onDidContentSizeChange(() => {
      setHeight(editorHeight(editor, lineHeight));
    });

    return () => {
      contentDisposable.dispose();
      sizeDisposable.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [
    fontFamily,
    fontSize,
    highlightOccurrences,
    id,
    lineHeight,
    lineNumbers,
    modelUri,
    monacoLanguage,
    renderIndentGuides,
    renderWhitespace,
    tabSize,
    themeId,
    wordWrap,
  ]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || model.getValue() === value) return;
    applyingExternalChangeRef.current = true;
    model.setValue(value);
    applyingExternalChangeRef.current = false;
    const editor = editorRef.current;
    if (editor) setHeight(editorHeight(editor, lineHeight));
  }, [lineHeight, value]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;
    monacoEditor.setModelLanguage(model, monacoLanguage);
    editor.updateOptions({
      fontFamily,
      fontSize,
      lineHeight,
      lineNumbers: lineNumbers ? "on" : "off",
      tabSize,
      renderWhitespace: renderWhitespace === "none" ? "none" : renderWhitespace,
      wordWrap: wordWrap ? "on" : "off",
      guides: {
        indentation: renderIndentGuides,
        highlightActiveIndentation: renderIndentGuides,
      },
      occurrencesHighlight: highlightOccurrences ? "singleFile" : "off",
      selectionHighlight: highlightOccurrences,
    });
    monacoEditor.setTheme(defineActiveMonacoTheme(themeId));
    setHeight(editorHeight(editor, lineHeight));
  }, [
    fontFamily,
    fontSize,
    highlightOccurrences,
    lineHeight,
    lineNumbers,
    monacoLanguage,
    renderIndentGuides,
    renderWhitespace,
    tabSize,
    themeId,
    wordWrap,
  ]);

  useEffect(() => {
    const applyTheme = (nextThemeId?: string) => {
      monacoEditor.setTheme(
        nextThemeId ? defineMonacoTheme(nextThemeId) : defineActiveMonacoTheme(themeId),
      );
    };

    applyTheme();

    const unsubscribeRegistry = themeRegistry.onRegistryChange(applyTheme);
    const unsubscribeTheme = themeRegistry.onThemeChange(applyTheme);
    const unsubscribeReady = themeRegistry.onReady(applyTheme);

    return () => {
      unsubscribeRegistry();
      unsubscribeTheme();
      unsubscribeReady();
    };
  }, [themeId]);

  useEffect(() => {
    editorRef.current?.layout();
  }, [height]);

  const shellStyle = {
    height,
    "--athas-monaco-font-family": fontFamily,
    "--athas-monaco-font-size": `${fontSize}px`,
    "--athas-monaco-line-height": `${lineHeight}px`,
  } as CSSProperties;

  return (
    <div className="monaco-editor-shell overflow-hidden bg-primary-bg" style={shellStyle}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
