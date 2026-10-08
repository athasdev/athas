import { Transaction } from "@codemirror/state";

interface OnTypeFormattingTrigger {
  character: string;
  /** The document position just after the typed character, where the server formats from. */
  position: number;
}

/**
 * The on-type formatting trigger a transaction typed, if any: a single `;` or `}`, or a line
 * break (with whatever indentation the editor inserted after it). These are the characters
 * Monaco registered on-type formatting for; the server must list them too.
 */
export function onTypeFormattingTrigger(tr: Transaction): OnTypeFormattingTrigger | null {
  if (!tr.docChanged) return null;
  // Typed characters are "input.type"; Enter (insertNewlineAndIndent) is plain "input".
  const event = tr.annotation(Transaction.userEvent);
  if (event !== "input" && !tr.isUserEvent("input.type")) return null;
  let trigger: OnTypeFormattingTrigger | null = null;
  let changes = 0;
  tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    changes += 1;
    const text = inserted.toString();
    if (text === ";" || text === "}") {
      trigger = { character: text, position: fromB + 1 };
    } else if (/^\r?\n[ \t]*$/.test(text)) {
      trigger = { character: "\n", position: fromB + inserted.length };
    }
  });
  return changes === 1 ? trigger : null;
}
