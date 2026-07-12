import type { ReactNode } from "react";

export type ChromeItem<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

export function orderChromeItems<T extends string>(
  items: Array<ChromeItem<T>>,
  orderedIds: readonly T[],
) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is ChromeItem<T> => Boolean(item));
  const orderedIdSet = new Set(orderedIds);
  const missingItems = items.filter((item) => !orderedIdSet.has(item.id));
  return [...orderedItems, ...missingItems];
}
