export function reorderProjectTabItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const reorderedItems = [...items];
  const [movedItem] = reorderedItems.splice(fromIndex, 1);

  if (movedItem === undefined) {
    return items;
  }

  reorderedItems.splice(toIndex, 0, movedItem);
  return reorderedItems;
}
