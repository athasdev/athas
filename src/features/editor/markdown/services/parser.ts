import DOMPurify from "dompurify";
import {
  renderMarkdown,
  type MarkdownBlock,
  type ParseMarkdownOptions,
  type UnsanitizedMarkdown,
} from "../render-markdown";

export type { ParseMarkdownOptions };

function joinBlock(block: MarkdownBlock, sanitizeNested: (unit: UnsanitizedMarkdown) => string) {
  let html = "";
  for (const part of block) html += typeof part === "string" ? part : sanitizeNested(part);
  return html;
}

export function sanitizeMarkdown(markdown: UnsanitizedMarkdown): string {
  let html = "";
  for (const block of markdown.blocks) html += joinBlock(block, sanitizeMarkdown);
  return DOMPurify.sanitize(html);
}

export function parseMarkdown(content: string, options: ParseMarkdownOptions = {}): string {
  return sanitizeMarkdown(renderMarkdown(content, options));
}

/*
 * Sanitizing block by block gives the same HTML as sanitizing the whole document only when every
 * block leaves the HTML parser exactly as it found it: in body, no open elements, no formatting to
 * reconstruct, tokenizer between tags. Each block is therefore sanitized with a probe after it.
 * The probe comes back intact, in place and at the top level only when that holds: an open
 * element would wrap it, an unclosed tag, comment or raw-text element would swallow it, an open
 * table would split it, formatting would be reconstructed around it, and a `<style>` still headed
 * for the document head (the first block) is dropped. A hook records where each probe ended up,
 * including inside an element DOMPurify removes while keeping its content. Blocks after the first
 * are parsed after an empty element, which puts the parser in body the way earlier blocks did.
 *
 * Many blocks go through one DOMPurify call, each with its own numbered probe, because a call
 * costs far more than a small block. Blocks up to the first one that fails are trusted; the ones
 * after it are not, since they were parsed after a block that left the parser dirty.
 *
 * Raw HTML can open an element in one block and close it in a later one (`<details>` around
 * Markdown), so a block that leaves elements open is sanitized together with the blocks up to
 * where its tags balance, and that group is checked the same way.
 *
 * Document-wide parser state that a probe cannot see (the form pointer, frameset handling,
 * `</body>`, a doctype switching quirks mode) is excluded by refusing blocks that mention it.
 * Whenever a block cannot be placed, the whole document is sanitized at once as before.
 */
const BLOCK_PREFIX = "<remove></remove>";
const BLOCK_PROBE_ATTRIBUTE = "data-athas-block-end";
const DOCUMENT_STATE_PATTERN = /<(?:!doctype|\/?(?:body|form|frameset|html)(?=[\s/>]|$))/i;
/** Markup that names the probe attribute could pose as a probe, so its block is refused. */
const PROBE_ATTRIBUTE_PATTERN = /data-athas-block-end/i;
/** Most blocks sanitized together (an HTML element spanning several) before giving up. */
const BLOCK_GROUP_LIMIT = 256;
/** Failed tries for one group before the document is sanitized whole, so damage stays linear. */
const BLOCK_GROUP_ATTEMPTS = 4;
/** Blocks per DOMPurify call when many are new, and failed calls before the rest go one by one. */
const BLOCK_BATCH_SIZE = 256;
const BLOCK_BATCH_FAILURES = 8;
const BLOCK_BATCH_MINIMUM = 4;
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const TAG_PATTERN = /<(\/?)([a-z][^\s/>]*)[^>]*?(\/?)>/gi;
const MIN_CACHE_ENTRIES = 256;

/**
 * `<style>` is dropped while the parser is still before the body, goes into an open table, and
 * stays inside open SVG or MathML, so the pair only comes back intact in body. `<abbr>` is a
 * plain element that breaks out of nothing, so anything left open wraps it.
 */
const blockProbe = (id: string) => `<style></style><abbr ${BLOCK_PROBE_ATTRIBUTE}="${id}"></abbr>`;

/** A value no document can guess, so only this call's probes are matched. */
function createProbeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let blocksSupported: boolean | undefined;

/** Without a surviving <style> the probe cannot tell head from body, so blocks are not used. */
function supportsBlocks() {
  blocksSupported ??= DOMPurify.sanitize(BLOCK_PREFIX + blockProbe("0")) === blockProbe("0");
  return blocksSupported;
}

interface ProbePlacement {
  seen: number;
  topLevel: boolean;
  hidden: boolean;
}

