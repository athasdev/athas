const MAX_GENERATED_SOURCE_LENGTH = 100_000;
const FORBIDDEN_GENERATED_SOURCE_PATTERNS = [
  { pattern: /\bimport\s*(?:\(|["'{*])/, label: "imports" },
  { pattern: /\brequire\s*\(/, label: "require" },
  { pattern: /\beval\s*\(/, label: "eval" },
  { pattern: /\bFunction\s*\(/, label: "Function" },
  { pattern: /\b(?:document|window)\s*(?:\.|\[)/, label: "browser DOM APIs" },
  {
    pattern:
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|WebTransport|Worker|SharedWorker|importScripts|BroadcastChannel)\b/,
    label: "direct network or worker APIs",
  },
  {
    pattern: /\b(?:postMessage|indexedDB|caches)\b/,
    label: "worker messaging or storage globals",
  },
  {
    pattern: /(?<![\w$.])(?:self|globalThis)\b/,
    label: "worker global objects",
  },
  { pattern: /\.constructor\b/, label: "dynamic code constructors" },
] as const;

export function validateGeneratedExtensionSource(code: string): void {
  if (!code.trim()) throw new Error("Generated extension source must not be empty");
  if (code.length > MAX_GENERATED_SOURCE_LENGTH) {
    throw new Error(
      `Generated extension source must be at most ${MAX_GENERATED_SOURCE_LENGTH} characters`,
    );
  }
  const forbidden = FORBIDDEN_GENERATED_SOURCE_PATTERNS.find(({ pattern }) => pattern.test(code));
  if (forbidden) {
    throw new Error(`Generated extension source must not use ${forbidden.label}`);
  }
}
