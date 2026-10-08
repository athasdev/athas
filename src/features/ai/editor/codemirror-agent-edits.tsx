import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { keepAgentHunk, rejectAgentHunk } from "@/features/ai/services/agent-edits-service";
import { useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import {
  type AgentHunkEditor,
  agentEditLensesFor,
  agentHunkActionTitle,
  focusAgentHunkEditor,
  removeAgentHunkEditor,
  setAgentHunkCount,
} from "@/features/ai/services/agent-hunk-actions";
import { toBufferText } from "@/features/editor/engines/codemirror/document-change";
import {
  type CodeMirrorHost,
  useCodeMirrorExtension,
} from "@/features/editor/engines/codemirror/host";
import {
  type AgentHunkActions,
  agentEditsExtension,
  agentEditsRenderKey,
  showAgentEdits,
} from "./agent-edits";
import { revealRangeInCenterIfOutside } from "@/features/editor/engines/codemirror/features/reveal";

/** Lets a burst of typing or store updates redraw the hunks once. */
const RENDER_DELAY_MS = 50;

/**
 * Shows the file's unreviewed agent hunks: added lines in green, the lines they replaced in red
 * above them, and Keep and Undo actions doing what the chat's review does for that hunk.
 */
export function CodeMirrorAgentEdits({ host }: { host: CodeMirrorHost }) {
  const { view } = host;
  const latest = useRef({ filePath: host.filePath, getSeparator: host.getSeparator });
  useLayoutEffect(() => {
    latest.current = { filePath: host.filePath, getSeparator: host.getSeparator };
  });

  const editor = useMemo<AgentHunkEditor>(
    () => ({
      getFilePath: () => latest.current.filePath || null,
      getText: () => toBufferText(view.state.doc, latest.current.getSeparator()),
      getCursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
      revealLine: (line) => {
        const { doc } = view.state;
        const from = doc.line(Math.max(1, Math.min(doc.lines, line))).from;
        view.dispatch({ selection: EditorSelection.cursor(from) });
        revealRangeInCenterIfOutside(view, from);
      },
    }),
    [view],
  );

  const scheduleRef = useRef<() => void>(() => {});
  const extension = useMemo(
    () => [
      agentEditsExtension,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) scheduleRef.current();
        if (update.focusChanged && update.view.hasFocus) focusAgentHunkEditor(editor);
      }),
    ],
    [editor],
  );
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let renderedKey = "";
    const actions: AgentHunkActions = {
      keep: (lens) => void keepAgentHunk(lens.chatId, lens.path, lens.hunk),
      reject: (lens) => void rejectAgentHunk(lens.chatId, lens.path, lens.hunk),
      title: () => "",
    };

    const render = () => {
      const lenses = agentEditLensesFor(editor.getFilePath(), editor.getText);
      setAgentHunkCount(editor, lenses.length);
      const chatCount = new Set(lenses.map((lens) => lens.chatId)).size;
      actions.title = (action, lens) => agentHunkActionTitle(action, lens, chatCount);
      const key = agentEditsRenderKey(lenses, actions);
      if (key === renderedKey) return;
      renderedKey = key;
      showAgentEdits(view, lenses, actions);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(render, RENDER_DELAY_MS);
    };
    scheduleRef.current = schedule;

    const unsubscribe = useAgentEditsStore.subscribe((state, previous) => {
      if (state.byChat !== previous.byChat) schedule();
    });
    if (view.hasFocus) focusAgentHunkEditor(editor);
    render();
    return () => {
      clearTimeout(timer);
      unsubscribe();
      scheduleRef.current = () => {};
      removeAgentHunkEditor(editor);
    };
  }, [editor, extension, view]);

  useEffect(() => {
    scheduleRef.current();
  }, [host.filePath]);

  return null;
}
