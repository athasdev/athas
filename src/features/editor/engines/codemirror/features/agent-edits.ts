import {
  type EditorState,
  type Extension,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutterLineClass,
  WidgetType,
} from "@codemirror/view";
import { agentEditDecorations } from "@/features/ai/services/agent-edit-decorations";
import type { AgentEditLens } from "@/features/ai/services/agent-edit-lenses";

/** What a hunk's Keep and Undo actions do. */
export interface AgentHunkActions {
  keep: (lens: AgentEditLens) => void;
  reject: (lens: AgentEditLens) => void;
  /** The label for an action, naming the chat when several chats edited the file. */
  title: (action: "Keep" | "Undo", lens: AgentEditLens) => string;
}

interface AgentEditsState {
  decorations: DecorationSet;
  gutter: RangeSet<GutterMarker>;
}

const EMPTY: AgentEditsState = { decorations: Decoration.none, gutter: RangeSet.empty };

const setAgentEdits = StateEffect.define<AgentEditsState>();

class AddedLineGutterMarker extends GutterMarker {
  elementClass = "cm-agent-edit-added-gutter";
}

const addedLineGutterMarker = new AddedLineGutterMarker();
const addedLineDecoration = Decoration.line({ class: "cm-agent-edit-added-line" });

/**
 * Sits above a hunk: its Keep and Undo actions, then the lines the agent removed, drawn the way
 * a diff shows them.
 */
class AgentHunkWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly lens: AgentEditLens,
    readonly removedLines: readonly string[],
    readonly keepTitle: string,
    readonly undoTitle: string,
    readonly actions: AgentHunkActions,
  ) {
    super();
  }

  eq(other: AgentHunkWidget) {
    return other.key === this.key;
  }

  toDOM() {
    const node = document.createElement("div");
    node.className = "cm-agent-edit-hunk";

    const lens = document.createElement("div");
    lens.className = "cm-agent-edit-lens";
    lens.setAttribute("role", "toolbar");
    lens.setAttribute("aria-label", "Agent change");
    lens.append(
      this.actionButton(this.keepTitle, "Keep this agent change", () =>
        this.actions.keep(this.lens),
      ),
      this.actionButton(this.undoTitle, "Undo this agent change", () =>
        this.actions.reject(this.lens),
      ),
    );
    node.append(lens);

    if (this.removedLines.length > 0) {
      const removed = document.createElement("div");
      removed.className = "cm-agent-edit-removed-lines";
      removed.setAttribute("aria-label", "Lines the agent removed");
      for (const line of this.removedLines) {
        const row = document.createElement("div");
        row.className = "cm-agent-edit-removed-line";
        row.textContent = line.length > 0 ? line : " ";
        removed.append(row);
      }
      node.append(removed);
    }
    return node;
  }

  private actionButton(label: string, description: string, run: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-agent-edit-lens-action";
    button.textContent = label;
    button.title = description;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      run();
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

const agentEditsField = StateField.define<AgentEditsState>({
  create: () => EMPTY,
  update(value, transaction) {
    let next = transaction.docChanged
      ? {
          decorations: value.decorations.map(transaction.changes),
          gutter: value.gutter.map(transaction.changes),
        }
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(setAgentEdits)) next = effect.value;
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    gutterLineClass.from(field, (value) => value.gutter),
  ],
});

const agentEditsTheme = EditorView.baseTheme({
  ".cm-agent-edit-added-line": { backgroundColor: "var(--git-added-soft)" },
  ".cm-gutter:last-child .cm-gutterElement.cm-agent-edit-added-gutter": {
    boxShadow: "inset -2px 0 0 var(--git-added)",
  },
  ".cm-agent-edit-lens": {
    display: "flex",
    gap: "0.75em",
    fontSize: "0.85em",
    color: "var(--subtle-foreground)",
  },
  ".cm-agent-edit-lens-action": {
    padding: "0",
    border: "none",
    background: "none",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-agent-edit-lens-action:hover": {
    color: "var(--foreground)",
    textDecoration: "underline",
  },
  ".cm-agent-edit-lens-action:focus-visible": {
    outline: "1px solid var(--focus-ring)",
    borderRadius: "2px",
  },
  ".cm-agent-edit-removed-lines": {
    borderLeft: "2px solid var(--git-deleted)",
    backgroundColor: "var(--git-deleted-soft)",
    color: "var(--subtle-foreground)",
    pointerEvents: "none",
  },
  ".cm-agent-edit-removed-line": { overflow: "hidden", whiteSpace: "pre" },
});

export const agentEditsExtension: Extension = [agentEditsField, agentEditsTheme];

/** A key for what `lenses` draw, so an unchanged set leaves the editor alone. */
export function agentEditsRenderKey(lenses: readonly AgentEditLens[], actions: AgentHunkActions) {
  return JSON.stringify(
    agentEditDecorations(lenses).map((item) => [
      item.lens.chatId,
      item.addedLines,
      item.afterLineNumber,
      item.removedLines,
      actions.title("Keep", item.lens),
      actions.title("Undo", item.lens),
    ]),
  );
}

/** The decorations and gutter marks for `lenses` in `state`'s document. */
function buildAgentEdits(
  state: EditorState,
  lenses: readonly AgentEditLens[],
  actions: AgentHunkActions,
): AgentEditsState {
  const { doc } = state;
  const decorations = [];
  const gutter = [];
  for (const item of agentEditDecorations(lenses)) {
    const keepTitle = actions.title("Keep", item.lens);
    const undoTitle = actions.title("Undo", item.lens);
    const key = JSON.stringify([
      item.lens.chatId,
      item.lens.path,
      item.lens.hunk,
      keepTitle,
      undoTitle,
    ]);
    const widget = new AgentHunkWidget(
      key,
      item.lens,
      item.removedLines,
      keepTitle,
      undoTitle,
      actions,
    );
    const after = Math.max(0, item.afterLineNumber);
    const aboveNextLine = after < doc.lines;
    decorations.push(
      Decoration.widget({ widget, block: true, side: aboveNextLine ? -1 : 1 }).range(
        aboveNextLine ? doc.line(after + 1).from : doc.length,
      ),
    );
    if (!item.addedLines) continue;
    const end = Math.min(item.addedLines.end, doc.lines);
    for (let number = Math.max(1, item.addedLines.start); number <= end; number++) {
      const from = doc.line(number).from;
      decorations.push(addedLineDecoration.range(from));
      gutter.push(addedLineGutterMarker.range(from));
    }
  }
  return { decorations: Decoration.set(decorations, true), gutter: RangeSet.of(gutter, true) };
}

/** Draws `lenses` in the editor, replacing what it drew before. */
export function showAgentEdits(
  view: EditorView,
  lenses: readonly AgentEditLens[],
  actions: AgentHunkActions,
) {
  if (view.state.field(agentEditsField, false) === undefined) return;
  view.dispatch({
    effects: setAgentEdits.of(lenses.length ? buildAgentEdits(view.state, lenses, actions) : EMPTY),
  });
}
