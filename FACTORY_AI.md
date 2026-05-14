# Factory AI Integration Guide for Athas

> This document is the single source of truth for how to use Factory AI (Droid) with the Athas project. It complements `AGENTS.md` which covers code conventions.

## Project Summary

**Athas** is a lightweight, cross-platform desktop code editor built with:
- **Frontend**: React 19 + TypeScript + Tailwind CSS + Zustand (in `src/`)
- **Backend**: Rust + Tauri v2 (in `src-tauri/` and `crates/`)
- **Key Features**: AI agents, Git integration, LSP support, Vim keybindings, integrated terminal, database viewers, collaboration, enterprise policy controls

## Quick Reference: Factory Capabilities

### Built-in Skills (Invoke with `/`)
| Skill | When to Use |
|-------|-------------|
| `review` | Code review for PRs or local changes |
| `simplify` | Refactor for reuse, quality, and efficiency |
| `security-review` | STRIDE, OWASP, supply chain security audit |
| `wiki` | Generate comprehensive codebase documentation |
| `install-wiki` | Auto-refresh wiki on every push |
| `install-qa` | Set up end-to-end automated QA testing |
| `install-code-review` | Auto code review on GitHub PRs |
| `paseo-epic` | Heavy-ceremony orchestration for big features |
| `paseo-committee` | Get a second opinion when stuck |
| `paseo-handoff` | Hand off current task to another agent |

### Quick-Reference Droids (General)
| Droid | Purpose | Invoke |
|-------|---------|--------|
| `athas-rust-expert` | General Rust/Tauri backend work | `delegate to athas-rust-expert` |
| `athas-frontend-expert` | General React/TS/UI work | `delegate to athas-frontend-expert` |
| `athas-qa-tester` | General testing and validation | `delegate to athas-qa-tester` |
| `athas-issue-resolver` | Bug triage and fixes | `delegate to athas-issue-resolver` |
| `athas-release-manager` | Release prep and validation | `delegate to athas-release-manager` |
| `athas-security-reviewer` | Security code review | `delegate to athas-security-reviewer` |

### Full Company Roster (30 Specialized Droids)
See `COMPANY_ROSTER.md` for the complete org chart. Key departments:

**Executive**: `athas-ceo`, `athas-chief-architect`
**Frontend**: `athas-react-engineer`, `athas-ui-engineer`, `athas-editor-engineer`, `athas-state-engineer`
**Backend**: `athas-rust-engineer`, `athas-tauri-engineer`, `athas-protocol-engineer`
**Platform**: `athas-devops-engineer`, `athas-release-engineer`
**QA**: `athas-qa-lead`, `athas-test-engineer`, `athas-smoke-tester`, `athas-performance-engineer`
**Security**: `athas-security-lead`, `athas-crypto-engineer`
**Product Teams**: `athas-ai-engineer`, `athas-git-engineer`, `athas-terminal-engineer`, `athas-database-engineer`, `athas-collaboration-engineer`, `athas-extension-engineer`
**Experience**: `athas-ux-designer`, `athas-docs-writer`, `athas-onboarding-specialist`
**Cross-Functional**: `athas-code-reviewer`, `athas-refactoring-specialist`, `athas-migration-engineer`, `athas-bug-hunter`

### Recommended MCPs
| MCP | Purpose | Install Command |
|-----|---------|-----------------|
| **GitHub** | Issue/PR management, repo operations | `droid mcp add github https://api.github.com/mcp` |
| **Linear** | Issue tracking integration | `droid mcp add linear https://mcp.linear.app/mcp` |
| **Slack** | Notifications and team comms | `droid mcp add slack https://mcp.slack.dev/sse` |
| **Playwright** | Browser/E2E testing | `droid mcp add playwright npx @playwright/mcp@latest` |

## Vibe Coding Workflow

### 1. Issue to Fix
```
> Use the GitHub MCP to list open issues. Pick one.
> Delegate to athas-issue-resolver to analyze and fix.
```

