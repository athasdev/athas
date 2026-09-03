import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useProjectStore } from "@/features/window/stores/project.store";
import ContinuousAgentsResource from "../continuous-agents/resource";
import { useContinuousAgentsStore } from "../continuous-agents/continuous-agents.store";

describe("ContinuousAgentsResource", () => {
  beforeEach(() => {
    useContinuousAgentsStore.setState({ tasks: [] });
    useProjectStore.setState({ rootFolderPath: "/workspace/athas", projectName: "Athas" });
  });

  it("renders as an editor resource with its own sidebar instead of a dialog", () => {
    useContinuousAgentsStore.getState().actions.createTask({
      name: "Keep tests green",
      prompt: "Run focused tests and fix regressions.",
      agentId: "codex",
      workspacePath: "/workspace/athas",
      cadence: "hourly",
    });

    const markup = renderToStaticMarkup(<ContinuousAgentsResource />);

    expect(markup).toContain('data-slot="continuous-agents-resource"');
    expect(markup).toContain('data-slot="continuous-agents-sidebar"');
    expect(markup).toContain('aria-label="Continuous Agents navigation"');
    expect(markup).toContain("Keep tests green");
    expect(markup).not.toContain('role="dialog"');
  });
});
