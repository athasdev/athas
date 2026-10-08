import { commands } from "@/bindings/commands";
import type {
  CodexSkillSummary,
  CodexThreadPage,
  CodexThreadSummary,
  CodexModelOption,
} from "./codex-types";
import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/utils/query-client";

const CATALOG_STALE_MS = 30_000;
const STARTUP_STALE_MS = 5_000;

const codexCatalogKeys = {
  startup: (cwd: string) => ["codex", cwd, "startup"] as const,
  models: (cwd: string) => ["codex", cwd, "models"] as const,
  threads: (cwd: string, cursor: string | null) => ["codex", cwd, "threads", cursor] as const,
  skills: (cwd: string) => ["codex", cwd, "skills"] as const,
};

/**
 * Concurrent reads share one request and fresh results are reused. A forced read cancels a request
 * already in flight instead of joining it, so it never returns a response that started earlier.
 */
async function loadCatalogEntry<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  options: { staleTime: number; force?: boolean },
): Promise<T> {
  if (options.force) await queryClient.cancelQueries({ queryKey, exact: true });
  return queryClient.query({
    queryKey,
    queryFn,
    staleTime: options.force ? 0 : options.staleTime,
    retry: false,
  });
}

async function withCatalogTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Codex took too long to respond. Try again.")),
        15_000,
      );
      request.then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeCodexModels(value: unknown): CodexModelOption[] {
  const result = asRecord(value);
  const data = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.models)
      ? result.models
      : [];
  return data.flatMap((entry) => {
    const model = asRecord(entry);
    const id = asString(model.model) || asString(model.id);
    if (!id || model.hidden === true) return [];
    const efforts = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
      : [];
    return [
      {
        id,
        name: asString(model.displayName) || asString(model.name) || id,
        description: asString(model.description),
        isDefault: model.isDefault === true,
        defaultReasoningEffort: asString(model.defaultReasoningEffort),
        reasoningEfforts: efforts.flatMap((entry) => {
          const effort = asRecord(entry);
          const value = asString(effort.reasoningEffort);
          return value ? [{ value, label: asString(effort.description) || value }] : [];
        }),
      },
    ];
  });
}

/**
 * Warm cache read. Lets a component that mounts and unmounts with a menu paint
 * the models it already has instead of flashing a loading row on every open.
 */
export function getCachedCodexModels(cwd: string): CodexModelOption[] | null {
  const state = queryClient.getQueryState<CodexModelOption[]>(codexCatalogKeys.models(cwd));
  if (!state?.data || Date.now() - state.dataUpdatedAt >= CATALOG_STALE_MS) return null;
  return state.data;
}

export function listCodexComposerModels(cwd: string, force = false) {
  return loadCatalogEntry(
    codexCatalogKeys.models(cwd),
    async () => {
      await startCodexComposer(cwd);
      return normalizeCodexModels(await withCatalogTimeout(commands.listCodexModels()));
    },
    { staleTime: CATALOG_STALE_MS, force },
  );
}

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
  await loadCatalogEntry(
    codexCatalogKeys.startup(cwd),
    async () => {
      await withCatalogTimeout(commands.startCodexIntegration({ cwd }));
      return true;
    },
    { staleTime: STARTUP_STALE_MS },
  );
}

export async function listCodexComposerThreads(
  cwd: string,
  cursor: string | null = null,
  force = false,
): Promise<CodexThreadPage> {
  return loadCatalogEntry(
    codexCatalogKeys.threads(cwd, cursor),
    async () => {
      await startCodexComposer(cwd);
      const result = await withCatalogTimeout(
        commands.listCodexThreads(cwd, cursor, CODEX_COMPOSER_THREAD_PAGE_SIZE),
      );

      return normalizeCodexThreadPage(result);
    },
    { staleTime: CATALOG_STALE_MS, force },
  );
}

export async function listCodexComposerSkills(cwd: string, force = false) {
  return loadCatalogEntry(
    codexCatalogKeys.skills(cwd),
    async () => {
      await startCodexComposer(cwd);
      return normalizeCodexSkills(await withCatalogTimeout(commands.listCodexSkills(cwd)));
    },
    { staleTime: CATALOG_STALE_MS, force },
  );
}
