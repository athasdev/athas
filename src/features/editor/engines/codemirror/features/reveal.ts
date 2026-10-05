import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Centers the range from `from` to `to` (plus `extraBottom` pixels drawn under it) when any of
 * it lies outside the visible part of the editor, and leaves the scroll position alone otherwise.
 */
export function revealRangeInCenterIfOutside(
  view: EditorView,
  from: number,
  to = from,
  extraBottom = 0,
) {
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const top = view.documentTop + view.lineBlockAt(from).top;
  const bottom = view.documentTop + view.lineBlockAt(to).bottom + extraBottom;
  const visible = scrollRect.height > 0 && top >= scrollRect.top && bottom <= scrollRect.bottom;
  if (visible) return;
  view.dispatch({
    effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: "center" }),
  });
}
