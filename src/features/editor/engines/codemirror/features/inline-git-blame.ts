import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export const INLINE_GIT_BLAME_CLASS = "cm-inline-git-blame";

class InlineGitBlameWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly key: string,
  ) {
    super();
  }

  eq(other: InlineGitBlameWidget) {
    return other.key === this.key;
  }

  toDOM() {
    const node = document.createElement("span");
    node.className = INLINE_GIT_BLAME_CLASS;
    node.textContent = this.text;
    return node;
  }

  /** Clicks land in the editor, which puts the cursor at the end of the line. */
  ignoreEvent() {
    return false;
  }
}

/** Shows `text` after the end of the line at `position`, or clears the blame with null. */
export const setInlineGitBlame = StateEffect.define<{
  position: number;
  text: string;
  key: string;
} | null>();

const inlineGitBlameField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setInlineGitBlame)) continue;
      next = effect.value
        ? Decoration.set([
            Decoration.widget({
              widget: new InlineGitBlameWidget(effect.value.text, effect.value.key),
              side: 1,
            }).range(effect.value.position),
          ])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Whether the editor currently shows a blame annotation. */
export function hasInlineGitBlame(view: EditorView) {
  const decorations = view.state.field(inlineGitBlameField, false);
  return Boolean(decorations && decorations.size > 0);
}

const inlineGitBlameTheme = EditorView.baseTheme({
  [`.${INLINE_GIT_BLAME_CLASS}`]: {
    color: "var(--subtle-foreground)",
    opacity: "0.8",
    whiteSpace: "pre",
  },
});

/** The blame annotation's state, plus `onCursorMove` for every selection change. */
export function inlineGitBlameExtension(onCursorMove: () => void): Extension {
  return [
    inlineGitBlameField,
    inlineGitBlameTheme,
    EditorView.updateListener.of((update) => {
      if (update.selectionSet) onCursorMove();
    }),
  ];
}
