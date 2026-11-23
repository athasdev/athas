//! Athas settings: the same keys and defaults as `settings.json` in the web workbench
//! (`features/settings/types/settings.types.ts`, `config/default-settings.ts`), so an existing
//! settings file imports as is. Keys this build does not know are kept and written back.

pub mod import;
mod jsonc;
mod advanced;
mod schema;
mod search_keywords;
pub use advanced::is_advanced;
pub use search_keywords::search_keywords;

use std::{collections::BTreeMap, path::PathBuf};

use anyhow::{Context as _, Result};
use gpui::{App, Global};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use jsonc::parse_jsonc;
pub use schema::SETTING_DEFS;

/// Which parts of the workbench are on (Settings > Advanced > Features).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CoreFeatures {
    pub git: bool,
    pub github: bool,
    pub remote: bool,
    pub terminal: bool,
    pub search: bool,
    pub diagnostics: bool,
    pub debugger: bool,
    pub docker: bool,
    pub ai_chat: bool,
    pub team_collaboration: bool,
    pub breadcrumbs: bool,
    pub persistent_commands: bool,
}

impl Default for CoreFeatures {
    fn default() -> Self {
        Self {
            git: true,
            github: true,
            remote: true,
            terminal: true,
            search: true,
            diagnostics: true,
            debugger: true,
            docker: true,
            ai_chat: true,
            team_collaboration: true,
            breadcrumbs: true,
            persistent_commands: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    #[serde(rename = "autoSave")]
    pub auto_save: bool,
    #[serde(rename = "quickOpenPreview")]
    pub quick_open_preview: bool,
    #[serde(rename = "updateChannel")]
    pub update_channel: String,
    #[serde(rename = "autoCheckForUpdates")]
    pub auto_check_for_updates: bool,
    #[serde(rename = "confirmQuitWithRunningAgents")]
    pub confirm_quit_with_running_agents: bool,
    #[serde(rename = "fontFamily")]
    pub font_family: String,
    #[serde(rename = "fontSize")]
    pub font_size: f64,
    #[serde(rename = "editorLineHeight")]
    pub editor_line_height: f64,
    #[serde(rename = "tabSize")]
    pub tab_size: f64,
    #[serde(rename = "wordWrap")]
    pub word_wrap: bool,
    #[serde(rename = "lineNumbers")]
    pub line_numbers: bool,
    #[serde(rename = "renderWhitespace")]
    pub render_whitespace: String,
    #[serde(rename = "renderIndentGuides")]
    pub render_indent_guides: bool,
    #[serde(rename = "highlightOccurrences")]
    pub highlight_occurrences: bool,
    #[serde(rename = "showMinimap")]
    pub show_minimap: bool,
    #[serde(rename = "showOutline")]
    pub show_outline: bool,
    #[serde(rename = "editorFontLigatures")]
    pub editor_font_ligatures: bool,
    #[serde(rename = "editorItalicComments")]
    pub editor_italic_comments: bool,
    #[serde(rename = "editorStickyScroll")]
    pub editor_sticky_scroll: bool,
    #[serde(rename = "editorBracketPairColorization")]
    pub editor_bracket_pair_colorization: bool,
    /// Kept for settings files: the Tauri editor read it but nothing used it, and this build
    /// scrolls with the platform's own momentum, so it changes nothing.
    #[serde(rename = "editorSmoothScrolling")]
    pub editor_smooth_scrolling: bool,
    #[serde(rename = "editorScrollBeyondLastLine")]
    pub editor_scroll_beyond_last_line: bool,
    #[serde(rename = "editorCursorStyle")]
    pub editor_cursor_style: String,
    #[serde(rename = "editorCursorBlinking")]
    pub editor_cursor_blinking: String,
    #[serde(rename = "inlayHints")]
    pub inlay_hints: bool,
    #[serde(rename = "codeLens")]
    pub code_lens: bool,
    #[serde(rename = "semanticTokens")]
    pub semantic_tokens: bool,
    #[serde(rename = "breadcrumbShowSymbols")]
    pub breadcrumb_show_symbols: bool,
    #[serde(rename = "editorAutoCloseBrackets")]
    pub editor_auto_close_brackets: bool,
    #[serde(rename = "editorRulers")]
    pub editor_rulers: Vec<f64>,
    #[serde(rename = "editorMultiCursorModifier")]
    pub editor_multi_cursor_modifier: String,
    #[serde(rename = "terminalFontFamily")]
    pub terminal_font_family: String,
    #[serde(rename = "terminalFontSize")]
    pub terminal_font_size: f64,
    #[serde(rename = "terminalLineHeight")]
    pub terminal_line_height: f64,
    #[serde(rename = "terminalLetterSpacing")]
    pub terminal_letter_spacing: f64,
    #[serde(rename = "terminalScrollback")]
    pub terminal_scrollback: f64,
    #[serde(rename = "terminalMinimumContrastRatio")]
    pub terminal_minimum_contrast_ratio: f64,
    #[serde(rename = "terminalShellIntegration")]
    pub terminal_shell_integration: bool,
    #[serde(rename = "terminalCommandNotifications")]
    pub terminal_command_notifications: bool,
    /// One of: block, underline, bar.
    #[serde(rename = "terminalCursorStyle")]
    pub terminal_cursor_style: String,
    #[serde(rename = "terminalCursorBlink")]
    pub terminal_cursor_blink: bool,
    #[serde(rename = "terminalCursorWidth")]
    pub terminal_cursor_width: f64,
    #[serde(rename = "terminalCursorInactiveStyle")]
    pub terminal_cursor_inactive_style: String,
    #[serde(rename = "terminalAltClickMovesCursor")]
    pub terminal_alt_click_moves_cursor: bool,
    #[serde(rename = "terminalMacOptionIsMeta")]
    pub terminal_mac_option_is_meta: bool,
    #[serde(rename = "terminalRightClickSelectsWord")]
    pub terminal_right_click_selects_word: bool,
    #[serde(rename = "terminalCopyOnSelect")]
    pub terminal_copy_on_select: bool,
    #[serde(rename = "terminalBell")]
    pub terminal_bell: String,
    #[serde(rename = "terminalConfirmCloseRunning")]
    pub terminal_confirm_close_running: bool,
    /// Drew the Tauri app's terminals with WebGL. Kept for settings files; this build always draws
    /// terminals on the GPU, so it changes nothing.
    #[serde(rename = "terminalGpuAcceleration")]
    pub terminal_gpu_acceleration: bool,
    #[serde(rename = "terminalDefaultShellId")]
    pub terminal_default_shell_id: String,
    #[serde(rename = "terminalDefaultProfileId")]
    pub terminal_default_profile_id: String,
    #[serde(rename = "uiFontFamily")]
    pub ui_font_family: String,
    /// macOS: take the accent, focus ring and selection colors from System Settings.
    #[serde(rename = "systemAccentColor")]
    pub system_accent_color: bool,
    #[serde(rename = "uiFontSize")]
    pub ui_font_size: f64,
    #[serde(rename = "showTabIcons")]
    pub show_tab_icons: bool,
    #[serde(rename = "tabCloseButtonVisibility")]
    pub tab_close_button_visibility: String,
    /// Turns off transitions and animations even when the OS does not ask for reduced motion.
    #[serde(rename = "theme")]
    pub theme: String,
    #[serde(rename = "iconTheme")]
    pub icon_theme: String,
    #[serde(rename = "syncSystemTheme")]
    pub sync_system_theme: bool,
    #[serde(rename = "autoThemeLight")]
    pub auto_theme_light: String,
    #[serde(rename = "autoThemeDark")]
    pub auto_theme_dark: String,
    /// The Tauri app offered it only where it has no native menu of its own (not macOS, Windows or
    /// Linux); this build has nothing to switch, so it changes nothing.
    #[serde(rename = "nativeMenuBar")]
    pub native_menu_bar: bool,
    #[serde(rename = "compactMenuBar")]
    pub compact_menu_bar: bool,
    #[serde(rename = "windowTransparency")]
    pub window_transparency: bool,
    #[serde(rename = "openFoldersInNewWindow")]
    pub open_folders_in_new_window: bool,
    #[serde(rename = "aiProviderId")]
    pub ai_provider_id: String,
    #[serde(rename = "aiModelId")]
    pub ai_model_id: String,
    #[serde(rename = "aiCustomBaseUrl")]
    pub ai_custombase_url: String,
    #[serde(rename = "aiCustomModelId")]
    pub ai_custom_model_id: String,
    #[serde(rename = "aiCompletion")]
    pub ai_completion: bool,
    /// One of: openrouter, custom.
    #[serde(rename = "aiAutocompleteProvider")]
    pub ai_autocomplete_provider: String,
    #[serde(rename = "aiAutocompleteModelId")]
    pub ai_autocomplete_model_id: String,
    #[serde(rename = "aiAutocompleteCustomBaseUrl")]
    pub ai_autocomplete_custombase_url: String,
    #[serde(rename = "aiAutocompleteCustomModelId")]
    pub ai_autocomplete_custom_model_id: String,
    #[serde(rename = "aiDefaultSessionMode")]
    pub aidefault_session_mode: String,
    #[serde(rename = "aiAgentNotifications")]
    pub ai_agent_notifications: bool,
    /// Notify when an agent turn finishes or fails, not only when it waits on the user.
    #[serde(rename = "aiAgentFinishNotifications")]
    pub ai_agent_finish_notifications: bool,
    #[serde(rename = "aiAgentNotificationSound")]
    pub ai_agent_notification_sound: bool,
    /// Skip OS notifications while any Athas window has focus.
    #[serde(rename = "notificationsOnlyInBackground")]
    pub notifications_only_in_background: bool,
    #[serde(rename = "notificationQuietHours")]
    pub notification_quiet_hours: bool,
    /// Local time as "HH:MM"; the window may cross midnight.
    #[serde(rename = "notificationQuietHoursStart")]
    pub notification_quiet_hours_start: String,
    #[serde(rename = "notificationQuietHoursEnd")]
    pub notification_quiet_hours_end: String,
    /// Whether new agent chats start with "Follow agent" on.
    #[serde(rename = "aiFollowAgent")]
    pub ai_follow_agent: bool,
    /// Whether `claude` in a terminal can connect to Athas through `/ide`.
    #[serde(rename = "claudeCodeIdeIntegration")]
    pub claude_code_ide_integration: bool,
    /// Model requests one built-in agent turn may make before it pauses to ask to continue.
    #[serde(rename = "aiAgentMaxSteps")]
    pub ai_agent_max_steps: f64,
    #[serde(rename = "aiUserRules")]
    pub ai_user_rules: String,
    #[serde(rename = "aiSkills")]
    pub ai_skills: Vec<serde_json::Value>,
    /// MCP servers offered to agents. Secrets live in secure storage, not here.
    #[serde(rename = "mcpServers")]
    pub mcp_servers: Vec<serde_json::Value>,
    #[serde(rename = "v0DesignSystems")]
    pub v0_design_systems: Vec<serde_json::Value>,
    #[serde(rename = "activeV0DesignSystemId")]
    pub active_v0_design_system_id: String,
    #[serde(rename = "ollamaBaseUrl")]
    pub ollama_base_url: String,
    #[serde(rename = "sidebarWidth")]
    pub sidebar_width: f64,
    #[serde(rename = "showGitHubPullRequests")]
    pub show_github_pull_requests: bool,
    #[serde(rename = "showGitHubIssues")]
    pub show_github_issues: bool,
    #[serde(rename = "showGitHubActions")]
    pub show_github_actions: bool,
    #[serde(rename = "showGitHubReleases")]
    pub show_github_releases: bool,
    #[serde(rename = "showGitHubDeployments")]
    pub show_github_deployments: bool,
    #[serde(rename = "githubActionNotifications")]
    pub github_action_notifications: bool,
    /// Which credential Athas authenticates GitHub with. "auto" prefers a pasted personal access token, then the Athas account token, then the `gh` CLI. Pin a source when the Athas token authenticates but cannot see the repos you need — an organization that has not approved the Athas OAuth app.
    /// One of: auto, athas, pat, gh.
    #[serde(rename = "githubTokenSource")]
    pub github_token_source: String,
    /// One of: none, vscode, jetbrains, sublime, xcode, atom, emacs, zed.
    #[serde(rename = "keybindingPreset")]
    pub keybinding_preset: String,
    #[serde(rename = "vimMode")]
    pub vim_mode: bool,
    #[serde(rename = "vimRelativeLineNumbers")]
    pub vim_relative_line_numbers: bool,
    #[serde(rename = "defaultLanguage")]
    pub default_language: String,
    #[serde(rename = "autoDetectLanguage")]
    pub auto_detect_language: bool,
    #[serde(rename = "formatOnSave")]
    pub format_on_save: bool,
    #[serde(rename = "trimTrailingWhitespaceOnSave")]
    pub trim_trailing_whitespace_on_save: bool,
    #[serde(rename = "insertFinalNewlineOnSave")]
    pub insert_final_newline_on_save: bool,
    #[serde(rename = "formatter")]
    pub formatter: String,
    #[serde(rename = "lintOnSave")]
    pub lint_on_save: bool,
    #[serde(rename = "autoCompletion")]
    pub auto_completion: bool,
    #[serde(rename = "parameterHints")]
    pub parameter_hints: bool,
    /// One of: none, nvim, helix, vim, custom.
    #[serde(rename = "externalEditor")]
    pub external_editor: String,
    #[serde(rename = "customEditorCommand")]
    pub custom_editor_command: String,
    #[serde(rename = "coreFeatures")]
    pub core_features: CoreFeatures,
    #[serde(rename = "enterpriseManagedMode")]
    pub enterprise_managed_mode: bool,
    #[serde(rename = "enterpriseRequireExtensionAllowlist")]
    pub enterprise_require_extension_allowlist: bool,
    #[serde(rename = "enterpriseAllowedExtensionIds")]
    pub enterprise_allowed_extension_ids: Vec<String>,
    #[serde(rename = "lastSettingsTab")]
    pub last_settings_tab: String,
    /// One of: all, core, language, theme, icon-theme, snippet, ai, integration, skill, agent.
    #[serde(rename = "extensionsActiveTab")]
    pub extensions_active_tab: String,
    #[serde(rename = "maxOpenTabs")]
    pub max_open_tabs: f64,
    #[serde(rename = "horizontalTabScroll")]
    pub horizontal_tab_scroll: bool,
    #[serde(rename = "fileTreeSortOrder")]
    pub file_tree_sort_order: String,
    #[serde(rename = "fileTreeIndentSize")]
    pub file_tree_indent_size: f64,
    #[serde(rename = "compactFoldersInFileTree")]
    pub compact_folders_in_file_tree: bool,
    #[serde(rename = "hideRootFolderInFileTree")]
    pub hide_root_folder_in_file_tree: bool,
    #[serde(rename = "autoRevealActiveFileInFileTree")]
    pub auto_reveal_active_file_in_file_tree: bool,
    #[serde(rename = "showFileIconsInFileTree")]
    pub show_file_icons_in_file_tree: bool,
    #[serde(rename = "showFolderArrowsInFileTree")]
    pub show_folder_arrows_in_file_tree: bool,
    #[serde(rename = "showIndentGuidesInFileTree")]
    pub show_indent_guides_in_file_tree: bool,
    #[serde(rename = "confirmBeforeFileDelete")]
    pub confirmbefore_file_delete: bool,
    #[serde(rename = "showHiddenFilesInFileTree")]
    pub show_hidden_files_in_file_tree: bool,
    #[serde(rename = "showGitignoredFilesInFileTree")]
    pub show_gitignored_files_in_file_tree: bool,
    #[serde(rename = "hiddenFilePatterns")]
    pub hidden_file_patterns: Vec<String>,
    #[serde(rename = "hiddenDirectoryPatterns")]
    pub hidden_directory_patterns: Vec<String>,
    #[serde(rename = "searchExcludePatterns")]
    pub search_exclude_patterns: Vec<String>,
    #[serde(rename = "largeFileThresholdMB")]
    pub large_file_threshold_mb: f64,
    #[serde(rename = "gitChangesFolderView")]
    pub git_changes_folder_view: bool,
    #[serde(rename = "confirmBeforeDiscard")]
    pub confirmbefore_discard: bool,
    #[serde(rename = "autoRefreshGitStatus")]
    pub auto_refresh_git_status: bool,
    /// Minutes between background fetches of the active repository; 0 turns it off.
    #[serde(rename = "gitAutoFetchInterval")]
    pub git_auto_fetch_interval: f64,
    #[serde(rename = "gitPullRebase")]
    pub git_pull_rebase: bool,
    #[serde(rename = "gitSignOffCommits")]
    pub git_sign_off_commits: bool,
    /// Initial branch for repositories Athas initializes; empty uses git's default.
    #[serde(rename = "gitDefaultBranchName")]
    pub git_default_branch_name: String,
    #[serde(rename = "showUntrackedFiles")]
    pub show_untracked_files: bool,
    #[serde(rename = "showStagedFirst")]
    pub show_staged_first: bool,
    /// One of: unified, split.
    #[serde(rename = "gitDefaultDiffView")]
    pub git_default_diff_view: String,
    #[serde(rename = "openDiffOnClick")]
    pub open_diff_on_click: bool,
    #[serde(rename = "showGitStatusInFileTree")]
    pub show_git_status_in_file_tree: bool,
    #[serde(rename = "compactGitStatusBadges")]
    pub compact_git_status_badges: bool,
    #[serde(rename = "collapseEmptyGitSections")]
    pub collapse_empty_git_sections: bool,
    #[serde(rename = "rememberLastGitPanelMode")]
    pub remember_last_git_panel_mode: bool,
    #[serde(rename = "gitLastPanelMode")]
    pub git_last_panel_mode: String,
    #[serde(rename = "gitSidebarTabOrder")]
    pub git_sidebar_tab_order: Vec<String>,
    #[serde(rename = "hiddenGitSidebarItems")]
    pub hidden_git_sidebar_items: Vec<String>,
    #[serde(rename = "githubSidebarSectionOrder")]
    pub github_sidebar_section_order: Vec<String>,
    #[serde(rename = "enableInlineGitBlame")]
    pub enable_inline_git_blame: bool,
    #[serde(rename = "telemetry")]
    pub telemetry: bool,
    /// Keys from other versions, kept so saving does not drop them.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_save: false,
            quick_open_preview: true,
            update_channel: "stable".into(),
            auto_check_for_updates: true,
            confirm_quit_with_running_agents: true,
            font_family: "JetBrains Mono".into(),
            font_size: 14.0,
            editor_line_height: 1.4,
            tab_size: 2.0,
            word_wrap: false,
            line_numbers: true,
            render_whitespace: "none".into(),
            render_indent_guides: true,
            highlight_occurrences: true,
            show_minimap: false,
            show_outline: false,
            editor_font_ligatures: false,
            editor_italic_comments: false,
            editor_sticky_scroll: false,
            editor_bracket_pair_colorization: true,
            editor_smooth_scrolling: false,
            editor_scroll_beyond_last_line: false,
            editor_cursor_style: "line".into(),
            editor_cursor_blinking: "blink".into(),
            inlay_hints: true,
            code_lens: true,
            semantic_tokens: true,
            breadcrumb_show_symbols: true,
            editor_auto_close_brackets: true,
            editor_rulers: Vec::new(),
            editor_multi_cursor_modifier: "alt".into(),
            terminal_font_family: "JetBrains Mono".into(),
            terminal_font_size: 14.0,
            terminal_line_height: 1.0,
            terminal_letter_spacing: 0.0,
            terminal_scrollback: 10000.0,
            terminal_minimum_contrast_ratio: 4.5,
            terminal_shell_integration: true,
            terminal_command_notifications: true,
            terminal_cursor_style: "bar".into(),
            terminal_cursor_blink: true,
            terminal_cursor_width: 2.0,
            terminal_cursor_inactive_style: "outline".into(),
            terminal_alt_click_moves_cursor: true,
            terminal_mac_option_is_meta: false,
            terminal_right_click_selects_word: false,
            terminal_copy_on_select: false,
            terminal_bell: "off".into(),
            terminal_confirm_close_running: true,
            terminal_gpu_acceleration: true,
            terminal_default_shell_id: "".into(),
            terminal_default_profile_id: "".into(),
            ui_font_family: "Inter".into(),
            system_accent_color: true,
            ui_font_size: 13.0,
            show_tab_icons: true,
            tab_close_button_visibility: "active".into(),
            theme: "athas-dark".into(),
            icon_theme: "pierre-icons-complete".into(),
            sync_system_theme: true,
            auto_theme_light: "athas-light".into(),
            auto_theme_dark: "athas-dark".into(),
            native_menu_bar: false,
            compact_menu_bar: true,
            window_transparency: false,
            open_folders_in_new_window: true,
            ai_provider_id: "athas".into(),
            ai_model_id: "auto".into(),
            ai_custombase_url: "".into(),
            ai_custom_model_id: "".into(),
            ai_completion: true,
            ai_autocomplete_provider: "openrouter".into(),
            ai_autocomplete_model_id: "mistralai/devstral-small".into(),
            ai_autocomplete_custombase_url: "".into(),
            ai_autocomplete_custom_model_id: "".into(),
            aidefault_session_mode: "".into(),
            ai_agent_notifications: true,
            ai_agent_finish_notifications: true,
            ai_agent_notification_sound: false,
            notifications_only_in_background: false,
            notification_quiet_hours: false,
            notification_quiet_hours_start: "22:00".into(),
            notification_quiet_hours_end: "08:00".into(),
            ai_follow_agent: false,
            claude_code_ide_integration: true,
            ai_agent_max_steps: 25.0,
            ai_user_rules: "".into(),
            ai_skills: Vec::new(),
            mcp_servers: Vec::new(),
            v0_design_systems: Vec::new(),
            active_v0_design_system_id: "".into(),
            ollama_base_url: "http://localhost:11434".into(),
            sidebar_width: 220.0,
            show_github_pull_requests: true,
            show_github_issues: true,
            show_github_actions: true,
            show_github_releases: true,
            show_github_deployments: true,
            github_action_notifications: false,
            github_token_source: "auto".into(),
            keybinding_preset: "none".into(),
            vim_mode: false,
            vim_relative_line_numbers: false,
            default_language: "auto".into(),
            auto_detect_language: true,
            format_on_save: false,
            trim_trailing_whitespace_on_save: false,
            insert_final_newline_on_save: false,
            formatter: "prettier".into(),
            lint_on_save: false,
            auto_completion: true,
            parameter_hints: true,
            external_editor: "none".into(),
            custom_editor_command: "".into(),
            core_features: CoreFeatures::default(),
            enterprise_managed_mode: false,
            enterprise_require_extension_allowlist: false,
            enterprise_allowed_extension_ids: Vec::new(),
            last_settings_tab: "general".into(),
            extensions_active_tab: "all".into(),
            max_open_tabs: 100.0,
            horizontal_tab_scroll: false,
            file_tree_sort_order: "folders-first".into(),
            file_tree_indent_size: 16.0,
            compact_folders_in_file_tree: false,
            hide_root_folder_in_file_tree: false,
            auto_reveal_active_file_in_file_tree: true,
            show_file_icons_in_file_tree: true,
            show_folder_arrows_in_file_tree: false,
            show_indent_guides_in_file_tree: true,
            confirmbefore_file_delete: true,
            show_hidden_files_in_file_tree: true,
            show_gitignored_files_in_file_tree: true,
            hidden_file_patterns: Vec::new(),
            hidden_directory_patterns: Vec::new(),
            search_exclude_patterns: Vec::new(),
            large_file_threshold_mb: 20.0,
            git_changes_folder_view: false,
            confirmbefore_discard: true,
            auto_refresh_git_status: true,
            git_auto_fetch_interval: 0.0,
            git_pull_rebase: false,
            git_sign_off_commits: false,
            git_default_branch_name: "".into(),
            show_untracked_files: true,
            show_staged_first: true,
            git_default_diff_view: "unified".into(),
            open_diff_on_click: true,
            show_git_status_in_file_tree: true,
            compact_git_status_badges: false,
            collapse_empty_git_sections: false,
            remember_last_git_panel_mode: false,
            git_last_panel_mode: "changes".into(),
            git_sidebar_tab_order: vec!["changes".into(), "history".into()],
            hidden_git_sidebar_items: Vec::new(),
            github_sidebar_section_order: vec!["pull-requests".into(), "issues".into(), "actions".into(), "releases".into(), "deployments".into()],
            enable_inline_git_blame: true,
            telemetry: false,
            extra: BTreeMap::new(),
        }
    }
}

