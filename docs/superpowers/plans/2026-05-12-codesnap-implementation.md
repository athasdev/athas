# CodeSnap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CodeSnap-style "screenshot of selected code" feature inside Athas that opens as a dedicated editor tab, renders a styled preview, and exports to clipboard or a PNG file.

**Architecture:** Self-contained feature module at `src/features/codesnap/`. UI is pure React + Zustand; rasterization is done in the webview via `html-to-image` (PNG → `Blob`); clipboard and save use the already-installed Tauri plugins. One additive function on the existing tree-sitter worker exposes per-snippet tokenization. Zero Rust changes.

**Tech Stack:** TypeScript, React 19, Zustand, Tauri 2 (clipboard-manager, dialog, fs), `html-to-image` (new dep), tree-sitter wasm parsers (already bundled).

**Spec:** [docs/superpowers/specs/2026-05-12-codesnap-design.md](../specs/2026-05-12-codesnap-design.md)

---

## Pre-flight reading

Before starting Task 1, the implementer should scan these files (5 minutes total) to internalize the patterns the plan builds on:

- [src/features/panes/types/pane-content.ts](../../../src/features/panes/types/pane-content.ts) — how pane content types are declared.
- [src/features/panes/components/pane-container.tsx:816-942](../../../src/features/panes/components/pane-container.tsx#L816-L942) — `renderActiveBuffer`, where the new tab type plugs in.
- [src/features/settings/config/default-settings.ts](../../../src/features/settings/config/default-settings.ts) and [src/features/settings/types/settings.ts](../../../src/features/settings/types/settings.ts) — how new setting keys are added.
- [src/features/editor/lib/wasm-parser/tokenizer-worker-client.ts:68-88](../../../src/features/editor/lib/wasm-parser/tokenizer-worker-client.ts#L68-L88) and [tokenizer-worker.ts:198,328-360](../../../src/features/editor/lib/wasm-parser/tokenizer-worker.ts#L198) — the worker pattern we extend.
- [src/features/editor/context-menu/editor-context-menu-items.tsx:61-243](../../../src/features/editor/context-menu/editor-context-menu-items.tsx#L61-L243) — how a menu item is added.
- [src/features/command-palette/constants/view-actions.tsx](../../../src/features/command-palette/constants/view-actions.tsx) — the shape of a palette action.
- [src/features/image-editor/utils/image-file-utils.ts:8-42](../../../src/features/image-editor/utils/image-file-utils.ts#L8-L42) — the canonical Tauri save-to-disk idiom in this codebase.

---

## Task 1: Scaffolding & dependency

**Files:**

- Modify: `package.json` (add `html-to-image`)
- Create: `src/features/codesnap/types.ts`
- Create: `src/features/codesnap/index.ts`

- [ ] **Step 1: Add the npm dependency**

```bash
bun add html-to-image
```

Expected: `html-to-image` appears in `dependencies` in `package.json`; `bun.lockb` updates.

- [ ] **Step 2: Create the feature directory layout**

```bash
mkdir -p src/features/codesnap/{components,lib,stores,constants,lib/__tests__}
```

- [ ] **Step 3: Define core types**

Create `src/features/codesnap/types.ts`:

```ts
export type SourceSnapshot = {
  /** Exact text being rendered (selected substring or full buffer). */
  text: string;
  /** 1-based line number of the first line. Used by realLineNumbers. */
  startLine: number;
  /** 1-based line number of the last line. Used for default filenames. */
  endLine: number;
  /** Tree-sitter parser id (e.g. "rust", "typescript", "markdown"). */
  language: string;
  /** Source buffer path, or null for untitled buffers. */
  bufferPath: string | null;
};

export type CodesnapShutterAction = "copy" | "save";
export type CodesnapTarget = "container" | "window";

export type CodesnapSettings = {
  backgroundColor: string;
  containerPadding: string;
  boxShadow: string;
  roundedCorners: boolean;
  showWindowControls: boolean;
  showWindowTitle: boolean;
  showLineNumbers: boolean;
  realLineNumbers: boolean;
  transparentBackground: boolean;
  target: CodesnapTarget;
  shutterAction: CodesnapShutterAction;
  defaultWidth: number;
  pixelRatio: number;
  fontFamily: string;
  useEditorTheme: boolean;
};
```

- [ ] **Step 4: Add the barrel export**

Create `src/features/codesnap/index.ts`:

```ts
export type {
  SourceSnapshot,
  CodesnapSettings,
  CodesnapShutterAction,
  CodesnapTarget,
} from "./types";
```

- [ ] **Step 5: Sanity-check TypeScript**

Run: `bun run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lockb src/features/codesnap
git commit -m "Scaffold codesnap feature module and add html-to-image"
```

---

## Task 2: Register `CodesnapSettings` in the global settings store

**Files:**

- Modify: `src/features/settings/types/settings.ts`
- Modify: `src/features/settings/config/default-settings.ts`

- [ ] **Step 1: Add the type field**

Open `src/features/settings/types/settings.ts`. Locate the top-level `Settings` type. Add:

```ts
import type { CodesnapSettings } from "@/features/codesnap/types";

// inside Settings:
codesnap: CodesnapSettings;
```

(If the file uses a different import-alias style, match what the rest of the file does — don't introduce a new one.)

- [ ] **Step 2: Add the defaults**

Open `src/features/settings/config/default-settings.ts`. Add to the `defaultSettings` object:

```ts
codesnap: {
  backgroundColor: "linear-gradient(135deg, #ff6b9d 0%, #c44eb8 100%)",
  containerPadding: "32px",
  boxShadow: "rgba(0, 0, 0, 0.55) 0px 20px 68px",
  roundedCorners: true,
  showWindowControls: true,
  showWindowTitle: false,
  showLineNumbers: true,
  realLineNumbers: true,
  transparentBackground: false,
  target: "container",
  shutterAction: "copy",
  defaultWidth: 720,
  pixelRatio: 2,
  fontFamily: "JetBrains Mono Variable",
  useEditorTheme: true,
},
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings
git commit -m "Add codesnap settings defaults"
```

---

## Task 3: Register `"codeSnap"` as a pane content type

**Files:**

- Modify: `src/features/panes/types/pane-content.ts`

- [ ] **Step 1: Add to the `PaneContentType` union (line 16)**

```ts
export type PaneContentType =
  | "editor"
  | "terminal"
  // ...existing entries...
  | "codeSnap";
```

- [ ] **Step 2: Add the content interface**

Below the other `*Content` interfaces (model after `OnboardingContent` near line 168), add:

```ts
import type { SourceSnapshot } from "@/features/codesnap/types";

export interface CodesnapContent extends PaneContentBase {
  type: "codeSnap";
  snapshot: SourceSnapshot;
}
```

- [ ] **Step 3: Add to the `PaneContent` discriminated union (around line 177)**

```ts
export type PaneContent =
  | EditorContent
  // ...
  | CodesnapContent;
```

- [ ] **Step 4: Add to the `OpenContentSpec` union (around line 302)**

Follow the local pattern — most likely a `{ type: "codeSnap"; snapshot: SourceSnapshot }` member.

- [ ] **Step 5: Add the type guard**

Below the other guards in the same file:

```ts
export function isCodesnapContent(c: PaneContent): c is CodesnapContent {
  return c.type === "codeSnap";
}
```

- [ ] **Step 6: Verify**

Run: `bun run typecheck`
Expected: PASS. (There will be an exhaustiveness warning at `pane-container.tsx:816-942` switch — that's expected and gets fixed in Task 13.)

- [ ] **Step 7: Commit**

```bash
git add src/features/panes
git commit -m "Register codeSnap pane content type"
```

---

## Task 4: `build-token-spans` (pure function, TDD)

**Files:**

- Test: `src/features/codesnap/lib/__tests__/build-token-spans.test.ts`
- Create: `src/features/codesnap/lib/build-token-spans.ts`

The token rendering split is the most error-prone piece: line breaks, multi-byte characters, tokens that span newlines. TDD it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { buildTokenSpans } from "../build-token-spans";

type Tok = { start: number; end: number; class_name: string };

describe("buildTokenSpans", () => {
  test("splits a single-line input into one line of spans", () => {
    const text = "fn main";
    const tokens: Tok[] = [
      { start: 0, end: 2, class_name: "token-keyword" },
      { start: 2, end: 3, class_name: "token-default" },
      { start: 3, end: 7, class_name: "token-function" },
    ];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { text: "fn", className: "token-keyword" },
      { text: " ", className: "token-default" },
      { text: "main", className: "token-function" },
    ]);
  });

  test("splits on \\n into multiple lines", () => {
    const text = "a\nb\nc";
    const tokens: Tok[] = [{ start: 0, end: 5, class_name: "token-default" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(3);
    expect(lines[0][0].text).toBe("a");
    expect(lines[1][0].text).toBe("b");
    expect(lines[2][0].text).toBe("c");
  });

  test("tokens spanning a newline are split across lines while preserving className", () => {
    const text = "ab\ncd";
    const tokens: Tok[] = [{ start: 0, end: 5, class_name: "token-string" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([{ text: "ab", className: "token-string" }]);
    expect(lines[1]).toEqual([{ text: "cd", className: "token-string" }]);
  });

  test("preserves multi-byte characters (emoji) without splitting graphemes", () => {
    const text = "// 🎉 ok";
    const tokens: Tok[] = [{ start: 0, end: text.length, class_name: "token-comment" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines[0][0].text).toBe("// 🎉 ok");
  });

  test("empty input returns a single empty line", () => {
    expect(buildTokenSpans("", [])).toEqual([[]]);
  });

  test("trailing newline produces a trailing empty line", () => {
    const text = "x\n";
    const tokens: Tok[] = [{ start: 0, end: 1, class_name: "token-default" }];
    const lines = buildTokenSpans(text, tokens);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual([]);
  });

  test("gaps in token coverage are filled with token-default", () => {
    const text = "ab cd";
    const tokens: Tok[] = [
      { start: 0, end: 2, class_name: "token-keyword" },
      { start: 3, end: 5, class_name: "token-function" },
    ];
    const lines = buildTokenSpans(text, tokens);
    expect(lines[0]).toEqual([
      { text: "ab", className: "token-keyword" },
      { text: " ", className: "token-default" },
      { text: "cd", className: "token-function" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bunx vp test run src/features/codesnap/lib/__tests__/build-token-spans.test.ts`
Expected: FAIL — `buildTokenSpans` is not defined.

- [ ] **Step 3: Implement**

Create `src/features/codesnap/lib/build-token-spans.ts`:

```ts
export type TokenLike = { start: number; end: number; class_name: string };
export type Span = { text: string; className: string };
export type Line = Span[];

const DEFAULT_CLASS = "token-default";

/**
 * Convert a `text` + a sorted, non-overlapping `tokens` array into an array of
 * lines, each line an array of styled spans. Gaps in token coverage are filled
 * with `token-default`. Token boundaries that straddle newlines are split.
 */
export function buildTokenSpans(text: string, tokens: TokenLike[]): Line[] {
  if (text.length === 0) return [[]];

  // Normalize: produce a list of spans that covers [0, text.length) end-to-end,
  // filling gaps with the default class.
  const covered: TokenLike[] = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start > cursor) {
      covered.push({ start: cursor, end: t.start, class_name: DEFAULT_CLASS });
    }
    covered.push(t);
    cursor = t.end;
  }
  if (cursor < text.length) {
    covered.push({ start: cursor, end: text.length, class_name: DEFAULT_CLASS });
  }

  // Split spans across newlines and group into lines.
  const lines: Line[] = [[]];
  for (const span of covered) {
    let i = span.start;
    while (i < span.end) {
      const newlineIdx = text.indexOf("\n", i);
      const stop = newlineIdx === -1 || newlineIdx >= span.end ? span.end : newlineIdx;
      if (stop > i) {
        lines[lines.length - 1].push({
          text: text.slice(i, stop),
          className: span.class_name,
        });
      }
      if (stop === newlineIdx && newlineIdx < span.end) {
        lines.push([]);
        i = newlineIdx + 1;
      } else {
        i = stop;
      }
    }
  }
  return lines;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bunx vp test run src/features/codesnap/lib/__tests__/build-token-spans.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/codesnap/lib/build-token-spans.ts src/features/codesnap/lib/__tests__/build-token-spans.test.ts
git commit -m "Add buildTokenSpans token-to-line renderer with tests"
```

---

## Task 5: `build-default-filename` (pure function, TDD)

**Files:**

- Test: `src/features/codesnap/lib/__tests__/build-default-filename.test.ts`
- Create: `src/features/codesnap/lib/build-default-filename.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { buildDefaultFilename } from "../build-default-filename";

describe("buildDefaultFilename", () => {
  test("with path: produces basename-L{start}-L{end}.png", () => {
    expect(
      buildDefaultFilename({ bufferPath: "/a/b/staging.rs", startLine: 42, endLine: 48 } as any),
    ).toBe("staging-rs-L42-L48.png");
  });

  test("dotted filenames have all dots replaced", () => {
    expect(
      buildDefaultFilename({ bufferPath: "/a/my.config.ts", startLine: 1, endLine: 10 } as any),
    ).toBe("my-config-ts-L1-L10.png");
  });

  test("Windows path separators are honored", () => {
    expect(
      buildDefaultFilename({
        bufferPath: "C:\\\\a\\\\b\\\\file.rs",
        startLine: 1,
        endLine: 2,
      } as any),
    ).toBe("file-rs-L1-L2.png");
  });

  test("no path uses codesnap-{ts}.png", () => {
    const out = buildDefaultFilename(
      { bufferPath: null, startLine: 1, endLine: 1 } as any,
      () => 1700000000000,
    );
    expect(out).toBe("codesnap-1700000000000.png");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bunx vp test run src/features/codesnap/lib/__tests__/build-default-filename.test.ts`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement**

Create `src/features/codesnap/lib/build-default-filename.ts`:

```ts
import type { SourceSnapshot } from "../types";

export function buildDefaultFilename(
  snapshot: SourceSnapshot,
  now: () => number = Date.now,
): string {
  if (!snapshot.bufferPath) {
    return `codesnap-${now()}.png`;
  }
  // Strip directory portion (Unix or Windows separator).
  const segments = snapshot.bufferPath.split(/[/\\]/);
  const base = segments[segments.length - 1] ?? "file";
  const safe = base.replace(/\./g, "-");
  return `${safe}-L${snapshot.startLine}-L${snapshot.endLine}.png`;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bunx vp test run src/features/codesnap/lib/__tests__/build-default-filename.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/codesnap/lib/build-default-filename.ts src/features/codesnap/lib/__tests__/build-default-filename.test.ts
git commit -m "Add buildDefaultFilename helper with tests"
```

---

## Task 6: `snapshot-from-selection` (pure function, TDD)

**Files:**

- Test: `src/features/codesnap/lib/__tests__/snapshot-from-selection.test.ts`
- Create: `src/features/codesnap/lib/snapshot-from-selection.ts`

- [ ] **Step 1: Inspect the editor state types**

Open [src/features/editor/types/editor.ts](../../../src/features/editor/types/editor.ts) and [src/features/editor/stores/buffer-store.ts](../../../src/features/editor/stores/buffer-store.ts). Confirm the exact field names for: selection range (`{ start: Position; end: Position }`), buffer (`content`, `path`, `language`).

Write the function as a **pure helper that takes a minimal interface**, so it's trivially testable without mocking the entire stores:

```ts
type SelectionInput = {
  start: { line: number; column: number };
  end: { line: number; column: number };
} | null;
type BufferInput = { content: string; path: string | null; language: string } | null;
```

- [ ] **Step 2: Write failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { buildSnapshotFromSelection } from "../snapshot-from-selection";

const buf = (content: string, path: string | null = "/a/x.ts", language = "typescript") => ({
  content,
  path,
  language,
});
const sel = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, column: sc },
  end: { line: el, column: ec },
});

describe("buildSnapshotFromSelection", () => {
  test("returns null when there is no buffer", () => {
    expect(buildSnapshotFromSelection(sel(0, 0, 0, 0), null)).toBeNull();
  });

  test("non-empty selection produces snapshot of the selected substring", () => {
    const b = buf("abc\ndef\nghi");
    const out = buildSnapshotFromSelection(sel(0, 1, 1, 2), b)!;
    expect(out.text).toBe("bc\nde");
    expect(out.startLine).toBe(1); // 1-based
    expect(out.endLine).toBe(2);
    expect(out.language).toBe("typescript");
    expect(out.bufferPath).toBe("/a/x.ts");
  });

  test("empty/zero-width selection falls back to the active line", () => {
    const b = buf("first\nSECOND\nthird");
    const out = buildSnapshotFromSelection(sel(1, 3, 1, 3), b)!;
    expect(out.text).toBe("SECOND");
    expect(out.startLine).toBe(2);
    expect(out.endLine).toBe(2);
  });

  test("null selection falls back to the active line at line 0", () => {
    const b = buf("abc\ndef");
    const out = buildSnapshotFromSelection(null, b)!;
    expect(out.text).toBe("abc");
    expect(out.startLine).toBe(1);
    expect(out.endLine).toBe(1);
  });

  test("untitled buffer (null path) preserves null in snapshot", () => {
    const out = buildSnapshotFromSelection(sel(0, 0, 0, 3), buf("abcd", null))!;
    expect(out.bufferPath).toBeNull();
  });

  test("buildSnapshotFromBuffer returns the whole buffer", () => {
    // Tested via a separate import to keep this concern explicit.
    // We'll add the second export in the implementation.
  });
});

describe("buildSnapshotFromBuffer", () => {
  test("returns snapshot spanning the entire buffer", async () => {
    const { buildSnapshotFromBuffer } = await import("../snapshot-from-selection");
    const out = buildSnapshotFromBuffer(buf("a\nb\nc"))!;
    expect(out.text).toBe("a\nb\nc");
    expect(out.startLine).toBe(1);
    expect(out.endLine).toBe(3);
  });

  test("returns null for null buffer", async () => {
    const { buildSnapshotFromBuffer } = await import("../snapshot-from-selection");
    expect(buildSnapshotFromBuffer(null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `bunx vp test run src/features/codesnap/lib/__tests__/snapshot-from-selection.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 4: Implement**

Create `src/features/codesnap/lib/snapshot-from-selection.ts`:

```ts
import type { SourceSnapshot } from "../types";

type Position = { line: number; column: number };
type SelectionInput = { start: Position; end: Position } | null;
type BufferInput = { content: string; path: string | null; language: string } | null;

function offsetFor(content: string, pos: Position): number {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for the newline
  }
  return offset + Math.min(pos.column, (lines[pos.line] ?? "").length);
}

export function buildSnapshotFromSelection(
  selection: SelectionInput,
  buffer: BufferInput,
): SourceSnapshot | null {
  if (!buffer) return null;

  // Treat null or zero-width selections as "active line".
  const isEmpty =
    !selection ||
    (selection.start.line === selection.end.line &&
      selection.start.column === selection.end.column);

  if (isEmpty) {
    const line = selection?.start.line ?? 0;
    const lines = buffer.content.split("\n");
    const text = lines[line] ?? "";
    return {
      text,
      startLine: line + 1,
      endLine: line + 1,
      language: buffer.language,
      bufferPath: buffer.path,
    };
  }

  const startOffset = offsetFor(buffer.content, selection!.start);
  const endOffset = offsetFor(buffer.content, selection!.end);
  return {
    text: buffer.content.slice(startOffset, endOffset),
    startLine: selection!.start.line + 1,
    endLine: selection!.end.line + 1,
    language: buffer.language,
    bufferPath: buffer.path,
  };
}

export function buildSnapshotFromBuffer(buffer: BufferInput): SourceSnapshot | null {
  if (!buffer) return null;
  const lines = buffer.content.split("\n");
  return {
    text: buffer.content,
    startLine: 1,
    endLine: lines.length,
    language: buffer.language,
    bufferPath: buffer.path,
  };
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `bunx vp test run src/features/codesnap/lib/__tests__/snapshot-from-selection.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/codesnap/lib/snapshot-from-selection.ts src/features/codesnap/lib/__tests__/snapshot-from-selection.test.ts
git commit -m "Add buildSnapshotFromSelection and buildSnapshotFromBuffer with tests"
```

---

## Task 7: `codesnap-store` (Zustand)

**Files:**

- Create: `src/features/codesnap/stores/codesnap-store.ts`

The store holds per-tab UI state (current width, exporting flag, and ephemeral shutter-action override) keyed by tab id, so multiple CodeSnap tabs can coexist.

- [ ] **Step 1: Implement**

Create `src/features/codesnap/stores/codesnap-store.ts`:

```ts
import { create } from "zustand";
import type { CodesnapShutterAction } from "../types";

type TabUiState = {
  width: number;
  shutterAction: CodesnapShutterAction;
  exporting: boolean;
};

type CodesnapStore = {
  tabs: Record<string, TabUiState>;
  ensure: (tabId: string, initial: { width: number; shutterAction: CodesnapShutterAction }) => void;
  setWidth: (tabId: string, width: number) => void;
  setShutterAction: (tabId: string, action: CodesnapShutterAction) => void;
  setExporting: (tabId: string, exporting: boolean) => void;
  drop: (tabId: string) => void;
};

export const useCodesnapStore = create<CodesnapStore>((set) => ({
  tabs: {},
  ensure: (tabId, initial) =>
    set((s) =>
      s.tabs[tabId] ? s : { tabs: { ...s.tabs, [tabId]: { ...initial, exporting: false } } },
    ),
  setWidth: (tabId, width) =>
    set((s) => (s.tabs[tabId] ? { tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], width } } } : s)),
  setShutterAction: (tabId, shutterAction) =>
    set((s) =>
      s.tabs[tabId] ? { tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], shutterAction } } } : s,
    ),
  setExporting: (tabId, exporting) =>
    set((s) =>
      s.tabs[tabId] ? { tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], exporting } } } : s,
    ),
  drop: (tabId) =>
    set((s) => {
      const next = { ...s.tabs };
      delete next[tabId];
      return { tabs: next };
    }),
}));
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/codesnap/stores
git commit -m "Add codesnap zustand store for per-tab UI state"
```

---

## Task 8: Extend the tokenizer worker with `tokenizeSnippet`

**Files:**

- Modify: `src/features/editor/lib/wasm-parser/worker-protocol.ts`
- Modify: `src/features/editor/lib/wasm-parser/tokenizer-worker.ts`
- Modify: `src/features/editor/lib/wasm-parser/tokenizer-worker-client.ts`

This is the only change outside `src/features/codesnap/`. It adds a stateless tokenization entry point — no buffer, no viewport.

- [ ] **Step 1: Add the new message types in worker-protocol.ts**

Append to the `TokenizerWorkerRequest` union:

```ts
| { type: "tokenizeSnippet"; id: number; snippet: string; languageId: string };
```

And to the `TokenizerWorkerResponse` union (if it's distinct):

```ts
| { type: "tokenizeSnippet"; id: number; tokens: Token[] };
```

- [ ] **Step 2: Add the handler in the worker**

In `tokenizer-worker.ts`, model after `handleTokenize` (around line 198). Add:

```ts
async function handleTokenizeSnippet(snippet: string, languageId: string): Promise<Token[]> {
  const parser = await ensureParserForLanguage(languageId); // existing helper
  if (!parser) return [{ start: 0, end: snippet.length, class_name: "token-default" }];
  const tree = parser.parse(snippet);
  return tokensFromTree(tree, snippet, languageId); // reuse existing token-extraction
}
```

The exact helper names will follow what's already in the file — adapt to local conventions; the goal is **reuse, not reimplement, the capture-map logic**.

Extend the switch around lines 328–360:

```ts
case "tokenizeSnippet": {
  const tokens = await handleTokenizeSnippet(msg.snippet, msg.languageId);
  self.postMessage({ type: "tokenizeSnippet", id: msg.id, tokens });
  break;
}
```

- [ ] **Step 3: Add the client method**

In `tokenizer-worker-client.ts`, model after `tokenize` (lines 68–88). Add:

```ts
async tokenizeSnippet(snippet: string, languageId: string): Promise<Token[]> {
  const id = this.nextId++;
  return new Promise<Token[]>((resolve, reject) => {
    this.pending.set(id, { resolve: resolve as any, reject });
    this.worker.postMessage({ type: "tokenizeSnippet", id, snippet, languageId });
  });
}
```

(Match the actual `pending`/`nextId` machinery already in the file — don't introduce a parallel one.)

In the worker `onmessage` dispatch in this file, ensure the `tokenizeSnippet` response is routed to the same pending-promise resolution path as `tokenize`.

- [ ] **Step 4: Manual smoke**

Run: `bun run dev`
In the dev console (Tauri devtools), execute:

```js
const { tokenizerWorkerClient } =
  await import("/src/features/editor/lib/wasm-parser/tokenizer-worker-client.ts");
console.log(await tokenizerWorkerClient.tokenizeSnippet("fn main() {}", "rust"));
```

Expected: an array of `{ start, end, class_name }` tokens, with `token-keyword` covering "fn".

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/lib/wasm-parser
git commit -m "Add tokenizeSnippet for stateless tree-sitter tokenization"
```

---

## Task 9: `font-embed` (memoized fontEmbedCSS)

**Files:**

- Create: `src/features/codesnap/lib/font-embed.ts`

- [ ] **Step 1: Locate the bundled JetBrains Mono woff2**

The font ships via `@fontsource-variable/jetbrains-mono`. Confirm the file path:

```bash
ls node_modules/@fontsource-variable/jetbrains-mono/files/ | head
```

Expected: woff2 files like `jetbrains-mono-latin-wght-normal.woff2`.

- [ ] **Step 2: Implement**

Create `src/features/codesnap/lib/font-embed.ts`:

```ts
// We inline JetBrains Mono Variable so html-to-image's foreignObject can use it.
// The font is loaded via `fetch` against the URL Vite produces at build time.
//
// `?url` tells Vite to give us the asset URL (not import the file's contents).
// @ts-ignore – Vite asset-url import
import fontUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";

let cached: string | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  // btoa() needs a string of bytes; build it without bloating the stack.
  let binary = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

export async function getEmbeddedFontCss(): Promise<string> {
  if (cached !== null) return cached;
  const base64 = await fetchAsBase64(fontUrl);
  cached = `
@font-face {
  font-family: 'JetBrains Mono Variable';
  font-weight: 100 800;
  font-style: normal;
  src: url(data:font/woff2;base64,${base64}) format('woff2');
}
`;
  return cached;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS. (If the `?url` import errors, check whether the project already imports assets that way and use the matching pattern.)

- [ ] **Step 4: Commit**

```bash
git add src/features/codesnap/lib/font-embed.ts
git commit -m "Add memoized JetBrains Mono fontEmbedCSS for html-to-image"
```

---

## Task 10: `render-png`

**Files:**

- Create: `src/features/codesnap/lib/render-png.ts`

- [ ] **Step 1: Implement**

```ts
import { toBlob } from "html-to-image";
import { getEmbeddedFontCss } from "./font-embed";

export async function renderPng(node: HTMLElement, pixelRatio: number): Promise<Blob> {
  const fontEmbedCSS = await getEmbeddedFontCss();
  const blob = await toBlob(node, {
    pixelRatio,
    fontEmbedCSS,
    cacheBust: false,
    backgroundColor: undefined, // honor transparentBackground from the captured node's CSS
    style: { transform: "none" },
  });
  if (!blob) throw new Error("renderPng: html-to-image returned null");
  return blob;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/codesnap/lib/render-png.ts
git commit -m "Add renderPng html-to-image wrapper"
```

---

## Task 11: `export.ts` (clipboard + save)

**Files:**

- Create: `src/features/codesnap/lib/export.ts`

- [ ] **Step 1: Implement**

```ts
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { buildDefaultFilename } from "./build-default-filename";
import type { SourceSnapshot } from "../types";

export async function copyToClipboard(png: Blob): Promise<void> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  await writeImage(bytes);
}

export async function saveToFile(png: Blob, snapshot: SourceSnapshot): Promise<string | null> {
  const defaultPath = buildDefaultFilename(snapshot);
  const target = await save({
    defaultPath,
    filters: [{ name: "PNG Image", extensions: ["png"] }],
  });
  if (!target) return null;
  const bytes = new Uint8Array(await png.arrayBuffer());
  await writeFile(target, bytes);
  return target;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/codesnap/lib/export.ts
git commit -m "Add copyToClipboard and saveToFile export helpers"
```

---

## Task 12: `PreviewFrame` component

**Files:**

- Create: `src/features/codesnap/components/preview-frame.tsx`
- Create: `src/features/codesnap/components/preview-frame.module.css` (or use Tailwind utilities — match what the rest of the codebase does)

The capturable DOM. `forwardRef` so the parent can pass it to `renderPng`.

- [ ] **Step 1: Implement**

```tsx
import { forwardRef, useMemo } from "react";
import type { CodesnapSettings, SourceSnapshot } from "../types";
import type { Line } from "../lib/build-token-spans";

type Props = {
  snapshot: SourceSnapshot;
  settings: CodesnapSettings;
  width: number;
  lines: Line[];
};

export const PreviewFrame = forwardRef<HTMLDivElement, Props>(function PreviewFrame(
  { snapshot, settings, width, lines },
  ref,
) {
  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      width,
      padding: settings.containerPadding,
      background: settings.transparentBackground ? "transparent" : settings.backgroundColor,
      boxShadow: settings.boxShadow,
      borderRadius: settings.roundedCorners ? 12 : 0,
    }),
    [width, settings],
  );

  const windowStyle: React.CSSProperties = {
    background: "var(--codesnap-window-bg, #1a1a1a)",
    borderRadius: settings.roundedCorners ? 8 : 0,
    overflow: "hidden",
  };

  const showHeader = settings.showWindowControls || settings.showWindowTitle;

  return (
    <div ref={ref} className="codesnap-frame" style={containerStyle}>
      <div className="codesnap-window" style={windowStyle}>
        {showHeader && (
          <div className="codesnap-chrome">
            {settings.showWindowControls && (
              <div className="codesnap-dots">
                <span className="codesnap-dot codesnap-dot--red" />
                <span className="codesnap-dot codesnap-dot--yellow" />
                <span className="codesnap-dot codesnap-dot--green" />
              </div>
            )}
            {settings.showWindowTitle && (
              <div className="codesnap-title">{snapshot.bufferPath ?? "untitled"}</div>
            )}
          </div>
        )}
        <pre className="codesnap-code" style={{ fontFamily: settings.fontFamily, margin: 0 }}>
          {lines.map((line, idx) => (
            <div key={idx} className="codesnap-line">
              {settings.showLineNumbers && (
                <span className="codesnap-ln">
                  {settings.realLineNumbers ? snapshot.startLine + idx : idx + 1}
                </span>
              )}
              {line.map((span, i) => (
                <span key={i} className={span.className}>
                  {span.text}
                </span>
              ))}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
});
```

- [ ] **Step 2: Add the stylesheet (Tailwind or CSS)**

If the codebase uses Tailwind, replace `className` strings with Tailwind utilities and rely on the global token-color CSS variables. Otherwise, create `preview-frame.css` that defines `.codesnap-frame`, `.codesnap-window`, `.codesnap-chrome`, `.codesnap-dot`, `.codesnap-dot--red/yellow/green`, `.codesnap-line`, `.codesnap-ln`, `.codesnap-code`. Token classes (`.token-keyword`, etc.) reuse the editor's existing theme stylesheets — do not redefine them.

The `.codesnap-ln` must be `user-select: none`, fixed width (~3ch), right-aligned, muted color.

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/codesnap/components/preview-frame.tsx src/features/codesnap/components/preview-frame.module.css
git commit -m "Add PreviewFrame component for codesnap"
```

---

## Task 13: `WidthHandle`, `ShutterBar`, `CodesnapTab`

**Files:**

- Create: `src/features/codesnap/components/width-handle.tsx`
- Create: `src/features/codesnap/components/shutter-bar.tsx`
- Create: `src/features/codesnap/components/codesnap-tab.tsx`

- [ ] **Step 1: WidthHandle**

A small pointer-events handler. Drag right → increase width; clamp to `[200, 1600]` px.

```tsx
import { useCallback, type PointerEvent } from "react";

type Props = { width: number; onChange: (w: number) => void };

export function WidthHandle({ width, onChange }: Props) {
  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent<HTMLDivElement>) => {
        const next = Math.max(200, Math.min(1600, startWidth + (ev.clientX - startX) * 2));
        onChange(Math.round(next));
      };
      const up = () => {
        target.releasePointerCapture(e.pointerId);
        target.removeEventListener("pointermove", move as any);
        target.removeEventListener("pointerup", up as any);
      };
      target.addEventListener("pointermove", move as any);
      target.addEventListener("pointerup", up as any);
    },
    [width, onChange],
  );

  return (
    <div
      className="codesnap-width-handle"
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
```

- [ ] **Step 2: ShutterBar**

```tsx
import type { CodesnapShutterAction } from "../types";

type Props = {
  width: number;
  height: number; // measured from PreviewFrame
  action: CodesnapShutterAction;
  exporting: boolean;
  onActionChange: (a: CodesnapShutterAction) => void;
  onShutter: () => void;
  onOpenSettings: () => void;
};

export function ShutterBar({
  width,
  height,
  action,
  exporting,
  onActionChange,
  onShutter,
  onOpenSettings,
}: Props) {
  return (
    <div className="codesnap-shutter-bar">
      <span className="codesnap-readout">
        {width} × {height}
      </span>
      <div className="codesnap-divider" />
      <div className="codesnap-toggle">
        <button
          className={action === "copy" ? "active" : ""}
          onClick={() => onActionChange("copy")}
        >
          Copy
        </button>
        <button
          className={action === "save" ? "active" : ""}
          onClick={() => onActionChange("save")}
        >
          Save
        </button>
      </div>
      <button className="codesnap-shutter" onClick={onShutter} disabled={exporting}>
        {exporting ? "…" : action === "copy" ? "📷 Copy" : "📷 Save"}
      </button>
      <div className="codesnap-divider" />
      <button className="codesnap-icon-btn" title="Settings" onClick={onOpenSettings}>
        ⚙
      </button>
    </div>
  );
}
```

- [ ] **Step 3: CodesnapTab — wires everything together**

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state/store"; // or wherever openSettingsDialog lives
import { tokenizerWorkerClient } from "@/features/editor/lib/wasm-parser/tokenizer-worker-client";
import { buildTokenSpans, type Line } from "../lib/build-token-spans";
import { renderPng } from "../lib/render-png";
import { copyToClipboard, saveToFile } from "../lib/export";
import { useCodesnapStore } from "../stores/codesnap-store";
import { PreviewFrame } from "./preview-frame";
import { WidthHandle } from "./width-handle";
import { ShutterBar } from "./shutter-bar";
import type { CodesnapContent } from "@/features/panes/types/pane-content";

export function CodesnapTab({ pane }: { pane: CodesnapContent }) {
  const settings = useSettingsStore((s) => s.settings.codesnap);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [measured, setMeasured] = useState({ w: 0, h: 0 });

  const ui = useCodesnapStore();
  const tabId = pane.id;
  useEffect(() => {
    ui.ensure(tabId, { width: settings.defaultWidth, shutterAction: settings.shutterAction });
    return () => ui.drop(tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);
  const tabState = ui.tabs[tabId];
  if (!tabState) return null;

  // Tokenize on mount / when snapshot changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = await tokenizerWorkerClient
        .tokenizeSnippet(pane.snapshot.text, pane.snapshot.language)
        .catch(() => [{ start: 0, end: pane.snapshot.text.length, class_name: "token-default" }]);
      if (cancelled) return;
      setLines(buildTokenSpans(pane.snapshot.text, tokens));
    })();
    return () => {
      cancelled = true;
    };
  }, [pane.snapshot.text, pane.snapshot.language]);

  // Measure rendered frame size for the readout.
  useLayoutEffect(() => {
    if (!frameRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setMeasured({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, []);

  const runShutter = async (action: typeof tabState.shutterAction) => {
    if (!frameRef.current) return;
    ui.setExporting(tabId, true);
    try {
      const blob = await renderPng(frameRef.current, settings.pixelRatio);
      if (action === "copy") {
        await copyToClipboard(blob);
        toast.success("Copied to clipboard");
      } else {
        const saved = await saveToFile(blob, pane.snapshot);
        if (saved) toast.success(`Saved to ${saved}`);
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Snapshot failed");
    } finally {
      ui.setExporting(tabId, false);
    }
  };

  // Keyboard shortcuts inside the tab.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "c") {
        e.preventDefault();
        runShutter("copy");
      }
      if (e.key === "s") {
        e.preventDefault();
        runShutter("save");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pane.snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSettings = () => {
    // v1: open the JSON settings file directly. Replace with section-deep-link once a codeSnap settings tab exists.
    useUIState.getState().openSettingsDialog("appearance");
  };

  return (
    <div className="codesnap-tab">
      <div className="codesnap-canvas">
        <div className="codesnap-preview-wrap" style={{ position: "relative" }}>
          <PreviewFrame
            ref={frameRef}
            snapshot={pane.snapshot}
            settings={settings}
            width={tabState.width}
            lines={lines}
          />
          <WidthHandle width={tabState.width} onChange={(w) => ui.setWidth(tabId, w)} />
        </div>
        <ShutterBar
          width={measured.w}
          height={measured.h}
          action={tabState.shutterAction}
          exporting={tabState.exporting}
          onActionChange={(a) => ui.setShutterAction(tabId, a)}
          onShutter={() => runShutter(tabState.shutterAction)}
          onOpenSettings={openSettings}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS. (Reconcile imports against the actual store/locator names in the repo.)

- [ ] **Step 5: Commit**

```bash
git add src/features/codesnap/components
git commit -m "Add WidthHandle, ShutterBar, and CodesnapTab"
```

---

## Task 14: Wire pane renderer dispatch

**Files:**

- Modify: `src/features/panes/components/pane-container.tsx` (around lines 816–942 in `renderActiveBuffer`)

- [ ] **Step 1: Add the case**

Find the `switch` (or sequence of `if`s) in `renderActiveBuffer`. Insert before the `default` (around line 928):

```tsx
case "codeSnap":
  return <CodesnapTab pane={pane} />;
```

Add the import at the top:

```ts
import { CodesnapTab } from "@/features/codesnap/components/codesnap-tab";
```

- [ ] **Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS. Discriminated-union exhaustiveness is satisfied.

- [ ] **Step 3: Manual smoke (no triggers yet)**

In Tauri devtools, dispatch a synthetic open via whatever helper Athas already uses for `openContent`. Example:

```js
const { useBufferStore } = await import("/src/features/editor/stores/buffer-store.ts");
// Or wherever openContent lives — adjust to the actual API.
openContent({
  type: "codeSnap",
  snapshot: { text: "fn main(){}", startLine: 1, endLine: 1, language: "rust", bufferPath: null },
});
```

Expected: a new tab opens; preview frame renders the gradient + the four-character "main" code; width handle is visible.

- [ ] **Step 4: Commit**

```bash
git add src/features/panes/components/pane-container.tsx
git commit -m "Render CodesnapTab for codeSnap pane content"
```

---

## Task 15: Command palette actions

**Files:**

- Create: `src/features/command-palette/constants/codesnap-actions.tsx`
- Modify: the file that aggregates all action arrays (look for `view-actions.tsx` siblings — there is likely an `index.ts` that flattens them)

- [ ] **Step 1: Implement the actions**

```tsx
import { Camera, CameraPlus } from "lucide-react"; // or whatever icon library Athas uses
import type { Action } from "../models/action.types";
import { useStateStore } from "@/features/editor/stores/state-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import {
  buildSnapshotFromSelection,
  buildSnapshotFromBuffer,
} from "@/features/codesnap/lib/snapshot-from-selection";
import { openContent } from "@/features/panes/.../open-content"; // wherever this lives

function activeBuffer() {
  const { buffers, activeBufferId } = useBufferStore.getState();
  return buffers.find((b) => b.id === activeBufferId) ?? null;
}

function fromSelection() {
  const sel = useStateStore.getState().selection;
  const buf = activeBuffer();
  const snap = buildSnapshotFromSelection(sel, buf) ?? buildSnapshotFromBuffer(buf);
  if (!snap) return;
  openContent({ type: "codeSnap", snapshot: snap });
}

function fromActiveBuffer() {
  const snap = buildSnapshotFromBuffer(activeBuffer());
  if (!snap) return;
  openContent({ type: "codeSnap", snapshot: snap });
}

export const codesnapActions: Action[] = [
  {
    id: "codesnap.fromSelection",
    label: "CodeSnap: From Selection",
    description: "Open a styled screenshot of the current selection",
    icon: <Camera />,
    category: "View",
    commandId: "codesnap.fromSelection",
    action: fromSelection,
  },
  {
    id: "codesnap.fromFile",
    label: "CodeSnap: Whole File",
    description: "Open a styled screenshot of the entire active file",
    icon: <CameraPlus />,
    category: "View",
    commandId: "codesnap.fromFile",
    action: fromActiveBuffer,
  },
];
```

- [ ] **Step 2: Register the action set**

Open the action aggregator (likely [src/features/command-palette/constants/index.ts](../../../src/features/command-palette/constants/index.ts) or similar) and add `codesnapActions` to the exported list.

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Run: `bun run dev`. Open a source file, select 5 lines, open the command palette, type "CodeSnap" — both entries appear; selecting "From Selection" opens a CodeSnap tab.

- [ ] **Step 5: Commit**

```bash
git add src/features/command-palette/constants
git commit -m "Add CodeSnap command palette entries"
```

---

## Task 16: Default keybinding

**Files:**

- Modify: `src/features/keymaps/defaults/default-keymaps.ts`

- [ ] **Step 1: Verify there's no collision**

Run: `grep -n "cmd+k cmd+s" src/features/keymaps/defaults/default-keymaps.ts || echo "free"`
Expected: "free".

(If a collision exists, pick `cmd+k cmd+p` as a fallback and update both the spec and the plan.)

- [ ] **Step 2: Add the entry**

```ts
{ key: "cmd+k cmd+s", command: "codesnap.fromSelection", when: "editorFocus", source: "default" },
```

- [ ] **Step 3: Manual smoke**

Run: `bun run dev`. Focus the editor, make a selection, press `Cmd+K` then `Cmd+S`. A CodeSnap tab opens.

- [ ] **Step 4: Commit**

```bash
git add src/features/keymaps/defaults/default-keymaps.ts
git commit -m "Bind cmd+k cmd+s to codesnap.fromSelection"
```

---

## Task 17: Editor context-menu entry

**Files:**

- Modify: `src/features/editor/context-menu/editor-context-menu-items.tsx`

- [ ] **Step 1: Extend the handlers interface**

Around line 23 (`EditorContextMenuHandlers`):

```ts
onCodeSnap?: () => void;
```

- [ ] **Step 2: Add the menu item**

Inside `buildEditorContextMenuItems` (~line 86 where "Copy" is added), add adjacent to Copy:

```tsx
{
  id: "codeSnap",
  label: "CodeSnap Selection",
  icon: <Camera />,
  disabled: isDisabled(handlers.onCodeSnap, !hasSelection),
  onClick: handlers.onCodeSnap ?? noop,
},
```

- [ ] **Step 3: Provide the handler at the call site**

Find where `buildEditorContextMenuItems` is called (likely the editor view). Wire `onCodeSnap` to the same `fromSelection` function exposed by the command-palette actions — extract that function from `codesnap-actions.tsx` into `src/features/codesnap/lib/triggers.ts` if doing so avoids a circular import.

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Run: `bun run dev`. Right-click in the editor with a selection — "CodeSnap Selection" appears, enabled. Click it — a tab opens. Right-click without a selection — entry disabled.

- [ ] **Step 6: Commit**

```bash
git add src/features/editor/context-menu src/features/codesnap
git commit -m "Add CodeSnap entry to editor context menu"
```

---

## Task 18: Full manual verification

No code in this task — just run the 14-step checklist below from the spec, capture a screenshot (or note pass/fail) for each, and only mark complete when all 14 pass.

- [ ] **Step 1: Run the dev server**

Run: `bun run dev`

- [ ] **Step 2: Execute checklist**

1. Selection screenshot — rust selection → palette → tab opens with gradient + traffic lights + line numbers at the real line number.
2. Whole-file screenshot — palette → entire buffer renders.
3. Width drag — handle resizes; line numbers don't drift; readout updates.
4. Copy — toast → paste into Preview.app or Slack → image at retina density.
5. Save — dialog → `{basename}-L{a}-L{b}.png` default → file opens, fonts correct (not serif).
6. `pixelRatio: 3` — re-export → PNG ≈1.5× the pixel dimensions of the default 2× export.
7. `transparentBackground: true` — preview shows checkerboard, PNG has alpha.
8. Untitled buffer → `codesnap-{timestamp}.png` default.
9. Unsupported language → preview renders as plain (unstyled) text, no crash.
10. `Cmd+K Cmd+S` with selection → opens. Without selection → opens whole-file.
11. Right-click in editor → entry present, enabled with selection / disabled without.
12. Toggle theme — preview re-themes live (when `useEditorTheme: true`).
13. Edit source buffer after opening CodeSnap → preview unchanged.
14. ⚙ in shutter bar → settings dialog opens (currently lands on "appearance" tab — note this as a follow-up item).

- [ ] **Step 3: Linux clipboard sanity check (if applicable)**

On Linux, confirm `writeImage` works through the Tauri clipboard-manager plugin (requires `xclip` on X11 or `wl-clipboard` on Wayland). Note the result in the PR description.

- [ ] **Step 4: Commit any small fixes uncovered during the run**

```bash
# Per-fix:
git add <files>
git commit -m "Fix <specific issue uncovered during manual verification>"
```

---

## Done criteria

The feature is complete when:

- All 18 tasks above are checked off.
- All 17 unit tests pass: `bunx vp test run src/features/codesnap`.
- `bun run typecheck` is clean.
- `bun run check` (`scripts/check.sh`) passes — covers lint + format + zig + rust checks.
- The 14-step manual checklist passes.
- The follow-up "open settings to a dedicated codesnap tab" is captured as a TODO in the PR description, not gating merge.

---

## Notes for the implementer

- **Don't rebuild syntax-highlighting CSS.** The token class names produced by `buildTokenSpans` match the editor's existing classes (`token-keyword`, `token-string`, etc.). Theme CSS is already global — `PreviewFrame` should render inside the same theme scope as the editor and inherit colors for free.
- **html-to-image and `<foreignObject>`.** If exported PNGs render with a serif font, `getEmbeddedFontCss` is failing (network error, or the Vite `?url` import didn't resolve). Check Network panel for the woff2 request and check that `getEmbeddedFontCss()` resolves before `renderPng` is called.
- **Resize-observer flicker.** If you see the width readout flicker between two values during drag, debounce the `ResizeObserver` callback with a single `requestAnimationFrame`.
- **Linux clipboard.** Tauri's clipboard-manager plugin needs `xclip` (X11) or `wl-clipboard` (Wayland) on Linux for `writeImage` to work. The plugin surfaces a clear error if absent; relay it via the existing toast.
