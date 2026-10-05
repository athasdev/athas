import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  moveLineDown,
  moveLineUp,
  toggleComment,
} from "@codemirror/commands";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ActiveEditorAdapter } from "../../extensions/api";
import { getLineCommentTokenForLanguage } from "../../utils/comment-toggle";

export type CodeMirrorLineCommands = Required<
  Pick<
    ActiveEditorAdapter,
    | "toggleComment"
    | "duplicateLine"
    | "deleteLine"
    | "moveLineUp"
    | "moveLineDown"
    | "copyLineUp"
    | "copyLineDown"
  >
>;

/**
 * The editor API's line commands carried out by CodeMirror, so they act on every cursor and
 * selection and land in the editor's own change stream instead of rewriting the buffer.
 */
export function createCodeMirrorLineCommands(
  getView: () => EditorView | null,
): CodeMirrorLineCommands {
  const run = (command: (view: EditorView) => boolean) => () => {
    const view = getView();
    if (view) command(view);
  };

  return {
    toggleComment: run(toggleComment),
    duplicateLine: run(copyLineDown),
    deleteLine: run(deleteLine),
    moveLineUp: run(moveLineUp),
    moveLineDown: run(moveLineDown),
    copyLineUp: run(copyLineUp),
    copyLineDown: run(copyLineDown),
  };
}

/**
 * Line comment tokens for languages whose CodeMirror support does not declare any, from the same
 * table the rest of Athas uses. Lowest precedence, so a language's own tokens always win.
 */
export function fallbackCommentTokens(languageId: string | null): Extension {
  const commentTokens = { line: getLineCommentTokenForLanguage(languageId) };
  return Prec.lowest(EditorState.languageData.of(() => [{ commentTokens }]));
}
