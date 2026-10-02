export interface SubtreePreloadQueueItem {
  path: string;
  depth: number;
}

export function takeSubtreePreloadBatch(
  queue: SubtreePreloadQueueItem[],
  visited: Set<string>,
  maxDepth: number,
  remainingBudget: number,
  batchSize = 8,
): SubtreePreloadQueueItem[] {
  const batch: SubtreePreloadQueueItem[] = [];
  const limit = Math.min(batchSize, Math.max(0, remainingBudget));

  while (queue.length > 0 && batch.length < limit) {
    const item = queue.shift();
    if (!item || visited.has(item.path) || item.depth >= maxDepth) continue;
    visited.add(item.path);
    batch.push(item);
  }

  return batch;
}
