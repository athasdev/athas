export function clampCommandListIndex(index: number, itemCount: number): number {
  return Math.min(Math.max(index, 0), Math.max(itemCount - 1, 0));
}

export function moveCommandListIndex(
  index: number,
  itemCount: number,
  direction: "next" | "previous",
): number {
  const currentIndex = clampCommandListIndex(index, itemCount);
  return clampCommandListIndex(currentIndex + (direction === "next" ? 1 : -1), itemCount);
}