/// How a settings row edits its value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SettingKind {
    Toggle,
    /// A switch that is on when the setting is off, such as "Respect .gitignore".
    InvertedToggle,
    Select(&'static [(&'static str, &'static str)]),
    Number { min: f64, max: f64, step: f64 },
    Text,
    /// A list of strings, edited as comma-separated text.
    List,
    /// Positive whole numbers, edited as comma-separated text (`editorRulers`).
    Columns,
    /// A local time of day, `HH:MM`.
    Time,
    /// One of the shells installed on this machine, or the system default (`""`).
    Shell,
    /// One of the terminal profiles, or the default terminal (`""`).
    Profile,
    /// A font family, picked from the system's fonts.
    Font { monospace: bool },
    /// A row that runs something (sign in, install the CLI) rather than holding a value.
    Action,
    /// A row a page's own view draws (theme cards, API keys, shortcuts): listed for search only,
    /// and opening it scrolls to the section that holds it.
    View,
}

/// One row of the Settings view.
#[derive(Clone, Copy, Debug)]
pub struct SettingDef {
    /// The Settings page: general, appearance, editor, …
    pub tab: &'static str,
    pub section: Option<&'static str>,
    pub label: &'static str,
    pub description: Option<&'static str>,
    pub key: Option<&'static str>,
    pub kind: SettingKind,
}

