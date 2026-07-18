const FILTERED_TAURI_WARNINGS = [
  "IPC custom protocol failed, Tauri will now use the postMessage interface instead",
  "[TAURI] Couldn't find callback id",
];

if (import.meta.env.DEV) {
  const originalWarn = console.warn.bind(console);

  console.warn = (...args: unknown[]) => {
    const firstArg = args[0];
    if (
      typeof firstArg === "string" &&
      FILTERED_TAURI_WARNINGS.some((message) => firstArg.startsWith(message))
    ) {
      return;
    }

    originalWarn(...args);
  };
}
