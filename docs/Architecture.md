# Athas Editor Architecture

## Overview

Athas is a modern code editor built with a hybrid architecture combining React/TypeScript for the frontend and Tauri/Rust for native desktop functionality. This document provides a comprehensive overview of the system architecture, design patterns, and technical decisions.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          Frontend (React)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │   App.tsx   │  │   Components │  │    Custom Hooks     │   │
│  │ (Main State)│  │  (30+ files) │  │   (useBuffers,      │   │
│  │             │  │              │  │    useSettings...)  │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘   │
│         └─────────────────┴──────────────────────┘              │
│                            │                                     │
│                    IPC Communication                             │
│                     (Tauri Commands)                             │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                       Backend (Tauri/Rust)                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │   main.rs   │  │    lsp.rs    │  │     ssh.rs          │   │
│  │  (Commands) │  │ (LSP Server) │  │ (Remote Files)      │   │
│  └─────────────┘  └──────────────┘  └─────────────────────┘   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ terminal.rs │  │   menu.rs    │  │  File System APIs   │   │
│  │ (PTY/Shell) │  │ (Native Menu)│  │                     │   │
│  └─────────────┘  └──────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### Frontend Architecture

#### 1. **State Management**

The application uses React's built-in state management without external libraries like Redux or MobX. This decision keeps the bundle size small and reduces complexity.

**Key State Areas:**
- **Buffer State**: Managed by `useBuffers` hook using `useReducer`
- **UI State**: Managed in `App.tsx` with `useState`
- **Settings**: Persisted to localStorage via `useSettings`
- **Feature Toggles**: Core features can be enabled/disabled

```typescript
// Buffer state structure
interface Buffer {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  isVirtual: boolean;
  isActive: boolean;
  vimMode?: 'normal' | 'insert' | 'visual';
  cursorPosition?: number;
}
```

#### 2. **Component Hierarchy**

```
App.tsx
├── CustomTitleBar          // macOS-style window controls
├── ResizableSidebar
│   ├── FileTree           // Recursive file browser
│   ├── GitView            // Git operations UI
│   ├── SearchView         // Global search
│   └── RemoteView         // SSH connections
├── EditorArea
│   ├── TabBar             // Open file tabs
│   ├── CodeEditor         // Main editor with syntax highlighting
│   ├── SQLiteViewer       // Database browser
│   ├── ImageViewer        // Image preview
│   └── DiffViewer         // Git diff display
├── BottomPane
│   ├── Terminal           // Integrated terminal
│   └── Diagnostics        // LSP errors/warnings
└── Modals
    ├── CommandPalette     // Cmd+K quick actions
    ├── CommandBar         // Cmd+P file search
    └── Settings           // JSON settings editor
```

#### 3. **Custom Hooks Architecture**

Athas uses custom hooks extensively to encapsulate complex logic:

- **`useBuffers`**: Buffer lifecycle management
- **`useSettings`**: User preferences with persistence
- **`useLSP`**: Language Server Protocol integration
- **`useKeyboardShortcuts`**: Global hotkey handling
- **`useVim`**: Vim mode state machine
- **`useTerminalTabs`**: Terminal session management
- **`useRemoteConnection`**: SSH file operations
- **`useSearch`**: Project-wide search functionality

### Backend Architecture

#### 1. **Tauri Command System**

Commands are exposed from Rust to JavaScript using Tauri's IPC system:

```rust
#[tauri::command]
async fn read_file_custom(path: String) -> Result<String, String> {
    // Implementation
}
```

**Command Categories:**
- **File Operations**: read, write, directory listing
- **Git Operations**: status, diff, commit, branch management
- **LSP Operations**: server lifecycle, document sync, completions
- **Terminal Operations**: PTY creation, data I/O
- **SSH Operations**: connection management, remote file access

#### 2. **Language Server Protocol (LSP)**

The LSP implementation manages multiple language servers:

```rust
struct LspManager {
    servers: HashMap<String, LspServer>,
    client_capabilities: ClientCapabilities,
}
```

