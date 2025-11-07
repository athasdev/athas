import isEqual from "fast-deep-equal";
import { createWithEqualityFn } from "zustand/traditional";
import type { Decoration, Position, Range } from "../types/editor";
import { logger } from "../utils/logger";

interface DecorationWithId extends Decoration {
  id: string;
}

interface EditorDecorationsStore {
  decorations: Map<string, DecorationWithId>;

  // Actions
  addDecoration: (decoration: Decoration) => string;
  removeDecoration: (id: string) => void;
  updateDecoration: (id: string, decoration: Partial<Decoration>) => void;
  clearDecorations: () => void;
  getDecorations: () => Decoration[];
  getDecorationsInRange: (range: Range) => Decoration[];
  getDecorationsAtPosition: (position: Position) => Decoration[];
  getDecorationsForLine: (lineNumber: number) => Decoration[];
}

function isPositionInRange(position: Position, range: Range): boolean {
  const { start, end } = range;

  if (position.line < start.line || position.line > end.line) {
    return false;
  }

  if (position.line === start.line && position.column < start.column) {
    return false;
  }

  if (position.line === end.line && position.column > end.column) {
    return false;
  }

  return true;
}

function rangesOverlap(a: Range, b: Range): boolean {
  // Check if one range starts after the other ends
  if (a.start.line > b.end.line || b.start.line > a.end.line) {
    return false;
  }

  if (a.start.line === b.end.line && a.start.column > b.end.column) {
    return false;
  }

  if (b.start.line === a.end.line && b.start.column > a.end.column) {
    return false;
  }

  return true;
}

export const useEditorDecorationsStore = createWithEqualityFn<EditorDecorationsStore>()(
  (set, get) => ({
    decorations: new Map(),

    addDecoration: (decoration) => {
      const id = `decoration-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const decorationWithId: DecorationWithId = { ...decoration, id };

      logger.debug(
        "Editor",
        `DecorationsStore: Adding decoration ${decoration.type} with class ${decoration.className}`,
      );

      set((state) => {
        const newDecorations = new Map(state.decorations);
        newDecorations.set(id, decorationWithId);
        return { decorations: newDecorations };
      });

      return id;
    },

    removeDecoration: (id) => {
      set((state) => {
        const newDecorations = new Map(state.decorations);
        newDecorations.delete(id);
        return { decorations: newDecorations };
      });
    },

    updateDecoration: (id, updates) => {
      set((state) => {
        const existing = state.decorations.get(id);
        if (!existing) return state;

        const newDecorations = new Map(state.decorations);
        newDecorations.set(id, { ...existing, ...updates });
        return { decorations: newDecorations };
      });
    },

    clearDecorations: () => {
      set({ decorations: new Map() });
    },

    getDecorations: () => {
      const { decorations } = get();
      return Array.from(decorations.values());
    },

    getDecorationsInRange: (range) => {
      const { decorations } = get();
      return Array.from(decorations.values()).filter((decoration) =>
        rangesOverlap(decoration.range, range),
      );
    },

    getDecorationsAtPosition: (position) => {
      const { decorations } = get();
      return Array.from(decorations.values()).filter((decoration) =>
        isPositionInRange(position, decoration.range),
      );
    },

    getDecorationsForLine: (lineNumber) => {
      const { decorations } = get();
      return Array.from(decorations.values()).filter(
        (decoration) =>
          decoration.range.start.line <= lineNumber && decoration.range.end.line >= lineNumber,
      );
    },
  }),
  isEqual,
);
