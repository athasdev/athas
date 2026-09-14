import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ComposerAgentSelector } from "../components/input/composer-agent-selector";

vi.mock("@/features/ai/hooks/use-agent-options", () => ({
  useAgentOptions: () => ({
    options: [
      { id: "claude-acp", name: "Claude Agent", isInstalled: false, action: "install" },
      { id: "codex", name: "Codex", isInstalled: true },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/ai/hooks/use-available-providers", () => ({
  useAvailableProviders: () => [{ id: "openai", name: "OpenAI" }],
}));
vi.mock("@/features/ai/integrations/codex/use-codex-settings", () => ({
  useCodexSettings: () => ({ settings: { model: "gpt-test" } }),
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
    DropdownMenuRadioGroup: group,
    DropdownMenuRadioItem: group,
    DropdownMenuViewport: group,
    DropdownMenuSub: group,
    DropdownMenuSubTrigger: group,
    DropdownMenuSubContent: group,
  };
});

describe("Composer agent sources", () => {
  it.each([
    { agentId: "claude-acp", visible: "Claude Agent", hidden: "OpenAI", search: "agents" },
    { agentId: "custom", visible: "OpenAI", hidden: "Claude Agent", search: "providers" },
  ])("opens the matching source for $agentId", ({ agentId, visible, hidden, search }) => {
    const markup = renderToStaticMarkup(
      <ComposerAgentSelector
        cwd="/project"
        currentAgentId={agentId}
        providerId="openai"
        modelId="gpt-test"
        sessionConfigOptions={[]}
        onModelChange={vi.fn()}
        onSessionConfigChange={vi.fn()}
      />,
    );
    expect(markup).toContain(visible);
    expect(markup).not.toContain(hidden);
    expect(markup).toContain(`Search ${search}...`);
    expect(markup).not.toContain("No models available");
  });
});
