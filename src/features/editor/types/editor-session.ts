import type { Position, Range } from "./editor";

export interface PersistedEditorViewState {
  cursor?: Position;
  selection?: Range;
  scrollTop?: number;
  scrollLeft?: number;
  collapsedFoldLines?: number[];
}
