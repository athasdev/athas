import { MIN_PANE_SIZE } from "../constants/pane";

export function getPaneResizeLimits(sizes: [number, number]) {
  const total = sizes[0] + sizes[1];
  const min = Math.min(MIN_PANE_SIZE, total * 0.1);
  return { min, max: total - min, total };
}

export function resizePanePair(sizes: [number, number], delta: number): [number, number] {
  const { min, max, total } = getPaneResizeLimits(sizes);
  const first = Math.max(min, Math.min(max, sizes[0] + delta));
  return [first, total - first];
}

export function resizePanePairByPixels(
  sizes: [number, number],
  delta: number,
  containerSize: number,
): [number, number] {
  return containerSize > 0 ? resizePanePair(sizes, (delta / containerSize) * 100) : sizes;
}
