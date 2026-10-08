export function insertSortedLimited<T>(
  items: T[],
  candidate: T,
  compare: (left: T, right: T) => number,
  limit: number,
) {
  if (limit <= 0) return;

  let low = 0;
  let high = items.length;
  while (low < high) {
    const midpoint = (low + high) >> 1;
    if (compare(candidate, items[midpoint]) < 0) high = midpoint;
    else low = midpoint + 1;
  }

  if (low >= limit && items.length >= limit) return;

  items.splice(low, 0, candidate);
  if (items.length > limit) items.pop();
}
