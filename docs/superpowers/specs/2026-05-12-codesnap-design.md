# CodeSnap: Built-in Code Screenshot Feature

**Status:** Draft
**Date:** 2026-05-12
**Author:** Johnson

## Summary

A built-in feature for Athas that takes the user's code selection (or entire file) and produces a stylized PNG suitable for sharing — window chrome, gradient/solid background, padding, line numbers, preserved syntax highlighting. The feature targets parity with the [CodeSnap VS Code extension](https://marketplace.visualstudio.com/items?itemName=adpyke.codesnap): a dedicated tab opens with a live preview, a width drag handle, and a shutter button that copies to clipboard or saves to disk.

## Goals

- **CodeSnap parity** for the common case: select code, trigger, get a shareable image.
- **Zero Rust changes.** All rendering happens in the webview using `html-to-image`.
- **Native Athas integration:** new editor tab type (not a popup), settings via `settings.json`, command-palette entries, keybinding, context-menu entry.
- **Frozen snapshot semantics:** once a CodeSnap tab is open, editing the source buffer does not mutate the preview.
- **Self-contained module** under `src/features/codesnap/`. Six new files plus four small insertions into existing files.

## Non-goals (deferred to a future iteration)

- Multi-snippet diff layouts (two code blocks side by side).
- Animated GIF / video / screen-recording exports.
- SVG or PDF export.
- In-preview code editing (preview is read-only).
- Preset "social card" aspect ratios (Twitter, OG, etc.).

## User-facing behavior

### Triggers

1. **Command palette** — `CodeSnap: From Selection` and `CodeSnap: Whole File`. `From Selection` falls back to whole-file behavior if no selection exists.
2. **Default keybinding** — `Cmd+K Cmd+S` (chord) bound to `codesnap.fromSelection` with `when: "editorFocus"`. Rebindable through the existing keymap override system.
3. **Editor context menu** — right-click in editor with selection shows "📷 CodeSnap Selection". Disabled when no selection.

### The CodeSnap tab

When triggered, a new tab of type `"codeSnap"` opens via the existing pane content system. The tab body contains:

- A centered **preview frame** (the capturable DOM) with the configured background, padding, window chrome, and the highlighted code.
- A **drag handle** on the right edge of the preview for horizontal resize. The width readout updates live.
- A floating **shutter bar** at the bottom with:
  - Width readout in the form `{width} × {height}`. Width is user-controlled via the drag handle; height is **content-derived** (the preview is only horizontally resizable — height follows from how the code wraps at the current width).
  - Copy/Save toggle. Initial value comes from `codesnap.shutterAction`; toggling inside the tab is **ephemeral per-tab** and does not write back to settings.
  - Shutter button — executes the toggle's current action.
  - Settings shortcut (jumps to the `codesnap.*` section).

### Keyboard inside the CodeSnap tab

- `⌘C` — copy regardless of toggle state.
- `⌘S` — save regardless of toggle state.
- `Esc` or close-tab button — closes the tab immediately without a confirmation prompt. The preview is a derived view; there is no unsaved state to protect.

### Export

- **Copy to clipboard** — writes PNG bytes via `@tauri-apps/plugin-clipboard-manager`'s `writeImage`. Success toast.
- **Save to disk** — opens a `save` dialog via `@tauri-apps/plugin-dialog`; writes via `@tauri-apps/plugin-fs#writeFile`. Default filename: `{basename}-L{startLine}-L{endLine}.png` (or `codesnap-{timestamp}.png` for untitled buffers).

## Architecture

### Module layout

```
src/features/codesnap/
├── components/
│   ├── codesnap-tab.tsx          # Top-level tab view; reads snapshot + settings
│   ├── preview-frame.tsx         # The capturable DOM (window chrome + bg + code)
│   ├── width-handle.tsx          # Drag handle
│   └── shutter-bar.tsx           # Toolbar (readout, toggle, shutter, settings)
├── lib/
│   ├── build-token-spans.ts      # Token[] → React span tree, line-split
│   ├── render-png.ts             # html-to-image wrapper, retina-aware
│   ├── export.ts                 # copyToClipboard, saveToFile, buildDefaultFilename
│   └── font-embed.ts             # Memoized JetBrains Mono inlined fontEmbedCSS
├── stores/
│   └── codesnap-store.ts         # Zustand: width, current snapshot, exporting state
├── constants/
│   └── codesnap-actions.tsx      # Command-palette entries
└── types.ts                      # SourceSnapshot, CodesnapSettings
```

### Data flow

