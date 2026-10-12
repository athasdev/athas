// @vitest-environment jsdom
import { fireEvent } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

vi.mock("../hooks/use-voice-input", () => ({
  useVoiceInput: () => ({
    isListening: false,
    interimTranscript: "",
    isSupported: false,
    isMacDevBlocked: false,
    toggle: vi.fn(),
  }),
}));

import type { PaneContent } from "@/features/panes/types/pane-content.types";
import {
  dispatchSidebarResourceDropOnAI,
  type SidebarDragResource,
} from "@/features/sidebar/services/sidebar-resource-drag";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import AIChatInputBar from "../components/input/chat-input-bar";

enableMapSet();

const openBuffer = {
  id: "buffer-app",
  type: "editor",
  path: "/repo/src/app.ts",
  name: "app.ts",
} as PaneContent;

let root: Root;
let container: HTMLDivElement;
let context: { files: Set<string>; buffers: Set<string> };

function Harness({ surfaceId }: { surfaceId: string }) {
  const [files, setFiles] = useState(new Set<string>());
  const [buffers, setBuffers] = useState(new Set<string>());
  context = { files, buffers };
  return (
    <AIChatInputBar
      surfaceId={surfaceId}
      buffers={[openBuffer]}
      allProjectFiles={[]}
      currentAgentId="custom"
      isTyping={false}
      streamingMessageId={null}
      queuedMessages={[]}
      selectedBufferIds={buffers}
      selectedFilesPaths={files}
      selectedEditorContexts={[]}
      onToggleBufferSelection={vi.fn()}
      onToggleFileSelection={vi.fn()}
      onSetSelectedBufferIds={setBuffers}
      onSetSelectedFilesPaths={setFiles}
      onRemoveEditorContext={vi.fn()}
      onSendMessage={() => ({ accepted: true })}
      onInterruptAndSend={() => ({ accepted: true })}
      onMoveQueuedMessage={vi.fn()}
      onUpdateQueuedMessage={vi.fn()}
      onRemoveQueuedMessage={vi.fn()}
      onSendQueuedMessageNow={vi.fn()}
      onStopStreaming={vi.fn()}
    />
  );
}

function sidebarTransfer(resource: SidebarDragResource) {
  const data: Record<string, string> = {
    "application/x-athas-sidebar-resource": JSON.stringify(resource),
    "text/plain": resource.name,
  };
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? "",
    dropEffect: "none",
    files: [],
    items: [],
  };
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(surfaceId = "composer-test") {
  await act(async () => root.render(<Harness surfaceId={surfaceId} />));
  await flush();
}

const dropTarget = () => container.querySelector("[data-ai-context-drop-target]") as HTMLElement;

async function drop(resource: SidebarDragResource) {
  const dataTransfer = sidebarTransfer(resource);
  let over!: boolean;
  await act(async () => {
    over = fireEvent.dragOver(dropTarget(), { dataTransfer });
  });
  await act(async () => {
    fireEvent.drop(dropTarget(), { dataTransfer });
  });
  await flush();
  return { acceptedDrag: !over, dataTransfer };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dropping sidebar items on the composer", () => {
  it("adds a dropped folder to the chat context", async () => {
    await render();

    const { acceptedDrag, dataTransfer } = await drop({
      type: "file",
      path: "/repo/docs",
      name: "docs",
      isDir: true,
    });

    expect(acceptedDrag).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect([...context.files]).toEqual(["/repo/docs"]);
  });

  it("reuses the open buffer for a file that is already open", async () => {
    await render();

    await drop({ type: "file", path: "/repo/src/app.ts", name: "app.ts", isDir: false });
    await drop({ type: "file", path: "/repo/src/app.ts", name: "app.ts", isDir: false });

    expect([...context.buffers]).toEqual(["buffer-app"]);
    expect(context.files.size).toBe(0);
  });

  it("adds a dropped worktree as a path", async () => {
    await render();

    await drop({ type: "git-worktree", path: "/repo-feature", branch: "feature", name: "feature" });

    expect([...context.files]).toEqual(["/repo-feature"]);
  });

  it("ignores drags that carry neither sidebar items nor files", async () => {
    await render();
    const dataTransfer = { types: ["text/plain"], getData: () => "hello", dropEffect: "none" };

    let notCancelled!: boolean;
    await act(async () => {
      notCancelled = fireEvent.dragOver(dropTarget(), { dataTransfer });
      fireEvent.drop(dropTarget(), { dataTransfer });
    });
    await flush();

    expect(notCancelled).toBe(true);
    expect(context.files.size).toBe(0);
    expect(context.buffers.size).toBe(0);
  });

  it("accepts sidebar drops routed to the activity sidebar chat", async () => {
    await render("activity-sidebar");

    await act(async () => {
      dispatchSidebarResourceDropOnAI({
        type: "file",
        path: "/repo/README.md",
        name: "README.md",
        isDir: false,
      });
    });
    await flush();

    expect([...context.files]).toEqual(["/repo/README.md"]);
  });

  it("leaves other chats alone when a drop is routed to the activity sidebar", async () => {
    await render("composer-test");

    await act(async () => {
      dispatchSidebarResourceDropOnAI({ type: "file", path: "/repo/x", name: "x", isDir: true });
    });
    await flush();

    expect(context.files.size).toBe(0);
  });
});
