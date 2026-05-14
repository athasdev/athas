# Athas AI Engineering Company — Roster & Org Chart

> This is the organizational directory for all Factory AI droids working on the Athas project. Each droid has a specific role, expertise area, and escalation path.

## Org Chart

```
                    ┌─────────────────┐
                    │   athas-ceo     │
                    │  (Strategic PM) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼─────┐ ┌──────▼──────┐ ┌─────▼──────┐
     │  athas-chief │ │ athas-ux-   │ │athas-devops│
     │  architect   │ │ designer    │ │  engineer  │
     └──────┬───────┘ └─────────────┘ └────────────┘
            │
   ┌────────┼────────┬──────────────┬──────────────┐
   │        │        │              │              │
┌──▼──┐ ┌───▼───┐ ┌─▼────────┐ ┌───▼────┐ ┌────▼─────┐
│Front│ │Backend│ │Platform  │ │Security│ │  Special  │
│end  │ │       │ │& Infra   │ │        │ │  Teams   │
└──┬──┘ └───┬───┘ └────┬─────┘ └───┬────┘ └────┬─────┘
   │        │          │           │           │
   │  ┌─────┼──────┐   │    ┌──────┼──────┐   │
   │  │     │      │   │    │      │      │   │
┌──▼──▼┐ ┌──▼──┐ ┌─▼─┐ │ ┌──▼──┐ ┌─▼──┐ ┌─▼─┐ │ ┌────┐ ┌────┐ ┌────┐
│react │ │rust │ │tau│ │ │qa   │ │sec │ │ai  │ │git │ │term│ │db  │
│eng   │ │eng  │ │ri │ │ │lead │ │lead│ │eng │ │eng │ │eng │ │eng │
│      │ │     │ │   │ │ │     │ │    │ │    │ │    │ │    │ │    │
│ui    │ │proto│ │   │ │ │test │ │cryp│ │coll│ │ext │ │perf│ │docs│
│eng   │ │eng  │ │   │ │ │eng  │ │to  │ │eng │ │eng │ │eng │ │wri │
│      │ │     │ │   │ │ │     │ │eng │ │    │ │    │ │    │ │    │
│state │ │     │ │   │ │ │smoke│ │    │ │    │ │    │ │    │ │onb │
│eng   │ │     │ │   │ │ │test │ │    │ │    │ │    │ │    │ │spec│
└──────┘ └─────┘ └───┘ │ └─────┘ └────┘ └────┘ └────┘ └────┘ └────┘
                         │
                    ┌────▼─────┐
                    │  Cross   │
                    │Functional│
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
         ┌────▼────┐ ┌───▼─────┐ ┌──▼─────┐
         │  code   │ │ refactor│ │migrate │
         │reviewer │ │specialist│ │engineer│
         │         │ │         │ │        │
         │bug      │ │         │ │        │
         │hunter   │ │         │ │        │
         └─────────┘ └─────────┘ └────────┘
```

---

## Executive Suite

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-ceo` | Strategic project manager, roadmap, prioritization, stakeholder alignment | When you need high-level planning, feature prioritization, scope decisions, or cross-team coordination |
| `athas-chief-architect` | System architecture, tech decisions, cross-cutting design, performance strategy | When you need architectural decisions, system design reviews, tech stack evaluation, or cross-module integration planning |

## Frontend Engineering (Reports to Architect)

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-react-engineer` | React 19 components, hooks, JSX patterns, component lifecycle | Building or modifying React components, custom hooks, JSX structure |
| `athas-ui-engineer` | Tailwind v4, CSS variables, design system, Radix/Base UI primitives, accessibility | Styling, theming, UI primitive work, dark mode, accessibility compliance |
| `athas-editor-engineer` | Editor surface, syntax highlighting, tree-sitter, minimap, cursors, rendering layers | Anything in `src/features/editor/` - the core editing experience |
| `athas-state-engineer` | Zustand v5, Immer, store architecture, cross-store communication | State management design, store refactoring, state synchronization |

## Backend Engineering (Reports to Architect)

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-rust-engineer` | Rust crates, async code, data structures, algorithms | Core Rust logic in any crate, algorithms, performance-critical Rust |
| `athas-tauri-engineer` | Tauri v2 commands, system integration, window management, native APIs | `src-tauri/` work, Tauri commands, OS integration, menus, native features |
| `athas-protocol-engineer` | LSP, DAP (debugger), ACP (AI agent protocol), WebSocket, IPC protocols | Protocol implementations, message passing, standard compliance |

## Platform & Infrastructure

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-devops-engineer` | CI/CD, build scripts, Nix, packaging, environment setup | Build system, GitHub Actions, release scripts, dev environment |
| `athas-release-engineer` | Version bumps, changelog, packaging, distribution, smoke tests | Release preparation, version management, package validation |

