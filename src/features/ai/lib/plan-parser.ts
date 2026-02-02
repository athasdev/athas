export interface PlanStep {
  index: number;
  title: string;
  description: string;
}

export interface ParsedPlan {
  beforePlan: string;
  steps: PlanStep[];
  afterPlan: string;
}

/**
 * Parse plan blocks from message content.
 * Returns null if no valid plan block is found.
 */
export function parsePlan(content: string): ParsedPlan | null {
  const planMatch = content.match(/\[PLAN_BLOCK\]([\s\S]*?)\[\/PLAN_BLOCK\]/);
  if (!planMatch) return null;

  const beforePlan = content.slice(0, planMatch.index).trim();
  const afterPlan = content.slice((planMatch.index ?? 0) + planMatch[0].length).trim();

  const stepRegex = /\[STEP\]\s*(.*?)(?:\n([\s\S]*?))?\[\/STEP\]/g;
  const steps: PlanStep[] = [];
  let index = 0;

  for (const match of planMatch[1].matchAll(stepRegex)) {
    steps.push({
      index,
      title: match[1].trim(),
      description: (match[2] || "").trim(),
    });
    index++;
  }

  if (steps.length === 0) return null;

  return { beforePlan, steps, afterPlan };
}

/**
 * Fast check for whether content contains a complete plan block.
 */
export function hasPlanBlock(content: string): boolean {
  return content.includes("[PLAN_BLOCK]") && content.includes("[/PLAN_BLOCK]");
}