1. User invokes a trigger.
2. Trigger handler reads `useStateStore.selection` + the active buffer from `useBufferStore`; builds a `SourceSnapshot`. Empty selections fall back to the active line; calling `fromSelection` with no buffer is a no-op.
3. `openContent({ type: "codeSnap", snapshot })` registers the tab through the existing pane system.
4. `<CodesnapTab>` mounts and:
   - Calls `tokenizerWorkerClient.tokenizeSnippet(snapshot.text, snapshot.language)` (new additive function — see "Tokenizer extension" below) to get `Token[]`.
   - Renders `<PreviewFrame>` with token spans, line numbers, chrome, and bg per `codesnap.*` settings.
5. User adjusts width via the drag handle; the preview re-flows. Token data is not re-fetched (it is a pure text→spans mapping).
6. User clicks Copy/Save:
   - `render-png.ts` calls `html-to-image.toBlob(previewFrameRef, { pixelRatio, fontEmbedCSS })`.
   - `export.ts` writes the resulting `Blob` to the clipboard or to a file at the user's chosen path.

### Integration touch points

| File                                                                                                              | Change                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/features/panes/types/pane-content.ts:16](../../src/features/panes/types/pane-content.ts#L16)                 | Add `"codeSnap"` to `PaneContentType` union; add `CodeSnapContent` interface; add `isCodeSnapContent` type guard; add to `OpenContentSpec` union (line ~302). |
| [src/features/settings/config/default-settings.ts:23](../../src/features/settings/config/default-settings.ts#L23) | Add `codesnap` namespace with defaults (see Settings below).                                                                                                  |
| [src/features/settings/types/settings.ts](../../src/features/settings/types/settings.ts)                          | Add `codesnap: CodesnapSettings` to the `Settings` type.                                                                                                      |
| [src/features/keymaps/defaults/default-keymaps.ts](../../src/features/keymaps/defaults/default-keymaps.ts)        | Add chord keybinding for `codesnap.fromSelection`.                                                                                                            |
| Editor context-menu config (TBD — locate during implementation)                                                   | Add "📷 CodeSnap Selection" entry, enabled when selection is non-empty.                                                                                       |
| Pane renderer dispatch                                                                                            | Render `<CodesnapTab>` for `pane.type === "codeSnap"`.                                                                                                        |

### Tokenizer extension

The existing tokenizer worker (`tokenizer-worker-client.ts`) operates in viewport-relative mode keyed to a buffer. We add a single additive function that runs the same tree-sitter wasm parser against raw text:

```ts
tokenizeSnippet(text: string, language: string): Promise<Token[]>
```

It uses the existing capture map at [src/features/editor/lib/wasm-parser/capture-map.ts](../../src/features/editor/lib/wasm-parser/capture-map.ts) so token class names match the live editor's. ~20 lines of glue. Languages without a bundled parser return a single default token spanning the entire text — preview falls back to unstyled but still produces a valid screenshot.

### Settings

All keys live under `settings.codesnap` and are read via `useSettingsStore`.

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
  target: "container",         // "container" | "window"
  shutterAction: "copy",       // "copy" | "save"
  defaultWidth: 720,
  pixelRatio: 2,               // 2 = retina, 3 = ultra
  fontFamily: "JetBrains Mono Variable",
  useEditorTheme: true,
}
```

Two deliberate departures from CodeSnap:

- **`backgroundColor` is first-class CSS** — gradient strings are explicitly supported and the shipping default is a gradient.
- **`pixelRatio`** is exposed for explicit export-density control.

v1 ships no in-app settings UI for these keys. Users edit them in `settings.json` like every other Athas setting. The ⚙ button in the shutter bar opens the settings UI scrolled to the `codesnap` section.

**`useEditorTheme` precedence.** `useEditorTheme` only controls the **code foreground colors** (syntax-highlight token classes). It does **not** override `backgroundColor`, `boxShadow`, or any window-chrome styling — those remain controlled by their own settings regardless of the theme. So a user can keep a pink-gradient background while their code colors track the active editor theme.

### Snapshot lifecycle

```ts
type SourceSnapshot = {
  text: string; // exact selected substring (or full buffer)
  startLine: number; // 1-based, for realLineNumbers
  endLine: number; // 1-based, for default filename
  language: string; // tree-sitter parser id
  bufferPath: string | null;
};
```

The snapshot is built once at trigger time and stored in the CodeSnap tab's state. Editing or closing the source buffer afterward does not affect the preview. This avoids stale-reference bugs and makes the tab's behavior predictable.

### Font embedding

`html-to-image` rasterizes via SVG `<foreignObject>`. `<foreignObject>` does not inherit `@font-face` declarations from the parent document, so without intervention the exported PNG silently falls back to a system serif font.

The fix: at first export, compute a `fontEmbedCSS` string that inlines the JetBrains Mono Variable woff2 as base64 and pass it to `toBlob`. Cache the result module-level so it is computed at most once per session. Encapsulated in `lib/font-embed.ts`.

### Failure handling

| Scenario                    | Behavior                                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| `toBlob` returns null       | `toast.error("Snapshot failed — see console")` + log underlying error.         |
| Clipboard write rejected    | Toast with retry hint; on a second consecutive failure, offer to save instead. |
| `save` dialog cancelled     | Silent.                                                                        |
| `writeFile` throws          | `toast.error` with the OS error message.                                       |
| Selection empty + no buffer | No-op (logged in debug).                                                       |
| Language has no parser      | Render plain (unstyled) text; do not error.                                    |

## Testing

### Unit tests

Three small test files in `src/features/codesnap/lib/__tests__/`. Total ~150 lines.

- **`build-token-spans.test.ts`** — line-split structure, multi-byte characters (emoji), trailing newlines, empty input.
- **`build-default-filename.test.ts`** — with path, without path, dotted filenames (`my.config.ts` → `my-config-ts-L1-L10.png`), Windows path separators.
- **`snapshot-from-selection.test.ts`** — mocked editor stores produce snapshots with correct `text`, `startLine`, `endLine`, `language`, `bufferPath`. Includes empty-selection-fallback case.

`render-png.ts` and `export.ts` are not unit-tested — they are thin wrappers over external libraries and the real failure modes are environmental.

### Manual verification checklist

To be run before merging. The PR description should link a screenshot of each numbered step.

1. **Selection screenshot** — select 5 lines of Rust → palette → `CodeSnap: From Selection` → tab opens with correct gradient, traffic lights, line numbers starting at the real line number.
2. **Whole-file screenshot** — palette → `CodeSnap: Whole File` → preview shows entire buffer.
3. **Width drag** — drag handle reduces width; line numbers do not drift; readout updates.
4. **Copy** — toggle = Copy → shutter → toast "Copied" → paste into Preview.app / Slack / Discord shows intact image at retina density.
5. **Save** — toggle = Save → shutter → dialog opens with `staging-rs-L42-L48.png` default → file written, opens, fonts correct (not serif).
6. **Pixel ratio** — set `codesnap.pixelRatio` to 3 → re-export → PNG is 1.5× the pixel dimensions of the 2× version.
7. **Transparent background** — set `transparentBackground: true` → preview shows checkerboard, exported PNG has alpha.
8. **Untitled buffer** — open scratch buffer, select code → trigger → filename defaults to `codesnap-{timestamp}.png`.
9. **Language without parser** — open a file in an unsupported language → trigger → preview renders as plain text, no crash.
10. **Keybinding** — `Cmd+K Cmd+S` with editor focus + selection → opens CodeSnap tab. Without selection → opens whole-file CodeSnap.
11. **Context menu** — right-click in editor with selection → entry present and enabled. Without selection → entry disabled.
12. **Theme switching** — toggle Athas's color theme → CodeSnap preview re-themes live (when `useEditorTheme: true`).
13. **Source buffer edit does not leak** — open CodeSnap from selection → edit source buffer → CodeSnap preview unchanged.
14. **Settings shortcut** — click ⚙ in shutter bar → settings UI opens with `codesnap.*` section focused.

## Dependencies

One new npm package:

- **`html-to-image`** (~30KB, MIT) — DOM → SVG `<foreignObject>` → canvas → PNG `Blob`.

No new Rust crates. No native dependencies.

## Open questions

1. **Editor context-menu location** — the scout didn't identify the exact file. To be located during implementation; should be one of `src/features/editor/components/` context-menu components.
2. **Default keybinding conflict check** — confirm `Cmd+K Cmd+S` is not already bound somewhere. If it is, the chord can shift (e.g. `Cmd+K Cmd+P`) without changing the spec materially.
3. **AppImage / Wayland clipboard** — Linux clipboard support depends on `xclip` / `wl-clipboard` for the underlying Tauri plugin. Assume the Tauri plugin handles graceful degradation; verify in step 4 of the manual checklist on a Linux build before claiming Linux parity.

## Out-of-scope reminders

- No diff layouts.
- No GIF/video.
- No SVG/PDF.
- No in-preview editing.
- No social-card presets.

These are valuable but additive; introducing them in v1 would expand the design surface beyond what is needed to claim CodeSnap parity.
