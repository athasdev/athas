import { KeyCode, KeyMod, type editor } from "monaco-editor";

export function registerMonacoHistoryActions(
  editor: Pick<editor.IStandaloneCodeEditor, "addAction">,
  apply: (direction: "undo" | "redo") => void,
) {
  const actions = [
    editor.addAction({
      id: "undo",
      label: "Undo",
      precondition: "!editorReadonly",
      keybindingContext: "editorTextFocus",
      keybindings: [KeyMod.CtrlCmd | KeyCode.KeyZ],
      run: () => apply("undo"),
    }),
    editor.addAction({
      id: "redo",
      label: "Redo",
      precondition: "!editorReadonly",
      keybindingContext: "editorTextFocus",
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyZ, KeyMod.CtrlCmd | KeyCode.KeyY],
      run: () => apply("redo"),
    }),
  ];
  return { dispose: () => actions.forEach((action) => action.dispose()) };
}
