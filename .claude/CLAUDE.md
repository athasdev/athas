## Important

- commits should have the first character uppercased
- do not prefix unused variables with an underscore.
  delete them instead.

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
