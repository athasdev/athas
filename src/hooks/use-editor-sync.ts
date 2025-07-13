import { useEffect } from "react";
import { useCodeEditorStore } from "../stores/code-editor-store";

interface UseEditorSyncProps {
  value: string;
  filename: string;
  filePath: string;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  disabled: boolean;
  vimEnabled: boolean;
  vimMode?: "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "command";
  aiCompletion: boolean;
  searchQuery: string;
  searchMatches: { start: number; end: number }[];
  currentMatchIndex: number;
}

export const useEditorSync = (props: UseEditorSyncProps) => {
  const setValue = useCodeEditorStore(state => state.setValue);
  const setFilename = useCodeEditorStore(state => state.setFilename);
  const setFilePath = useCodeEditorStore(state => state.setFilePath);
  const setFontSize = useCodeEditorStore(state => state.setFontSize);
  const setTabSize = useCodeEditorStore(state => state.setTabSize);
  const setWordWrap = useCodeEditorStore(state => state.setWordWrap);
  const setLineNumbers = useCodeEditorStore(state => state.setLineNumbers);
  const setDisabled = useCodeEditorStore(state => state.setDisabled);
  const setVimEnabled = useCodeEditorStore(state => state.setVimEnabled);
  const setVimMode = useCodeEditorStore(state => state.setVimMode);
  const setAiCompletion = useCodeEditorStore(state => state.setAiCompletion);
  const setSearchQuery = useCodeEditorStore(state => state.setSearchQuery);
  const setSearchMatches = useCodeEditorStore(state => state.setSearchMatches);
  const setCurrentMatchIndex = useCodeEditorStore(state => state.setCurrentMatchIndex);

  // Sync all props with store
  useEffect(() => {
    setValue(props.value);
  }, [props.value, setValue]);

  useEffect(() => {
    setFilename(props.filename);
  }, [props.filename, setFilename]);

  useEffect(() => {
    setFilePath(props.filePath);
  }, [props.filePath, setFilePath]);

  useEffect(() => {
    setFontSize(props.fontSize);
  }, [props.fontSize, setFontSize]);

  useEffect(() => {
    setTabSize(props.tabSize);
  }, [props.tabSize, setTabSize]);

  useEffect(() => {
    setWordWrap(props.wordWrap);
  }, [props.wordWrap, setWordWrap]);

  useEffect(() => {
    setLineNumbers(props.lineNumbers);
  }, [props.lineNumbers, setLineNumbers]);

  useEffect(() => {
    setDisabled(props.disabled);
  }, [props.disabled, setDisabled]);

  useEffect(() => {
    setVimEnabled(props.vimEnabled);
  }, [props.vimEnabled, setVimEnabled]);

  useEffect(() => {
    if (props.vimMode) {
      setVimMode(props.vimMode);
    }
  }, [props.vimMode, setVimMode]);

  useEffect(() => {
    setAiCompletion(props.aiCompletion);
  }, [props.aiCompletion, setAiCompletion]);

  useEffect(() => {
    setSearchQuery(props.searchQuery);
  }, [props.searchQuery, setSearchQuery]);

  useEffect(() => {
    setSearchMatches(props.searchMatches);
  }, [props.searchMatches, setSearchMatches]);

  useEffect(() => {
    setCurrentMatchIndex(props.currentMatchIndex);
  }, [props.currentMatchIndex, setCurrentMatchIndex]);
};
