# Architecture

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Zustand, Vite
- **Backend**: Tauri 2, Rust
- **Tools**: Biome, Bun
- **Editor**: LSP, Prism.js
- **Terminal**: xterm.js

## Project Structure

```
src/
├── components/         # Shared UI components
├── features/          # Feature modules (editor, terminal, git, vim, etc.)
├── extensions/        # Themes, icon themes, languages
├── hooks/            # Shared hooks
├── lib/              # Utilities
└── stores/           # Zustand stores
```

## Features

Uses vertical slice architecture - each feature has its own components, hooks, utils, types, etc.

Main features: AI, editor, terminal, file explorer, git, vim mode, search, tabs, settings.
