# Editor Architecture

The editor uses a layered architecture with clean separation of concerns.

## Layers

### Model Layer
Core data structures managing editor state:
- **Document Model** - Immutable document with O(log n) offset/position conversion and line offset caching
- **Transaction System** - Undo/redo with automatic merging (500ms window) and inversion-based history
- **Token Management** - Syntax highlighting token caching, debouncing, and viewport-aware tokenization

### View Layer
Rendering and DOM management:
- **Virtual Scrolling** - Calculates visible lines, renders only viewport plus padding
- **DOM Manager** - Minimal updates with element recycling pool, preserves cursor position
- **Editor View** - Main component coordinating viewport, rendering, and input
- **Cursor** - Blinking animation (530ms interval), auto-hides during text selection
- **Selection** - Multi-line selection highlighting with scroll position awareness
- **Gutter** - Line numbers with active line indicator and click handling

### Hooks Layer
React hooks for editor functionality:
- **Tokenizer Hook** - Manages syntax highlighting lifecycle and decoration updates
- **Input Hook** - Keyboard shortcuts, IME composition, paste/cut handlers, navigation
- **Mouse Selection Hook** - Click positioning, drag selection, coordinate mapping

### Store Layer
Central state management:
- **Core Store** - Single source of truth for document, selection, history, decorations, and viewport

### Types Layer
Pure interfaces with no state:
- **Selection Types** - Multi-cursor support, selection mapping through changes, cursor utilities

## Performance

- Virtual scrolling renders only visible lines plus padding
- Line offset caching with binary search for position calculations
- Element recycling pool prevents DOM thrashing
- Incremental tokenization for large files (viewport-aware)
- Inversion-based transactions prevent content corruption

## Backend Integration

Rust backend (Tree-sitter) provides:
- Full document tokenization
- Range-based tokenization
- Line-based token retrieval

## Current Limitations

- Multi-cursor editing not implemented (infrastructure ready)
- Copy to clipboard in cut handler incomplete
- No line folding
- No find/replace integration
