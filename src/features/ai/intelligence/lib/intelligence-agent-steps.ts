/** Model requests one turn may make before it pauses with a Continue affordance. */
export const DEFAULT_INTELLIGENCE_AGENT_STEPS = 25;
export const MIN_INTELLIGENCE_AGENT_STEPS = 1;
export const MAX_INTELLIGENCE_AGENT_STEPS = 100;

/** A whole number of steps within the allowed range, or the default for anything else. */
export function normalizeIntelligenceAgentSteps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_INTELLIGENCE_AGENT_STEPS;
  return Math.min(
    MAX_INTELLIGENCE_AGENT_STEPS,
    Math.max(MIN_INTELLIGENCE_AGENT_STEPS, Math.floor(value)),
  );
}