**Supported Languages:**
- TypeScript/JavaScript (typescript-language-server)
- Python (pylsp)
- Ruby (solargraph)

#### 3. **Terminal Integration**

Uses portable-pty for cross-platform terminal emulation:
- Creates pseudo-terminals
- Manages shell processes
- Handles ANSI escape sequences
- Supports multiple concurrent sessions

### Data Flow

#### 1. **File Operations**

```
User Action → React Component → Tauri Command → Rust Handler → File System
                     ↓                              ↓
                State Update ← ← ← ← Result/Error ← ┘
```

#### 2. **LSP Communication**

```
Code Change → Editor Component → LSP Hook → Tauri Command
                                              ↓
                                          LSP Server
                                              ↓
Diagnostics ← UI Update ← LSP Hook ← Tauri Event
```

#### 3. **Virtual File System**

Athas implements a virtual file system for special files:

- `settings://user-settings.json` - Editable settings
- `extensions://marketplace` - Extension browser
- `git://diff/path` - Git diff views

## Design Patterns

### 1. **Command Pattern**
All backend operations are exposed as commands, providing a clean API boundary.

### 2. **Observer Pattern**
UI components subscribe to state changes through hooks and re-render automatically.

### 3. **Strategy Pattern**
Different file viewers (code, image, SQLite, diff) implement a common interface.

### 4. **Facade Pattern**
Platform-specific operations are abstracted behind unified APIs.

## Performance Optimizations

### 1. **Lazy Loading**
- Directory contents load on-demand
- Remote files fetch only when opened
- LSP servers start when needed

### 2. **Caching**
- 30-second cache for directory listings
- Debounced file saves
- Memoized expensive computations

### 3. **Virtual Rendering**
- Line numbers limited to visible range
- Syntax highlighting applied incrementally
- Search results rendered on-demand

## Security Considerations

### 1. **Input Validation**
- All file paths sanitized
- Command parameters validated in Rust
- No dynamic code execution

### 2. **Secure Storage**
- SSH credentials stored securely via Tauri
- API keys never exposed to frontend
- Settings validated before applying

### 3. **Process Isolation**
- Terminal sessions run in separate processes
- LSP servers sandboxed
- File operations require explicit permissions

## Extensibility

### 1. **Theme System**
Themes are CSS files with CSS variables:
```css
:root {
  --editor-bg: #282a36;
  --editor-fg: #f8f8f2;
  --keyword: #ff79c6;
  /* ... */
}
```

### 2. **Language Support**
Adding new languages requires:
1. Prism.js grammar definition
2. LSP server configuration
3. File extension mapping

### 3. **AI Providers**
New AI providers implement a common interface:
```typescript
interface AIProvider {
  complete(prompt: string): Promise<string>;
  chat(messages: Message[]): Promise<string>;
}
```

## Future Architecture Considerations

### 1. **Plugin System**
- WebAssembly plugins for performance
- JavaScript API for extensions
- Marketplace integration

### 2. **Collaboration**
- CRDT-based collaborative editing
- WebRTC for peer-to-peer sync
- Presence awareness

### 3. **Cloud Integration**
- Cloud file storage backends
- Settings sync across devices
- Remote development environments

## Technical Stack

### Frontend
- **React 18.3.1** - UI framework
- **TypeScript 5.6.2** - Type safety
- **Vite 6.3.5** - Build tooling
- **Tailwind CSS 4.1.8** - Styling
- **Prism.js** - Syntax highlighting

### Backend
- **Tauri 2.x** - Desktop framework
- **Rust** - Systems programming
- **Tokio** - Async runtime
- **portable-pty** - Terminal emulation

### Development
- **Bun** - Package manager
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Vitest** - Testing framework

## Conclusion

Athas's architecture prioritizes simplicity, performance, and extensibility. By leveraging Tauri's lightweight runtime and React's component model, it delivers a responsive editing experience while maintaining a small resource footprint. The clear separation between frontend and backend through Tauri's command system ensures security and enables future platform expansion.