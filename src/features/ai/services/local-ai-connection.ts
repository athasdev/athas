import type { Settings } from "@/features/settings/types/settings.types";
import { resolveCustomProviderBaseUrl } from "./custom-provider-config";
import { isOllamaCloudUrl, resolveOllamaBaseUrl } from "./ollama-endpoint";

const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".lan", ".home.arpa", ".internal"];

function isPrivateIPv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b] = parts;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    // Carrier-grade NAT space, which Tailscale and similar private networks use.
    (a === 100 && b >= 64 && b <= 127) ||
    hostname === "0.0.0.0"
  );
}

function isPrivateIPv6(hostname: string) {
  const address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^fe[89ab]/.test(address)
  );
}

/** Whether `url` points at this machine or the local network, so requests to it stay private. */
export function isLocalEndpointUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  if (LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
  return isPrivateIPv4(hostname) || (hostname.includes(":") && isPrivateIPv6(hostname));
}

type LocalProviderSettings = Pick<
  Settings,
  "ollamaBaseUrl" | "aiCustomBaseUrl" | "aiAutocompleteCustomBaseUrl"
>;

/**
 * Whether a provider runs on this machine or the local network: Ollama away from Ollama Cloud,
 * or a custom OpenAI-compatible endpoint on a local host. Prompts sent to it never leave the LAN.
 */
export function isLocalAiProvider(providerId: string, settings: LocalProviderSettings): boolean {
  if (providerId === "ollama") {
    const baseUrl = resolveOllamaBaseUrl(settings.ollamaBaseUrl ?? "") ?? "http://localhost:11434";
    return !isOllamaCloudUrl(baseUrl) && isLocalEndpointUrl(baseUrl);
  }
  if (providerId === "custom") {
    return isLocalEndpointUrl(resolveCustomProviderBaseUrl(settings as Settings));
  }
  return false;
}

/**
 * The connection a chat's side requests, such as its title, must use: the chat's own local
 * provider and model, so a local chat's text is never sent to a hosted model. Null when the chat
 * is not a built-in agent chat on a local provider.
 */
export function getLocalChatConnection(
  chat: { agentId: string; providerId?: string | null; modelId?: string | null } | undefined,
  settings: LocalProviderSettings,
): { providerId: string; modelId: string } | null {
  if (!chat || chat.agentId !== "custom" || !chat.providerId) return null;
  if (!isLocalAiProvider(chat.providerId, settings)) return null;
  return { providerId: chat.providerId, modelId: chat.modelId?.trim() ?? "" };
}
