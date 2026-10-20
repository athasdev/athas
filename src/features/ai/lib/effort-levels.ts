const EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "Off",
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  med: "Medium",
  high: "High",
  xhigh: "Extra high",
  extrahigh: "Extra high",
  veryhigh: "Extra high",
  max: "Max",
  maximum: "Max",
};

const AUTO_EFFORTS = new Set(["default", "auto"]);

const normalizeEffort = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** An effort that leaves the choice to the agent ("default", "auto") rather than a level. */
export function isAutoEffort(value: string): boolean {
  return AUTO_EFFORTS.has(normalizeEffort(value));
}

/**
 * One wording for every agent's effort scale: Codex says `xhigh`, Claude says `Xhigh`, both read
 * "Extra high"; the agent's own "default" reads "Auto". Unknown levels keep the agent's name.
 */
export function formatEffortLabel(value: string, name?: string): string {
  if (isAutoEffort(value)) return "Auto";
  const known = EFFORT_LABELS[normalizeEffort(value)] ?? EFFORT_LABELS[normalizeEffort(name ?? "")];
  if (known) return known;
  const fallback = (name || value).trim();
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}
