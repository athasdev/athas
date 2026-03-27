import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";

export type HarnessRuntimeBackend = "legacy-acp-bridge" | "pi-native";

export const DEFAULT_HARNESS_RUNTIME_BACKEND: HarnessRuntimeBackend = "legacy-acp-bridge";

const AGENT_BUFFER_PATH_PREFIX = "agent://";

const isHarnessRuntimeBackend = (value: string): value is HarnessRuntimeBackend =>
  value === "legacy-acp-bridge" || value === "pi-native";

export const normalizeHarnessRuntimeBackend = (
  backend: HarnessRuntimeBackend | null | undefined,
): HarnessRuntimeBackend => backend ?? DEFAULT_HARNESS_RUNTIME_BACKEND;

export const buildHarnessAgentBufferPath = (
  sessionId = DEFAULT_HARNESS_SESSION_KEY,
  backend: HarnessRuntimeBackend = DEFAULT_HARNESS_RUNTIME_BACKEND,
): string => {
  const normalizedSessionId = sessionId.trim() || DEFAULT_HARNESS_SESSION_KEY;
  return `${AGENT_BUFFER_PATH_PREFIX}${backend}/${normalizedSessionId}`;
};

export const parseHarnessAgentBufferPath = (
  path: string | null | undefined,
): { backend: HarnessRuntimeBackend; sessionId: string } | null => {
  if (!path?.startsWith(AGENT_BUFFER_PATH_PREFIX)) {
    return null;
  }

  const remainder = path.slice(AGENT_BUFFER_PATH_PREFIX.length).trim();
  if (!remainder) {
    return {
      backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      sessionId: DEFAULT_HARNESS_SESSION_KEY,
    };
  }

  const [maybeBackend, ...sessionParts] = remainder.split("/");
  if (isHarnessRuntimeBackend(maybeBackend) && sessionParts.length > 0) {
    const normalizedSessionId = sessionParts.join("/").trim() || DEFAULT_HARNESS_SESSION_KEY;
    return {
      backend: maybeBackend,
      sessionId: normalizedSessionId,
    };
  }

  return {
    backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
    sessionId: remainder || DEFAULT_HARNESS_SESSION_KEY,
  };
};
