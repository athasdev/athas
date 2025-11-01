# Code Style Guide

## General

- Commits should have the first character uppercased
  - Use present tense (e.g., "Add language support for Python")
- Delete unused variables instead of prefixing with underscore

## Zustand

- Use `createSelectors` wrapper for all stores
- Use `immer` for deep nested state
- Use `persist` for localStorage sync
- Group all actions in an `actions` object
- Access other stores via `getState()` inside actions

## Tailwind

- Don't use `@apply`
- Use `size-X` instead of `w-X h-X`

## Accessibility

- Add `aria-label`, `role`, etc. to interactive elements

## Folder Structure

- Features: `src/features/[name]/[components,hooks,utils,models,etc.]`
- Extensions: `src/extensions/[themes,languages,etc.]`
- Shared: `src/[components,hooks,utils,etc.]`
- Documentation: `docs/`
- Scripts: `scripts/`

## Documentation

- Update docs when adding features or changing behavior
