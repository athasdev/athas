// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ExternalEditorBufferView } from "../components/external-editor-terminal";
import {
  createTerminalEventChannel,
  releaseTerminalEventChannel,
} from "../services/terminal-protocol";

const mocks = vi.hoisted(() => ({
  terminalInput: vi.fn(async (_connectionId: string, _input: unknown) => {}),
  closeBufferForce: vi.fn(),
  tooltips: [] as Array<{ show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn> }>,
  webLinkOptions: [] as Array<{ hover: (event: MouseEvent, text: string) => void }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class<T> {
    constructor(public onmessage: (message: T) => void) {}
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordFrictionSignal: vi.fn(async () => {}),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    element: HTMLElement | undefined;
    rows = 24;
    cols = 80;
    options: Record<string, unknown>;
    unicode = { activeVersion: "" };
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    loadAddon(addon: { activate?: (terminal: unknown) => void }) {
      addon.activate?.(this);
    }
    open(parent: HTMLElement) {
      this.element = document.createElement("div");
      this.element.className = "xterm";
      parent.append(this.element);
    }
    onData() {
      return { dispose() {} };
    }
    onBinary() {
      return { dispose() {} };
    }
    onTitleChange() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    focus() {}
    write() {}
    refresh() {}
    dispose() {
      this.element?.remove();
    }
  },
}));

const { FakeAddon } = vi.hoisted(() => ({
  FakeAddon: class {
    activate() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class extends FakeAddon {} }));
vi.mock("@xterm/addon-clipboard", () => ({ ClipboardAddon: class extends FakeAddon {} }));
vi.mock("@xterm/addon-unicode-graphemes", () => ({
  UnicodeGraphemesAddon: class extends FakeAddon {},
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      throw new Error("WebGL2 not supported");
    }
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class extends FakeAddon {
    constructor(_handler: unknown, options: { hover: (event: MouseEvent, text: string) => void }) {
      super();
      mocks.webLinkOptions.push(options);
    }
  },
}));
vi.mock("@/features/terminal/lib/terminal-link-tooltip", () => ({
  TerminalLinkTooltip: class {
    show = vi.fn();
    hide = vi.fn();
    dispose = vi.fn();
    constructor() {
      mocks.tooltips.push(this);
    }
  },
}));

vi.mock("@/features/terminal/services/terminal-pty-api", () => ({
  writeLocalTerminalInput: mocks.terminalInput,
  resizeLocalTerminal: vi.fn(async () => {}),
  setLocalTerminalOutputPaused: vi.fn(async () => {}),
}));
vi.mock("@/features/terminal/hooks/use-terminal-theme", () => ({
  useTerminalTheme: () => ({ getTerminalTheme: () => ({}) }),
}));

const settings = {
  fontSize: 14,
  fontFamily: "Mono",
  externalEditor: "custom",
  customEditorCommand: "vim $FILE",
  theme: "dark",
};
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: (selector: (state: { settings: typeof settings }) => unknown) =>
    selector({ settings }),
}));
vi.mock("@/features/workspace/stores/project.store", () => ({
  useProjectStore: (selector: (state: { rootFolderPath: string }) => unknown) =>
    selector({ rootFolderPath: "/workspace" }),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: Object.assign(() => undefined, {
    getState: () => ({ buffers: [], actions: { updateBuffer: vi.fn() } }),
    use: { actions: () => ({ closeBufferForce: mocks.closeBufferForce }) },
  }),
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: { getState: () => ({ handleFileSelect: vi.fn() }) },
}));

const CONNECTION_ID = "external-editor-pty";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() },
  });
  mocks.terminalInput.mockClear();
  mocks.closeBufferForce.mockClear();
  mocks.tooltips.length = 0;
  mocks.webLinkOptions.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  releaseTerminalEventChannel(CONNECTION_ID);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderExternalEditor() {
  const events = createTerminalEventChannel();
  events.bind(CONNECTION_ID);
  await act(async () =>
    root.render(
      <ExternalEditorBufferView
        bufferId="buffer-1"
        filePath="/workspace/notes.txt"
        fileName="notes.txt"
        terminalConnectionId={CONNECTION_ID}
      />,
    ),
  );
  return events;
}

describe("external editor terminal", () => {
  it("mounts its terminal and runs the configured editor on the file", async () => {
    await renderExternalEditor();

    expect(container.querySelector(".xterm")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(250));
    expect(mocks.terminalInput).toHaveBeenCalledWith(CONNECTION_ID, {
      kind: "text",
      data: 'vim "./notes.txt"\r',
    });
  });

  it("still runs the editor when a setting changes before the command is sent", async () => {
    await renderExternalEditor();

    settings.fontSize = 15;
    try {
      await act(async () =>
        root.render(
          <ExternalEditorBufferView
            bufferId="buffer-1"
            filePath="/workspace/notes.txt"
            fileName="notes.txt"
            terminalConnectionId={CONNECTION_ID}
          />,
        ),
      );
      await act(async () => vi.advanceTimersByTime(250));
    } finally {
      settings.fontSize = 14;
    }

    expect(mocks.terminalInput).toHaveBeenCalledTimes(1);
    expect(mocks.terminalInput).toHaveBeenCalledWith(CONNECTION_ID, {
      kind: "text",
      data: 'vim "./notes.txt"\r',
    });
  });

  it("shows the link tooltip of the terminal it mounted when a URL is hovered", async () => {
    await renderExternalEditor();

    expect(mocks.tooltips).toHaveLength(1);
    expect(mocks.webLinkOptions).toHaveLength(1);
    const event = new MouseEvent("mousemove");
    mocks.webLinkOptions[0].hover(event, "https://athas.dev");
    expect(mocks.tooltips[0].show).toHaveBeenCalledWith(
      event,
      "https://athas.dev",
      expect.any(String),
    );
  });

  it("closes its buffer once the editor's shell exits", async () => {
    const events = await renderExternalEditor();

    await act(async () => events.channel.onmessage({ event: "closed" }));
    expect(mocks.closeBufferForce).toHaveBeenCalledWith("buffer-1");
  });
});
