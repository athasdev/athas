## Important

- Commits should have the first character uppercased
- Do not prefix unused variables with an underscore, delete them instead
- Do not use emojis in commit messages, logs, or documentation
- Never change the AGENTS.md file unless the user specifically asks for it
- Avoid unnecessary comments in UI components (keep code self-explanatory)
- Avoid unnecessary `cn(...)` calls: use it only for conditional or merged class names; do not wrap static strings
- Always use bun.
- PR descriptions should be simple, natural language, no headers or sections, just a few bullet points describing what changed and why.

## Zustand

This project uses Zustand for state management with specific patterns:

- `createSelectors` - Creates automatic selectors for each state property. Use like `store.use.property()` instead of `store((state) => state.property)`
- `immer` - Use when stores have deep nesting to enable direct mutations in set functions
- `persist` - Use to sync store state with localStorage
- `createWithEqualityFn` - Use when you need custom comparison functions for selectors to avoid unnecessary rerenders when stable references change
- `useShallow` - Use when creating selectors that return objects/arrays to compare them shallowly and avoid rerenders

### Store Access Patterns

- Use `getState()` to access other stores' state within actions: `const { fontSize } = useEditorSettingsStore.getState()`
- Prefer accessing dependent store state inside actions rather than passing parameters
- Group all actions in an `actions` object within the store
- Always use `createSelectors` wrapper for stores

### CSS Variables for Theming

All theme colors are defined as CSS variables following this structure:

**Variable Naming Convention:**

- Use semantic names without prefixes: `--primary-bg`, `--text`, `--accent`
- No `--tw-` prefix (this was removed during standardization)
- Variables are defined in `:root` with system theme fallbacks via `@media (prefers-color-scheme: dark)`

**Tailwind Integration:**

- CSS variables map to Tailwind colors via `@theme inline` directive
- Use pattern: `--color-{name}: var(--{name})`
- Enables utilities like `bg-primary-bg`, `text-text`, `border-border`

**Theme System:**

- All themes (including built-ins) are defined in JSON files in `src/extensions/themes/builtin/`
- Themes override CSS variables via the Theme Registry
- No CSS classes for themes - pure variable-based theming
- Data attributes track current theme: `data-theme="theme-id"` and `data-theme-type="light|dark"`

### File Organization

```
src/
├── styles.css                    # Global styles, Tailwind imports, theme config
├── features/
│   └── [feature]/
│       └── styles/              # Feature-specific CSS files
└── extensions/
    └── themes/
        ├── builtin/*.json       # Theme definitions
        ├── theme-registry.ts    # Theme management
        └── types.ts             # Theme interfaces
```

### Best Practices

1. **Consistency**: Use Tailwind utilities for all standard component styling
2. **Performance**: Use CSS files for complex layouts with many styles
3. **Theming**: Always use CSS variables for colors, never hardcode hex values
4. **Maintainability**: Keep styles close to their components using feature-based organization
5. **Customization**: Make components themeable by using semantic CSS variable names

### Accessibility

- Always add accessibility attributes like `aria-label`, `role`, etc. to interactive elements

### Folder Structure

- Group related components, hooks, and utils into feature-based folders (e.g. `src/features/editor/[components,types,utils,config,constants,etc.])
- Use `src/` for shared, generic components used across multiple features (e.g. `src/components`, `src/hooks`, `src/utils`, etc.)
- Use `src/extensions/` for extension-specific code (e.g. themes, plugins, etc.)
- New feature code should follow the canonical structure documented in the contributing docs (hosted in the www repo)
- Prefer `src/features/[feature]/{components,hooks,services,api,adapters,stores,state,selectors,contexts,types,constants,utils,tests}`
- Do not add new feature-specific logic to global folders unless it is genuinely shared across multiple features
- Do not leave feature logic scattered in `src/features/[feature]/` root when an appropriate subfolder exists
- Keep feature tests under `src/features/[feature]/tests/` when practical
- Backend feature logic should prefer `crates/[feature]`; keep `src-tauri` focused on app wiring and integration

### Documentation

- User-facing documentation lives in the **www** repo (`www/docs/`), not in this repo
- Update relevant documentation in the www repo when adding new features or making significant changes
- Documentation should be clear and concise, focusing on usage and examples
- Documentation is for users, not developers - avoid internal implementation details unless necessary for understanding usage
- Use markdown format for documentation files with proper headings, lists, and code blocks