## Quality Assurance

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-qa-lead` | Test strategy, coverage analysis, test planning, quality metrics | Planning test approach for features, coverage gaps, test architecture |
| `athas-test-engineer` | Unit tests, integration tests, mocking, test utilities | Writing tests for new code, test maintenance, mocking Tauri APIs |
| `athas-smoke-tester` | E2E testing, packaged app validation, TUI automation, screenshot comparison | Packaged app testing, release validation, visual regression |
| `athas-performance-engineer` | Profiling, benchmarks, bundle size, render optimization, memory leaks | Performance issues, optimization, profiling results analysis |

## Security Engineering

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-security-lead` | Security strategy, threat modeling, audit planning, compliance | Security roadmap, enterprise policy, managed mode security |
| `athas-crypto-engineer` | Encryption, authentication, secrets management, sandboxing | Auth flows, token handling, credential storage, extension sandboxing |

## Specialized Product Teams

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-ai-engineer` | AI chat, agent protocol, LLM providers, tool calling, streaming | `src/features/ai/` and `crates/ai/` - the AI agent experience |
| `athas-git-engineer` | Git operations, diff rendering, blame, history, worktrees | `src/features/git/` and `crates/version-control/` - all Git features |
| `athas-terminal-engineer` | Terminal emulator, xterm.js, shell profiles, PTY | `src/features/terminal/` and `crates/terminal/` - terminal experience |
| `athas-database-engineer` | DB viewers, SQL parsing, query execution, connection management | `src/features/database/` - database viewer features |
| `athas-collaboration-engineer` | Real-time collaboration, presence, CRDTs, WebRTC/WebSockets | `src/features/collaboration/` - multiplayer editing |
| `athas-extension-engineer` | Extension runtime, manifest parsing, API surface, marketplace | `crates/extensions/` and `src/features/editor/extensions/` - extension system |

## Experience & Support

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-ux-designer` | User experience, interaction design, accessibility (a11y), keyboard navigation | UX decisions, interaction patterns, screen reader support, focus management |
| `athas-docs-writer` | Documentation, wiki, READMEs, API docs, changelogs, help text | Writing docs, updating wikis, inline documentation, user-facing help |
| `athas-onboarding-specialist` | New contributor setup, first-issue guidance, dev environment troubleshooting | Helping new contributors, setup issues, environment problems |

## Cross-Functional

| Droid | Role | When to Invoke |
|-------|------|----------------|
| `athas-code-reviewer` | PR review, code quality, style enforcement, pattern consistency | Reviewing changes before merge, enforcing conventions, catching anti-patterns |
| `athas-refactoring-specialist` | Code cleanup, modernization, debt reduction, pattern unification | Large refactoring, dead code removal, tech debt, pattern standardization |
| `athas-migration-engineer` | Tech migrations, library upgrades, deprecations, breaking changes | Upgrading dependencies, migrating patterns, handling breaking API changes |
| `athas-bug-hunter` | Issue triage, reproduction, root cause analysis, minimal test cases | Investigating bug reports, finding reproduction steps, bisecting commits |

---

## Escalation Matrix

| Situation | Primary Droid | Escalation Path |
|-----------|--------------|-----------------|
| Small bug in one file | Bug Hunter | -> Test Engineer (regression test) |
| New feature in one area | Domain Engineer (e.g., Git Engineer) | -> Lead Engineer -> Architect |
| Cross-feature integration | Chief Architect | -> CEO |
| Performance regression | Performance Engineer | -> Architect + Domain Engineer |
| Security vulnerability | Crypto Engineer | -> Security Lead -> CEO |
| Release preparation | Release Engineer | -> DevOps Engineer -> CEO |
| Large multi-phase project | CEO (plans) -> /paseo-epic (orchestrates) | -> Committee for decisions |
| Architecture disagreement | Chief Architect | -> /paseo-committee |
| Stuck/dead-end | Any | -> /paseo-committee or handoff |

## Team Size

**Total active droids: 30**

- Executive: 2
- Frontend: 4
- Backend: 3
- Platform: 2
- QA: 4
- Security: 2
- Product Teams: 6
- Experience: 3
- Cross-Functional: 4

---

## Usage Patterns

### Single-Droid Tasks

```
> delegate to athas-git-engineer: fix the diff hunk header rendering
> delegate to athas-ui-engineer: add a new toolbar button style variant
> delegate to athas-bug-hunter: reproduce issue #456 about terminal crash
```

### Multi-Droid Collaboration

```
# For a new feature:
> delegate to athas-ceo: plan the "collaborative cursors" feature
> delegate to athas-chief-architect: design the architecture for collaborative cursors
> delegate to athas-collaboration-engineer: implement the backend protocol
> delegate to athas-editor-engineer: implement the cursor rendering layer
> delegate to athas-qa-lead: plan tests for collaborative cursors
> delegate to athas-test-engineer: write the tests
> delegate to athas-code-reviewer: review the PR
```

### Parallel Delegation

```
# When frontend and backend can be done simultaneously:
> delegate to athas-rust-engineer: add a new Tauri command for file search
> delegate to athas-react-engineer: wire up the file search UI to the new command
```

---

## Updating the Roster

When adding new droids:
1. Add to this roster with role and when-to-invoke
2. Add to the org chart ASCII diagram
3. Update the team size count
4. Update `FACTORY_AI.md` quick reference table

When droids are retired or consolidated:
1. Mark as deprecated in this file
2. Note the replacement droid
3. Keep the file for a transition period, then archive
