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
 *   Every entry carries the reason it is public. Components are listed when another feature mounts
 *   them by design: entry views that a host (the app shell, main layout, settings dialog, command
 *   palette) renders for the owning feature, and widgets that several features compose. Logic is
 *   not listed; it moves to a public folder instead. Buffer, sidebar and editor views are not
 *   listed either: the owning feature registers them from its `services/` (the pane view, sidebar
 *   view, tab decoration and editor feature registries), so their hosts never import them.
 * - Always private: `lib/`, `utils/`, `controllers/`, `internal/`, `tests/`.
 *
 * Layer folders are matched anywhere below the feature, so a subfeature such as
 * `editor/lsp/hooks/` follows the same rule. Test files are exempt as importers.
 *
 * Features are also layered. Every feature sits in one tier of `layers.tiers`, lowest first:
 *
 * - `foundation`: platform helpers with no product feature underneath them (file search, remote
 *   and WSL path formats and connections, telemetry). They are meant to import no other feature.
 * - `core`: the workbench and the editing model (settings, keymaps, workspace, file system,
 *   layout and window state, editor, panes, tabs, terminal, git, viewers, sidebar trees, search,
 *   diagnostics and the other editor capabilities). Core features use each other freely.
 * - `features`: product features built on the core (AI, GitHub, databases, Docker,
 *   collaboration, sharing, custom views, onboarding, run actions, the browser, feedback).
 * - `shell`: the parts that wire everything together (bootstrap, command palette, quick open).
 *
 * A file may import its own tier or a lower one. `layers.tierOverrides` moves a folder or file
 * into another tier when it is a host for the tiers above it: command definitions in
 * `keymaps/commands/`, the workbench chrome in `layout/components/` and `window/components/`, the
 * detached window roots, and the settings pages. Overrides carry a reason like `publicFiles`
 * entries and should stay rare; prefer moving the code, or a registry the higher feature
 * contributes to (as buffer views, sidebar views, tab decorations and editor features do).
 *
 * The tiers were derived from the import graph: a feature that most of the app imports and that
 * imports few features back sits low, and the remaining upward imports are the debt the baseline
 * tracks. To place a new feature, pick the lowest tier whose features it does not need to import
 * from above, and add it to `layers.tiers` (the test fails while a feature has no tier).
 *
 * `scripts/check/tests/feature-boundaries.test.ts` enforces three rules with a ratchet baseline in
 * `feature-boundaries.baseline.json`:
 *
 * 1. `privateImports`: an import from one feature into a private file of another feature.
 * 2. `cycleEdges`: a cross-feature edge inside a module-level static import cycle (Tarjan SCC over
 *    value imports; `import type` and dynamic `import()` do not count).
 * 3. `upwardImports`: imports from a lower tier into a higher one, counted per
 *    `importer module -> imported module` pair (a module is a feature or a tier override) as
 *    distinct importer/imported file pairs. Value, type-only and dynamic imports all count; test
 *    files and `vi.mock` do not.
 *
 * The test fails on any violation missing from the baseline (or an upward pair whose count grew),
 * and on any baseline entry that no longer occurs (or whose count shrank), so the baseline only
 * shrinks. To fix a new violation, import the owning feature's public module instead, move the
 * shared code into a public folder (or `src/utils`, `src/ui` when it is app-wide), or break the
 * cycle with `import type`, a callback, or `src/utils/app-events.ts`. For an upward import, move
 * the shared type or helper down to the lower feature, run the higher feature's action through
 * its command (`keymapRegistry.executeCommand`), notify through `src/utils/app-events.ts`, or move
 * the code that needs the higher feature into it. Only if the import is intended, list the file
 * in `publicFiles` below with its reason.
 *
 * After removing violations, shrink the baseline with:
 *
 *   bun scripts/check/feature-boundaries.ts --update
 *
 * `bun scripts/check/feature-boundaries.ts` (no flag) prints the difference against the baseline
 * and the feature graph's bidirectional pairs and largest cycle; `--upward` lists every upward
 * import and `--graph` every bidirectional pair. Never add entries to the baseline by hand, or
 * raise a count, to get a new violation through.
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
   * Extra public files per feature, relative to the feature folder, each mapped to the reason it is
   * public. Supports exact paths (with or without extension), `dir/*` (direct children) and
   * `dir/**` (whole subtree). Every entry must match an existing file.
   */
  publicFiles: Record<string, Record<string, string>>;
  layers: FeatureLayers;
};

