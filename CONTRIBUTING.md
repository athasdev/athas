# Contributing to Athas

Thank you for contributing to Athas!

Please check existing issues and pull requests before creating new ones.

## Getting Started

**Small changes** (bug fixes, typos): Submit a PR directly.

**Large changes** (new features, major refactors): Open an issue first to discuss.

## Setup

See [setup guides](docs/contributing/setup/) for your platform.

Prerequisites:
- [Rust](https://rustup.rs)
- [Bun](https://bun.sh)
- [Node.js ≥ 18](https://nodejs.org)

```bash
bun install
bun tauri dev
```

## Before Submitting

1. Code passes checks: `bun check`
2. Auto-fix issues: `bun fix`
3. App runs: `bun tauri dev`
4. Rebase on master: `git rebase origin/master`
5. Squash commits into logical units

## Guidelines

- Follow [code style](docs/contributing/code-style.md)
- Use descriptive commit messages (present tense, capitalized)
- One logical change per commit
- Update documentation if needed

## Documentation

- [Code Style](docs/contributing/code-style.md)
- [Architecture](docs/contributing/architecture.md)
- [Releasing](docs/contributing/releasing.md)