/// The pages of the Settings view, in order, with their icon names (`config/settings-tabs.ts`).
pub const SETTINGS_PAGES: &[(&str, &str)] = &[
    ("general", "General"),
    ("account", "Account"),
    ("appearance", "Appearance"),
    ("notifications", "Notifications"),
    ("editor", "Editor"),
    ("file-explorer", "Files"),
    ("git", "Git"),
    ("terminal", "Terminal"),
    ("keyboard", "Keybindings"),
    ("ai", "AI"),
    ("integrations", "Integrations"),
    ("team", "Team"),
    ("advanced", "Advanced"),
];

impl Settings {
    fn as_map(&self) -> serde_json::Map<String, Value> {
        match serde_json::to_value(self) {
            Ok(Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        }
    }

    /// The value stored under a `settings.json` key; `coreFeatures.git` reaches into an object.
    pub fn get(&self, key: &str) -> Option<Value> {
        let mut map = self.as_map();
        match key.split_once('.') {
            Some((outer, inner)) => map.remove(outer)?.get(inner).cloned(),
            None => map.remove(key),
        }
    }

    /// Sets a value by its `settings.json` key; a value of the wrong type is refused.
    pub fn set(&mut self, key: &str, value: Value) -> Result<()> {
        let mut map = self.as_map();
        match key.split_once('.') {
            Some((outer, inner)) => match map.get_mut(outer) {
                Some(Value::Object(object)) => {
                    object.insert(inner.to_string(), value);
                }
                _ => anyhow::bail!("setting {key}: {outer} is not an object"),
            },
            None => {
                map.insert(key.to_string(), value);
            }
        }
        *self = serde_json::from_value(Value::Object(map)).with_context(|| format!("setting {key}"))?;
        Ok(())
    }

    pub fn reset(&mut self, key: &str) {
        if let Some(value) = Settings::default().get(key) {
            self.set(key, value).ok();
        }
    }

    pub fn is_default(&self, key: &str) -> bool {
        self.get(key) == Settings::default().get(key)
    }

    pub fn from_json(json: &str) -> Result<Self> {
        Ok(serde_json::from_str(json)?)
    }

    pub fn to_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(self)?)
    }
}

