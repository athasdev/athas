## Important

- Commits should have the first character uppercased
- Do not prefix unused variables with an underscore, delete them instead

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

### Tailwind

- Don't use @apply
- Use size instead of w and h classes where possible (e.g. use `size-6` instead of `w-6 h-6`)

### Accessibility

- Always add accessibility attributes like `aria-label`, `role`, etc. to interactive elements

### Folder Structure

- Group related components, hooks, and utils into feature-based folders (e.g. `src/features/editor/[components,types,utils,config,constants,etc.])
- Use `src/` for shared, generic components used across multiple features (e.g. `src/components`, `src/hooks`, `src/utils`, etc.)
- Use `src/extensions/` for extension-specific code (e.g. themes, plugins, etc.)

### Documentation

- Update relevant documentation files when adding new features or making significant changes
- Documentation should be clear and concise, focusing on usage and examples
- Documentation is for users, not developers - avoid internal implementation details unless necessary for understanding usage
- For internal developer documentation, use comments in the codebase instead of separate docs
- Use markdown format for documentation files with proper headings, lists, and code blocks
- Documentation is stored in the same repository as the codebase for easy access and versioning (e.g. `docs/` folder or README files in relevant directories)
- README files in relevant directories should provide an overview of the directory's purpose and contents. They are for developers, not end-users.
