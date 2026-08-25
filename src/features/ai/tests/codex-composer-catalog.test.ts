import { describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  loadCodexComposerCatalog,
  normalizeCodexSkills,
  normalizeCodexThreads,
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

  it("starts Codex before loading workspace sessions and skills", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_codex_threads") return Promise.resolve({ data: [] });
      if (command === "list_codex_skills") return Promise.resolve({ data: [] });
      return Promise.resolve({ initialized: true });
    });

    await expect(loadCodexComposerCatalog("/workspace")).resolves.toEqual({
      threads: [],
      skills: [],
      skillErrors: [],
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "start_codex_integration", {
      args: { cwd: "/workspace" },
    });
    expect(invoke).toHaveBeenCalledWith("list_codex_threads", {
      cwd: "/workspace",
      cursor: null,
    });
    expect(invoke).toHaveBeenCalledWith("list_codex_skills", { cwd: "/workspace" });
  });
});
