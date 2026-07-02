import type { ReactNode } from "react";

export type FooterItem<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

export function orderFooterItems<T extends string>(items: Array<FooterItem<T>>, orderedIds: T[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is FooterItem<T> => Boolean(item));
  const orderedIdSet = new Set(orderedIds);
  const missingItems = items.filter((item) => !orderedIdSet.has(item.id));
  return [...orderedItems, ...missingItems];
}
