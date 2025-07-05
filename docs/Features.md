# Athas Editor Features

Athas is a modern, lightweight code editor with powerful features for developers. This guide covers all features and how to use them effectively.

## Table of Contents


1. [Editor Features](#editor-features)
2. [File Management](#file-management)
3. [Git Integration](#git-integration)
4. [AI Assistant](#ai-assistant)
5. [Terminal](#terminal)
6. [Search and Navigation](#search-and-navigation)
7. [Remote Development](#remote-development)
8. [Database Tools](#database-tools)
9. [Customization](#customization)
10. [Keyboard Shortcuts](#keyboard-shortcuts)

## Editor Features

### Syntax Highlighting

Athas supports syntax highlighting for 15+ languages out of the box:
- JavaScript, TypeScript, JSX, TSX
- Python, Ruby, Java, C/C++, C#
- HTML, CSS, SCSS, JSON, YAML
- Markdown, SQL, PHP, Rust, Go

Language is automatically detected based on file extension.

### Code Editing

**Basic Editing:**
- Multi-cursor support for simultaneous edits
- Smart indentation based on language
- Bracket matching and auto-closing
- Line numbers (toggleable)
- Word wrap (toggleable)
- Configurable tab size (2, 4, or 8 spaces)

**Advanced Editing:**
- **Line Operations:**
  - `Cmd/Ctrl+D` - Duplicate current line
  - `Alt+↑/↓` - Move line up/down
  - `Cmd/Ctrl+/` - Toggle comment
  - `Cmd/Ctrl+Enter` - Insert line below

### Vim Mode

Athas includes a comprehensive Vim emulation:

**Modes:**
- Normal mode (default)
- Insert mode (`i`, `a`, `o`, `O`)
- Visual mode (`v`)

**Motions:**
- Character: `h`, `j`, `k`, `l`
- Word: `w`, `b`, `e`
- Line: `0`, `$`, `^`
- Document: `G`, `gg`

**Operations:**
- Delete: `d`, `dd`, `D`, `x`
- Change: `c`, `cc`, `C`
- Yank: `y`, `yy`, `Y`
- Paste: `p`, `P`

**Visual Mode:**
- Select text with `v` + motions
- Operations work on selection
- `V` for line-wise visual mode

### Language Server Protocol (LSP)

Athas provides intelligent code assistance through LSP:

**Features:**
- Real-time error checking
- Code completions
- Hover information
- Go to definition (coming soon)
- Find references (coming soon)

**Supported Languages:**
- TypeScript/JavaScript (typescript-language-server)
- Python (pylsp)
- Ruby (solargraph)

**Using LSP:**
1. Open a supported file type
2. LSP starts automatically
3. Errors appear in the diagnostics panel
4. Completions show as you type

### AI-Powered Completions

**Inline Completions:**
- AI suggestions appear as ghost text
- `Tab` to accept
- `Escape` to dismiss
- Configurable in settings

**Supported Providers:**
- OpenAI
- Anthropic
- OpenRouter

## File Management

### File Explorer

**Navigation:**
- Click to expand/collapse folders
- Click files to open
- Right-click for context menu

**Features:**
- File icons by type
- Hidden files toggle
- Automatic .gitignore respect
- Project root detection

### Tabs

**Tab Management:**
- Click tab to switch files
- Middle-click or × to close
- Drag to reorder
- Pin important tabs

**Tab Indicators:**
- Dot indicates unsaved changes
- Different colors for file types
- Active tab highlighted

### File Operations

**Creating Files:**
1. Right-click in file tree
2. Select "New File"
3. Enter filename with extension

**Saving:**
- `Cmd/Ctrl+S` - Save current file
- Auto-save option in settings
- Virtual files have custom save handlers

## Git Integration

### Git Status View

Access git features through the sidebar git icon.

**File States:**
- **Modified** - Blue indicator
- **Added** - Green indicator
- **Deleted** - Red indicator
- **Renamed** - Purple indicator
- **Untracked** - Gray indicator

### Staging Changes

**Stage Files:**
- Click + icon next to file
- Stage all with "Stage All" button

**Unstage Files:**
- Click - icon next to staged file
- Unstage all with "Unstage All" button

### Committing

1. Stage desired changes
2. Enter commit message
3. Click "Commit" button
4. View result in git log

### Branch Management

**Current Branch:**
- Displayed at top of git view
- Click to see all branches

**Branch Operations:**
- Create new branch
- Switch branches
- Delete branches
- View commit history

### Diff Viewer

**Viewing Diffs:**
- Click on modified file in git view
- Opens split diff view

**Diff Features:**
- Syntax highlighting in diffs
- Stage/unstage individual hunks
- Copy line content
- Collapsible sections

## AI Assistant

### AI Chat

Access via the AI icon in sidebar.

**Features:**
- Multiple AI provider support
- Model selection
- Conversation history
- Code highlighting in responses
- Apply suggestions to editor

**Supported Providers:**
- OpenAI
- Anthropic (Claude)
- Google (Gemini)
- Groq
- DeepSeek
- xAI
- v0

**Using AI Chat:**
1. Open AI panel
2. Select provider and model
3. Type your question
4. Include file context with @ mentions
5. Apply code suggestions with "Apply" button

### Inline AI Completions

**Setup:**
1. Add API key in settings
2. Enable AI completions
3. Configure per file type

**Usage:**
- Completions appear automatically
- Ghost text shows suggestion
- Tab to accept
- Escape to dismiss

## Terminal

### Integrated Terminal

**Opening Terminal:**
- Click terminal icon in toolbar
- `Cmd/Ctrl+`` ` shortcut
- Resizable bottom panel

**Terminal Features:**
- Multiple sessions/tabs
- Full ANSI color support
- Working directory sync
- Command history
- Copy/paste support

**Terminal Tabs:**
- Click + for new session
- Click × to close session
- Click tab to switch
- Sessions persist until closed

## Search and Navigation

### Global Search

**Opening Search:**
- Click search icon in sidebar
- `Cmd/Ctrl+Shift+F` shortcut

**Search Options:**
- Case sensitive toggle
- Whole word matching
- Regular expression mode
- Include/exclude patterns

**Search Results:**
- Grouped by file
- Click to jump to location
- Expandable/collapsible
- Match count per file

### Command Palette

**Opening:**
- `Cmd/Ctrl+K` shortcut
- Search all commands

**Features:**
- Fuzzy search
- Recent commands
- Categorized commands
- Keyboard navigation

### Quick Open

**Opening:**
- `Cmd/Ctrl+P` shortcut
- Fuzzy file search

**Usage:**
- Type partial filename
- Arrow keys to navigate
- Enter to open
- Recent files shown first

## Remote Development

### SSH Connections

**Setting Up:**
1. Click remote icon in sidebar
2. Add new connection
3. Enter host details
4. Choose authentication method

**Authentication:**
- Password authentication
- Private key (recommended)
- Saved connections

**Remote Features:**
- Browse remote files
- Edit remotely
- Terminal access
- Secure credential storage

## Database Tools

### SQLite Viewer

**Opening SQLite Files:**
- Click .db/.sqlite files
- Automatic table detection

**Features:**
- Table browser
- Custom SQL queries
- Result pagination
- Export to CSV/JSON
- Schema viewing

**Query Editor:**
- Syntax highlighting
- Query history
- Error messages
- Performance timing

## Customization

### Themes

**Available Themes:**
Over 30 themes including:
- Dracula
- Nord
- Tokyo Night
- Catppuccin (multiple variants)
- GitHub Light/Dark
- Monokai
- Solarized

**Changing Theme:**
1. Open command palette
2. Type "theme"
3. Select desired theme

### Settings

**Accessing Settings:**
- `Cmd/Ctrl+,` shortcut
- Command palette → Settings
- Edit JSON directly

**Key Settings:**
```json
{
  "theme": "dracula",
  "fontSize": 14,
  "tabSize": 2,
  "wordWrap": false,
  "lineNumbers": true,
  "autoSave": false,
  "vimMode": false,
  "aiCompletion": true
}
```

### Core Features Toggle

Enable/disable major features:
- Git integration
- Remote development
- Terminal
- Global search
- Diagnostics panel
- AI chat

## Keyboard Shortcuts

### Essential Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Save | `Cmd+S` | `Ctrl+S` |
| Open File | `Cmd+O` | `Ctrl+O` |
| Quick Open | `Cmd+P` | `Ctrl+P` |
| Command Palette | `Cmd+K` | `Ctrl+K` |
| Find | `Cmd+F` | `Ctrl+F` |
| Global Search | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Toggle Comment | `Cmd+/` | `Ctrl+/` |
| Duplicate Line | `Cmd+D` | `Ctrl+D` |
| Settings | `Cmd+,` | `Ctrl+,` |

### Navigation

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Go to Line | `Cmd+G` | `Ctrl+G` |
| Next Tab | `Cmd+Tab` | `Ctrl+Tab` |
| Previous Tab | `Cmd+Shift+Tab` | `Ctrl+Shift+Tab` |
| Close Tab | `Cmd+W` | `Ctrl+W` |

### Editing

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Indent | `Tab` | `Tab` |
| Outdent | `Shift+Tab` | `Shift+Tab` |
| Move Line Up | `Alt+↑` | `Alt+↑` |
| Move Line Down | `Alt+↓` | `Alt+↓` |
| New Line Below | `Cmd+Enter` | `Ctrl+Enter` |

### Terminal

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Toggle Terminal | `Cmd+`` ` | `Ctrl+`` ` |
| Clear Terminal | `Cmd+K` | `Ctrl+K` |
| New Terminal | `Cmd+Shift+`` ` | `Ctrl+Shift+`` ` |

## Tips and Tricks

### Performance

1. **Large Files**: Athas handles large files well, but consider:
   - Disabling word wrap for very long lines
   - Using search instead of scrolling
   - Closing unused tabs

2. **Multiple Projects**: 
   - Use separate windows for different projects
   - Each window maintains its own state
   - Recent folders for quick access

### Productivity

1. **Vim Mode**: Learn basic vim motions for faster editing
2. **Command Palette**: Faster than menus for most actions
3. **Keyboard Shortcuts**: Memorize frequently used shortcuts
4. **AI Assistant**: Use for boilerplate code and documentation

### Troubleshooting

1. **LSP Not Working**:
   - Check language server is installed
   - Restart editor
   - Check diagnostics panel for errors

2. **Performance Issues**:
   - Disable unused features
   - Close unnecessary tabs
   - Check for large files

3. **Git Integration**:
   - Ensure git is installed
   - Check repository has .git folder
   - Refresh file tree if needed
