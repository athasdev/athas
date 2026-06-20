import type { SettingsTab } from "@/features/window/stores/ui-state.store";
import { compactSearchText, normalizeSearchText } from "@/utils/search-match";
import type { SettingSearchRecord } from "../types/search.types";

export const SETTINGS_SEARCH_TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  account: "Account",
  appearance: "Appearance",
  features: "Features",
  editor: "Editor",
  language: "Language",
  "file-explorer": "Files",
  git: "Git",
  terminal: "Terminal",
  keyboard: "Keybindings",
  extensions: "Extensions",
  databases: "Database",
  ai: "AI",
  collaboration: "Collaboration",
  enterprise: "Enterprise",
  advanced: "Advanced",
};

export function getSettingSearchTargetKey(value: string) {
  return compactSearchText(value) || "setting";
}

function scoreField(value: string, query: string, tokens: string[], weight: number) {
  const normalizedValue = normalizeSearchText(value);
  const compactValue = compactSearchText(value);
  const compactQuery = compactSearchText(query);
  const words = normalizedValue.split(/\s+/).filter(Boolean);
  let score = 0;

  if (normalizedValue === query) {
    score += weight * 40;
  } else if (normalizedValue.startsWith(query)) {
    score += weight * 28;
  } else if (normalizedValue.includes(query) || compactValue.includes(compactQuery)) {
    score += weight * 18;
  }

  for (const token of tokens) {
    const compactToken = compactSearchText(token);
    let tokenScore = 0;

    if (words.includes(token)) {
      tokenScore = weight * 10;
    } else if (words.some((word) => word.startsWith(token))) {
      tokenScore = weight * 7;
    } else if (normalizedValue.includes(token)) {
      tokenScore = weight * 4;
    } else if (compactValue.includes(compactToken)) {
      tokenScore = weight * 3;
    }

    score += tokenScore;
  }

  return score;
}

export function scoreSettingSearchRecord(query: string, record: SettingSearchRecord) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const fields = [
    { value: record.label, weight: 16 },
    { value: record.section, weight: 8 },
    { value: SETTINGS_SEARCH_TAB_LABELS[record.tab], weight: 7 },
    { value: record.description, weight: 3 },
    ...(record.keywords ?? []).map((keyword) => ({ value: keyword, weight: 6 })),
  ];

  const allTokensMatched = tokens.every((token) => {
    const compactToken = compactSearchText(token);
    return fields.some(({ value }) => {
      const normalizedValue = normalizeSearchText(value);
      return normalizedValue.includes(token) || compactSearchText(value).includes(compactToken);
    });
  });

  if (!allTokensMatched) return 0;

  return fields.reduce(
    (total, field) => total + scoreField(field.value, normalizedQuery, tokens, field.weight),
    0,
  );
}
