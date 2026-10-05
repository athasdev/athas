import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

const OPENING = new Set(["(", "[", "{"]);
const BRACKETS = new Set(["(", ")", "[", "]", "{", "}"]);
const LEVELS = 3;
const levelMarks = Array.from({ length: LEVELS }, (_, level) =>
  Decoration.mark({ class: `cm-athas-bracket-${level}` }),
);

/** How many bracketed nodes enclose this bracket, not counting the one it belongs to. */
function bracketDepth(bracket: SyntaxNode): number {
  let depth = -1;
  for (let node = bracket.parent; node; node = node.parent) {
    const first = node.firstChild;
    if (first && OPENING.has(first.name)) depth++;
  }
  return Math.max(0, depth);
}

function buildBracketDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (!BRACKETS.has(node.name) || node.to - node.from !== 1) return;
        builder.add(node.from, node.to, levelMarks[bracketDepth(node.node) % LEVELS]);
      },
    });
  }
  return builder.finish();
}

/**
 * Colors brackets by nesting depth using the language's syntax tree. Languages without a real tree
 * (legacy stream modes) are left uncolored rather than guessed at.
 */
export const bracketPairColors = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildBracketDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildBracketDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
