import { providerFetch } from "@/features/ai/services/providers/provider-fetch";
import { getApiBase } from "@/utils/api-base";

const API_BASE = getApiBase();

export interface AutocompleteModel {
  id: string;
  name: string;
}

class AutocompleteError extends Error {
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

export async function fetchAutocompleteModels(): Promise<AutocompleteModel[]> {
  const response = await providerFetch(`${API_BASE}/api/ai/autocomplete/models`, {
    method: "GET",
  });

  if (response.ok) {
    const body = await response.json();
    return parseModelListFromUnknown(body);
  }

  const openRouterResponse = await providerFetch("https://openrouter.ai/api/v1/models", {
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
