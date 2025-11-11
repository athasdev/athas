# Terminal Architecture

This document describes the technical architecture of the integrated terminal feature for developers contributing to the codebase.

## Overview

The terminal feature is built using xterm.js with a Rust/Tauri backend for PTY (pseudo-terminal) management. It follows a component-based architecture with clear separation between UI, state management, and backend communication.

## Directory Structure

```
src/features/terminal/
├── components/
│   ├── terminal.tsx              # Main xterm.js integration
│   ├── terminal-container.tsx    # Container managing tabs and layout
│   ├── terminal-session.tsx      # Individual terminal session wrapper
│   ├── terminal-tab-bar.tsx      # Tab management with drag-and-drop
│   ├── terminal-search.tsx       # Search functionality overlay
│   └── terminal-error-boundary.tsx # Error handling
├── hooks/
│   └── use-terminal-tabs.ts      # Terminal state management hook
├── styles/
│   └── terminal.css              # Terminal-specific styles
└── types/
    └── terminal.ts               # TypeScript type definitions

src/stores/
├── terminal-store.ts             # Global terminal session store
└── terminal-profiles-store.ts    # Terminal profiles management

src-tauri/src/
├── xterm_terminal.rs             # PTY implementation
├── commands/
│   ├── xterm.rs                  # Terminal Tauri commands
│   └── shell.rs                  # Shell detection and management
```

## Architecture Components

### Frontend

#### Terminal Component (`terminal.tsx`)

Core xterm.js integration responsible for:
- Terminal initialization with theme and font settings
- xterm.js addon management (fit, search, clipboard, serialize, etc.)
- PTY communication via Tauri events
- Keyboard event handling and shortcuts
- OSC 7 sequence parsing for directory tracking
- Theme synchronization

**Key Features:**
- Auto-fit on resize using ResizeObserver
- Custom keyboard event handler for Mac-enhanced shortcuts
- Web links with confirmation dialog
- Search integration with match counter
- Zoom controls (Cmd/Ctrl +/-/0)

#### Terminal Container (`terminal-container.tsx`)

Layout and tab management:
- Multiple terminal instances
- Tab bar with drag-and-drop reordering
- Split view support with independent sessions
- Terminal creation and deletion
- Rename modal
- Focus management

**State Management:**
- Uses `useTerminalTabs` hook for terminal list state
- Manages active terminal ID
- Handles keyboard shortcuts globally
- Registers terminal refs for programmatic access

#### Terminal Tab Bar (`terminal-tab-bar.tsx`)

Tab UI and interactions:
- Draggable tabs with visual feedback
- Context menu (right-click) with actions
- Pin/unpin functionality
- Shell selection dropdown
- Width mode toggle
- Export terminal output

**Context Menu Actions:**
- Pin/Unpin Terminal
- Duplicate Terminal
- Clear Terminal
- Rename Terminal
- Export Output
- Close variations (current, others, all, to right)

### State Management

#### useTerminalTabs Hook

Custom hook using `useReducer` for terminal state:

**State Shape:**
```typescript
interface TerminalState {
  terminals: Terminal[];
  activeTerminalId: string | null;
}
```

**Actions:**
- `CREATE_TERMINAL` - Add new terminal
- `CLOSE_TERMINAL` - Remove terminal and update active
- `SET_ACTIVE_TERMINAL` - Change active terminal
- `UPDATE_TERMINAL_NAME` - Rename terminal
- `UPDATE_TERMINAL_DIRECTORY` - Change working directory
- `UPDATE_TERMINAL_ACTIVITY` - Update last activity timestamp
- `PIN_TERMINAL` - Pin/unpin terminal
- `REORDER_TERMINALS` - Change terminal order
- `SET_TERMINAL_SPLIT_MODE` - Toggle split view

**Persistence:**
- Terminals are saved to localStorage automatically
- Restored on app startup
- Configurable via persistence toggle (future)

#### Terminal Store (`terminal-store.ts`)

Zustand store for session-specific data:
- Connection IDs for PTY processes
- Terminal refs for imperative API access
- Width mode preference (full/editor)

Uses `persist` middleware to save width mode.

#### Terminal Profiles Store (`terminal-profiles-store.ts`)

Manages terminal profiles:
```typescript
interface TerminalProfile {
  id: string;
  name: string;
  shell?: string;
  startupDirectory?: string;
  env?: Record<string, string>;
  startupCommands?: string[];
  icon?: string;
  color?: string;
}
```

Actions:
- `addProfile` - Create new profile
- `updateProfile` - Modify existing profile
- `deleteProfile` - Remove profile
- `getProfile` - Retrieve profile by ID

### Backend (Rust/Tauri)

#### PTY Management (`xterm_terminal.rs`)

Handles pseudo-terminal creation and management:
- Uses `portable_pty` crate for cross-platform PTY
- Spawns shell processes with proper environment
- Manages terminal resize events
- Handles input/output streaming

**Key Functions:**
- `create_xterm_terminal` - Initialize new PTY
- `terminal_write` - Send input to PTY
- `resize_xterm_terminal` - Handle terminal resize
- `close_xterm_terminal` - Clean up PTY resources

#### Shell Detection (`shell.rs`)

Detects available shells on the system:
- Unix: Checks `/etc/shells` and common paths
- Windows: Searches PATH for shell executables
- Returns list of available shells with metadata

**Supported Shells:**
- bash, zsh, fish, nushell (Unix)
- PowerShell, cmd (Windows)

### Communication Flow

```
User Input → Terminal Component → Tauri IPC → Rust Backend → PTY
                    ↑                                            ↓
                    └──────── Tauri Events ←─────────── PTY Output
```

