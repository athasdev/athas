import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/utils/auth-api";
import { getProviderApiToken } from "@/utils/token-manager";

const API_BASE = import.meta.env.VITE_API_URL || "https://athas.dev";
const OPENROUTER_PROVIDER_ID = "openrouter";
const BYOK_HEADER = "X-OpenRouter-Api-Key";

export interface AutocompleteRequest {
  model: string;
  beforeCursor: string;
  afterCursor: string;
  filePath?: string;
  languageId?: string;
}

export interface AutocompleteModel {
  id: string;
  name: string;
}

export class AutocompleteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AutocompleteError";
    this.status = status;
  }
}

type OpenRouterModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
  }>;
};

function parseModelListFromUnknown(payload: unknown): AutocompleteModel[] {
  let models: unknown[] = [];

  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { models?: unknown }).models)
  ) {
    models = (payload as { models: unknown[] }).models;
  } else if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as OpenRouterModelResponse).data)
  ) {
    models = (payload as OpenRouterModelResponse).data as unknown[];
  }

  return models
    .map((model) => {
      if (!model || typeof model !== "object") return null;
      const candidate = model as { id?: unknown; name?: unknown };
      const id = typeof candidate.id === "string" ? candidate.id : "";
      const name = typeof candidate.name === "string" ? candidate.name : id;
      if (!id) return null;
      return { id, name };
    })
    .filter((model): model is AutocompleteModel => Boolean(model));
}

export async function requestAutocomplete(
  request: AutocompleteRequest,
  options?: { useByok?: boolean },
): Promise<{ completion: string }> {
  const token = await getAuthToken();
  if (!token) {
    throw new AutocompleteError("Not authenticated", 401);
  }

  let byokKey: string | null = null;
  if (options?.useByok) {
    byokKey = await getProviderApiToken(OPENROUTER_PROVIDER_ID);
    if (!byokKey) {
      throw new AutocompleteError("OpenRouter API key is required for free autocomplete.", 402);
    }
  }

  const response = await tauriFetch(`${API_BASE}/api/ai/autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(byokKey ? { [BYOK_HEADER]: byokKey } : {}),
    },
    body: JSON.stringify(request),
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error || `Autocomplete request failed (${response.status})`;
    throw new AutocompleteError(message, response.status);
  }

  return {
    completion: typeof body?.completion === "string" ? body.completion : "",
  };
}

export async function fetchAutocompleteModels(): Promise<AutocompleteModel[]> {
  const response = await tauriFetch(`${API_BASE}/api/ai/autocomplete/models`, {
    method: "GET",
  });

  if (response.ok) {
    const body = await response.json();
    return parseModelListFromUnknown(body);
  }

  // Fallback: if backend endpoint fails,
  // load public OpenRouter model metadata directly.
  const openRouterResponse = await tauriFetch("https://openrouter.ai/api/v1/models", {
    method: "GET",
  });

  if (!openRouterResponse.ok) {
    throw new AutocompleteError(
      `Failed to fetch fallback models (${openRouterResponse.status})`,
      openRouterResponse.status,
    );
  }

  const openRouterBody = await openRouterResponse.json();
  return parseModelListFromUnknown(openRouterBody);
}
