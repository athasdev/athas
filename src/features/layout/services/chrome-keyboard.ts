export type ChromeNavigationOrientation = "horizontal" | "vertical";

export function getChromeNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
  orientation: ChromeNavigationOrientation,
): number | null {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) return null;

  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;

  const previousKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
  const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";

  if (key === previousKey) return Math.max(0, currentIndex - 1);
  if (key === nextKey) return Math.min(itemCount - 1, currentIndex + 1);

  return null;
}
