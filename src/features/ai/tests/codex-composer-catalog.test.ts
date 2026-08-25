import { describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  CODEX_COMPOSER_THREAD_PAGE_SIZE,
  listCodexComposerSkills,
  listCodexComposerThreads,
  normalizeCodexSkills,
  normalizeCodexThreadPage,
  normalizeCodexThreads,
  startCodexComposer,
} from "@/features/ai/integrations/codex/codex-composer-catalog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("Codex composer catalog", () => {
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
