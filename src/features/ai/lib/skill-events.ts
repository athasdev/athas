import type { AIChatSkill } from "@/features/ai/types/skills";

export const AI_CHAT_INSERT_SKILL_EVENT = "athas-ai-insert-skill";

export function dispatchAIChatSkillInsert(skill: AIChatSkill) {
  window.dispatchEvent(new CustomEvent<AIChatSkill>(AI_CHAT_INSERT_SKILL_EVENT, { detail: skill }));
}