### 2. Feature to Build
```
> Use /paseo-epic for large features (multi-file, multi-phase)
> Or: describe the feature, let Droid plan and execute
```

### 3. Code Review
```
> /review on local changes before committing
> Or delegate to athas-security-reviewer for security-critical changes
```

### 4. Testing
```
> Delegate to athas-qa-tester to write tests for new code
> Run `bunx vp test run` to validate
```

### 5. Release
```
> Delegate to athas-release-manager for version bumps and validation
> Use `bun scripts/release.ts <bump> --dry-run` first
```

## Validation Checklist

Before any Droid completes work on Athas:
- [ ] `bun check` passes (frontend + rust)
- [ ] `bun typecheck` passes (TypeScript)
- [ ] `bunx vp test run` passes (unit tests)
- [ ] `bun check:rust` passes when touching Rust code
- [ ] No hardcoded hex colors, use CSS variables
- [ ] No `text-[11px]` hardcodes, use `ui-text-xs` etc.
- [ ] Feature code lives in `src/features/[feature]/`
- [ ] Zustand stores use `createSelectors` wrapper
- [ ] Commit message follows conventions in `AGENTS.md`

## Architecture Boundaries

### Frontend (`src/`)
- `src/features/[feature]/` - Feature-specific code (components, hooks, stores, utils, tests)
- `src/ui/` - Reusable UI primitives only
- `src/hooks/` - Shared hooks only
- `src/utils/` - Genuinely shared helpers only
- `src/extensions/` - Extension system code

### Backend (`crates/`)
- `crates/ai` - AI agent protocol
- `crates/database` - Database viewer engine
- `crates/debugger` - Debug adapter protocol
- `crates/extensions` - Extension runtime
- `crates/fff-search` - Fast file finder
- `crates/github` - GitHub API integration
- `crates/lsp` - Language Server Protocol
- `crates/project` - Project/workspace management
- `crates/remote` - Remote development
- `crates/runtime` - Core runtime
- `crates/terminal` - Terminal emulator
- `crates/tooling` - Build tooling
- `crates/version-control` - Git operations

### Tauri App Shell (`src-tauri/`)
- App wiring, window management, system integration
- Keep thin; delegate feature logic to `crates/`

## Useful Commands

```bash
# Dev
bun dev                          # Start app in preview mode
bun dev:stable                   # Start app in stable mode

# Validation
bun check                        # Full check (frontend + rust)
bun check:frontend               # Frontend only
bun check:rust                   # Rust only
bun typecheck                    # TypeScript
bunx vp test run                 # Unit tests
bun smoke alpha                  # Smoke test packaged app

# Release
bun scripts/release.ts patch --dry-run   # Dry run release
bun release:check                # Pre-release validation
```

## Context for Droids

When starting work, Droid automatically reads `AGENTS.md`. Key facts to remember:
- **Package manager**: Bun 1.3.2 (never npm/yarn)
- **Node**: >= 22
- **Test runner**: Vitest (via `bunx vp`)
- **Styling**: Tailwind v4 with CSS variables
- **State**: Zustand with `createSelectors` and `immer`
- **Icons**: Phosphor Icons (`@phosphor-icons/react`)
- **UI primitives**: Radix UI + Base UI + custom `src/ui/` primitives
- **Commit style**: Short, direct, uppercase start, no prefixes

## Factory Resources

- [Factory Docs](https://docs.factory.ai)
- [Custom Droids](https://docs.factory.ai/cli/configuration/custom-droids)
- [MCP Guide](https://docs.factory.ai/cli/configuration/mcp)
- [Skills Guide](https://docs.factory.ai/cli/configuration/skills)
- [BYOK Models](https://docs.factory.ai/cli/byok/overview)
- [Hooks Guide](https://docs.factory.ai/cli/configuration/hooks-guide)
- [Vibe Coding Skill](https://docs.factory.ai/guides/skills/vibe-coding)

## Updating This File

When new Factory capabilities are discovered or project workflows evolve, update this file so all Droids have the latest context.
