export function highlightMarkdownPreviewMatches(html: string, query: string) {
  if (!query) return { html, matchCount: 0 };

  const container = document.createElement("div");
  container.innerHTML = html;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  let matchCount = 0;
  for (const node of textNodes) {
    const content = node.textContent ?? "";
    const matches = [...content.matchAll(pattern)];
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const start = match.index;
      fragment.append(document.createTextNode(content.slice(offset, start)));
      const marker = document.createElement("mark");
      marker.dataset.markdownSearchMatch = "";
      marker.textContent = match[0];
      fragment.append(marker);
      offset = start + match[0].length;
      matchCount++;
    }
    fragment.append(document.createTextNode(content.slice(offset)));
    node.replaceWith(fragment);
  }

  return { html: container.innerHTML, matchCount };
}

export function isEntireMarkdownPreviewSelected(
  content: HTMLElement,
  selection: Selection,
): boolean {
  if (selection.isCollapsed || selection.rangeCount !== 1) return false;

  const contentRange = document.createRange();
  contentRange.selectNodeContents(content);
  const selectedRange = selection.getRangeAt(0);
  return (
    selectedRange.compareBoundaryPoints(Range.START_TO_START, contentRange) <= 0 &&
    selectedRange.compareBoundaryPoints(Range.END_TO_END, contentRange) >= 0
  );
}
