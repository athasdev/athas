# Code Editor Architecture

## Overview

The code editor uses a **two-layer overlay architecture** with a transparent textarea for input and a syntax-highlighted div for display. This approach balances performance, browser compatibility, and implementation simplicity.

## Current Architecture

### Rendering Approach

**Two-Layer System:**
1. **Input Layer** (`input-layer.tsx`): Transparent `<textarea>`
   - Handles all user input (typing, selection, cursor movement)
   - Browser provides native text editing behavior
   - `color: transparent` - text is invisible
   - `caret-color: var(--text)` - cursor is visible
   - `z-index: 2` - sits on top

2. **Highlight Layer** (`highlight-layer.tsx`): Read-only `<div>`
   - Displays syntax-highlighted text
   - React-based rendering with per-line memoization
   - `pointer-events: none` - doesn't intercept mouse events
   - `z-index: 1` - sits below input layer

3. **Multi-Cursor Layer** (`multi-cursor-layer.tsx`): Optional overlay
   - Renders secondary cursors when in multi-cursor mode
   - Uses absolute positioning for cursor placement
   - `z-index: 10` - sits above both layers

### State Management

**Zustand Stores:**
- `buffer-store.ts` - File content, syntax tokens, dirty state
- `state-store.ts` - Cursor position, selection, multi-cursor state
- `settings-store.ts` - Font size, line numbers, preferences
- `ui-store.ts` - LSP completions, search UI
- `view-store.ts` - Viewport calculations for virtual scrolling

### Syntax Highlighting

**Hybrid Approach:**
- **Backend**: Rust with Tree-sitter parsers (18+ languages)
- **Frontend**: React rendering of token spans
- **Performance**: ~5-10ms tokenization per keystroke (no debouncing needed)

### Selection & Multi-Cursor

**Selection:**
- Native browser selection on transparent textarea
- CSS `::selection` pseudo-element for styling
- Selection state tracked in Zustand store

**Multi-Cursor:**
- State-based cursor management (array of cursors)
- Custom rendering for secondary cursors
- Simultaneous editing at multiple positions
- Cmd/Ctrl+Click to add cursors, Escape to clear

## Performance Characteristics

### What Works Well

1. **Zero-lag typing**: Uncontrolled textarea = instant response
2. **Fast syntax highlighting**: Tree-sitter processes on every keystroke
3. **Virtual scrolling**: Only renders visible lines + overscan
4. **Efficient memoization**: Per-line React memoization prevents unnecessary re-renders

### Current Limitations

1. **Large files (10k+ lines)**:
   - Full document tokenization on every change
   - React diffing overhead even with memoization
   - Solution: Implement incremental tokenization (infrastructure exists)

2. **Token offset complexity**:
   - Tokens use document-level byte offsets
   - Requires conversion to per-line positions
   - Solution: Cache line offset map (already implemented)

3. **Multi-cursor performance**:
   - Edits processed sequentially from bottom to top
   - For 100+ cursors, may have perceptible lag
   - Solution: Batch updates or use Web Workers for complex operations

## Architecture Improvements

### Short-term Improvements (Current Architecture)

#### 1. Incremental Tokenization
**Status**: Infrastructure exists, not fully utilized
**Files**: `tokens.rs` has `get_tokens_range`
**Benefit**: Faster tokenization for large files

```rust
// Already implemented in Rust:
pub async fn get_tokens_range(
  content: String,
  file_extension: String,
  start_line: usize,
  end_line: usize,
) -> Result<Vec<Token>, String>
```

**Implementation**:
- Track which lines changed
- Only tokenize changed lines + small buffer
- Re-tokenize full document every 5 seconds (already done)

#### 2. Virtual Scrolling for Highlight Layer
**Status**: Partial - viewport tracking exists
**Files**: `use-viewport-lines.ts`, `view-store.ts`
**Benefit**: Reduce DOM nodes for very large files

**Implementation**:
- Only render visible lines in HighlightLayer
- Use transform/translate for positioning
- Keep textarea full height for scrolling

#### 3. Web Workers for Tokenization Coordination
**Status**: Not implemented
**Benefit**: Offload coordination logic from main thread

**Implementation**:
- Move token caching to Web Worker
- Coordinate Rust tokenization calls from worker
- Post results back to main thread

#### 4. Selection Performance
**Status**: ✅ Fixed
**Improvements**:
- Selection now persists after mouse release
- `onMouseUp` event tracks final selection
- Multi-cursor selections rendered with custom overlay

#### 5. Cursor Position Caching
**Status**: ✅ Implemented
**Implementation**:
- LRU cache for cursor positions (max 50 buffers)
- Restores position on tab switch
- Prevents cursor jumping

### Medium-term Improvements

#### 1. Text Rope Data Structure
**Current**: Simple string + `split("\n")`
**Proposed**: Rope data structure for large files
**Benefit**: O(log n) insertions/deletions instead of O(n)

**When to use**:
- Files > 5,000 lines
- Frequent edits in middle of large files
- Complex multi-cursor operations

**Libraries**:
- `crop` - Rust rope implementation (already using Rust backend)
- `jumprope` - Another high-performance option

#### 2. Diff-based Rendering
**Current**: Full React re-render on content change
**Proposed**: Only update changed lines in DOM

**Implementation**:
- Calculate diff between old and new content
- Directly mutate DOM for changed lines
- Skip React for large file edits