export type FeatureTier = "foundation" | "core" | "features" | "shell";

export type FeatureLayers = {
  /** Tiers from lowest to highest. A file may import its own tier or a lower one. */
  order: FeatureTier[];
  /** Every feature folder, in exactly one tier. */
  tiers: Record<FeatureTier, string[]>;
  /**
   * Parts of a feature that sit in a different tier than the feature, relative to the features
   * root: an exact file or `dir/**`. The most specific match wins. Each one gives its reason.
   */
  tierOverrides: Record<string, { tier: FeatureTier; reason: string }>;
};

export type FeatureBoundaryBaseline = {
  privateImports: string[];
  cycleEdges: string[];
  /** Upward imports per `importer module -> imported module`, counted as distinct file pairs. */
  upwardImports: Record<string, number>;
};

const APP_SHELL = "Mounted by the app shell (src/App.tsx, src/main.tsx, src/workbench-app.tsx).";
const MAIN_LAYOUT = "Mounted by the main layout.";
const ACTIVITY_CHROME = "Control mounted in the activity bar or title bar chrome.";
const SETTINGS_SECTION = "Settings section this feature contributes to the settings dialog.";
const COMMAND_VIEW = "Command palette view this feature contributes.";
const EDITOR_FEATURE_API =
  "CodeMirror feature API: features contributed to the editor (editor-feature-registry) build on it.";

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
    ai: {
      "components/history/agent-sessions-dialog.tsx": APP_SHELL,
      "continuous-agents/continuous-agents-runtime.tsx": APP_SHELL,
      "detached/detached-agent-window.tsx": APP_SHELL,
      "components/mcp/mcp-server-settings.tsx": SETTINGS_SECTION,
      "components/permissions/agent-allowed-actions-settings.tsx": SETTINGS_SECTION,
      "integrations/codex/codex-settings.tsx": SETTINGS_SECTION,
      "components/icons/provider-icons.tsx":
        "Provider brand icons for the AI provider settings pages.",
      "components/selectors/model-connection-picker.tsx":
        "The model picker; the AI settings pages choose models with it.",
      "components/chat/chat-message.tsx": "Chat message rendering reused by shared-chat previews.",
      "components/messages/markdown-renderer.tsx":
        "Assistant markdown renderer reused for extension and skill descriptions.",
      "components/skills/skills-command.tsx": "Skills browser embedded in the extensions view.",
    },
    auth: {
      "components/account-menu.tsx": ACTIVITY_CHROME,
      "components/pro-gate.tsx": "Gates Pro-only UI; extensions' generative UI renders through it.",
    },
    bootstrap: {
      "components/settings-ready-bootstrap.tsx": APP_SHELL,
    },
    "command-palette": {
      "components/command-palette.tsx": MAIN_LAYOUT,
    },
    database: {
      "components/connection/connection-dialog.tsx": MAIN_LAYOUT,
    },
    debugger: {
      "components/debugger-view.tsx": "Debugger panel mounted in the bottom pane.",
    },
    diagnostics: {
      "components/diagnostics-activity-control.tsx": ACTIVITY_CHROME,
    },
    editor: {
      "stores/buffer-index.ts":
        "Cached id/path lookups over the buffer list, used next to the buffer store.",
      "markdown/highlighted-code.tsx":
        "Highlighted code block shared with AI chat and extension diff previews.",
      "markdown/styles.css": "Markdown styles for GitHub and onboarding markdown.",
      "components/code-editor.tsx": "The text editor; panes and diff views render it.",
      "engines/codemirror/host.ts": EDITOR_FEATURE_API,
      "engines/codemirror/position.ts": EDITOR_FEATURE_API,
      "engines/codemirror/document-change.ts": EDITOR_FEATURE_API,
      "engines/codemirror/features/reveal.ts": EDITOR_FEATURE_API,
      "components/codemirror-readonly-view.tsx":
        "Read-only code view; GitHub Actions logs render with it.",
      "components/multibuffer/multibuffer-workspace.tsx":
        "Multibuffer surface that search, diagnostics and diff views are built on.",
      "components/multibuffer/multibuffer-navigator-toggle.tsx":
        "Navigator toggle for toolbars of multibuffer views.",
      "components/toolbar/breadcrumb.tsx":
        "Editor header (breadcrumb and actions) reused by diff views.",
      "components/toolbar/file-path-breadcrumb.tsx":
        "Navigable file path breadcrumb used by file viewers.",
    },
    feedback: {
      "components/product-feedback-dialog.tsx": APP_SHELL,
    },
    "file-explorer": {
      "components/file-navigator-sidebar.tsx":
        "File list/tree navigator shared by multibuffer, search, diagnostics and diff views.",
    },
    "file-system": {
      "components/ide-settings-import-dialog.tsx":
        "IDE settings import, offered by onboarding and settings.",
      "components/linux-folder-picker-dialog.tsx": MAIN_LAYOUT,
    },
    git: {
      "components/diff/diff-file-content.tsx":
        "Single-file diff body reused by GitHub pull request files.",
      "components/git-branch-manager.tsx": ACTIVITY_CHROME,
      "components/git-project-selector.tsx":
        "Repository picker reused by the GitHub pull requests view.",
      "components/inline-git-blame-card.tsx": "Blame card the editor shows for inline blame.",
    },
    github: {
      "components/github-actions-watcher.tsx": APP_SHELL,
      "components/github-auth-status.tsx": "GitHub sign-in state message reused by notifications.",
    },
    keymaps: {
      "components/keybinding-row.tsx": "Keybinding table row the keyboard settings page renders.",
    },
    layout: {
      "components/main-layout.tsx": APP_SHELL,
      "components/zoom-indicator.tsx": APP_SHELL,
      "components/project-switcher.tsx": ACTIVITY_CHROME,
    },
    "local-history": {
      "components/local-history-command.tsx": COMMAND_VIEW,
    },
    notifications: {
      "components/notification-recorder.tsx": APP_SHELL,
      "components/notifications-trigger.tsx": ACTIVITY_CHROME,
    },
    outline: {
      "components/outline-command.tsx": COMMAND_VIEW,
      "components/outline-sidebar.tsx": "Outline panel the code editor shows beside the text.",
    },
    panes: {
      "components/split-view-root.tsx": MAIN_LAYOUT,
      "components/pane-node-renderer.tsx": "Renders a pane tree; the bottom pane hosts one.",
      "components/pane-resize-handle.tsx": "Split resize handle, reused by terminal splits.",
      "components/split-drop-overlay.tsx": "Split drop zones overlay, reused by terminal splits.",
    },
    "quick-open": {
      "components/quick-open.tsx": MAIN_LAYOUT,
    },
    remote: {
      "components/connection-form.tsx": "Remote connection form embedded in the project picker.",
      "components/password-prompt-dialog.tsx":
        "Remote password prompt used when connecting projects.",
    },
    "run-actions": {
      "components/run-actions-button.tsx": ACTIVITY_CHROME,
    },
    settings: {
      "components/settings-section.tsx":
        "Layout blocks for settings pages that other features contribute.",
      "components/settings-dialog.tsx": MAIN_LAYOUT,
      "components/font-style-injector.tsx": "Applies font settings; every window shell mounts it.",
    },
    sharing: {
      "components/share-dialog.tsx": APP_SHELL,
      "components/sharing-runtime.tsx": APP_SHELL,
      "components/sharing-settings.tsx": SETTINGS_SECTION,
    },
    sidebar: {
      "components/sidebar-tree.tsx":
        "Tree widget (roving focus, guides) shared by every sidebar tree; owns its keyboard tests.",
    },
    tabs: {
      "components/unsaved-changes-dialog.tsx":
        "Save/discard prompt for closing dirty buffers, tabs and the window.",
      "components/tab-bar.tsx": "The editor tab bar each pane renders.",
      "components/buffer-type-icon.tsx":
        "The icon of a tab's content, shared with quick open's list of open tabs.",
      "components/pending-buffer-close-dialog.tsx": MAIN_LAYOUT,
    },
    terminal: {
      "components/terminal-host.tsx":
        "Keeps terminal sessions alive; main layout and terminal windows mount it.",
      "components/terminal-container.tsx": "Terminal panel mounted in the bottom pane.",
    },
    viewer: {
      "csv/components/csv-preview.tsx": "CSV table preview the code editor shows for CSV files.",
    },
    vim: {
      "components/vim-status-indicator.tsx": "Vim mode indicator in the editor status actions.",
    },
    window: {
      "components/title-bar/title-bar.tsx": MAIN_LAYOUT,
      "components/title-bar/title-leading.tsx": MAIN_LAYOUT,
      "components/window-close-guard.tsx": MAIN_LAYOUT,
      "components/window-menu-bar.tsx": ACTIVITY_CHROME,
      "components/window-resize-border.tsx": APP_SHELL,
      "detached/detached-window-shell.tsx": "Window chrome for detached feature windows.",
      "detached/detached-resource-window.tsx": APP_SHELL,
      "detached/standalone-content-window.tsx": APP_SHELL,
    },
    workspace: {
      "stores/create-workspace-scoped-store.ts":
        "Infrastructure for per-workspace stores used by most features.",
      "project-picker/components/project-picker.tsx": ACTIVITY_CHROME,
      "project-icons/components/project-custom-icon.tsx":
        "Project icon the project switcher shows.",
      "project-icons/components/project-icon-picker.tsx":
        "Project icon picker opened from the project switcher.",
    },
  },
  layers: {
    order: ["foundation", "core", "features", "shell"],
    tiers: {
      foundation: ["file-search", "remote", "telemetry", "wsl"],
      core: [
        "auth",
        "debugger",
        "diagnostics",
        "editor",
        "file-explorer",
        "file-system",
        "git",
        "global-search",
        "keymaps",
        "layout",
        "local-history",
        "notifications",
        "outline",
        "panes",
        "references",
        "settings",
        "sidebar",
        "tabs",
        "terminal",
        "viewer",
        "vim",
        "window",
        "workspace",
      ],
      features: [
        "ai",
        "browser",
        "browser-use",
        "collaboration",
        "database",
        "docker",
        "feedback",
        "github",
        "onboarding",
        "run-actions",
        "sharing",
        "views",
      ],
      shell: ["bootstrap", "command-palette", "quick-open"],
    },
    tierOverrides: {
      "keymaps/commands/**": {
        tier: "shell",
        reason: "Command definitions and their actions; they call into every feature.",
      },
      "layout/components/**": {
        tier: "shell",
        reason:
          "Workbench chrome (main layout, sidebar, bottom pane, activity bar) that mounts feature views.",
      },
      "window/components/**": {
        tier: "shell",
        reason: "Window chrome (title bar, menu bar, close guard) that mounts feature controls.",
      },
      "window/detached/detached-resource-window.tsx": {
        tier: "shell",
        reason: "Root view of a detached resource window, mounted by src/App.tsx.",
      },
      "window/detached/standalone-content-window.tsx": {
        tier: "shell",
        reason: "Root view of a standalone terminal or settings window, mounted by src/App.tsx.",
      },
      "settings/components/settings-dialog.tsx": {
        tier: "shell",
        reason: "Settings host; its pages render the settings of every feature.",
      },
      "settings/components/settings-workbench-view.tsx": {
        tier: "shell",
        reason: "Settings host; its pages render the settings of every feature.",
      },
      "settings/components/tabs/**": {
        tier: "shell",
        reason: "Settings pages; each renders the settings sections of the features on that page.",
      },
      "settings/components/ai/**": {
        tier: "shell",
        reason: "Settings pages; each renders the settings sections of the features on that page.",
      },
    },
  },
};
