import type { AIChatSkill } from "@/features/ai/types/skills.types";

export const AI_CHAT_INSERT_SKILL_EVENT = "athas-ai-insert-skill";

export interface AIChatSkillInsertDetail {
  skill: AIChatSkill;
  surfaceId: string;
}

export function dispatchAIChatSkillInsert(skill: AIChatSkill, surfaceId: string) {
  window.dispatchEvent(
    new CustomEvent<AIChatSkillInsertDetail>(AI_CHAT_INSERT_SKILL_EVENT, {
      detail: { skill, surfaceId },
    }),
  );
}
