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
 *   them by design: entry views that a host (the app shell, main layout, sidebar pane, pane
 *   container, settings dialog, command palette) renders for the owning feature, and widgets that
 *   several features compose. Logic is not listed; it moves to a public folder instead.
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
 * Only if the import is intended, list the file in `publicFiles` below with its reason.
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
   * Extra public files per feature, relative to the feature folder, each mapped to the reason it is
   * public. Supports exact paths (with or without extension), `dir/*` (direct children) and
   * `dir/**` (whole subtree). Every entry must match an existing file.
   */
  publicFiles: Record<string, Record<string, string>>;
};

export type FeatureBoundaryBaseline = {
  privateImports: string[];
  cycleEdges: string[];
};

const APP_SHELL = "Mounted by the app shell (src/App.tsx, src/main.tsx, src/workbench-app.tsx).";
const MAIN_LAYOUT = "Mounted by the main layout.";
const SIDEBAR_VIEW = "Sidebar view mounted by the layout's sidebar pane.";
const ACTIVITY_CHROME = "Control mounted in the activity bar or title bar chrome.";
const PANE_VIEW = "Buffer view the pane container renders for this feature's buffers.";
const RESOURCE_VIEW = "Resource view rendered by the pane resource buffer view.";
const SETTINGS_SECTION = "Settings section this feature contributes to the settings dialog.";
const COMMAND_VIEW = "Command palette view this feature contributes.";
const TAB_DECORATION = "Tab icon or badge the tab bar renders for this feature's buffers.";

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
      "acp-inspector/components/acp-inspector-view.tsx": PANE_VIEW,
      "components/agent-launch-input.tsx": PANE_VIEW,
      "components/agent-start-view.tsx": PANE_VIEW,
      "components/agent-tab.tsx": PANE_VIEW,
      "components/chat/agent-edits-review.tsx": PANE_VIEW,
      "continuous-agents/resource.tsx": PANE_VIEW,
      "components/panel/agent-context-sidebar.tsx": SIDEBAR_VIEW,
      "components/sidebar/agents-sidebar.tsx": SIDEBAR_VIEW,
      "components/history/agent-sessions-dialog.tsx": APP_SHELL,
      "continuous-agents/continuous-agents-runtime.tsx": APP_SHELL,
      "detached/detached-agent-window.tsx": APP_SHELL,
      "components/agent-attention-dot.tsx": TAB_DECORATION,
      "components/icons/agent-session-icon.tsx": TAB_DECORATION,
      "components/mcp/mcp-server-settings.tsx": SETTINGS_SECTION,
      "components/permissions/agent-allowed-actions-settings.tsx": SETTINGS_SECTION,
      "integrations/codex/codex-settings.tsx": SETTINGS_SECTION,
      "components/icons/provider-icons.tsx":
        "Provider brand icons, shown wherever a provider is named.",
      "components/selectors/model-connection-picker.tsx":
        "The model picker; settings, inline edit and completion status choose models with it.",
      "components/chat/chat-message.tsx": "Chat message rendering reused by shared-chat previews.",
      "components/messages/markdown-renderer.tsx":
        "Assistant markdown renderer reused for extension and skill descriptions.",
      "components/skills/skills-command.tsx": "Skills browser embedded in the extensions view.",
      "detached/agent-window-service.ts": "Opens an agent in its own window (command entry point).",
      "detached/agent-window.store.ts": "Whether agents are detached, read by the close guard.",
    },
    auth: {
      "components/account-menu.tsx": ACTIVITY_CHROME,
      "components/pro-gate.tsx": "Gates Pro-only UI; extensions' generative UI renders through it.",
    },
    bootstrap: {
      "components/settings-ready-bootstrap.tsx": APP_SHELL,
    },
    browser: {
      "components/browser-view.tsx": PANE_VIEW,
      "components/browser-tab-icon.tsx": TAB_DECORATION,
    },
    collaboration: {
      "components/collaboration-sidebar.tsx": SIDEBAR_VIEW,
    },
    "command-palette": {
      "components/command-palette.tsx": MAIN_LAYOUT,
    },
    database: {
      "components/database-sidebar.tsx": SIDEBAR_VIEW,
      "components/connection/connection-dialog.tsx": MAIN_LAYOUT,
      "providers/provider-registry.ts":
        "Database viewers by provider; the pane container picks one.",
    },
    debugger: {
      "components/debugger-view.tsx": "Debugger panel mounted in the bottom pane.",
    },
    diagnostics: {
      "components/diagnostics-buffer.tsx": PANE_VIEW,
      "components/diagnostics-activity-control.tsx": ACTIVITY_CHROME,
    },
    docker: {
      "components/docker-sidebar.tsx": SIDEBAR_VIEW,
    },
    editor: {
      "stores/buffer-index.ts":
        "Cached id/path lookups over the buffer list, used next to the buffer store.",
      "lsp/lsp-client.ts":
        "The app's LSP client; other features request hovers, symbols and edits through it.",
      "lsp/workspace-edit.ts":
        "Applies LSP workspace edits and builds file URIs for LSP and DAP callers.",
      "lsp/location-navigation.ts": "Opens LSP locations; navigation commands go through it.",
      "extensions/api.ts": "`editorAPI`, the imperative API to the active editor used by commands.",
      "formatter/formatter-service.ts": "Format document and range entry points for commands.",
      "linter/linter-service.ts":
        "Lint entry point and the diagnostic shape the diagnostics store keeps.",
      "agent-edits/agent-hunk-actions.ts": "Accept and reject agent hunks; AI commands call it.",
      "lib/wasm-parser/cache-indexeddb.ts":
        "Tree-sitter parser cache shared with the extension installer.",
      "lib/wasm-parser/converter.ts":
        "Tree-sitter runtime used by language extension installation.",
      "lib/wasm-parser/extension-assets.ts":
        "Tree-sitter asset lookup shared with language packaging.",
      "lib/wasm-parser/loader.ts": "Tree-sitter runtime used by the extension store lifecycle.",
      "lib/wasm-parser/tokenizer.ts":
        "Tree-sitter runtime used by language extension installation.",
      "lib/wasm-parser/tokenizer-worker-client.ts":
        "Off-thread tokenizer that diff and search excerpts highlight with.",
      "markdown/code-highlight.ts":
        "Markdown rendering shared with GitHub, AI chat and onboarding.",
      "markdown/highlighted-code.tsx":
        "Markdown rendering shared with GitHub, AI chat and extensions.",
      "markdown/language-map.ts": "Markdown fence language mapping shared with AI chat.",
      "markdown/parser.ts": "Markdown rendering shared with GitHub, AI chat and onboarding.",
      "markdown/styles.css": "Markdown rendering shared with GitHub, AI chat and onboarding.",
      "markdown/use-highlighted-markdown.ts": "Markdown rendering shared with onboarding.",
      "markdown/toggle-markdown-preview.ts": "Markdown preview toggle, an editor command.",
      "markdown/markdown-document-view.tsx": PANE_VIEW,
      "components/code-editor.tsx": "The text editor; panes and diff views render it.",
      "components/codemirror-readonly-view.tsx": "Read-only code view for logs and generated text.",
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
      "components/file-explorer-pane.tsx": SIDEBAR_VIEW,
      "components/file-navigator-sidebar.tsx":
        "File list/tree navigator shared by multibuffer, search, diagnostics and diff views.",
    },
    "file-system": {
      "components/ide-settings-import-dialog.tsx":
        "IDE settings import, offered by onboarding and settings.",
      "components/linux-folder-picker-dialog.tsx": MAIN_LAYOUT,
    },
    git: {
      "components/git-view.tsx": SIDEBAR_VIEW,
      "components/diff/git-diff-viewer.tsx": PANE_VIEW,
      "components/diff/diff-file-content.tsx":
        "Single-file diff body reused by GitHub pull request files.",
      "components/git-branch-manager.tsx": ACTIVITY_CHROME,
      "components/git-project-selector.tsx":
        "Repository picker reused by the GitHub pull requests view.",
      "components/inline-git-blame-card.tsx": "Blame card the editor shows for inline blame.",
    },
    github: {
      "components/github-prs-view.tsx": SIDEBAR_VIEW,
      "components/github-action-viewer.tsx": RESOURCE_VIEW,
      "components/github-create-view.tsx": RESOURCE_VIEW,
      "components/github-issue-viewer.tsx": RESOURCE_VIEW,
      "components/github-pr-viewer.tsx": RESOURCE_VIEW,
      "delivery/components/github-delivery-viewer.tsx": RESOURCE_VIEW,
      "components/github-actions-watcher.tsx": APP_SHELL,
      "components/github-auth-status.tsx": "GitHub sign-in state message reused by notifications.",
      "components/github-markdown-editor.tsx":
        "Markdown editor with GitHub preview for markdown documents.",
    },
    "global-search": {
      "components/global-search-buffer.tsx": PANE_VIEW,
    },
    keymaps: {
      "components/keybinding-row.tsx": "Keybinding table row the keyboard settings page renders.",
      "defaults/keybinding-presets.ts": "Keybinding presets offered by settings and onboarding.",
    },
    layout: {
      "components/main-layout.tsx": APP_SHELL,
      "components/zoom-indicator.tsx": APP_SHELL,
      "components/project-switcher.tsx": ACTIVITY_CHROME,
      "components/workbench-fullscreen-surface.tsx":
        "Fullscreen surface the split view renders panes into.",
    },
    "local-history": {
      "components/local-history-command.tsx": COMMAND_VIEW,
    },
    notifications: {
      "components/notification-recorder.tsx": APP_SHELL,
      "components/notifications-trigger.tsx": ACTIVITY_CHROME,
    },
    onboarding: {
      "components/onboarding-view.tsx": PANE_VIEW,
    },
    outline: {
      "components/outline-command.tsx": COMMAND_VIEW,
      "components/outline-sidebar.tsx": "Outline panel the code editor shows beside the text.",
    },
    panes: {
      "components/pane-content-chrome.tsx":
        "Header and status bar chrome for views that other features render inside a pane.",
      "components/split-view-root.tsx": MAIN_LAYOUT,
      "components/pane-node-renderer.tsx": "Renders a pane tree; the bottom pane hosts one.",
      "components/resource-buffer-view.tsx": "Resource buffer host, reused by detached windows.",
      "components/pane-resize-handle.tsx": "Split resize handle, reused by terminal splits.",
      "components/split-drop-overlay.tsx": "Split drop zones overlay, reused by terminal splits.",
    },
    "quick-open": {
      "components/quick-open.tsx": MAIN_LAYOUT,
    },
    references: {
      "components/references-buffer.tsx": PANE_VIEW,
    },
    remote: {
      "utils/remote-path.ts":
        "The `remote://` path format is the remote feature's contract with the app.",
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
      "components/settings-workbench-view.tsx": PANE_VIEW,
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
      "components/pending-buffer-close-dialog.tsx": MAIN_LAYOUT,
    },
    terminal: {
      "components/terminal-host.tsx":
        "Keeps terminal sessions alive; main layout and terminal windows mount it.",
      "components/terminal-tab.tsx": PANE_VIEW,
      "components/external-editor-terminal.tsx": PANE_VIEW,
      "components/terminal-container.tsx": "Terminal panel mounted in the bottom pane.",
    },
    viewer: {
      "components/viewer-state.tsx": "Shared loading, empty and error states for file viewers.",
      "binary/components/binary-file-viewer.tsx": PANE_VIEW,
      "image/components/image-viewer.tsx": PANE_VIEW,
      "pdf/components/pdf-viewer.tsx": PANE_VIEW,
      "csv/components/csv-preview.tsx": "CSV table preview the code editor shows for CSV files.",
    },
    views: {
      "components/custom-view.tsx": PANE_VIEW,
      "components/views-sidebar.tsx": SIDEBAR_VIEW,
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
      "detached/detached-window-protocol.ts": "Detached window URL and message protocol.",
      "detached/detached-window-owner.ts":
        "Opens and tracks detached windows for features that detach views.",
      "detached/detached-window-shell.tsx": "Window chrome for detached feature windows.",
      "detached/use-detached-window.ts":
        "Detached window lifecycle hook for detached feature windows.",
      "detached/detached-resource-service.ts": "Opens a resource buffer in its own window.",
      "detached/standalone-content-service.ts": "Opens terminals and settings in their own window.",
      "detached/detached-resource-window.tsx": APP_SHELL,
      "detached/standalone-content-window.tsx": APP_SHELL,
    },
    workspace: {
      "stores/create-workspace-scoped-store.ts":
        "Infrastructure for per-workspace stores used by most features.",
      "runtime/workspace-runtime-registry.ts":
        "Infrastructure for per-workspace stores used by most features.",
      "persistence/workspace-session-repository.ts":
        "Workspace session persistence; stores that own a session slice save and restore through it.",
      "persistence/workspace-session-codec.ts": "Workspace session snapshot format.",
      "persistence/workspace-session-save-queue.ts": "Debounced workspace session saves.",
      "persistence/workspace-ui-defaults.ts": "Default per-project UI state for the layout store.",
      "persistence/workspace-ui-session.ts":
        "Saves and restores per-project UI state on project switches.",
      "project-picker/components/project-picker.tsx": ACTIVITY_CHROME,
      "project-icons/components/project-custom-icon.tsx":
        "Project icon shown wherever a project is named.",
      "project-icons/components/project-icon-picker.tsx":
        "Project icon picker opened from the project switcher.",
      "team/components/workspace-sidebar.tsx": SIDEBAR_VIEW,
      "team/components/workspace-management-view.tsx": PANE_VIEW,
    },
    wsl: {
      "utils/wsl-path.ts":
        "The WSL path format is the wsl feature's contract with the rest of the app.",
    },
  },
};
