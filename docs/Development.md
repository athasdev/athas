# Athas Development Guide

This guide covers everything you need to know to contribute to Athas, build it from source, and extend its functionality.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Getting Started](#getting-started)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Adding Features](#adding-features)
6. [Testing](#testing)
7. [Debugging](#debugging)
8. [Contributing](#contributing)
9. [Release Process](#release-process)

## Prerequisites

### Required Software

- **Bun** (JavaScript runtime and package manager)
- **Rust** 1.70+ with cargo
- **Git**
- Platform-specific requirements:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft C++ Build Tools
  - **Linux**: webkit2gtk, libgtk-3-dev, libappindicator3-dev

### Recommended Tools

- **VS Code** or another TypeScript-aware editor
- **Rust Analyzer** for Rust development
- **Chrome DevTools** for frontend debugging

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/athasdev/athas.git
cd athas
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Build and Run

Development mode with hot reload:
```bash
bun run tauri dev
```

Build for production:
```bash
bun run tauri build
```

## Project Structure

```
athas/
├── src/                    # Frontend source (React/TypeScript)
│   ├── components/        # React components
│   ├── hooks/            # Custom React hooks
│   ├── types/            # TypeScript types
│   ├── utils/            # Utility functions
│   ├── lsp/              # LSP client implementation
│   └── styles/           # CSS and themes
├── src-tauri/            # Backend source (Rust/Tauri)
│   ├── src/              # Rust source files
│   │   ├── main.rs       # Main entry point
│   │   ├── lsp.rs        # LSP server management
│   │   ├── terminal.rs   # Terminal emulation
│   │   ├── ssh.rs        # SSH functionality
│   │   └── menu.rs       # Native menu setup
│   ├── Cargo.toml        # Rust dependencies
│   └── tauri.conf.json   # Tauri configuration
├── public/               # Static assets
├── docs/                 # Documentation
└── package.json          # JavaScript dependencies
```

## Development Workflow

### Frontend Development

#### 1. **Component Development**

When creating new components:

```typescript
// src/components/MyComponent.tsx
import React from 'react';

interface MyComponentProps {
  // Define props
}

export const MyComponent = ({ /* props */ }: MyComponentProps) => {
  // Implementation
  return <div>Component</div>;
};
```

Follow existing patterns:
- Use functional components with hooks
- Define TypeScript interfaces for props
- Keep components focused and reusable

#### 2. **Adding a Custom Hook**

```typescript
// src/hooks/use-my-feature.ts
import { useState, useCallback, useEffect } from 'react';

export const useMyFeature = () => {
  const [state, setState] = useState();

  const doSomething = useCallback(() => {
    // Implementation
  }, [/* dependencies */]);

  useEffect(() => {
    // Side effects
  }, [/* dependencies */]);

  return { state, doSomething };
};
```

#### 3. **State Management**

Athas uses React's built-in state management:

- **Local State**: Use `useState` for component-specific state
- **Shared State**: Lift state up to common parent
- **Complex State**: Use `useReducer` (see `useBuffers` hook)

### Backend Development

#### 1. **Adding Tauri Commands**

```rust
// src-tauri/src/main.rs
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
    // Implementation
    Ok("Result".to_string())
}

// Register in main()
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            my_command, // Add here
            // ... other commands
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 2. **Frontend Integration**

```typescript
// src/utils/myFeature.ts
import { invoke } from '@tauri-apps/api/core';

export const callMyCommand = async (param: string): Promise<string> => {
  return await invoke('my_command', { param });
};
```

## Adding Features

### 1. Adding a New Language for Syntax Highlighting

#### Step 1: Install Prism language component
```bash
bun add prismjs/components/prism-{language}
```

#### Step 2: Import in CodeEditor
```typescript
// src/components/CodeEditor.tsx
import 'prismjs/components/prism-{language}';
```

#### Step 3: Add file extension mapping
```typescript
// src/utils/platform.ts
const getLanguageFromFilename = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    // ... existing mappings
    'ext': 'language-name',
  };
  // ...
};
```

### 2. Adding a New Theme

#### Step 1: Create theme CSS
```css
/* src/styles/themes/my-theme.css */
.theme-my-theme {
  --editor-bg: #color;
  --editor-fg: #color;
  --keyword: #color;
  --string: #color;
  --comment: #color;
  /* ... all variables from existing themes */
}
```

#### Step 2: Import theme
```typescript
// src/styles/themes.css
@import './themes/my-theme.css';
```

#### Step 3: Add to theme list
```typescript
// src/App.tsx or theme configuration
const themes = [
  // ... existing themes
  'my-theme',
];
```

### 3. Adding an LSP Server

#### Step 1: Define server configuration
```typescript
// src/lsp/servers.ts
export const LSP_SERVERS = {
  // ... existing servers
  mylang: {
    command: 'mylang-lsp',
    args: ['--stdio'],
    rootIndicators: ['mylang.config.json'],
    fileExtensions: ['.ml', '.mli'],
  },
};
```

#### Step 2: Handle in backend
```rust
// src-tauri/src/lsp.rs
fn get_lsp_config(language: &str) -> Option<LspConfig> {
    match language {
        // ... existing languages
        "mylang" => Some(LspConfig {
            command: "mylang-lsp".to_string(),
            args: vec!["--stdio".to_string()],
        }),
        _ => None,
    }
}
```

### 4. Adding an AI Provider

#### Step 1: Implement provider interface
```typescript
// src/utils/ai/providers/myProvider.ts
export class MyProvider implements AIProvider {
  async complete(prompt: string): Promise<string> {
    // Implementation
  }

  async chat(messages: Message[]): Promise<string> {
    // Implementation
  }
}
```

#### Step 2: Register provider
```typescript
// src/components/AIChat.tsx
const providers = {
  // ... existing providers
  myprovider: new MyProvider(),
};
```

## Testing

### Running Tests

```bash
# Frontend tests
bun test

# Rust tests
cd src-tauri
cargo test
```

### Writing Tests

#### Frontend Tests
```typescript
// src/components/__tests__/MyComponent.test.tsx
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

#### Backend Tests
```rust
// src-tauri/src/main.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_function() {
        assert_eq!(my_function("input"), "expected");
    }
}
```

## Debugging

### Frontend Debugging

1. **Browser DevTools**:
   - Right-click in app → Inspect Element
   - Use React Developer Tools extension
   - Set breakpoints in Sources tab

2. **Console Logging**:
   ```typescript
   console.log('Debug info:', variable);
   ```

3. **React DevTools**:
   - Inspect component props and state
   - Profile performance
   - Track re-renders

### Backend Debugging

1. **Rust Logging**:
   ```rust
   println!("Debug: {:?}", variable);
   // or use the log crate
   log::debug!("Debug info: {:?}", variable);
   ```

2. **VS Code Debugging**:
   - Install CodeLLDB extension
   - Configure launch.json for Tauri

### Common Issues

1. **Build Failures**:
   - Clear node_modules and reinstall
   - Clean Rust build: `cargo clean`
   - Check Tauri prerequisites

2. **Hot Reload Not Working**:
   - Ensure no syntax errors
   - Check Vite dev server is running
   - Restart development server

3. **Platform-Specific Issues**:
   - Check platform requirements
   - Verify permissions (macOS)
   - Check dependencies (Linux)

## Contributing

### Code Style

#### TypeScript/React
- Use functional components
- Prefer hooks over class components
- Use TypeScript strict mode
- Follow ESLint rules

#### Rust
- Follow Rust naming conventions
- Use `cargo fmt` before committing
- Use `cargo clippy` for lints
- Handle errors properly with Result

### Commit Guidelines

Follow conventional commits:
```
type(scope): description

feat: new feature
fix: bug fix
docs: documentation
style: formatting
refactor: code restructuring
test: tests
chore: maintenance
```

Example:
```
feat(editor): add multi-cursor support
fix(terminal): resolve color rendering issue
docs: update development guide
```

### Pull Request Process

1. Fork the repository
2. Create feature branch: `git checkout -b feat/my-feature`
3. Make changes and commit
4. Push to your fork
5. Open PR with description

PR should include:
- Clear description of changes
- Screenshots for UI changes
- Test coverage
- Documentation updates

## Release Process

### Version Bumping

1. Update version in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

2. Update changelog

3. Commit version bump:
   ```bash
   git commit -m "chore: bump version to x.y.z"
   ```

### Building Releases

```bash
# Build for current platform
bun run tauri build

# Output location
# macOS: src-tauri/target/release/bundle/dmg/
# Windows: src-tauri/target/release/bundle/msi/
# Linux: src-tauri/target/release/bundle/appimage/
```

### Cross-Platform Building

Use GitHub Actions for automated builds:
- `.github/workflows/release.yml`
- Triggers on version tags
- Builds for all platforms
- Creates GitHub release

## Performance Guidelines

### Frontend Performance

1. **Minimize Re-renders**:
   - Use React.memo for expensive components
   - Implement shouldComponentUpdate logic
   - Use useCallback and useMemo appropriately

2. **Lazy Loading**:
   - Load features on-demand
   - Use React.lazy for code splitting
   - Defer non-critical resources

3. **Optimize Bundles**:
   - Tree-shake unused code
   - Minimize dependencies
   - Use production builds

### Backend Performance

1. **Async Operations**:
   - Use async/await for I/O
   - Don't block the main thread
   - Handle backpressure

2. **Memory Management**:
   - Avoid unnecessary clones
   - Use references when possible
   - Clean up resources

## Resources

### Documentation
- [Tauri Docs](https://tauri.app)
- [React Docs](https://react.dev)
- [Rust Book](https://doc.rust-lang.org/book/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Community
- GitHub Issues for bug reports
- GitHub Discussions for questions
- Discord/Slack for real-time chat

### Tools
- [Tauri Plugin Library](https://github.com/tauri-apps/plugins-workspace)
- [React DevTools](https://react.dev/learn/react-developer-tools)
- [Rust Analyzer](https://rust-analyzer.github.io/)

## Conclusion

Athas is built with modern web technologies and Rust, providing a fast and extensible code editing experience. We welcome contributions that improve performance, add features, or fix bugs. Follow this guide to get started, and don't hesitate to ask questions in the community channels!
