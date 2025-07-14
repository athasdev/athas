# Contributing to Athas

Welcome! We're happy to have you here. Thank you in advance for your contribution in Athas.

Note: Please check existing issues and pull requests before creating a new one.

# The Basics

Athas welcomes contributions in the form of pull requests.

For small changes (e.g., bug fixes), feel free to submit a PR.

For larger changes (e.g., new lint rules, new functionality, new configuration options), consider creating an issue outlining your proposed change. You can also join us on slack to discuss your idea with the community. We've labeled beginner-friendly tasks in the issue tracker, along with bugs and improvements that are ready for contributions.

If you have suggestions on how we might improve the contributing documentation, let us know!

# Prerequisites

Athas is a Tauri project using Bun as package manager and Biome for linting/formatting.

- [Rust](https://rustup.rs) with `cargo`, `rustfmt`, and `clippy`
- [Tauri CLI](https://tauri.app) → `cargo install tauri-cli`
- [Bun](https://bun.sh) as package manager
- [Node.js ≥ 18](https://nodejs.org)

Check with: `node -v`, `cargo --version`, `tauri --version`, `bun --version`

# Development

After cloning the repository, run Athas locally from the repository root with:

```bash
bun install
bun run tauri dev
```

## Code Quality

Before opening a pull request, ensure your code passes all checks:

```bash
bun run check     # Run typecheck and biome check
bun run fix       # Auto-fix formatting and linting issues
```

Available commands:

- `bun run format` - Format code with Biome
- `bun run lint` - Lint code with Biome
- `bun run typecheck` - Run TypeScript type checking
- `bun run check` - Run both typecheck and biome check
- `bun run fix` - Auto-fix formatting and linting issues

# Pull Request Guidelines

## Commit History

To maintain a clean commit history:

1. **Squash commits** into logical, compact commits before opening your PR
2. **Rebase on origin/master** to avoid merge conflicts:
   ```bash
   git fetch origin
   git rebase origin/master
   ```
3. Each commit should represent a single logical change
4. Use descriptive commit messages following conventional commits format

## Before Submitting

- Ensure the app runs without crashing: `bun run tauri dev`
- All checks pass: `bun run check`
- Your branch is rebased on the latest master
- Commits are squashed into logical units
- Follow the PR template when opening your pull request

This helps maintainers review and merge your contributions efficiently without resolving conflicts.
