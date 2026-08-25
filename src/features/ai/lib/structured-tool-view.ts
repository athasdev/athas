import type { GenerativeUIView } from "@/extensions/ui/types/generative-ui";

interface StructuredToolViewEnvelope {
  type: "athas_ui";
  view: GenerativeUIView;
}

export function isStructuredToolViewEnvelope(value: unknown): value is StructuredToolViewEnvelope {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "athas_ui" &&
    "view" in value,
  );
}

export function getStructuredToolViews(output: unknown): GenerativeUIView[] {
  if (isStructuredToolViewEnvelope(output)) return [output.view];
  if (!Array.isArray(output)) return [];
  return output.filter(isStructuredToolViewEnvelope).map((item) => item.view);
}

export function stripStructuredToolViews(output: unknown): unknown {
  if (isStructuredToolViewEnvelope(output)) return undefined;
  if (!Array.isArray(output)) return output;
  const remaining = output.filter((item) => !isStructuredToolViewEnvelope(item));
  return remaining.length > 0 ? remaining : undefined;
}
