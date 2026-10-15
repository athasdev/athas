// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { commands } from "@/bindings/commands";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { isBufferPinned } from "@/features/panes/stores/pane-selectors";
import { selectActivePane } from "@/features/panes/stores/pane-selectors";
import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { subscribeToEditorDocumentChanges } from "../services/editor-document-events";
import { useBufferStore } from "../stores/buffer.store";
import { detectLanguageFromFileName } from "../services/language-detection";

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  stopForFile: vi.fn().mockResolvedValue(undefined),
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/features/file-system/api/file-operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/file-system/api/file-operations")>()),
  readFileContent: mocks.readFileContent,
}));
vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: { getInstance: () => ({ stopForFile: mocks.stopForFile }) },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const actions = () => useBufferStore.getState().actions;
const buffers = () => useBufferStore.getState().buffers;
const byId = (id: string) => buffers().find((buffer) => buffer.id === id) as PaneContent;
const active = () => actions().getActiveBuffer();

function editor(id: string, path: string, content: string, extra: Partial<EditorContent> = {}) {
  return {
    id,
    type: "editor",
    path,
    name: path.split("/").pop()!,
    content,
    savedContent: content,
    contentRevision: 0,
    isDirty: false,
    isVirtual: false,
    language: "typescript",
    ...extra,
  } satisfies EditorContent;
}

