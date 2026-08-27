import type { PaneContent } from "@/features/panes/types/pane-content.types";

export interface NativeMenuState {
  closeFolderEnabled: boolean;
  saveEnabled: boolean;
  saveAsEnabled: boolean;
  activityBarVisible: boolean;
  sidebarVisible: boolean;
  terminalVisible: boolean;
  minimapVisible: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  whitespaceVisible: boolean;
}

interface NativeMenuStateInput {
  activeBuffer: PaneContent | null;
  hasOpenFolder: boolean;
  activityBarVisible: boolean;
  sidebarVisible: boolean;
  terminalVisible: boolean;
  minimapVisible: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  renderWhitespace: "none" | "boundary" | "trailing" | "all";
}

export function getNativeMenuState(input: NativeMenuStateInput): NativeMenuState {
  const writableEditor =
    input.activeBuffer?.type === "editor" && !input.activeBuffer.readOnly
      ? input.activeBuffer
      : null;

  return {
    closeFolderEnabled: input.hasOpenFolder,
    saveEnabled: Boolean(
      writableEditor && (writableEditor.isDirty || writableEditor.path.startsWith("untitled:")),
    ),
    saveAsEnabled: Boolean(writableEditor),
    activityBarVisible: input.activityBarVisible,
    sidebarVisible: input.sidebarVisible,
    terminalVisible: input.terminalVisible,
    minimapVisible: input.minimapVisible,
    wordWrap: input.wordWrap,
    lineNumbers: input.lineNumbers,
    whitespaceVisible: input.renderWhitespace !== "none",
  };
}
