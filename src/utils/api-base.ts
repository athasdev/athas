const DEFAULT_API_BASE = "https://athas.dev";

function isLocalApiBase(value: string): boolean {
  return value.includes("localhost") || value.includes("127.0.0.1");
}

export function getApiBase(): string {
  const configuredApiBase = import.meta.env.VITE_API_URL?.trim();

  if (!configuredApiBase) {
    return DEFAULT_API_BASE;
  }

  if (import.meta.env.PROD && isLocalApiBase(configuredApiBase)) {
    return DEFAULT_API_BASE;
  }

  return configuredApiBase;
}

export const __test__ = {
  isLocalApiBase,
};