/// Whether a row shows on this platform with these settings (`{IS_MAC && …}`,
/// `{externalEditor === "custom" ? … : null}` in the tabs).
pub fn row_visible(def: &SettingDef, settings: &Settings) -> bool {
    let mac = cfg!(target_os = "macos");
    match def.key {
        Some("customEditorCommand") => settings.external_editor == "custom",
        Some("systemAccentColor") => mac,
        Some("nativeMenuBar") => cfg!(target_family = "wasm"),
        Some("compactMenuBar") => !mac,
        _ => true,
    }
}

/// Whether a row's control takes input, or waits on the setting it depends on.
pub fn row_enabled(def: &SettingDef, settings: &Settings) -> bool {
    match def.key {
        Some("vimRelativeLineNumbers") => settings.line_numbers,
        Some("compactMenuBar") => !settings.native_menu_bar,
        Some("aiAgentFinishNotifications" | "aiAgentNotificationSound") => settings.ai_agent_notifications,
        Some("terminalCommandNotifications" | "terminalConfirmCloseRunning") => settings.terminal_shell_integration,
        Some("notificationQuietHoursStart" | "notificationQuietHoursEnd") => settings.notification_quiet_hours,
        _ => true,
    }
}

/// `HH:MM` on a 24-hour clock.
pub fn is_time_of_day(text: &str) -> bool {
    let Some((hours, minutes)) = text.split_once(':') else { return false };
    let valid = |part: &str, limit: u32| part.len() == 2 && part.parse::<u32>().is_ok_and(|value| value < limit);
    valid(hours, 24) && valid(minutes, 60)
}

