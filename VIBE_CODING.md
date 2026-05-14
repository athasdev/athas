# Vibe Coding with Factory AI on Athas

> This guide defines the "vibe coding" workflow for Athas: iterative, creative, autonomous development using Factory AI's full capability stack.

## Philosophy

Vibe coding means describing what you want in plain English and letting the AI handle implementation details, while maintaining code quality through automated validation. For Athas, this means:

1. **Describe** the feature or fix
2. **Plan** with Droid (or let it self-plan)
3. **Implement** with specialized droids
4. **Validate** automatically
5. **Iterate** based on feedback

## The Factory AI Stack for Athas

```
User Request
    |
    v
[Droid CLI] -----> AGENTS.md + FACTORY_AI.md (context)
    |
    +---> Skills (/review, /simplify, /security-review, /wiki, /install-qa)
    |
    +---> Custom Droids (rust-expert, frontend-expert, qa-tester, issue-resolver)
    |
    +---> MCPs (GitHub, Linear, Slack, Playwright)
    |
    +---> Paseo (paseo-epic for big features, paseo-committee for decisions)
    |
    v
[Validation] -----> bun check + tests + typecheck + rust check
    |
    v
[Commit] -------> Clean, focused commits
```

## Workflow Patterns

### Pattern A: Quick Fix (5 min)

For small bugs or one-line changes:

```
> Fix the typo in the git status panel
Droid locates -> fixes -> validates -> commits
```

### Pattern B: Feature Implementation (30 min - 2 hrs)

For medium features (1-5 files):

```
> Add a "copy file path" action to the file explorer context menu

Droid:
1. Explores src/features/file-explorer/ for existing context menu code
2. Adds the action to the context menu component
3. Implements the copy logic using Tauri clipboard API
4. Adds a keyboard shortcut to keymaps
5. Validates: bun typecheck, bun check:frontend
6. Commits: "Add copy file path action to file explorer"
```

### Pattern C: Epic Feature (2+ hrs, multi-phase)

For large features spanning multiple systems:

```
> /paseo-epic Implement collaborative cursors for the editor

Paseo orchestrates:
- Phase 1: Research existing collaboration infra in src/features/collaboration/
- Phase 2: Design cursor data model and protocol
- Phase 3: Implement cursor rendering layer in editor
- Phase 4: Wire up collaboration backend (Rust)
- Phase 5: Add settings and toggle
- Phase 6: Write tests
- Phase 7: Validation and review

Each phase delegates to appropriate droids:
- Rust backend -> athas-rust-expert
- React frontend -> athas-frontend-expert
- Testing -> athas-qa-tester
- Security review -> athas-security-reviewer
```

### Pattern D: Issue Triage and Fix

```
> Use GitHub MCP to list open bugs
> Delegate to athas-issue-resolver to fix #123

athas-issue-resolver:
1. Fetches issue details via GitHub MCP
2. Reads related code
3. Reproduces the bug
4. Implements minimal fix
5. Adds regression test
6. Validates and commits
7. Comments on the issue with resolution
```

### Pattern E: Security Audit

```
> /security-review on the AI agent tool execution code

Droid runs STRIDE + OWASP analysis on:
- crates/ai/ (agent sandboxing)
- src/features/ai/ (frontend AI chat)
- crates/extensions/ (extension security)

Reports findings with severity, file refs, and fixes.
```

## Daily Standup Commands

```bash
# Morning: Check what needs attention
> List open PRs needing review
> /review on my local changes

# Mid-day: Pick up work
> Delegate to athas-issue-resolver for the highest priority bug

# Afternoon: Validation
> bun check
> bunx vp test run

# EOD: Documentation
> /wiki to update the codebase wiki with today's changes
```

## Droid Selection Guide

| Task Type | Who to Call | How |
|-----------|-------------|-----|
| Rust bug in Git operations | athas-rust-expert | `delegate to athas-rust-expert: fix...` |
| New React component for settings | athas-frontend-expert | `delegate to athas-frontend-expert: add...` |
| Missing tests for database viewer | athas-qa-tester | `delegate to athas-qa-tester: write tests...` |
| Crash report #456 | athas-issue-resolver | `delegate to athas-issue-resolver: fix issue 456` |
| New release v0.8.0 | athas-release-manager | `delegate to athas-release-manager: prepare release` |
| PR with auth changes | athas-security-reviewer | `delegate to athas-security-reviewer: review auth PR` |
| Large feature (multi-crate) | paseo-epic | `/paseo-epic Implement...` |
| Stuck on architecture decision | paseo-committee | `/paseo-committee Should we use X or Y for...` |

## MCP Integration Patterns

### GitHub MCP
```
> List open issues with label "good first issue"
> Create a branch for issue #123
> Open a PR from this branch with description "Fixes #123: ..."
> Merge PR #456 after checks pass
```

### Linear MCP
```
> List Linear issues assigned to me
> Update ENG-123 status to "In Progress"
> Comment on ENG-456 with the fix details
```

### Playwright MCP
```
> Test the new file explorer drag-and-drop feature
> Take a screenshot of the settings dialog
> Verify the terminal opens with correct profile
```

## Quality Gates

Every vibe coding session must pass these gates before completion:

1. **Type Safety**: `bun typecheck` (zero errors)
2. **Lint**: `bun check:frontend` and `cargo clippy` (zero warnings)
3. **Tests**: `bunx vp test run` and `cargo test` (all pass)
4. **Style**: No hardcoded colors/fonts, feature code in `src/features/[feature]/`
5. **Commits**: One logical change per commit, descriptive message
6. **Security**: No secrets in code, proper input validation

## Escalation Paths

| Situation | Action |
|-----------|--------|
| Simple, well-defined task | Direct to Droid, self-plan |
| Medium complexity | Droid plans, asks for confirmation |
| Large/multi-feature | `/paseo-epic` for structured orchestration |
| Unclear requirements | `/paseo-committee` to clarify approach |
| Security-critical | Always `athas-security-reviewer` |
| Stuck/dead-end | `/paseo-committee` for fresh perspective |
| Handoff needed | `/paseo-handoff` to another agent |

## Tips for Maximum Velocity

1. **Be specific in prompts**: "Add a copy button to the file explorer toolbar" beats "improve the file explorer"
2. **Use droids for parallel work**: Delegate frontend and backend work simultaneously
3. **Always validate**: Never skip `bun check` after changes
4. **Let Droid explore first**: For unfamiliar code, ask Droid to explore before implementing
5. **Use skills for common tasks**: `/review`, `/simplify`, `/wiki` are faster than manual prompts
6. **Keep context files updated**: When Droid discovers new patterns, update `AGENTS.md` or `FACTORY_AI.md`
7. **Commit early and often**: One logical change = one commit, makes review easier

## Customization

Add your own droids to `.factory/droids/`:
```yaml
---
name: my-custom-droid
description: What this droid does and when to use it
model: inherit
---
# Your custom prompt here
```

Add your own skills via the Skills tool or in `.factory/skills/`.

## Updating This Guide

When new patterns emerge, update this file. When Factory adds new capabilities, document them in `FACTORY_AI.md` and reference here.