function show(list: PaneContent[], activeId: string | null) {
  useBufferStore.setState({ buffers: list });
  seedActiveBuffer(activeId);
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  mocks.readFileContent.mockReset();
  vi.spyOn(commands, "closeTerminal").mockResolvedValue(null as never);
  vi.spyOn(commands, "closeRemoteTerminal").mockResolvedValue(null as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("opening tool and GitHub tabs", () => {
  it("reuses a pull request tab and refreshes its details", () => {
    const first = actions().openPRBuffer(12, { title: "Old title", repoPath: "/repo" });
    actions().openBrowserBuffer();

    const second = actions().openPRBuffer(12, {
      title: "Fix login",
      repoPath: "/repo",
      authorAvatarUrl: "https://avatars/u.png",
      selectedFilePath: "src/a b.ts",
    });

    expect(second).toBe(first);
    expect(active()?.id).toBe(first);
    expect(byId(first)).toMatchObject({
      name: "Fix login",
      authorAvatarUrl: "https://avatars/u.png",
      path: "pr://12?file=src%2Fa%20b.ts",
    });

    actions().openPRBuffer(12, { initialView: "files" });
    expect(byId(first).path).toBe("pr://12?view=files");
    expect(byId(first).name).toBe("Fix login");

    expect(actions().openPRBuffer(12, { repoPath: "/other-repo" })).not.toBe(first);
  });

  it("reuses an issue tab and updates its link", () => {
    const first = actions().openGitHubIssueBuffer({ issueNumber: 7, repoPath: "/repo" });
    const again = actions().openGitHubIssueBuffer({
      issueNumber: 7,
      repoPath: "/repo",
      title: "Crash on start",
      url: "https://github.com/o/r/issues/7",
    });

    expect(again).toBe(first);
    expect(byId(first)).toMatchObject({
      name: "Crash on start",
      path: "https://github.com/o/r/issues/7",
      url: "https://github.com/o/r/issues/7",
    });
  });

  it("matches workflow run tabs by run id or by notification", () => {
    const run = actions().openGitHubActionBuffer({ repoPath: "/repo", runId: 99, title: "CI" });
    expect(actions().openGitHubActionBuffer({ repoPath: "/repo", runId: 99, title: "CI #2" })).toBe(
      run,
    );
    expect(byId(run)).toMatchObject({ name: "CI #2", path: "github-action://99" });

    const notification = { id: "n-1", title: "Run failed" } as never;
    const fromNotification = actions().openGitHubActionBuffer({
      repoPath: "/repo",
      notification,
    });
    expect(fromNotification).not.toBe(run);
    expect(byId(fromNotification).path).toBe("github-action-notification://n-1");
    expect(actions().openGitHubActionBuffer({ repoPath: "/repo", notification })).toBe(
      fromNotification,
    );
  });

  it("reuses creation forms, delivery views and extension pages", () => {
    const form = actions().openGitHubFormBuffer({ repoPath: "/repo", formKind: "issue" });
    expect(actions().openGitHubFormBuffer({ repoPath: "/repo", formKind: "issue" })).toBe(form);
    expect(byId(form).path).toBe("github-form://create/issue/%2Frepo");

    const releases = actions().openContent({
      type: "githubDelivery",
      kind: "releases",
      repoPath: "/repo",
    });
    expect(
      actions().openContent({ type: "githubDelivery", kind: "releases", repoPath: "/repo" }),
    ).toBe(releases);

    const extension = actions().openExtensionBuffer("acme.tools", "Tools");
    expect(actions().openExtensionBuffer("acme.tools", "Acme Tools")).toBe(extension);
    expect(byId(extension).name).toBe("Acme Tools");

    const view = actions().openContent({ type: "customView", projectPath: "/ws", viewId: "todo" });
    expect(actions().openContent({ type: "customView", projectPath: "/ws", viewId: "todo" })).toBe(
      view,
    );
  });

  it("keeps one onboarding tab per mode and version", () => {
    const context = { mode: "release-notes" as const, currentVersion: "1.2.0" };
    const first = actions().openOnboardingBuffer(context);
    expect(actions().openOnboardingBuffer(context)).toBe(first);
    expect(actions().openOnboardingBuffer({ ...context, currentVersion: "1.3.0" })).not.toBe(first);
  });

  it("keeps one tab for each singleton tool view", () => {
    const opened = [
      actions().openReferencesBuffer(),
      actions().openContinuousAgentsBuffer(),
      actions().openAcpInspectorBuffer(),
      actions().openExtensionsBuffer(),
    ];

    expect([
      actions().openReferencesBuffer(),
      actions().openContinuousAgentsBuffer(),
      actions().openAcpInspectorBuffer(),
      actions().openExtensionsBuffer(),
    ]).toEqual(opened);
    expect(new Set(opened).size).toBe(4);
  });

  it("numbers terminal and agent tabs and reuses them by session", () => {
    const one = actions().openTerminalBuffer();
    const two = actions().openTerminalBuffer({ sessionId: "s-2", workingDirectory: "/ws" });
    expect(byId(one).name).toBe("Terminal 1");
    expect(byId(two)).toMatchObject({ name: "Terminal 2", path: "terminal://s-2" });
    expect(actions().openTerminalBuffer({ sessionId: "s-2" })).toBe(two);

    const agent = actions().openAgentBuffer("chat-1");
    expect(byId(agent)).toMatchObject({ name: "Agent 1", path: "agent://chat-1" });
    expect(actions().openAgentBuffer("chat-1")).toBe(agent);
    expect(byId(actions().openAgentBuffer()).name).toBe("Agent 2");
  });

  it("reuses a restored browser tab by its saved path", () => {
    const first = actions().openContent({
      type: "browser",
      url: "https://a.dev",
      path: "browser://saved",
    });
    expect(actions().openContent({ type: "browser", path: "browser://saved" })).toBe(first);
    expect(actions().openBrowserBuffer("https://a.dev")).not.toBe(first);
  });
});

describe("external editor tabs", () => {
  it("replaces the previous external editor and closes its terminal", async () => {
    const first = actions().openExternalEditorBuffer("/ws/a.txt", "a.txt", "conn-1");
    expect(actions().openExternalEditorBuffer("/ws/a.txt", "a.txt", "conn-1")).toBe(first);

    const second = actions().openExternalEditorBuffer("/ws/b.txt", "b.txt", "conn-2");

    expect(buffers().map((buffer) => buffer.id)).toEqual([second]);
    await vi.waitFor(() => expect(commands.closeTerminal).toHaveBeenCalledWith("conn-1"));
  });

  it("closes the terminal of a closed external editor tab", async () => {
    const id = actions().openExternalEditorBuffer("/ws/a.txt", "a.txt", "conn-9");
    actions().closeBufferForce(id);
    await vi.waitFor(() => expect(commands.closeTerminal).toHaveBeenCalledWith("conn-9"));
  });
});

describe("legacy openBuffer flags", () => {
  it("routes each flag to its own content type", () => {
    const open = actions().openBuffer;
    expect(byId(open("/ws/a.png", "a.png", "", true)).type).toBe("image");
    expect(byId(open("/ws/db.sqlite", "db.sqlite", "", false, "sqlite")).type).toBe("database");
    expect(byId(open("diff://a", "a.diff", "+x", false, undefined, true)).type).toBe("diff");
    expect(
      byId(open("md://a", "a.md", "# a", false, undefined, false, true, undefined, true)),
    ).toMatchObject({ type: "markdownPreview", sourceFilePath: "md://a" });
    expect(
      byId(
        open("html://a", "a.html", "<p>", false, undefined, false, true, undefined, false, true),
      ),
    ).toMatchObject({ type: "htmlPreview" });
    expect(
      byId(
        open(
          "csv://a",
          "a.csv",
          "a,b",
          false,
          undefined,
          false,
          true,
          undefined,
          false,
          false,
          true,
          "/ws/a.csv",
        ),
      ),
    ).toMatchObject({ type: "csvPreview", sourceFilePath: "/ws/a.csv" });
    expect(
      byId(
        open(
          "/ws/a.pdf",
          "a.pdf",
          "",
          false,
          undefined,
          false,
          false,
          undefined,
          false,
          false,
          false,
          undefined,
          false,
          true,
        ),
      ).type,
    ).toBe("pdf");
    expect(
      byId(
        open(
          "/ws/a.bin",
          "a.bin",
          "",
          false,
          undefined,
          false,
          false,
          undefined,
          false,
          false,
          false,
          undefined,
          false,
          false,
          true,
        ),
      ).type,
    ).toBe("binary");
  });
});

describe("closing", () => {
  it("asks before closing a dirty buffer and can cancel", () => {
    show([editor("a", "/ws/a.ts", "edited", { savedContent: "orig", isDirty: true })], "a");

    actions().handleTabClose("a");

    expect(useBufferStore.getState().pendingClose).toEqual({ bufferId: "a", type: "single" });
    expect(byId("a")).toBeDefined();
    actions().cancelPendingClose();
    expect(useBufferStore.getState().pendingClose).toBeNull();
  });

  it("closes a clean buffer and stops its language server", async () => {
    show([editor("a", "/ws/a.ts", "x"), editor("b", "/ws/b.ts", "y")], "a");

    actions().closeBuffer("a");

    expect(buffers().map((buffer) => buffer.id)).toEqual(["b"]);
    expect(active()?.id).toBe("b");
    await vi.waitFor(() => expect(mocks.stopForFile).toHaveBeenCalledWith("/ws/a.ts"));
  });

  it("closes a batch and moves focus to a remaining tab", () => {
    show(
      [editor("a", "/ws/a.ts", "a"), editor("b", "/ws/b.ts", "b"), editor("c", "/ws/c.ts", "c")],
      "b",
    );

    actions().closeBuffersBatch(["a", "b"]);
    actions().closeBuffersBatch([]);

    expect(buffers().map((buffer) => buffer.id)).toEqual(["c"]);
    expect(active()?.id).toBe("c");
  });

  it("ends the terminal session of a closed terminal tab", async () => {
    const id = actions().openTerminalBuffer({ sessionId: "term-1" });
    const terminals = useTerminalStore.getState().actions;
    terminals.registerSession("term-1", { connectionId: "pty-1" });

    actions().closeBufferForce(id);

    await vi.waitFor(() => expect(commands.closeTerminal).toHaveBeenCalledWith("pty-1"));
    await vi.waitFor(() => expect(terminals.getSession("term-1")).toBeUndefined());
  });
});

describe("tab navigation", () => {
  it("cycles through the active pane's tabs in both directions", () => {
    show(
      [editor("a", "/ws/a.ts", "a"), editor("b", "/ws/b.ts", "b"), editor("c", "/ws/c.ts", "c")],
      "a",
    );

    actions().switchToNextBuffer();
    expect(active()?.id).toBe("b");
    actions().switchToNextBuffer();
    actions().switchToNextBuffer();
    expect(active()?.id).toBe("a");
    actions().switchToPreviousBuffer();
    expect(active()?.id).toBe("c");
    actions().handleTabClick("b");
    expect(active()?.id).toBe("b");
  });

  it("does nothing with a single tab", () => {
    show([editor("a", "/ws/a.ts", "a")], "a");
    actions().switchToNextBuffer();
    actions().switchToPreviousBuffer();
    expect(active()?.id).toBe("a");
  });

  it("toggles pinning and ignores unknown buffers", () => {
    show([editor("a", "/ws/a.ts", "a")], "a");
    actions().handleTabPin("a");
    expect(isBufferPinned("a")).toBe(true);
    actions().handleTabPin("a");
    expect(isBufferPinned("a")).toBe(false);
    actions().handleTabPin("missing");
    expect(selectActivePane(usePaneStore.getState())?.bufferIds).toEqual(["a"]);
  });
});

describe("buffer updates", () => {
  it("overrides a buffer's language", () => {
    show([editor("a", "/ws/a.txt", "a")], "a");
    actions().updateBufferLanguage("a", "markdown");
    expect(byId("a")).toMatchObject({ languageOverride: "markdown" });
  });

  it("marks clean adopts the current text as saved", () => {
    show([editor("a", "/ws/a.ts", "edited", { savedContent: "orig", isDirty: true })], "a");

    actions().markBufferDirty("a", false);
    expect(byId("a")).toMatchObject({ isDirty: false, savedContent: "edited" });

    actions().markBufferDirty("a", true);
    expect(byId("a")).toMatchObject({ isDirty: true, savedContent: "edited" });
  });

  it("records a save, including save-as to a new path", () => {
    show([editor("a", "untitled-1", "body", { isVirtual: true, isDirty: true })], "a");

    actions().markBufferSaved("a", "body", "/ws/notes.md");

    expect(byId("a")).toMatchObject({
      path: "/ws/notes.md",
      name: "notes.md",
      isVirtual: false,
      isDirty: false,
      savedContent: "body",
      language: detectLanguageFromFileName("notes.md"),
    });

    actions().markBufferSaved("a", "older body");
    expect(byId("a")).toMatchObject({ isDirty: true, savedContent: "older body" });
  });

  it("moves a buffer to a new path and treats its text as saved", () => {
    show([editor("a", "/ws/old.ts", "text", { savedContent: "", isDirty: true })], "a");

    actions().updateBufferPath("a", "/ws/renamed.py");

    expect(byId("a")).toMatchObject({
      path: "/ws/renamed.py",
      name: "renamed.py",
      savedContent: "text",
      language: detectLanguageFromFileName("renamed.py"),
    });
  });

  it("updates browser tab details only when something changed", () => {
    const id = actions().openBrowserBuffer("https://a.dev");
    const before = byId(id);

    actions().updateBrowserBuffer(id, { url: "https://a.dev" });
    expect(byId(id)).toBe(before);

    actions().updateBrowserBuffer(id, { url: "https://b.dev", favicon: "icon.png" });
    expect(byId(id)).toMatchObject({ url: "https://b.dev", favicon: "icon.png" });

    actions().updateBrowserBuffer("missing", { url: "https://c.dev" });
  });

  it("bumps the revision and publishes the text when a replaced buffer's content changes", () => {
    show([editor("a", "/ws/a.ts", "one")], "a");
    const published: string[] = [];
    const unsubscribe = subscribeToEditorDocumentChanges((event) => {
      published.push(event.fullContent ?? "");
    });

    actions().updateBuffer({ ...(byId("a") as EditorContent), content: "two" });
    actions().updateBuffer({ ...(byId("a") as EditorContent), name: "renamed.ts" });
    unsubscribe();

    expect(byId("a")).toMatchObject({ content: "two", contentRevision: 1, name: "renamed.ts" });
    expect(published).toEqual(["two"]);
  });

  it("keeps an unsaved image edit and asks before closing it", () => {
    useBufferStore.setState({
      buffers: [{ id: "img", type: "image", path: "/ws/a.png", name: "a.png" } as PaneContent],
    });
    seedActiveBuffer("img");
    const draft = {
      initialSrc: "data:a",
      history: ["data:a", "data:b"],
      index: 1,
      savedSrc: "data:a",
      revision: 1,
      processing: 0,
      error: null,
    };

    actions().updateImageDraft("img", draft);
    actions().closeBuffer("img");

    expect(byId("img")).toMatchObject({ imageDraft: draft });
    expect(useBufferStore.getState().pendingClose).toEqual({ bufferId: "img", type: "single" });
  });
});

describe("reloading from disk", () => {
  it("replaces the text with the file on disk and marks it clean", async () => {
    show([editor("a", "/ws/a.ts", "local", { savedContent: "old", isDirty: true })], "a");
    mocks.readFileContent.mockResolvedValueOnce("from disk");

    await actions().reloadBufferFromDisk("a");

    expect(byId("a")).toMatchObject({
      content: "from disk",
      savedContent: "from disk",
      isDirty: false,
    });
  });

  it("keeps the buffer when the read fails and skips virtual buffers", async () => {
    show(
      [editor("a", "/ws/a.ts", "local"), editor("v", "untitled", "draft", { isVirtual: true })],
      "a",
    );
    mocks.readFileContent.mockRejectedValueOnce(new Error("EACCES"));

    await actions().reloadBufferFromDisk("a");
    await actions().reloadBufferFromDisk("v");
    await actions().reloadBufferFromDisk("missing");

    expect(byId("a")).toMatchObject({ content: "local" });
    expect(mocks.readFileContent).toHaveBeenCalledTimes(1);
  });
});

describe("reopening closed tabs", () => {
  it("says so when there is nothing to reopen", async () => {
    show([editor("a", "/ws/a.ts", "a")], "a");
    useBufferStore.setState({
      closedBuffersHistory: [{ type: "editor", path: "/ws/a.ts", name: "a.ts" } as never],
    });

    await actions().reopenClosedTab();
    await actions().reopenClosedTab();

    expect(mocks.toast.info).toHaveBeenCalledTimes(2);
    expect(mocks.toast.info).toHaveBeenCalledWith("No recently closed tabs");
  });

  it("reopens previews and diffs with their content, and restores the pin", async () => {
    useBufferStore.setState({
      closedBuffersHistory: [
        {
          type: "markdownPreview",
          path: "preview://a.md",
          name: "Preview a.md",
          content: "# A",
          sourceFilePath: "/ws/a.md",
          isPinned: true,
        } as never,
        {
          type: "diff",
          path: "diff://a.ts",
          name: "a.ts (diff)",
          content: "+a",
        } as never,
      ],
    });

    await actions().reopenClosedTab();
    const preview = active()!;
    expect(preview).toMatchObject({
      type: "markdownPreview",
      content: "# A",
      sourceFilePath: "/ws/a.md",
    });
    expect(isBufferPinned(preview.id)).toBe(true);

    await actions().reopenClosedTab();
    expect(active()).toMatchObject({ type: "diff", content: "+a" });
    expect(useBufferStore.getState().closedBuffersHistory).toEqual([]);
  });
});
