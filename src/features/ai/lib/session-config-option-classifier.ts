import type { SessionConfigOption } from "@/features/ai/types/acp";

export type SessionConfigOptionCategory = "model" | "mode" | "thought_level" | "other";

function normalizeConfigText(option: SessionConfigOption): string {
  return [option.id, option.name, option.description ?? ""].join(" ").toLowerCase();
}

export function classifySessionConfigOption(
  option: SessionConfigOption,
): SessionConfigOptionCategory {
  const text = normalizeConfigText(option);

  if (/\bmodel\b|\bmodels\b|\bprovider\b/.test(text)) {
    return "model";
  }

  if (/\bmode\b|\bprofile\b/.test(text)) {
    return "mode";
  }

  if (/\bthought\b|\breasoning\b|\bthinking\b|\beffort\b/.test(text)) {
    return "thought_level";
  }

  return "other";
}

export function getPrimarySessionConfigOption(
  options: SessionConfigOption[],
  category: SessionConfigOptionCategory,
): SessionConfigOption | null {
  return options.find((option) => classifySessionConfigOption(option) === category) ?? null;
}
