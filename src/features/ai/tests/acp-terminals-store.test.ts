import { describe, expect, it } from "vite-plus/test";
import { useAcpTerminalsStore } from "@/features/ai/stores/acp-terminals.store";

describe("useAcpTerminalsStore", () => {
  it("collects a terminal's output and keeps its first exit", () => {
    const { actions } = useAcpTerminalsStore.getState();
    actions.start("t1", { sessionId: "s1", cwd: "/work", displayOnly: true });
    actions.append("t1", "s1", "line 1\n");
    actions.append("t1", "s1", "line 2\n");

    const exited = actions.exit("t1", "s1", { exitCode: 0, signal: null });
    const again = actions.exit("t1", "s1", { exitCode: 1, signal: "released" });

    expect(exited).toMatchObject({
      output: "line 1\nline 2\n",
      displayOnly: true,
      exit: { exitCode: 0, signal: null },
    });
    expect(again.exit).toEqual({ exitCode: 0, signal: null });
    expect(useAcpTerminalsStore.getState().terminals.t1.cwd).toBe("/work");
  });

  it("takes output for a terminal it has not seen start", () => {
    const { actions } = useAcpTerminalsStore.getState();
    actions.append("t2", "s1", "early");
    expect(useAcpTerminalsStore.getState().terminals.t2).toMatchObject({
      sessionId: "s1",
      output: "early",
      exit: null,
    });
  });
});