/// Checks a value against what its Settings row allows: one of a select's options, a number in
/// the stepper's range, a time of day.
pub fn validate(key: &str, value: &Value) -> std::result::Result<(), String> {
    let Some(def) = SETTING_DEFS.iter().find(|def| def.key == Some(key)) else { return Ok(()) };
    match def.kind {
        SettingKind::Select(options) => match value.as_str() {
            Some(text) if options.iter().any(|(option, _)| *option == text) => Ok(()),
            _ => Err(format!(
                "must be one of {}",
                options.iter().map(|(option, _)| format!("\"{option}\"")).collect::<Vec<_>>().join(", ")
            )),
        },
        SettingKind::Number { min, max, .. } => match value.as_f64() {
            Some(number) if (min..=max).contains(&number) => Ok(()),
            Some(_) => Err(format!("must be between {min} and {max}")),
            None => Err("must be a number".into()),
        },
        SettingKind::Time => match value.as_str() {
            Some(text) if is_time_of_day(text) => Ok(()),
            _ => Err("must be a time like \"22:00\"".into()),
        },
        SettingKind::Columns => match value.as_array() {
            Some(items) if items.iter().all(|item| item.as_u64().is_some_and(|column| column > 0)) => Ok(()),
            _ => Err("must be a list of positive column numbers".into()),
        },
        _ => Ok(()),
    }
}

