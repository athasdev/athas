import "../monaco/monaco-environment";
import "../monaco/language-contributions";
import "monaco-editor/min/vs/editor/editor.main.css";
import "../styles/monaco-editor.css";

import { editor as monacoEditor, Uri } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { toMonacoLanguageId } from "../monaco/language";
import { calculateLineHeight } from "../utils/lines";
import { defineMonacoTheme } from "../components/monaco-editor";

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
  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const editorLineHeight = useEditorSettingsStore.use.lineHeight();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const wordWrap = useEditorSettingsStore.use.wordWrap();
  const theme = useEditorSettingsStore.use.theme();
  const settingsTheme = useSettingsStore((state) => state.settings.theme);
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const fontSize = baseFontSize * zoomLevel;
  const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
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
      lineNumbers: "on",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 8,
      lineNumbersMinChars: 3,
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      renderWhitespace: "selection",
      wordWrap: wordWrap ? "on" : "off",
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      parameterHints: { enabled: true },
      contextmenu: false,
      theme: defineMonacoTheme(settingsTheme || theme),
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
    id,
    lineHeight,
    modelUri,
    monacoLanguage,
    settingsTheme,
    tabSize,
    theme,
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
      tabSize,
      wordWrap: wordWrap ? "on" : "off",
    });
    monacoEditor.setTheme(defineMonacoTheme(settingsTheme || theme));
    setHeight(editorHeight(editor, lineHeight));
  }, [fontFamily, fontSize, lineHeight, monacoLanguage, settingsTheme, tabSize, theme, wordWrap]);

  useEffect(() => {
    editorRef.current?.layout();
  }, [height]);

  return (
    <div className="notebook-cell-monaco-shell" style={{ height }}>
      <div ref={containerRef} className="notebook-cell-monaco" />
    </div>
  );
}
