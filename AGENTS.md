## Project Overview

- Athas is a desktop code editor built with Tauri, React, TypeScript, and Rust.
- Frontend feature code lives under `src/features/`.
- Shared frontend code lives under `src/components`, `src/hooks`, and `src/utils`.
- Extension-specific code lives under `src/extensions/`.
- Rust feature logic should prefer `crates/[feature]`; keep `src-tauri` focused on app wiring and integration.

## Setup And Validation

- Always use Bun for repo scripts and package management.
- Required environment: Bun `1.3.2`, Node.js `22+`, and Rust.
- Install dependencies with `bun install`.
- Start the app with `bun dev`.
- Use `bun smoke alpha` or `bun smoke prod` for quick local smoke tests of packaged app launches.
- Run full checks with `bun check`.
- Run tests with `bunx vp test run`.
- Run TypeScript checks with `bun typecheck`.
- Run Rust checks with `bun check:rust` when touching Rust code.
- When touching release flow, validate locally with `bun scripts/release.ts <bump> --dry-run` before anything else, then run `bun release:check`.

## Workflow Rules

- Never change `AGENTS.md` unless the user explicitly asks.
- Do not prefix unused variables with an underscore; delete them instead.
- Do not use emojis in commit messages, logs, or documentation.
- Validate the relevant checks after making changes instead of stopping at code edits.

## Branches And Releases

- Default to working directly on `master`.
- If a branch is needed, branch from `master`.
- Keep branch names short and descriptive.
- Keep releases and release tags on `master`.

## Commits

- Keep commits focused. One logical change per commit.
- Commit titles should be short, direct, and describe the outcome of the change.
- Start commit messages with an uppercase letter.
- Add a short commit body when the change benefits from extra context.
- Prefer a short wrapped commit body in plain language.
- Wrap commit body lines before the commitlint line-length limit instead of leaving warnings behind.
- Commit bodies should explain what changed and why without headings, boilerplate, or filler.
- When useful, end the commit message with a separate `Fixes ...` or `Closes ...` line.
- Avoid prefixes, filler, hype, and changelog-style noise in commit messages.
- Never leave commitlint or message-format warnings unresolved.
- Before creating a commit, run the checks that match the change.
- When editing commit text that includes code, multiline content, or shell-sensitive characters, prefer a file-based edit over inline shell text.

## Code Style

- Follow existing code style and keep changes aligned with nearby code.
- Use kebab-case for file and folder names by default.
- React component files, hook files, and utility files should use descriptive kebab-case names such as `settings-dialog.tsx`, `use-keymaps.ts`, or `theme-loader.ts`.
- Avoid new vague filenames such as `helpers.ts`, `misc.ts`, or `utils.ts` when the file can be named after what it actually does.
- Avoid unnecessary comments in UI components; prefer self-explanatory code.
- Avoid unnecessary `cn(...)` calls; use it only for conditional or merged class names.
- Use Tailwind utilities for normal component styling.
- Use CSS variables for theme colors; do not hardcode hex values in UI code.
- Keep font size, font family, theme colors, keymaps, and shortcuts in their existing system-level homes instead of redefining them ad hoc in feature components.
- Interactive elements must remain accessible, including accessible names for icon-only controls and usable keyboard/focus behavior.

## Zustand

- Always use the `createSelectors` wrapper for stores.
- Group store actions inside an `actions` object.
- Use `getState()` to access other stores inside actions instead of passing dependent state through parameters.
- Use `immer` when store updates are deeply nested.

## Code Organization

- Group feature-specific code under `src/features/[feature]/`.
- Keep `src/ui` for reusable UI primitives, `src/hooks` for shared hooks, and `src/utils` for genuinely shared helpers with no feature-specific behavior.
- Do not add feature logic to `src/` root shared folders just because it is convenient.
- Keep settings-related concerns such as fonts, themes, and UI preferences under `src/features/settings/`.
- Keep keymaps and shortcut logic under `src/features/keymaps/`.
- Keep extension and theme implementation under `src/extensions/`.
- Prefer subfolders such as `components`, `hooks`, `services`, `stores`, `types`, `utils`, and `tests` instead of leaving feature logic in the feature root.
- If a feature contains a distinct subfeature, give it a dedicated nested folder and keep its components, hooks, and helpers close to that subfeature instead of scattering them across the whole feature.
- If a file is only used by one subfeature, keep it inside that subfeature folder instead of promoting it to the feature root.
- Do not put feature-specific code in global shared folders unless it is genuinely shared across features.
- Keep feature tests under `src/features/[feature]/tests/` when practical.
- New user-facing documentation belongs in the `www` repo under `www/docs/`, not in this repo.

## Release Rules

- Validate release changes locally before publishing anything.
- Do not use real release tags to debug release automation.
- Keep Windows MSI versioning numeric-only via `tauri.bundle.windows.wix.version`.
- Release automation is triggered by pushing `v*` tags.
- Use `bun scripts/release.ts <bump> --dry-run` before running a real release command.