/// A problem with `settings.json`: a key with a value Athas cannot use, or the file not being
/// JSON at all (with where the parser stopped).
#[derive(Clone, Debug, PartialEq)]
pub struct SettingIssue {
    pub key: Option<String>,
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

impl std::fmt::Display for SettingIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (&self.key, self.line, self.column) {
            (Some(key), _, _) => write!(f, "{key}: {}", self.message),
            (None, Some(line), Some(column)) => write!(f, "Line {line}, column {column}: {}", self.message),
            _ => write!(f, "{}", self.message),
        }
    }
}

/// Reads `settings.json` as a person edited it: comments and trailing commas are fine, a key with
/// a wrong value keeps its current value and is reported, unknown keys are kept. Text that is not
/// JSON is an error with its position.
pub fn parse_edited(text: &str, current: &Settings) -> std::result::Result<(Settings, Vec<SettingIssue>), SettingIssue> {
    let value = parse_jsonc(text).map_err(|error| {
        let (line, column) = error.downcast_ref::<serde_json::Error>().map_or((None, None), |error| (Some(error.line()), Some(error.column())));
        SettingIssue { key: None, message: error.to_string(), line, column }
    })?;
    let Value::Object(object) = value else {
        return Err(SettingIssue { key: None, message: "settings.json must hold an object".into(), line: Some(1), column: Some(1) });
    };
    let known = Settings::default().as_map();
    let mut settings = Settings::default();
    let mut issues = Vec::new();
    for (key, value) in object {
        if !known.contains_key(&key) {
            settings.extra.insert(key, value);
            continue;
        }
        let checked = match &value {
            Value::Object(fields) => fields.iter().try_for_each(|(field, inner)| validate(&format!("{key}.{field}"), inner)),
            other => validate(&key, other),
        };
        let result = checked.and_then(|()| settings.set(&key, value).map_err(|error| format!("{:#}", error.root_cause())));
        if let Err(message) = result {
            if let Some(kept) = current.get(&key) {
                settings.set(&key, kept).ok();
            }
            issues.push(SettingIssue { key: Some(key), message, line: None, column: None });
        }
    }
    Ok((settings, issues))
}

/// Editor settings an extension changed for this session (`editor.updateSettings`). They sit on
/// top of the user's settings until cleared or the app quits, and are never saved.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EditorOverrides {
    pub font_size: Option<f64>,
    pub line_height: Option<f64>,
    pub tab_size: Option<f64>,
    pub line_numbers: Option<bool>,
    pub word_wrap: Option<bool>,
    pub render_whitespace: Option<String>,
    pub render_indent_guides: Option<bool>,
}

impl EditorOverrides {
    /// The overridable keys of an `EditorSettings` object; others, and values of the wrong type,
    /// are ignored.
    pub fn from_json(value: &Value) -> Self {
        let number = |key: &str| value.get(key).and_then(Value::as_f64).filter(|number| number.is_finite() && *number > 0.0);
        let flag = |key: &str| value.get(key).and_then(Value::as_bool);
        Self {
            font_size: number("fontSize"),
            line_height: number("lineHeight"),
            tab_size: number("tabSize"),
            line_numbers: flag("lineNumbers"),
            word_wrap: flag("wordWrap"),
            render_whitespace: value
                .get("renderWhitespace")
                .and_then(Value::as_str)
                .filter(|mode| ["none", "selection", "trailing", "all", "boundary"].contains(mode))
                .map(str::to_string),
            render_indent_guides: flag("renderIndentGuides"),
        }
    }

    fn merge(&mut self, other: EditorOverrides) {
        self.font_size = other.font_size.or(self.font_size);
        self.line_height = other.line_height.or(self.line_height);
        self.tab_size = other.tab_size.or(self.tab_size);
        self.line_numbers = other.line_numbers.or(self.line_numbers);
        self.word_wrap = other.word_wrap.or(self.word_wrap);
        self.render_whitespace = other.render_whitespace.or(self.render_whitespace.take());
        self.render_indent_guides = other.render_indent_guides.or(self.render_indent_guides);
    }

    /// Drops the overrides masking settings the user just changed, so their value takes effect.
    fn drop_changed(&mut self, before: &Settings, after: &Settings) {
        if before.font_size != after.font_size {
            self.font_size = None;
        }
        if before.editor_line_height != after.editor_line_height {
            self.line_height = None;
        }
        if before.tab_size != after.tab_size {
            self.tab_size = None;
        }
        if before.line_numbers != after.line_numbers {
            self.line_numbers = None;
        }
        if before.word_wrap != after.word_wrap {
            self.word_wrap = None;
        }
        if before.render_whitespace != after.render_whitespace {
            self.render_whitespace = None;
        }
        if before.render_indent_guides != after.render_indent_guides {
            self.render_indent_guides = None;
        }
    }

    /// `settings` with these overrides applied.
    pub fn apply(&self, settings: &Settings) -> Settings {
        let mut out = settings.clone();
        out.font_size = self.font_size.unwrap_or(out.font_size);
        out.editor_line_height = self.line_height.unwrap_or(out.editor_line_height);
        out.tab_size = self.tab_size.unwrap_or(out.tab_size);
        out.line_numbers = self.line_numbers.unwrap_or(out.line_numbers);
        out.word_wrap = self.word_wrap.unwrap_or(out.word_wrap);
        if let Some(mode) = &self.render_whitespace {
            out.render_whitespace = mode.clone();
        }
        out.render_indent_guides = self.render_indent_guides.unwrap_or(out.render_indent_guides);
        out
    }
}

/// The settings in use, and where they are saved.
pub struct SettingsStore {
    /// The user's settings, as saved.
    settings: Settings,
    /// `settings` with the session's editor overrides applied, which everything reads.
    effective: Settings,
    overrides: EditorOverrides,
    path: Option<PathBuf>,
    /// What this build last wrote to or read from `path`, so a change on disk is told apart from
    /// its own saves.
    last_disk: Option<String>,
    /// `last_disk` could not be read as settings: the next save keeps a backup of it.
    disk_unreadable: bool,
}

impl Global for SettingsStore {}

/// `settings.json` of this app.
#[cfg(not(target_family = "wasm"))]
pub fn default_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("settings.json"))
}

/// The settings file of the Tauri app, imported on the first run.
#[cfg(not(target_family = "wasm"))]
pub fn legacy_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("com.code.athas").join("settings.json"))
}

