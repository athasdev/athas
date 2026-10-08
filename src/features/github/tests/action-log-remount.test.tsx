// @vitest-environment jsdom
import { act, useLayoutEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GitHubActionLogPanel } from "../components/github-action-log-panel";
import { parseWorkflowLog } from "../utils/github-workflow-logs";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  dispatch: vi.fn(),
  addScroll: vi.fn(),
  removeScroll: vi.fn(),
}));
const editor = {
  state: {
    doc: {
      lines: 2,
      line: (number: number) => ({ number, from: (number - 1) * 10 }),
    },
  },
  scrollDOM: {
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    addEventListener: mocks.addScroll,
    removeEventListener: mocks.removeScroll,
  },
  dispatch: mocks.dispatch,
};
vi.mock("@/features/editor/components/codemirror-readonly-view", () => ({
  CodeMirrorReadonlyView: function ReadonlyView({
    onReady,
  }: {
    onReady: (value: typeof editor) => () => void;
  }) {
    useLayoutEffect(() => onReady(editor), []);
    return <div>Log editor</div>;
  },
}));
vi.mock("../lib/github-workflow-log-codemirror", () => ({
  workflowLogExtension: [],
  updateWorkflowLog: mocks.update,
}));
function revealedTargets() {
  return mocks.dispatch.mock.calls.map(([spec]) => {
    const target = spec.effects.value as { range: { head: number }; y: string };
    return { pos: target.range.head, y: target.y };
  });
}
let root: Root;
let container: HTMLDivElement;
const props: ComponentProps<typeof GitHubActionLogPanel> = {
  job: {
    id: 1,
    name: "Build",
    status: "completed",
    conclusion: "success",
    startedAt: null,
    completedAt: null,
    labels: [],
    steps: [],
  },
  step: null,
  lines: [],
  now: 0,
  repoPath: "/old",
  isLoading: false,
  isLogsAvailable: true,
  error: null,
  query: "",
  onQueryChange: vi.fn(),
  showTimestamps: false,
  onToggleTimestamps: vi.fn(),
  wrap: false,
  onToggleWrap: vi.fn(),
  highlightLineIndex: null,
  isLive: false,
  onRefresh: vi.fn(),
  onCopy: vi.fn(),
  onExport: vi.fn(),
  onOpenOnGitHub: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Workflow log editor remount", () => {
  it("uses the current repository, timestamps and highlighted line when output arrives", async () => {
    await act(async () => root.render(<GitHubActionLogPanel {...props} />));
    const lines = parseWorkflowLog("2026-09-15T00:00:00Z first\n2026-09-15T00:00:01Z second");
    await act(async () =>
      root.render(
        <GitHubActionLogPanel
          {...props}
          lines={lines}
          repoPath="/new"
          showTimestamps
          highlightLineIndex={1}
        />,
      ),
    );
    expect(mocks.update.mock.calls[0][1]).toMatchObject({
      repoPath: "/new",
      showTimestamps: true,
      highlightLine: 2,
    });
    expect(revealedTargets()).toContainEqual({ pos: 10, y: "center" });
  });

  it("follows live output when an initially empty viewer mounts its editor", async () => {
    await act(async () => root.render(<GitHubActionLogPanel {...props} />));
    await act(async () =>
      root.render(
        <GitHubActionLogPanel {...props} lines={parseWorkflowLog("first\nsecond")} isLive />,
      ),
    );
    expect(revealedTargets()).toContainEqual({ pos: 10, y: "end" });
    const handleScroll = mocks.addScroll.mock.calls[0][1];
    await act(async () => root.render(<GitHubActionLogPanel {...props} />));
    expect(mocks.removeScroll).toHaveBeenCalledWith("scroll", handleScroll);
  });
});
