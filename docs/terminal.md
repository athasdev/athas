# Terminal

The integrated terminal provides a full-featured terminal emulator within the editor, powered by xterm.js.

## Features

### Multiple Terminals

- Create multiple terminal instances with independent sessions
- Organize terminals in tabs with drag-and-drop reordering
- Pin important terminals to prevent accidental closure
- Split view for side-by-side terminal sessions

### Terminal Management

**Creating Terminals**
- Click the `+` button in the terminal tab bar
- Use `Cmd/Ctrl+T` keyboard shortcut
- Select a shell from the dropdown before creating

**Closing Terminals**
- Click the `×` button on a terminal tab
- Use `Cmd/Ctrl+W` keyboard shortcut
- Right-click > Close Terminal
- Close other tabs, close all tabs, or close tabs to the right

**Renaming Terminals**
- Right-click on terminal tab > Rename Terminal
- Enter new name in the dialog

### Shell Selection

Choose your preferred shell when creating new terminals:
- bash
- zsh
- fish
- nushell
- PowerShell (Windows)

The dropdown in the terminal tab bar allows you to select a shell before creating a new terminal.

### Terminal Persistence

Terminals automatically save and restore across app restarts:
- Terminal names and configurations are preserved
- Working directories are maintained
- Shell preferences are remembered
- Pinned state is restored

### Working Directory Tracking

The terminal automatically tracks directory changes using OSC 7 escape sequences. When you `cd` to a new directory, the terminal session updates its working directory, which is used when:
- Duplicating terminals
- Creating split views
- Restoring sessions

### Search in Terminal

**Opening Search**
- Press `Cmd/Ctrl+F` while terminal is focused
- Search box appears in top-right corner

**Using Search**
- Type search term
- Press `Enter` to find next match
- Press `Shift+Enter` to find previous match
- Match counter shows current position
- Press `Esc` to close search

### Split View

Create side-by-side terminal sessions:
- Click split view icon in terminal tab bar
- Use `Cmd/Ctrl+D` keyboard shortcut
- Each pane has an independent terminal session
- Toggle off to return to single terminal view

### Context Menu

Right-click on terminal tabs for quick actions:
- Pin/Unpin Terminal
- Duplicate Terminal - creates new terminal in same directory
- Clear Terminal - clears the screen
- Rename Terminal
- Export Output - saves terminal content to file
- Close Terminal
- Close Other Tabs
- Close All Tabs
- Close Tabs to Right

### Exporting Terminal Output

Save terminal content to a text file:
1. Right-click terminal tab > Export Output
2. Choose save location and filename
3. Terminal content is saved as plain text

### Keyboard Shortcuts

**Terminal Management**
- `Cmd/Ctrl+T` - New terminal
- `Cmd/Ctrl+W` - Close current terminal
- `Cmd/Ctrl+K` - Clear terminal screen
- `Cmd/Ctrl+D` - Toggle split view
- `Cmd/Ctrl+[` - Previous terminal
- `Cmd/Ctrl+]` - Next terminal
- `Cmd/Ctrl+1-9` - Switch to terminal by number
- `Ctrl+Tab` - Cycle through terminals

**Terminal Operations**
- `Cmd/Ctrl+F` - Search in terminal
- `Cmd/Ctrl+C` - Interrupt (when terminal focused)
- `Cmd/Ctrl+V` - Paste
- `Cmd/Ctrl++` - Increase font size
- `Cmd/Ctrl+-` - Decrease font size
- `Cmd/Ctrl+0` - Reset font size

**Enhanced Mac Shortcuts** (when terminal focused)
- `Option+Delete` - Delete word backwards
- `Cmd+Delete` - Delete to beginning of line
- `Cmd+Left` - Jump to line start
- `Cmd+Right` - Jump to line end
- `Option+Left` - Jump word backwards
- `Option+Right` - Jump word forwards

### Terminal Display Modes

**Width Modes**
- Full Width - terminal spans entire bottom pane
- Editor Width - terminal aligns with editor width

Right-click the terminal toolbar (not a tab) to toggle width mode.

### Themes

Terminal colors automatically sync with your editor theme:
- 16 ANSI colors (8 standard + 8 bright variants)
- Cursor color matches accent color
- Background and foreground colors from theme
- Link colors use accent color with underline

### Web Links

URLs in terminal output are automatically detected and clickable:
- Confirmation dialog appears before opening external links
- Links are styled with accent color and underline
- Click or Cmd/Ctrl+Click to open in browser

## Tips

**Session Persistence**
- Terminals restore automatically when reopening the app
- Pinned terminals are always restored
- Working directories are maintained across sessions

**Efficient Navigation**
- Use `Cmd/Ctrl+1-9` to quickly jump to specific terminals
- Pin frequently used terminals to keep them at the front
- Use split view for comparing outputs side-by-side

**Terminal Organization**
- Drag tabs to reorder terminals
- Pin important terminals to prevent accidental closure
- Use descriptive names (right-click > Rename) for easy identification

**Performance**
- Terminal has 10,000 lines of scrollback
- Zoom controls (Cmd/Ctrl +/-/0) adjust font size
- Clear terminal (Cmd/Ctrl+K) to remove old output

## Troubleshooting

**Terminal not responding**
- Try closing and reopening the terminal
- Check if the shell process is running in task manager
- Restart the application if issues persist

**Colors not matching theme**
- Theme changes are applied automatically
- Some programs may override terminal colors

**Keyboard shortcuts not working**
- Ensure terminal has focus (click inside terminal area)
- Some shortcuts are captured by the terminal itself
- Meta/Cmd shortcuts are handled by the app, Ctrl shortcuts by terminal
