interface RenderedBlock {
  html: string;
  nodes: ChildNode[];
}

const renderedBlocks = new WeakMap<HTMLElement, RenderedBlock[]>();

/** How far ahead an unchanged block is looked for among the replaced ones. */
const REUSE_LOOKAHEAD = 16;

function createBlock(html: string): RenderedBlock {
  const parser = document.createElement("div");
  parser.innerHTML = html;
  return { html, nodes: [...parser.childNodes] };
}

function removeBlock(block: RenderedBlock) {
  for (const node of block.nodes) node.remove();
}

function firstNodeFrom(blocks: RenderedBlock[], index: number, fallback: ChildNode | null) {
  for (let cursor = index; cursor < blocks.length; cursor++) {
    if (blocks[cursor].nodes.length > 0) return blocks[cursor].nodes[0];
  }
  return fallback;
}

/**
 * Shows sanitized HTML blocks in `container`, replacing only the blocks whose HTML changed since
 * the last call. Unchanged blocks keep their DOM nodes, so selection, focus, scroll position and
 * loaded images in them survive an edit elsewhere in the document.
 */
export function renderMarkdownBlocks(container: HTMLElement, blocks: readonly string[]) {
  let previous = renderedBlocks.get(container);
  // Anything else that rewrote the container makes the recorded blocks unusable; start over.
  const intact = previous?.every((block) =>
    block.nodes.every((node) => node.parentNode === container),
  );
  if (!previous || !intact) {
    container.replaceChildren();
    previous = [];
  }

  let head = 0;
  while (head < previous.length && head < blocks.length && previous[head].html === blocks[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < previous.length - head &&
    tail < blocks.length - head &&
    previous[previous.length - 1 - tail].html === blocks[blocks.length - 1 - tail]
  ) {
    tail++;
  }

  const replaced = previous.slice(head, previous.length - tail);
  const tailBlocks = previous.slice(previous.length - tail);
  const end = firstNodeFrom(tailBlocks, 0, null);
  const middle: RenderedBlock[] = [];
  let cursor = 0;

  for (const html of blocks.slice(head, blocks.length - tail)) {
    const limit = Math.min(replaced.length, cursor + REUSE_LOOKAHEAD);
    let match = -1;
    for (let index = cursor; index < limit; index++) {
      if (replaced[index].html === html) {
        match = index;
        break;
      }
    }
    if (match !== -1) {
      for (let index = cursor; index < match; index++) removeBlock(replaced[index]);
      middle.push(replaced[match]);
      cursor = match + 1;
      continue;
    }
    const block = createBlock(html);
    const before = firstNodeFrom(replaced, cursor, end);
    for (const node of block.nodes) container.insertBefore(node, before);
    middle.push(block);
  }
  for (let index = cursor; index < replaced.length; index++) removeBlock(replaced[index]);

  renderedBlocks.set(container, [...previous.slice(0, head), ...middle, ...tailBlocks]);
}
