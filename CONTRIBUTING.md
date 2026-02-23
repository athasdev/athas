# Contributing to Athas

Thank you for contributing to Athas! Please check existing issues and pull requests before creating new ones.

## Setup

See [setup guides](docs/contributing/setup/) for your platform.

Prerequisites:
- [Rust](https://rustup.rs)
- [Bun](https://bun.sh)
- [Node.js ≥ 18](https://nodejs.org)

```bash
bun install
bun dev
```

## Before Submitting

1. Code passes checks: `bun check`
2. Auto-fix issues: `bun fix`
3. App runs: `bun dev`
4. Rebase on master: `git rebase origin/master`
5. Squash commits into logical units
6. Review and agree to the
   [Contributor License and Feedback Agreement](CONTRIBUTOR_LICENSE_AND_FEEDBACK_AGREEMENT.md)

## Guidelines

- Follow the existing code style
- Use descriptive commit messages (i.e., "Add autocompletion")
- One logical change per commit
- Update documentation if needed

## Documentation

- [Releasing](docs/contributing/releasing.md)
