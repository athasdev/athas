/**
 * Feature boundaries: which files of a feature other features may import.
 *
 * Features under `src/features/<feature>/` act as modules without barrel files (an `index.ts`
 * per feature would make Vite dev and vitest load the whole feature graph on every import).
 * Instead, a feature's public surface is defined by folder:
 *
 * - Public by default: `api/`, `hooks/`, `types/`, `services/`, `constants/`, `config/`, and the
 *   store modules in `stores/` (`*.store.ts` and the other files matched by `storeFilePattern`).
 * - Public only when listed in `publicFiles`: `components/` and anything else not covered above.
 * - Always private: `lib/`, `utils/`, `controllers/`, `internal/`, `tests/`.
 *
 * Layer folders are matched anywhere below the feature, so a subfeature such as
 * `editor/lsp/hooks/` follows the same rule. Test files are exempt as importers.
 *
 * `scripts/check/tests/feature-boundaries.test.ts` enforces two rules with a ratchet baseline in
 * `feature-boundaries.baseline.json`:
 *
 * 1. `privateImports`: an import from one feature into a private file of another feature.
 * 2. `cycleEdges`: a cross-feature edge inside a module-level static import cycle (Tarjan SCC over
 *    value imports; `import type` and dynamic `import()` do not count).
 *
 * The test fails on any violation missing from the baseline, and on any baseline entry that no
 * longer occurs, so the baseline only shrinks. To fix a new violation, import the owning feature's
 * public module instead, move the shared code into a public folder (or `src/utils`, `src/ui` when it
 * is app-wide), or break the cycle with `import type`, a callback, or `src/utils/app-events.ts`.
 * Only if the import is intended, list the file in `publicFiles` below.
 *
 * After removing violations, shrink the baseline with:
 *
 *   bun scripts/check/feature-boundaries.ts --update
 *
 * `bun scripts/check/feature-boundaries.ts` (no flag) prints the difference against the baseline.
 * Never add entries to the baseline by hand to get a new violation through.
 */

export type FeatureBoundaryConfig = {
  sourceRoot: string;
  featuresRoot: string;
  /** Folder names that mark a layer of a feature or subfeature. */
  layerFolders: string[];
  /** Layer folders other features may import from. */
  publicFolders: string[];
  /** Folder names that are private wherever they appear. */
  privateFolders: string[];
  /** File names in `stores/` that are public store modules; other files there are internal. */
  storeFilePattern: RegExp | null;
  /**
   * Extra public files per feature, relative to the feature folder. Supports exact paths (with or
   * without extension), `dir/*` (direct children) and `dir/**` (whole subtree).
   */
  publicFiles: Record<string, string[]>;
};

export type FeatureBoundaryBaseline = {
  privateImports: string[];
  cycleEdges: string[];
};

export const featureBoundaries: FeatureBoundaryConfig = {
  sourceRoot: "src",
  featuresRoot: "src/features",
  layerFolders: [
    "api",
    "hooks",
    "types",
    "stores",
    "services",
    "constants",
    "config",
    "events",
    "components",
    "lib",
    "utils",
    "controllers",
    "internal",
    "tests",
  ],
  publicFolders: ["api", "hooks", "types", "stores", "services", "constants", "config", "events"],
  privateFolders: ["lib", "utils", "controllers", "internal", "tests"],
  storeFilePattern: /(\.store|\.types|-selectors)\.tsx?$/,
  publicFiles: {
    editor: [
      // Cached id/path lookups over the buffer list, used next to the buffer store.
      "stores/buffer-index.ts",
      // The app's LSP client; other features request hovers, symbols and edits through it.
      "lsp/lsp-client.ts",
    ],
    "file-system": [
      // File IO entry points; they belong in `api/` but are kept in place for now.
      "controllers/platform.ts",
      "controllers/file-operations.ts",
    ],
    panes: [
      // Header and status bar chrome for views that other features render inside a pane.
      "components/pane-content-chrome.tsx",
    ],
    remote: [
      // The `remote://` path format is the remote feature's contract with the rest of the app.
      "utils/remote-path.ts",
    ],
    settings: [
      // Layout blocks for settings pages that other features contribute.
      "components/settings-section.tsx",
    ],
    viewer: [
      // Shared loading, empty and error states for file viewers.
      "components/viewer-state.tsx",
    ],
    workspace: [
      // Infrastructure for per-workspace stores used by most features.
      "stores/create-workspace-scoped-store.ts",
      "runtime/workspace-runtime-registry.ts",
    ],
    wsl: [
      // The WSL path format is the wsl feature's contract with the rest of the app.
      "utils/wsl-path.ts",
    ],
  },
};
