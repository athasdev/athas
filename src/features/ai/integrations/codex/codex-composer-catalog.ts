import { invoke } from "@tauri-apps/api/core";
import type { CodexSkillSummary, CodexThreadPage, CodexThreadSummary } from "./codex-types";

export const CODEX_COMPOSER_THREAD_PAGE_SIZE = 20;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeCodexThreads(value: unknown): CodexThreadSummary[] {
  const response = asRecord(value);
  const data = Array.isArray(response.data) ? response.data : [];

  return data
    .map((entry): CodexThreadSummary | null => {
      const thread = asRecord(entry);
      const id = asString(thread.id);
      if (!id) return null;

      return {
        id,
        name: asString(thread.name) || null,
        preview: asString(thread.preview),
        cwd: asString(thread.cwd),
        updatedAt: asNumber(thread.updatedAt),
      };
    })
    .filter((thread): thread is CodexThreadSummary => Boolean(thread));
}

export function normalizeCodexThreadPage(value: unknown): CodexThreadPage {
  const response = asRecord(value);
  const nextCursor = asString(response.nextCursor);

  return {
    threads: normalizeCodexThreads(value),
    nextCursor: nextCursor || null,
  };
}

export function normalizeCodexSkills(value: unknown) {
  const response = asRecord(value);
  const entries = Array.isArray(response.data) ? response.data : [];
  const skills: CodexSkillSummary[] = [];
  const skillErrors: string[] = [];
  const seen = new Set<string>();

  for (const value of entries) {
    const entry = asRecord(value);
    const entrySkills = Array.isArray(entry.skills) ? entry.skills : [];
    const entryErrors = Array.isArray(entry.errors) ? entry.errors : [];

    for (const value of entrySkills) {
      const skill = asRecord(value);
      const name = asString(skill.name);
      const path = asString(skill.path);
      const key = path || name;
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      skills.push({
        name,
        description: asString(skill.description) || asString(skill.shortDescription),
        path,
        scope: asString(skill.scope),
        enabled: skill.enabled !== false,
      });
    }

    for (const value of entryErrors) {
      const error = asRecord(value);
      const message = asString(error.message);
      if (message) skillErrors.push(message);
    }
  }

  return { skills, skillErrors };
}

export async function startCodexComposer(cwd: string): Promise<void> {
  await invoke("start_codex_integration", { args: { cwd } });
}

export async function listCodexComposerThreads(
  cwd: string,
  cursor: string | null = null,
): Promise<CodexThreadPage> {
  const result = await invoke("list_codex_threads", {
    cwd,
    cursor,
    limit: CODEX_COMPOSER_THREAD_PAGE_SIZE,
  });

  return normalizeCodexThreadPage(result);
}

export async function listCodexComposerSkills(cwd: string) {
  return normalizeCodexSkills(await invoke("list_codex_skills", { cwd }));
}