**Events:**
- `pty-output-{id}` - Terminal output from PTY
- `pty-error-{id}` - Error messages from PTY
- `pty-closed-{id}` - PTY process terminated

**Commands:**
- `create_xterm_terminal` - Create new PTY
- `terminal_write` - Write data to PTY
- `resize_xterm_terminal` - Resize PTY
- `close_xterm_terminal` - Close PTY
- `get_shells` - Get available shells

## Key Features Implementation

### Terminal Persistence

**Save Flow:**
1. `useTerminalTabs` hook listens to state changes
2. On change, `saveTerminalsToStorage` is called
3. Terminals are serialized (excluding refs and functions)
4. Saved to localStorage under `terminal-sessions` key

**Restore Flow:**
1. On mount, `getPersistedTerminals` reads from localStorage
2. `restoreTerminalsFromPersisted` dispatches CREATE actions
3. Each terminal spawns a new PTY process
4. UI shows restored terminals with same names and directories

### Working Directory Tracking

Uses OSC 7 escape sequences:
```typescript
// OSC 7 format: ESC]7;file://hostname/path BEL
const parseOSC7 = (data: string): string | null => {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const osc7Regex = new RegExp(`${ESC}\\]7;file://[^/]*([^${BEL}]+)${BEL}`);
  // ...parse and return path
}
```

Shells emit OSC 7 sequences when changing directories. The terminal component:
1. Listens to PTY output
2. Parses OSC 7 sequences
3. Updates terminal session's `currentDirectory`
4. Used for duplicate, split, and persistence

### Split View

**Implementation:**
1. User toggles split view
2. New terminal is created with same directory and shell
3. Main terminal's `splitMode` flag set to true
4. `splitWithId` references companion terminal
5. Container renders both terminals side-by-side
6. Each has independent PTY session

**Closing Split:**
- Toggling off closes companion terminal
- Closing main terminal also closes companion
- Handled by reducer's CLOSE_TERMINAL case

### Export Terminal Output

Uses xterm.js SerializeAddon:
1. User selects Export from context menu
2. `serialize()` captures terminal buffer as plain text
3. Tauri dialog API shows save dialog
4. Content written to file via `writeTextFile`

## Extending the Terminal

### Adding New Context Menu Items

1. Add handler prop to `TerminalContextMenuProps` in `terminal-tab-bar.tsx`
2. Add menu button in `TerminalContextMenu` component
3. Pass handler from container component
4. Implement logic using terminal refs or state

### Adding Terminal Commands

**Frontend:**
```typescript
// In terminal.tsx
const myCustomCommand = useCallback(() => {
  if (xtermRef.current) {
    xtermRef.current.write('custom output\r\n');
  }
}, []);
```

**Backend (if needed):**
```rust
// In commands/xterm.rs
#[tauri::command]
pub async fn my_terminal_command(id: String) -> Result<(), String> {
    // Implement command
}
```

### Adding Terminal Profiles

Profiles are stored in `terminal-profiles-store.ts`. To use:

```typescript
const { profiles, actions } = useTerminalProfilesStore.use.profiles();

// Create profile
actions.addProfile({
  name: 'My Profile',
  shell: 'zsh',
  startupDirectory: '/home/user',
  startupCommands: ['echo "Hello"'],
});

// Use profile
const profile = actions.getProfile(profileId);
createTerminal(profile.name, profile.startupDirectory, profile.shell);
```

## Testing Considerations

**Terminal Component:**
- Mock xterm.js Terminal class
- Mock Tauri IPC calls
- Test keyboard event handlers
- Verify theme updates

**Container Component:**
- Test tab creation and deletion
- Verify drag-and-drop reordering
- Test split view toggle
- Check persistence save/restore

**Backend:**
- Test PTY creation across platforms
- Verify shell detection
- Test resize handling
- Check proper cleanup on close

## Performance Considerations

**Scrollback Limit:** 10,000 lines
- Configurable in Terminal options
- Prevents memory issues with long-running terminals

**Resize Debouncing:**
- Uses `requestAnimationFrame` to batch resize operations
- Prevents excessive PTY resize calls

**Event Cleanup:**
- All event listeners properly removed on unmount
- PTY processes cleaned up when terminals close
- ResizeObserver disconnected on cleanup

## Theme Integration

Terminal colors are derived from CSS variables:
```typescript
const getTerminalTheme = (): TerminalTheme => {
  const computedStyle = getComputedStyle(document.documentElement);
  return {
    background: getColor('--color-primary-bg'),
    foreground: getColor('--color-text'),
    cursor: getColor('--color-accent'),
    // ... 16 ANSI colors from --color-terminal-* variables
  };
};
```

Theme changes trigger:
1. Theme registry `onThemeChange` listener
2. Terminal updates `options.theme`
3. xterm.js re-renders with new colors

## Common Pitfalls

**Terminal Not Mounting:**
- Ensure DOM ref exists before initializing xterm
- Check initialization flag to prevent double-init
- Verify PTY connection established

**Keyboard Shortcuts Conflicts:**
- Distinguish between Meta (app) and Ctrl (terminal) keys
- Use `attachCustomKeyEventHandler` to intercept
- Return `false` to prevent terminal handling

**Theme Not Applying:**
- Verify CSS variables are defined in theme
- Check theme change listener is registered
- Ensure terminal refresh is called

**Memory Leaks:**
- Always clean up event listeners
- Dispose xterm instance on unmount
- Close PTY connections when terminals close

## Future Improvements

Planned enhancements:
- Terminal profiles UI in settings
- Configurable persistence toggle
- Enhanced error messages with recovery options
- Improved clipboard integration
- Terminal-specific settings page
- Custom startup commands
- Environment variable management
