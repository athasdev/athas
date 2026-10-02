import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ComposerAgentSelector } from "../components/input/composer-agent-selector";

vi.mock("@/features/ai/hooks/use-agent-options", () => ({
  useAgentOptions: () => ({
    options: [
      { id: "claude-acp", name: "Claude Agent", isInstalled: false, action: "install" },
      { id: "codex", name: "Codex", isInstalled: true },
      { id: "gemini", name: "Gemini CLI", isInstalled: true },
    ],
    isLoading: false,
    loadError: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/features/ai/hooks/use-available-providers", () => ({
  useAvailableProviders: () => [
    { id: "openai", name: "OpenAI", models: [{ id: "gpt-test", name: "GPT Test" }] },
  ],
}));
vi.mock("@/features/ai/integrations/codex/use-codex-settings", () => ({
  useCodexSettings: () => ({ settings: { model: "codex-mini" } }),
}));
vi.mock("@/ui/dropdown", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const group = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ...original,
    DropdownMenu: group,
    DropdownMenuTrigger: group,
    DropdownMenuContent: group,
    DropdownMenuItem: group,
    DropdownMenuCheckboxItem: group,
    DropdownMenuRadioGroup: group,
    DropdownMenuRadioItem: group,
    DropdownMenuViewport: group,
    DropdownMenuEmpty: group,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSearch: ({ placeholder }: { placeholder?: string }) => (
      <input placeholder={placeholder} />
    ),
  };
});

const effortOption = {
  id: "effort",
  name: "Effort",
  category: "thought_level",
  kind: {
    type: "select" as const,
    currentValue: "high",
    options: [
      { id: "low", name: "Low" },
      { id: "high", name: "High" },
    ],
  },
};

const render = (
  agentId: string,
  followChatId?: string,
  sessionConfigOptions: (typeof effortOption)[] = [],
) =>
  renderToStaticMarkup(
    <ComposerAgentSelector
      cwd="/project"
      followChatId={followChatId}
      currentAgentId={agentId}
      providerId="openai"
      modelId="gpt-test"
      sessionConfigOptions={sessionConfigOptions}
      onModelChange={vi.fn()}
      onSessionConfigChange={vi.fn()}
    />,
  );

describe("Composer agent selector", () => {
  it("labels the trigger with the chosen API model", () => {
    const markup = render("custom");

    expect(markup).toContain("GPT Test");
    expect(markup).toContain("Select a model…");
  });

  it("labels a CLI agent session with its own model", () => {
    expect(render("codex")).toContain("codex-mini");
  });

  it("offers following the agent from the model menu when the chat supports it", () => {
    expect(render("gemini", "chat-1")).toContain("Follow agent in editor");
    expect(render("gemini")).not.toContain("Follow agent in editor");
  });

  it("shows a reasoning effort chip beside the model only when the agent has a scale", () => {
    expect(render("gemini", undefined, [effortOption])).toContain(">Low<");
    expect(render("gemini")).not.toContain(">Low<");
    expect(render("custom", undefined, [effortOption])).not.toContain(">Low<");
  });
});
