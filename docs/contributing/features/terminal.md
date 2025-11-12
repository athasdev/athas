# Terminal

The terminal feature integrates xterm.js with a Rust/Tauri PTY backend, providing multiple terminal sessions with tabs, split view, and profiles.

## Structure

```
src/features/terminal/
├── components/
│   ├── terminal.tsx              # xterm.js integration
│   ├── terminal-container.tsx    # Tab management and layout
│   ├── terminal-tab-bar.tsx      # Draggable tabs with context menu
│   └── terminal-search.tsx       # Search overlay
├── hooks/
│   └── use-terminal-tabs.ts      # Terminal state management
└── types/
    └── terminal.ts               # Type definitions

src/stores/
├── terminal-store.ts             # Session data (connection IDs, refs)
└── terminal-profiles-store.ts    # Terminal profiles

src-tauri/src/terminal/
├── mod.rs                        # Tauri commands
├── manager.rs                    # TerminalManager - session management
├── connection.rs                 # TerminalConnection - PTY operations
├── config.rs                     # TerminalConfig
└── shell.rs                      # Shell detection
```

## Architecture

### Frontend Components

**terminal.tsx**
- Initializes xterm.js with addons (fit, search, clipboard, etc.)
- Handles PTY communication via Tauri events
- Parses OSC 7 sequences for directory tracking
- Manages keyboard shortcuts and theme integration

**terminal-container.tsx**
- Manages multiple terminal instances and active state
- Handles tab lifecycle (create, close, rename, duplicate)
- Supports split view with independent sessions

**terminal-tab-bar.tsx**
- Draggable tabs with reordering
- Context menu (pin, duplicate, clear, export, close)
- Shell selection and width mode toggle

### State Management

**useTerminalTabs Hook**
- Uses `useReducer` for terminal state
- Persists terminals to localStorage
- Actions: CREATE, CLOSE, SET_ACTIVE, UPDATE_NAME, REORDER, etc.

**terminal-store.ts (Zustand)**
- Connection IDs for PTY processes
- Terminal refs for imperative API
- Width mode preference

**terminal-profiles-store.ts (Zustand)**
- Stores terminal profiles with shell, directory, env vars
- Actions: addProfile, updateProfile, deleteProfile

### Backend (Rust)

**TerminalManager** - Manages multiple terminal sessions
**TerminalConnection** - Wraps PTY instance using `portable_pty`
**TerminalConfig** - Configuration for terminal creation
**Shell Detection** - Discovers available shells on the system

### Communication

```
User Input → Terminal Component → Tauri IPC → Rust Backend → PTY
                    ↑                                            ↓
                    └──────── Tauri Events ←─────────── PTY Output
```

**Tauri Commands:**
- `create_terminal` - Create new PTY
- `terminal_write` - Write to PTY
- `terminal_resize` - Resize PTY
- `close_terminal` - Close PTY
- `get_shells` - Get available shells

**Events:**
- `pty-output-{id}` - Terminal output
- `pty-error-{id}` - Error messages
- `pty-closed-{id}` - Process terminated

## Key Features

**Persistence**
- Terminals saved to localStorage on state change
- Restored on app startup with same names and directories

**Directory Tracking**
- Parses OSC 7 escape sequences from shell output
- Updates `currentDirectory` for each terminal session
- Used for duplicate, split, and persistence

**Split View**
- Creates companion terminal with same directory and shell
- Independent PTY sessions rendered side-by-side
- Closing main terminal closes companion

**Export Output**
- Uses xterm.js SerializeAddon to capture buffer
- Saves to file via Tauri dialog API

## Extending

### Adding Context Menu Items

```typescript
// terminal-tab-bar.tsx
<ContextMenuItem onClick={() => handleCustomAction(terminalId)}>
  Custom Action
</ContextMenuItem>
```

### Adding Tauri Commands

```rust
// terminal/mod.rs
#[tauri::command]
pub async fn my_terminal_command(id: String) -> Result<(), String> {
    // Implementation
}
```

### Using Terminal Profiles

```typescript
const { actions } = useTerminalProfilesStore();

actions.addProfile({
  name: 'Dev Shell',
  shell: 'zsh',
  startupDirectory: '/home/user/projects',
  startupCommands: ['source .env'],
});
```

## Theme Integration

Terminal colors derive from CSS variables (`--color-terminal-*`). Theme changes trigger:
1. Theme registry `onThemeChange` listener
2. Terminal updates `options.theme`
3. xterm.js re-renders with new colors