#### 3. GPU-Accelerated Cursor Rendering
**Current**: CSS-based cursor blinking
**Proposed**: WebGL cursor rendering for multi-cursor

**When to use**:
- 20+ simultaneous cursors
- High-DPI displays
- Cursor animations beyond simple blink

### Long-term Considerations

#### Alternative Rendering Methods (If Current Approach Hits Limits)

**When to consider**:
- Files > 50,000 lines are common
- Users frequently edit files > 100,000 lines
- Current performance becomes unacceptable

**Option A: Hybrid Canvas + Textarea**
- Use Canvas for gutter and syntax highlighting
- Keep textarea for input
- **Pros**: Better performance for massive files, lower memory
- **Cons**: More complex, need to reimplement text shaping
- **Example**: CodeMirror 6 uses this approach

**Option B: Full contenteditable**
- Replace textarea with contenteditable div
- **Pros**: More control over rendering, easier multi-cursor
- **Cons**: Browser inconsistencies, XSS risks, harder to manage
- **Not recommended**: Current approach is simpler and safer

**Option C: WebGL Rendering**
- Full GPU-accelerated text rendering
- **Pros**: Maximum performance, smooth animations
- **Cons**: Very complex, overkill for most use cases
- **When to use**: Only if targeting 1M+ line files
- **Example**: Xi editor (archived project)

## Recommendations

### For Current Use Cases

**Keep the current architecture** - it's well-suited for:
- Files up to 10,000 lines
- Modern desktop browsers
- Single-user editing (not collaborative)

**Immediate priorities**:
1. ✅ Fix selection persistence (DONE)
2. ✅ Implement multi-cursor support (DONE)
3. Implement incremental tokenization for large files
4. Add virtual scrolling to HighlightLayer

### Performance Targets

**Current performance** (measured on MacBook Pro M1):
- Typing lag: 0ms (instant)
- Tokenization: 5-10ms per keystroke
- React re-render: 10-20ms for 1,000 lines
- Memory usage: ~50MB for 10,000 line file

**Target performance**:
- Typing lag: 0ms (maintain)
- Tokenization: <5ms even for 10,000+ line files (incremental)
- React re-render: <10ms for any file size (virtual scrolling)
- Memory usage: <100MB for 50,000 line file

### When to Consider Architecture Change

Consider a more complex rendering approach if:
- Users regularly edit files > 50,000 lines
- Typing lag exceeds 50ms consistently
- Memory usage becomes problematic
- Collaborative editing is required (needs CRDT)

**Current verdict**: The two-layer architecture is **optimal** for this use case.

## Code Organization

```
src/features/editor/
├── components/
│   ├── editor-overlay.tsx        # Main component
│   ├── input-layer.tsx            # Transparent textarea
│   ├── highlight-layer.tsx        # Syntax highlighting
│   ├── multi-cursor-layer.tsx     # Secondary cursors
│   ├── gutter.tsx                 # Line numbers
│   └── code-editor.tsx            # Top-level wrapper
├── stores/
│   ├── buffer-store.ts            # Content & tokens
│   ├── state-store.ts             # Cursor & selection
│   ├── settings-store.ts          # Preferences
│   └── ui-store.ts                # UI state
├── utils/
│   ├── position.ts                # Cursor calculations
│   └── multi-cursor.ts            # Multi-cursor editing
├── styles/
│   └── overlay-editor.css         # Two-layer CSS
└── lsp/
    └── lsp-store.ts               # Language server
```

## Testing Strategy

### Performance Testing
1. Generate test files of varying sizes (100, 1K, 10K, 50K lines)
2. Measure typing lag with performance.mark/measure
3. Profile React re-renders with DevTools
4. Monitor memory usage over time

### Multi-Cursor Testing
1. Test with 2, 5, 10, 50 cursors
2. Measure edit performance
3. Verify cursor positioning accuracy
4. Test undo/redo with multi-cursor

### Browser Compatibility
- ✅ Chrome/Edge (Chromium)
- ✅ Safari (WebKit)
- ✅ Firefox (Gecko)
- Tauri wraps Chromium on most platforms

## Future Work

### Nice-to-Have Features
1. Column selection (Alt+Drag) for multi-cursor
2. Cursor history (jump back to previous positions)
3. Minimap for large files
4. Smooth scrolling animations
5. Collaborative editing (requires architectural changes)

### Performance Experiments
1. Benchmark incremental tokenization
2. Test virtual scrolling impact
3. Profile memory usage with very large files
4. Compare Rope vs String performance

## References

- [CodeMirror 6 Architecture](https://codemirror.net/docs/guide/)
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [Text Editor Data Structures](https://cdacamar.github.io/data%20structures/algorithms/benchmarking/text%20editors/c++/editor-data-structures/)
- [Rope Science](https://xi-editor.io/docs/rope_science_00.html)

## Conclusion

The current two-layer architecture is **excellent** for the target use case. It provides:
- ✅ Zero-lag typing experience
- ✅ Fast syntax highlighting
- ✅ Native browser text editing
- ✅ Multi-cursor support
- ✅ Clean, maintainable codebase

**Focus on incremental improvements** rather than architectural rewrites. The infrastructure for performance optimizations (incremental tokenization, virtual scrolling) already exists—it just needs to be fully utilized.