/**
 * Sanitizes `raws` in one DOMPurify call, each followed by its own probe. Returns the HTML of the
 * leading blocks that left the parser clean, then null for the first block that did not; blocks
 * after that one are left out.
 */
function sanitizeBlockBatch(raws: string[], atDocumentStart: boolean): Array<string | null> {
  if (!supportsBlocks()) return [null];
  const refused = raws.findIndex(
    (raw) => DOCUMENT_STATE_PATTERN.test(raw) || PROBE_ATTRIBUTE_PATTERN.test(raw),
  );
  const batch = refused === -1 ? raws : raws.slice(0, refused);
  if (batch.length === 0) return [null];

  const nonce = createProbeNonce();
  const probeId = (index: number) => `${nonce}-${index}`;
  const probes = new Map<string, ProbePlacement>();
  const placement = (id: string | null) => {
    const key = id ?? "";
    let entry = probes.get(key);
    if (!entry) {
      entry = { seen: 0, topLevel: false, hidden: false };
      probes.set(key, entry);
    }
    return entry;
  };
  const recordProbes = (node: Node, data: { tagName: string; allowedTags: object }) => {
    if (!(node instanceof Element)) return;
    if (node.hasAttribute(BLOCK_PROBE_ATTRIBUTE)) {
      const entry = placement(node.getAttribute(BLOCK_PROBE_ATTRIBUTE));
      entry.seen += 1;
      entry.topLevel = node.parentNode === node.ownerDocument.body;
    }
    const allowed = (data.allowedTags as Record<string, boolean | undefined>)[data.tagName];
    if (allowed) return;
    for (const probe of node.querySelectorAll(`[${BLOCK_PROBE_ATTRIBUTE}]`)) {
      placement(probe.getAttribute(BLOCK_PROBE_ATTRIBUTE)).hidden = true;
    }
  };

  let dirty = atDocumentStart ? "" : BLOCK_PREFIX;
  batch.forEach((raw, index) => {
    dirty += raw + blockProbe(probeId(index));
  });
  DOMPurify.addHook("uponSanitizeElement", recordProbes);
  let html: string;
  try {
    html = DOMPurify.sanitize(dirty);
  } finally {
    DOMPurify.removeHook("uponSanitizeElement", recordProbes);
  }

  const results: Array<string | null> = [];
  let cursor = 0;
  for (let index = 0; index < batch.length; index++) {
    const probe = blockProbe(probeId(index));
    const at = html.indexOf(probe, cursor);
    const entry = probes.get(probeId(index));
    const isLast = index === batch.length - 1;
    if (
      at === -1 ||
      !entry ||
      entry.seen !== 1 ||
      !entry.topLevel ||
      entry.hidden ||
      (isLast && at + probe.length !== html.length)
    ) {
      results.push(null);
      return results;
    }
    results.push(html.slice(cursor, at));
    cursor = at + probe.length;
  }
  if (refused !== -1) results.push(null);
  return results;
}

/**
 * Sanitized blocks of one preview, keyed by their raw HTML, so an edit re-sanitizes only the
 * blocks it changed. A null entry records a block that cannot be sanitized on its own.
 */
export class MarkdownSanitizeCache {
  private readonly entries = new Map<string, string | null>();
  private readonly documentStartEntries = new Map<string, string | null>();
  private used = 0;

  /** A block already known to sanitize on its own, without counting it as used. */
  peek(raw: string, atDocumentStart: boolean): string | undefined {
    const entries = atDocumentStart ? this.documentStartEntries : this.entries;
    return entries.get(raw) ?? undefined;
  }

  sanitize(raw: string, atDocumentStart: boolean): string | null {
    const entries = atDocumentStart ? this.documentStartEntries : this.entries;
    this.used += 1;
    const cached = entries.get(raw);
    if (cached !== undefined) {
      entries.delete(raw);
      entries.set(raw, cached);
      return cached;
    }
    const [html] = sanitizeBlockBatch([raw], atDocumentStart);
    entries.set(raw, html);
    return html;
  }

