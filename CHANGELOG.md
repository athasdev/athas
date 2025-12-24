# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2025-12-22

### Fixed
- Fix Windows build by correcting CLI module imports

## [0.3.0] - 2025-12-22

### Added
- Ollama support for local AI models
- ACP (Agent Client Protocol) integration with session modes
- GitHub pull request integration with checklist rendering
- Project picker dialog for workspace management
- Web viewer for browsing URLs in editor
- Extension system core architecture with bundled extensions
- Syntax highlighting in diff viewer
- Markdown syntax highlighting
- Terminal font settings customization
- Advanced model selector dropdown in AI chat
- ARIA accessibility descriptors for menus and tabs
- Persistent commands feature
- SSH key authentication with multiple key fallback
- Open File in Editor feature for AI agent
- Slider component and Christmas theme
- Pre-release check script for validating releases

### Changed
- Replace expandable commits with hover previews in source control
- Improve LSP integration with diagnostics
- Improve scrollbar design
- Auto-refresh Source Control when view becomes active
- Add 1 second delay before showing git blame popover
- Refactor theme system
- Extend Gemini API support

### Fixed
- Fix LSP popup position
- Fix editor viewport and line alignment bugs
- Fix terminal font rendering for Nerd Fonts
- Fix context menu positioning
- Fix sticky folder background transparency in file tree
- Fix workspace reset and terminal persistence
- Fix drag region for window on macOS
- Fix autosave functionality and dirty state logic
- Fix traffic lights for macOS 26
- Fix LSP for JavaScript/TypeScript files

## [0.2.6] - 2025-12-04

### Added
- Auto-update system with GitHub Releases integration
- Markdown preview button in editor toolbar
- Deep link support (`athas://` protocol)
- Linting service with Tauri backend support
- Symlink support for file explorer and icon themes
- Keymaps feature with customizable keyboard shortcuts
- External editor support
- Right-click context menu in editor
- Code folding in gutter
- xAI Grok models support
- Gemini 3 Pro Preview support
- Settings search functionality
- Storybook for UI development and testing

### Changed
- Migrate to tree-sitter-web for syntax highlighting
- Migrate AI chat history to SQLite
- Refactor terminal module and fix auto-create behavior
- Refactor AI chat UI
- Improve LSP client and configuration
- Improve formatter service
- Improve extension system with on-demand architecture

### Fixed
- Fix editor rendering and extension install UX
- Fix command bar not triggering
- Fix scrolling issues
- Fix Git Blame and other git issues
- Fix line numbers not showing up on big files
- Fix highlighter initialization after extension installation
- Fix HighlightLayer memo bug
- Fix editor selections
- Fix cursor position restoration and tab switching conflicts

## [0.2.4] - 2025-11-08

### Added
- Project tabs for multi-workspace support

### Changed
- Organize files by feature (vertical slice architecture)
- Refactor editor and fix overall issues

### Fixed
- Fix Windows build errors in CLI and search commands
- Fix git status rows for nested paths and stage directories correctly

### Removed
- Remove welcome screen and CLI install prompt

## [0.2.2] - 2025-10-30

### Added
- Release automation system
- Certificate import and notarization for macOS in GitHub Actions

### Changed
- Vim enhancements

## [0.2.1] - 2025-10-29

### Added
- Code signing for macOS
- New AI models and BYOK (Bring Your Own Key) settings
- Image preview and toolbar
- Extension support for syntax highlighting
- CLI command installation feature
- Setting toggles in command palette

### Changed
- Improve UX in switching projects
- Make git inline blame popup more compact

### Fixed
- Fix welcome screen theme responsiveness for light mode
- Fix viewport ref for scrolling
- Fix syntax highlighting initialization
- Fix intrusive UI on the code editor
- Fix traffic light position for macOS

## [0.1.2] - 2025-10-19

### Added
- Markdown preview
- Icon themes
- Multiple AI agents
- Individual zoom for editor, terminal, and window
- Vim commands
- Shortcut for color theme selector
- Shortcut to kill terminal process

### Changed
- Improve SQLite viewer
- Refactor cursor styles for Vim mode

### Fixed
- Fix editor syntax and search highlighting
- Fix Vim mode issues
- Fix agent dropdowns
- Fix editor scrolling

## [0.1.1] - 2025-08-27

### Added
- Git blame functionality with inline display and hover details
- Password prompt dialog for SSH connections
- Lines and columns information in footer
- Integrated menu bar with toggle option
- Global search shortcuts
- Keyboard shortcuts to text editor
- Code formatting feature
- Move line up/down functionality
- Cursor position restoration when switching files
- Highlight search results and click-to-jump
- Shell switching support
- Close editor tabs with middle click

### Changed
- Enhance remote connection handling
- Improve text selection handling
- Improve command bar performance
- Refactor clipboard utilities to use Tauri clipboard manager

### Fixed
- Fix Linux menu bar UI
- Fix zooming issues
- Fix context menu positioning when zoomed
- Fix completion dropdown not hiding after acceptance
- Fix auto-pairing logic

## [0.1.0] - 2025-08-12

Initial release

---

[0.2.6]: https://github.com/athasdev/athas/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/athasdev/athas/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/athasdev/athas/compare/v0.2.2...v0.2.4
[0.2.2]: https://github.com/athasdev/athas/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/athasdev/athas/compare/v0.1.2...v0.2.1
[0.1.2]: https://github.com/athasdev/athas/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/athasdev/athas/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/athasdev/athas/releases/tag/v0.1.0
