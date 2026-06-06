import type { ReactNode } from "react";

export type HeaderItem<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

export function orderHeaderItems<T extends string>(items: Array<HeaderItem<T>>, orderedIds: T[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is HeaderItem<T> => Boolean(item));
  const missingItems = items.filter((item) => !orderedIds.includes(item.id));
  return [...orderedItems, ...missingItems];
}

export function placeHeaderItemsBeforeAccount<T extends string>(items: Array<HeaderItem<T>>) {
  const accountIndex = items.findIndex((item) => item.id === "account");
  if (accountIndex < 0) return items;

  const nextItems = [...items];
  for (const id of ["ai-chat"] as const) {
    const itemIndex = nextItems.findIndex((item) => item.id === id);
    const nextAccountIndex = nextItems.findIndex((item) => item.id === "account");
    if (itemIndex < 0 || nextAccountIndex < 0 || itemIndex === nextAccountIndex - 1) {
      continue;
    }

    const [item] = nextItems.splice(itemIndex, 1);
    const insertionIndex = nextItems.findIndex((candidate) => candidate.id === "account");
    nextItems.splice(insertionIndex, 0, item);
  }

  return nextItems;
}
