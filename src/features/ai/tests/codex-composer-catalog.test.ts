import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { getCodexModelPatch } from "../integrations/codex/codex-model-settings";
import {
  CODEX_COMPOSER_THREAD_PAGE_SIZE,
  listCodexComposerSkills,
  listCodexComposerThreads,
  normalizeCodexSkills,
  normalizeCodexThreadPage,
  normalizeCodexThreads,
  startCodexComposer,
  listCodexComposerModels,
  normalizeCodexModels,
} from "@/features/ai/integrations/codex/codex-composer-catalog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => vi.useRealTimers());
beforeEach(() => vi.clearAllMocks());

describe("Codex composer catalog", () => {
  it("keeps supported effort and replaces an incompatible effort when changing models", () => {
    const models = normalizeCodexModels({
      data: [
        {
          model: "new-model",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
        },
      ],
    });
    expect(getCodexModelPatch("new-model", models, { effort: "high" })).toEqual({
      model: "new-model",
      effort: "high",
    });
    expect(getCodexModelPatch("new-model", models, { effort: "xhigh" })).toEqual({
      model: "new-model",
      effort: "medium",
    });
    expect(getCodexModelPatch(undefined, models, { effort: "high" })).toEqual({
      model: undefined,
      effort: "high",
    });
  });
  it("normalizes actual model IDs and supported reasoning choices", () => {
    expect(
      normalizeCodexModels({
        data: [
          {
            id: "display-id",
            model: "actual-model",
            displayName: "My model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "high", description: "Thorough" },
            ],
          },
          { id: "hidden", hidden: true },
          {},
        ],
      }),
    ).toEqual([
      {
        id: "actual-model",
        name: "My model",
        description: "",
        isDefault: true,
        defaultReasoningEffort: "medium",
        reasoningEfforts: [
          { value: "medium", label: "Balanced" },
          { value: "high", label: "Thorough" },
        ],
      },
    ]);
  });

  it("coalesces repeated model requests and reuses the catalog across menu mounts", async () => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue({ data: [{ model: "cached-model" }] });
    const [first, second] = await Promise.all([
      listCodexComposerModels("/cache-test"),
      listCodexComposerModels("/cache-test"),
    ]);
    expect(second).toEqual(first);
    await listCodexComposerModels("/cache-test");
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "list_codex_models"),
    ).toHaveLength(1);
    await listCodexComposerModels("/cache-test", true);
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === "list_codex_models"),
    ).toHaveLength(2);
  });

  it("allows retry after a failed model load", async () => {
    vi.mocked(invoke).mockImplementation((command) =>
      command === "list_codex_models" ? Promise.reject(new Error("offline")) : Promise.resolve({}),
    );
    await expect(listCodexComposerModels("/retry-test")).rejects.toThrow("offline");
    vi.mocked(invoke).mockResolvedValue({ data: [{ model: "recovered" }] });
    expect((await listCodexComposerModels("/retry-test", true))[0].id).toBe("recovered");
  });

  it("times out an unresponsive catalog instead of leaving a permanent spinner", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementation((command) =>
      command === "list_codex_models" ? new Promise(() => {}) : Promise.resolve({}),
    );
    const pending = expect(listCodexComposerModels("/timeout-test")).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
  });

  it("normalizes thread summaries and nested skill entries", () => {
    expect(
      normalizeCodexThreads({
        data: [
          {
            id: "thread-1",
            name: "Fix session menu",
            preview: "Show Codex sessions",
            cwd: "/workspace",
            updatedAt: 42,
          },
        ],
      }),
    ).toEqual([
      {
        id: "thread-1",
        name: "Fix session menu",
        preview: "Show Codex sessions",
        cwd: "/workspace",
        updatedAt: 42,
      },
    ]);
    expect(
      normalizeCodexThreadPage({
        data: [{ id: "thread-1", preview: "Show Codex sessions" }],
        nextCursor: "next-page",
      }),
    ).toEqual({
      threads: [
        {
          id: "thread-1",
          name: null,
          preview: "Show Codex sessions",
          cwd: "",
          updatedAt: 0,
        },
      ],
      nextCursor: "next-page",
    });

    expect(
      normalizeCodexSkills({
        data: [
          {
            cwd: "/workspace",
            skills: [
              {
                name: "commit",
                description: "Create focused commits",
                path: "/skills/commit/SKILL.md",
                scope: "user",
                enabled: true,
              },
            ],
            errors: [{ path: "/skills/broken", message: "Invalid skill manifest" }],
          },
        ],
      }),
    ).toEqual({
      skills: [
        {
          name: "commit",
          description: "Create focused commits",
          path: "/skills/commit/SKILL.md",
          scope: "user",
          enabled: true,
        },
      ],
      skillErrors: ["Invalid skill manifest"],
    });
  });

  it("loads bounded session pages and skills independently", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_codex_threads") {
        return Promise.resolve({ data: [], nextCursor: "next-page" });
      }
      if (command === "list_codex_skills") return Promise.resolve({ data: [] });
      return Promise.resolve({ initialized: true });
    });

    await expect(startCodexComposer("/workspace")).resolves.toBeUndefined();
    await expect(listCodexComposerThreads("/workspace")).resolves.toEqual({
      threads: [],
      nextCursor: "next-page",
    });
    await expect(listCodexComposerSkills("/workspace")).resolves.toEqual({
      skills: [],
      skillErrors: [],
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "start_codex_integration", {
      args: { cwd: "/workspace" },
    });
    expect(invoke).toHaveBeenCalledWith("list_codex_threads", {
      cwd: "/workspace",
      cursor: null,
      limit: CODEX_COMPOSER_THREAD_PAGE_SIZE,
    });
    expect(invoke).toHaveBeenCalledWith("list_codex_skills", { cwd: "/workspace" });
  });
});
