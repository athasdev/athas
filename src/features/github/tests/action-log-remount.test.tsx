// @vitest-environment jsdom
import { act, useLayoutEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GitHubActionLogPanel } from "../components/github-action-log-panel";
import { parseWorkflowLog } from "../utils/github-workflow-logs";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
  reveal: vi.fn(),
  revealCenter: vi.fn(),
  layoutDispose: vi.fn(),
  scrollDispose: vi.fn(),
}));
const editor = {
  getModel: () => ({ isDisposed: () => false, getLineCount: () => 2 }),
  onDidLayoutChange: () => ({ dispose: mocks.layoutDispose }),
  onDidScrollChange: () => ({ dispose: mocks.scrollDispose }),
  revealLine: mocks.reveal,
  revealLineInCenter: mocks.revealCenter,
};
vi.mock("@/features/editor/components/monaco-readonly-view", () => ({
  MonacoReadonlyView: function ReadonlyView({
    onReady,
  }: {
    onReady: (value: typeof editor) => () => void;
  }) {
    useLayoutEffect(() => onReady(editor), []);
    return <div>Log editor</div>;
  },
}));
vi.mock("../lib/github-workflow-log-monaco", () => ({
  ensureWorkflowLogLanguage: vi.fn(),
  WORKFLOW_LOG_LANGUAGE_ID: "workflow",
  createViewportDecorator: () => ({ update: mocks.update, dispose: mocks.dispose }),
  registerWorkflowLogModel: mocks.register,
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
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
  mocks.register.mockReturnValue(vi.fn());
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
    expect(mocks.register.mock.calls[0][1]).toMatchObject({
      repoPath: "/new",
      showTimestamps: true,
    });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ showTimestamps: true, highlightLine: 2 });
    expect(mocks.revealCenter).toHaveBeenCalledWith(2);
  });

  it("follows live output when an initially empty viewer mounts its editor", async () => {
    await act(async () => root.render(<GitHubActionLogPanel {...props} />));
    await act(async () =>
      root.render(
        <GitHubActionLogPanel {...props} lines={parseWorkflowLog("first\nsecond")} isLive />,
      ),
    );
    expect(mocks.reveal).toHaveBeenCalledWith(2);
    await act(async () => root.render(<GitHubActionLogPanel {...props} />));
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.scrollDispose).toHaveBeenCalledTimes(1);
    expect(mocks.layoutDispose).toHaveBeenCalledTimes(1);
  });
});
