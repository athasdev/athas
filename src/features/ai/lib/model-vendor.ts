/** Gateway vendor prefixes (`vendor/model`) mapped to the provider ids `ProviderIcon` knows. */
const VENDOR_ICON_IDS: Readonly<Record<string, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  qwen: "qwen",
  alibaba: "qwen",
  "x-ai": "xai",
  xai: "xai",
  deepseek: "deepseek",
  mistral: "mistral",
  mistralai: "mistral",
  moonshotai: "kimi-cli",
};

const VENDOR_NAMES: Readonly<Record<string, string>> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  qwen: "Qwen",
  alibaba: "Alibaba",
  "x-ai": "xAI",
  xai: "xAI",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  mistralai: "Mistral",
  moonshotai: "Moonshot",
  minimax: "MiniMax",
  "meta-llama": "Meta",
  zai: "Z.ai",
};

function getVendor(modelId: string): string | undefined {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash).toLowerCase() : undefined;
}

/** The vendor behind a gateway `vendor/model` id, for labelling rows; undefined otherwise. */
export function getModelVendorName(modelId: string): string | undefined {
  const vendor = getVendor(modelId);
  return vendor ? (VENDOR_NAMES[vendor] ?? vendor) : undefined;
}

/**
 * The icon for one model row. Gateways such as Athas and OpenRouter serve models from many
 * vendors under `vendor/model` ids, so those rows show the vendor's mark; everything else, and
 * vendors without a mark, keep the connection's own icon.
 */
export function getModelIconId(providerId: string, modelId: string): string {
  const vendor = getVendor(modelId);
  return (vendor && VENDOR_ICON_IDS[vendor]) || providerId;
}

/**
 * Model families worth suggesting first, strongest fallback last within each family. Patterns
 * rather than ids, so the picks follow the catalog as it updates and never name a model the
 * catalog does not serve.
 */
const RECOMMENDED_FAMILIES: readonly (readonly RegExp[])[] = [
  [/^anthropic\/claude-sonnet-/],
  [/^openai\/gpt-[\d.]+-terra$/, /^openai\/gpt-[\d.]+-sol$/, /^openai\/gpt-(?!.*codex)/],
  [/^google\/gemini-[\d.]+-pro/],
];

/**
 * Athas Automatic plus the catalog's first match for each recommended family, in catalog order
 * within a family. Empty when the catalog has none of them.
 */
export function pickRecommendedModels<T extends { id: string }>(models: readonly T[]): T[] {
  const picks = RECOMMENDED_FAMILIES.flatMap((patterns) => {
    for (const pattern of patterns) {
      const match = models.find((model) => pattern.test(model.id));
      if (match) return [match];
    }
    return [];
  });
  if (picks.length === 0) return [];
  const automatic = models.find((model) => model.id === "auto");
  return automatic ? [automatic, ...picks] : picks;
}