  /** Sanitizes the body blocks not cached yet, many per DOMPurify call. */
  prefetch(raws: string[]) {
    const missing = [...new Set(raws.filter((raw) => !this.entries.has(raw)))];
    // A typical edit changes a block or two; those are cheaper to place one by one.
    if (missing.length < BLOCK_BATCH_MINIMUM) return;
    let failures = 0;
    for (let start = 0; start < missing.length && failures < BLOCK_BATCH_FAILURES;) {
      const batch = missing.slice(start, start + BLOCK_BATCH_SIZE);
      const results = sanitizeBlockBatch(batch, false);
      results.forEach((html, index) => this.entries.set(batch[index], html));
      start += results.length;
      if (results[results.length - 1] === null) failures += 1;
    }
  }

  /** Keeps about twice the blocks the last document used, dropping the least recently used. */
  trim() {
    const limit = Math.max(MIN_CACHE_ENTRIES, this.used * 2);
    this.used = 0;
    for (const entries of [this.entries, this.documentStartEntries]) {
      for (const key of entries.keys()) {
        if (entries.size <= limit) break;
        entries.delete(key);
      }
    }
  }

  clear() {
    this.entries.clear();
    this.documentStartEntries.clear();
    this.used = 0;
  }
}

/** One preview's sanitize cache, emptied whenever the preview shows another source. */
export class SourceSanitizeCache {
  private readonly cache = new MarkdownSanitizeCache();
  private sourceKey: string | undefined;

  forSource(sourceKey: string | undefined) {
    if (sourceKey !== this.sourceKey) {
      this.cache.clear();
      this.sourceKey = sourceKey;
    }
    return this.cache;
  }
}

/** How many more elements a block opens than it closes, counting tags roughly. */
function openElementBalance(raw: string) {
  if (!raw.includes("<")) return 0;
  let balance = 0;
  for (const [, closing, name, selfClosing] of raw.matchAll(TAG_PATTERN)) {
    if (selfClosing || VOID_ELEMENTS.has(name.toLowerCase())) continue;
    balance += closing ? -1 : 1;
  }
  return balance;
}

/** Sanitizes the block at `start`, joined with the blocks after it until its tags balance. */
function sanitizeGroup(
  raws: string[],
  start: number,
  atDocumentStart: boolean,
  cache: MarkdownSanitizeCache,
): { html: string; next: number } | null {
  const cached = cache.peek(raws[start], atDocumentStart);
  if (cached !== undefined) {
    cache.sanitize(raws[start], atDocumentStart);
    return { html: cached, next: start + 1 };
  }
  let balance = 0;
  let attempts = 0;
  const limit = Math.min(raws.length, start + BLOCK_GROUP_LIMIT);
  for (let end = start; end < limit && attempts < BLOCK_GROUP_ATTEMPTS; end++) {
    balance += openElementBalance(raws[end]);
    // The count is rough (`Vec<T>` in prose reads as an open tag), so a block is always tried
    // alone first; groups are tried only where the count balances.
    if (balance > 0 && end > start) continue;
    const html = cache.sanitize(raws.slice(start, end + 1).join(""), atDocumentStart);
    if (html !== null) return { html, next: end + 1 };
    attempts += 1;
  }
  return null;
}

function sanitizeBlocksWithCache(
  markdown: UnsanitizedMarkdown,
  cache: MarkdownSanitizeCache,
): string[] {
  const nested = (unit: UnsanitizedMarkdown) => sanitizeBlocksWithCache(unit, cache).join("");
  const raws = markdown.blocks.map((block) => joinBlock(block, nested));
  const html = raws.join("");
  // DOMPurify returns markup-free input untouched.
  if (!html.includes("<")) return html ? [html] : [];
  cache.prefetch(raws.slice(1));

  const blocks: string[] = [];
  for (let next = 0; next < raws.length;) {
    const group = sanitizeGroup(raws, next, next === 0, cache);
    if (!group) return [DOMPurify.sanitize(html)];
    blocks.push(group.html);
    next = group.next;
  }
  return blocks;
}

/**
 * The sanitized document as top-level blocks, reusing the cache for blocks that did not change.
 * Joined, the blocks equal `sanitizeMarkdown(markdown)`. When some block cannot be sanitized on its
 * own the whole document comes back as one block.
 */
export function sanitizeMarkdownBlocks(
  markdown: UnsanitizedMarkdown,
  cache: MarkdownSanitizeCache,
): string[] {
  const blocks = sanitizeBlocksWithCache(markdown, cache);
  cache.trim();
  return blocks;
}

export function parseMarkdownBlocks(
  content: string,
  options: ParseMarkdownOptions,
  cache: MarkdownSanitizeCache,
): string[] {
  return sanitizeMarkdownBlocks(renderMarkdown(content, options), cache);
}
