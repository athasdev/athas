import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { emitAppEvent } from "@/utils/app-events";

export interface AIChatSkillInsertDetail {
  skill: AIChatSkill;
  surfaceId: string;
}

export function dispatchAIChatSkillInsert(skill: AIChatSkill, surfaceId: string) {
  emitAppEvent("ai:insert-skill", { skill, surfaceId });
}