/// Loads the settings from `path`; on the first run, from the Tauri app's file.
pub fn load(path: Option<PathBuf>, legacy: Option<PathBuf>) -> Settings {
    let read = |path: &Option<PathBuf>| path.as_ref().and_then(|path| std::fs::read_to_string(path).ok());
    let json = read(&path).or_else(|| read(&legacy));
    let Some(json) = json else { return Settings::default() };
    match Settings::from_json(&json) {
        Ok(settings) => settings,
        // A comment or one value of the wrong type must not cost every other setting: read it
        // the way an edit in the editor is read, key by key.
        Err(error) => match parse_edited(&json, &Settings::default()) {
            Ok((settings, _)) => settings,
            Err(_) => {
                eprintln!("settings: could not read settings: {error:#}");
                Settings::default()
            }
        },
    }
}

pub fn init(cx: &mut App, settings: Settings, path: Option<PathBuf>) {
    let last_disk = path.as_ref().and_then(|path| std::fs::read_to_string(path).ok());
    let effective = settings.clone();
    let disk_unreadable = last_disk.as_deref().is_some_and(|text| parse_jsonc(text).is_err());
    cx.set_global(SettingsStore { settings, effective, overrides: EditorOverrides::default(), path, last_disk, disk_unreadable });
}

/// Where the settings in use are saved, when they are.
pub fn path(cx: &App) -> Option<PathBuf> {
    cx.try_global::<SettingsStore>().and_then(|store| store.path.clone())
}

/// Applies `settings.json` when something other than this build changed it, such as the file
/// open in the editor being saved. `None` when the file is as this build left it; otherwise the
/// keys that were refused, or why the file could not be read.
pub fn reload_from_disk(cx: &mut App) -> Option<std::result::Result<Vec<SettingIssue>, SettingIssue>> {
    let store = cx.try_global::<SettingsStore>()?;
    let path = store.path.clone()?;
    let text = std::fs::read_to_string(&path).ok()?;
    if store.last_disk.as_deref() == Some(text.as_str()) {
        return None;
    }
    let parsed = parse_edited(&text, &store.settings);
    let store = cx.global_mut::<SettingsStore>();
    store.last_disk = Some(text);
    store.disk_unreadable = parsed.is_err();
    Some(parsed.map(|(settings, issues)| {
        store.overrides.drop_changed(&store.settings, &settings);
        store.settings = settings;
        store.effective = store.overrides.apply(&store.settings);
        issues
    }))
}

/// The settings in effect: the user's, with any editor overrides of this session on top.
pub fn get(cx: &App) -> &Settings {
    &cx.global::<SettingsStore>().effective
}

/// The user's settings as saved, without this session's editor overrides.
pub fn saved(cx: &App) -> &Settings {
    &cx.global::<SettingsStore>().settings
}

/// The editor overrides an extension set for this session.
pub fn editor_overrides(cx: &App) -> &EditorOverrides {
    &cx.global::<SettingsStore>().overrides
}

/// Lays `overrides` over the editor settings for this session, without saving them.
pub fn set_editor_overrides(cx: &mut App, overrides: EditorOverrides) {
    let store = cx.global_mut::<SettingsStore>();
    store.overrides.merge(overrides);
    store.effective = store.overrides.apply(&store.settings);
}

/// Drops every editor override, back to the user's settings.
pub fn clear_editor_overrides(cx: &mut App) {
    let store = cx.global_mut::<SettingsStore>();
    store.overrides = EditorOverrides::default();
    store.effective = store.settings.clone();
}

/// Changes the settings, saves them and lets observers of `SettingsStore` know. The closure sees
/// the user's settings; an editor override of a key it changes is dropped.
pub fn update(cx: &mut App, change: impl FnOnce(&mut Settings)) {
    let store = cx.global_mut::<SettingsStore>();
    // The file changed since this build last read or wrote it (an edit not applied yet), or it
    // is not JSON: the change goes on top of the file's settings, and text that cannot be read
    // is kept beside it before it is replaced.
    if let Some(path) = store.path.clone()
        && let Ok(disk) = std::fs::read_to_string(&path)
        && (store.disk_unreadable || store.last_disk.as_deref() != Some(disk.as_str()))
    {
        match parse_edited(&disk, &store.settings) {
            Ok((settings, _)) => {
                store.overrides.drop_changed(&store.settings, &settings);
                store.settings = settings;
            }
            Err(_) => {
                let _ = std::fs::write(path.with_extension("json.backup"), &disk);
            }
        }
        store.disk_unreadable = false;
    }
    let before = store.settings.clone();
    change(&mut store.settings);
    store.overrides.drop_changed(&before, &store.settings);
    store.effective = store.overrides.apply(&store.settings);
    if let Some(path) = &store.path {
        match save(&store.settings, path) {
            Ok(json) => store.last_disk = Some(json),
            Err(error) => eprintln!("settings: could not save: {error:#}"),
        }
    }
}

fn save(settings: &Settings, path: &PathBuf) -> Result<String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = settings.to_json()?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, &json)?;
    std::fs::rename(&temporary, path)?;
    Ok(json)
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_comment_or_a_bad_value_does_not_reset_the_settings() {
        let dir = std::env::temp_dir().join(format!("athas-settings-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(&path, "{\n  // mine\n  \"fontSize\": 19,\n  \"tabSize\": \"four\"\n}").unwrap();
        let settings = super::load(Some(path.clone()), None);
        assert_eq!(settings.font_size, 19.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    use super::*;

    #[test]
    fn editor_overrides_sit_on_top_until_the_setting_changes() {
        let base = Settings::default();
        let mut overrides = EditorOverrides::from_json(&serde_json::json!({ "fontSize": 20, "wordWrap": true, "theme": "x", "tabSize": "4", "renderWhitespace": "all" }));
        assert_eq!(overrides.font_size, Some(20.0));
        assert_eq!(overrides.tab_size, None);
        let effective = overrides.apply(&base);
        assert_eq!((effective.font_size, effective.word_wrap, effective.render_whitespace.as_str()), (20.0, true, "all"));
        overrides.merge(EditorOverrides { tab_size: Some(8.0), ..Default::default() });
        assert_eq!((overrides.font_size, overrides.tab_size), (Some(20.0), Some(8.0)));
        let mut changed = base.clone();
        changed.font_size = 16.0;
        overrides.drop_changed(&base, &changed);
        assert_eq!(overrides.font_size, None);
        assert_eq!(overrides.apply(&changed).font_size, 16.0);
        assert_eq!(overrides.word_wrap, Some(true));
    }

    #[test]
    fn defaults_match_the_web_workbench() {
        let settings = Settings::default();
        assert_eq!(settings.tab_size, 2.0);
        assert_eq!(settings.theme, "athas-dark");
        assert!(settings.sync_system_theme);
        assert_eq!(settings.git_sidebar_tab_order, vec!["changes".to_string(), "history".to_string()]);
    }

    #[test]
    fn unknown_keys_survive_a_round_trip() {
        let settings = Settings::from_json(r#"{"tabSize": 4, "someFutureKey": [1, 2]}"#).unwrap();
        assert_eq!(settings.tab_size, 4.0);
        let back: Value = serde_json::from_str(&settings.to_json().unwrap()).unwrap();
        assert_eq!(back["someFutureKey"], serde_json::json!([1, 2]));
    }

    #[test]
    fn set_and_reset_by_key() {
        let mut settings = Settings::default();
        settings.set("wordWrap", Value::Bool(true)).unwrap();
        assert!(settings.word_wrap);
        assert!(!settings.is_default("wordWrap"));
        assert!(settings.set("wordWrap", Value::String("yes".into())).is_err());
        settings.reset("wordWrap");
        assert!(settings.is_default("wordWrap"));
    }

    #[test]
    fn every_row_names_a_known_key() {
        let defaults = Settings::default();
        for def in SETTING_DEFS {
            if let Some(key) = def.key {
                assert!(defaults.get(key).is_some(), "{key}");
            }
            assert!(SETTINGS_PAGES.iter().any(|(id, _)| *id == def.tab), "{}", def.tab);
        }
    }

    #[test]
    fn nested_keys_reach_into_objects() {
        let mut settings = Settings::default();
        assert_eq!(settings.get("coreFeatures.git"), Some(Value::Bool(true)));
        settings.set("coreFeatures.git", Value::Bool(false)).unwrap();
        assert!(!settings.core_features.git);
        assert!(settings.core_features.github);
        assert!(!settings.is_default("coreFeatures.git"));
        settings.reset("coreFeatures.git");
        assert!(settings.core_features.git);
    }

    #[test]
    fn values_are_checked_against_their_rows() {
        assert!(validate("renderWhitespace", &Value::String("all".into())).is_ok());
        assert!(validate("renderWhitespace", &Value::String("most".into())).is_err());
        assert!(validate("tabSize", &serde_json::json!(4)).is_ok());
        assert!(validate("tabSize", &serde_json::json!(40)).is_err());
        assert!(validate("notificationQuietHoursStart", &serde_json::json!("07:30")).is_ok());
        assert!(validate("notificationQuietHoursStart", &serde_json::json!("7:30")).is_err());
        assert!(validate("editorRulers", &serde_json::json!([80, 120])).is_ok());
        assert!(validate("editorRulers", &serde_json::json!([0])).is_err());
        assert!(validate("someFutureKey", &serde_json::json!(1)).is_ok());
    }

    #[test]
    fn an_edited_file_applies_what_it_can() {
        let current = Settings { tab_size: 4.0, word_wrap: true, font_size: 16.0, ..Default::default() };
        let text = "{\n  // two spaces\n  \"tabSize\": 2,\n  \"fontSize\": \"big\",\n  \"renderWhitespace\": \"most\",\n  \"someFutureKey\": 1,\n}";
        let (settings, issues) = parse_edited(text, &current).unwrap();
        assert_eq!(settings.tab_size, 2.0);
        // A key the file leaves out goes back to its default, as the file is the whole settings.
        assert!(!settings.word_wrap);
        assert_eq!(settings.font_size, 16.0);
        assert_eq!(settings.render_whitespace, "none");
        assert_eq!(settings.extra["someFutureKey"], serde_json::json!(1));
        let keys: Vec<_> = issues.iter().filter_map(|issue| issue.key.as_deref()).collect();
        assert_eq!(keys, vec!["fontSize", "renderWhitespace"]);
        let error = parse_edited("{\n  \"tabSize\": 2\n  \"fontSize\": 3\n}", &current).unwrap_err();
        assert_eq!(error.line, Some(3));
        assert!(error.to_string().starts_with("Line 3"));
    }

    #[test]
    fn rows_follow_the_settings_they_depend_on() {
        let row = |key: &str| SETTING_DEFS.iter().find(|def| def.key == Some(key)).unwrap();
        let mut settings = Settings::default();
        assert!(!row_visible(row("customEditorCommand"), &settings));
        settings.external_editor = "custom".into();
        assert!(row_visible(row("customEditorCommand"), &settings));
        assert!(!row_enabled(row("notificationQuietHoursStart"), &settings));
        settings.notification_quiet_hours = true;
        assert!(row_enabled(row("notificationQuietHoursStart"), &settings));
        settings.line_numbers = false;
        assert!(!row_enabled(row("vimRelativeLineNumbers"), &settings));
    }

    #[test]
    fn number_rows_hold_their_defaults() {
        let defaults = Settings::default();
        for def in SETTING_DEFS {
            if let (Some(key), SettingKind::Number { .. } | SettingKind::Select(_)) = (def.key, def.kind) {
                let value = defaults.get(key).unwrap();
                assert!(validate(key, &value).is_ok(), "{key} = {value}");
            }
        }
    }

    #[test]
    fn disk_changes_reload_and_own_saves_do_not() {
        let dir = std::env::temp_dir().join(format!("athas-settings-reload-{}", std::process::id()));
        let path = dir.join("settings.json");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{}").unwrap();
        gpui::TestAppContext::single().update(|cx| {
            init(cx, Settings::default(), Some(path.clone()));
            assert!(reload_from_disk(cx).is_none());
            update(cx, |settings| settings.tab_size = 4.0);
            assert!(reload_from_disk(cx).is_none());
            std::fs::write(&path, r#"{"tabSize": 8, "theme": 3}"#).unwrap();
            let issues = reload_from_disk(cx).unwrap().unwrap();
            assert_eq!(get(cx).tab_size, 8.0);
            assert_eq!(issues.len(), 1);
            std::fs::write(&path, "{ nope").unwrap();
            assert!(reload_from_disk(cx).unwrap().is_err());
            assert_eq!(get(cx).tab_size, 8.0);
        });
        std::fs::remove_dir_all(&dir).ok();
    }
}
