// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Terminal, type ILink, type ILinkProvider } from "@xterm/xterm";
import {
  createTerminalAddons,
  createTerminalLinkHandler,
  loadWebLinksAddon,
  registerFileLinksProvider,
  TERMINAL_UNICODE_VERSION,
} from "../hooks/use-terminal-addons";
import { useTerminalTheme } from "../hooks/use-terminal-theme";
import type { TerminalLinkTooltip } from "../lib/terminal-link-tooltip";
import { describeTerminalLinkHint } from "../utils/terminal-link-activation";

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  friction: vi.fn().mockResolvedValue(undefined),
  webgl: { available: false, contextLoss: null as null | (() => void), disposed: 0 },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      if (!mocks.webgl.available) throw new Error("WebGL2 not supported");
    }
    onContextLoss(listener: () => void) {
      mocks.webgl.contextLoss = listener;
    }
    activate() {}
    dispose() {
      mocks.webgl.disposed += 1;
    }
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordFrictionSignal: mocks.friction,
}));

const withModifier = () => new MouseEvent("click", { metaKey: true, ctrlKey: true });
const withoutModifier = () => new MouseEvent("click");

function tooltip() {
  return { show: vi.fn(), hide: vi.fn() } as unknown as TerminalLinkTooltip & {
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
  };
}

function fakeTerminal(lines: string[]) {
  let provider: ILinkProvider | null = null;
  const terminal = {
    buffer: {
      active: {
        getLine: (index: number) =>
          lines[index] === undefined ? undefined : { translateToString: () => lines[index] },
      },
    },
    registerLinkProvider: (next: ILinkProvider) => {
      provider = next;
      return { dispose: () => {} };
    },
  };
  const provide = (lineNumber: number) =>
    new Promise<ILink[] | undefined>((resolve) => provider!.provideLinks(lineNumber, resolve));
  return { terminal: terminal as unknown as Terminal, provide };
}

beforeEach(() => {
  mocks.openUrl.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("style");
});

describe("terminal addons", () => {
  it("loads core addons and falls back to the DOM renderer without WebGL", () => {
    const terminal = new Terminal({ allowProposedApi: true });
    const onRendererFallback = vi.fn();

    const addons = createTerminalAddons(terminal, { onRendererFallback });

    expect(terminal.unicode.activeVersion).toBe(TERMINAL_UNICODE_VERSION);
    expect(addons.fitAddon).toBeDefined();
    expect(addons.searchAddon).toBeDefined();
    expect(addons.webglAddon).toBeNull();
    expect(onRendererFallback).toHaveBeenCalledTimes(1);
    expect(mocks.friction).toHaveBeenCalledWith({
      area: "terminal",
      signal: "renderer_fallback",
    });
    terminal.dispose();
  });

  it("drops the WebGL renderer when its context is lost", () => {
    mocks.webgl.available = true;
    const terminal = new Terminal({ allowProposedApi: true });
    const onRendererFallback = vi.fn();

    const addons = createTerminalAddons(terminal, { onRendererFallback });
    expect(addons.webglAddon).not.toBeNull();
    expect(onRendererFallback).not.toHaveBeenCalled();

    mocks.webgl.contextLoss?.();

    expect(mocks.webgl.disposed).toBe(1);
    expect(onRendererFallback).toHaveBeenCalledTimes(1);
    mocks.webgl.available = false;
    terminal.dispose();
  });

  it("opens web links only with the modifier and shows a hint on hover", async () => {
    const loaded: Array<{ _handler: (event: MouseEvent, uri: string) => void; _options: any }> = [];
    const terminal = { loadAddon: (addon: never) => loaded.push(addon) } as unknown as Terminal;
    const tip = tooltip();

    loadWebLinksAddon(terminal, { tooltip: tip });
    const addon = loaded[0];

    addon._handler(withoutModifier(), "https://athas.dev");
    expect(mocks.openUrl).not.toHaveBeenCalled();
    addon._handler(withModifier(), "https://athas.dev");
    addon._handler(withModifier(), "javascript:alert(1)");
    await vi.waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith("https://athas.dev/"));
    expect(mocks.openUrl).toHaveBeenCalledTimes(1);

    const event = withoutModifier();
    addon._options.hover(event, "https://athas.dev");
    expect(tip.show).toHaveBeenCalledWith(
      event,
      "https://athas.dev",
      describeTerminalLinkHint("url"),
    );
    addon._options.leave();
    expect(tip.hide).toHaveBeenCalledTimes(1);
  });

  it("loads web links before the link tooltip exists and uses it once it does", () => {
    const loaded: Array<{ _options: any }> = [];
    const terminal = { loadAddon: (addon: never) => loaded.push(addon) } as unknown as Terminal;
    let tip: ReturnType<typeof tooltip> | null = null;
    const options = {
      get tooltip() {
        if (!tip) throw new Error("Terminal link tooltip is not ready.");
        return tip;
      },
    };

    expect(() => loadWebLinksAddon(terminal, options)).not.toThrow();
    tip = tooltip();
    const event = withoutModifier();
    loaded[0]._options.hover(event, "https://athas.dev");
    expect(tip.show).toHaveBeenCalledWith(
      event,
      "https://athas.dev",
      describeTerminalLinkHint("url"),
    );
  });
});

describe("file links in terminal output", () => {
  it("links file paths on a line to their workspace files", async () => {
    const { terminal, provide } = fakeTerminal(["error in src/app.ts:12:5 and more"]);
    const openFile = vi.fn();
    const tip = tooltip();
    registerFileLinksProvider(terminal, { tooltip: tip, getWorkspaceRoot: () => "/ws", openFile });

    const links = await provide(1);

    expect(links).toHaveLength(1);
    const [link] = links!;
    expect(link.text).toBe("src/app.ts:12:5");
    expect(link.range).toEqual({ start: { x: 10, y: 1 }, end: { x: 24, y: 1 } });

    link.activate(withoutModifier(), link.text);
    expect(openFile).not.toHaveBeenCalled();
    link.activate(withModifier(), link.text);
    expect(openFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/ws/src/app.ts", line: 12, column: 5 }),
    );

    const event = withoutModifier();
    link.hover?.(event, link.text);
    expect(tip.show).toHaveBeenCalledWith(event, link.text, describeTerminalLinkHint("file"));
    link.leave?.(event, link.text);
    expect(tip.hide).toHaveBeenCalled();
  });

  it("provides nothing for missing lines or lines without paths", async () => {
    const { terminal, provide } = fakeTerminal(["just words here"]);
    registerFileLinksProvider(terminal, {
      tooltip: tooltip(),
      getWorkspaceRoot: () => "/ws",
      openFile: vi.fn(),
    });

    await expect(provide(1)).resolves.toBeUndefined();
    await expect(provide(5)).resolves.toBeUndefined();
  });
});

describe("OSC 8 hyperlinks", () => {
  it("opens file:// links in the editor and web links externally", async () => {
    const openFile = vi.fn();
    const tip = tooltip();
    const handler = createTerminalLinkHandler({
      tooltip: tip,
      getWorkspaceRoot: () => "/ws",
      openFile,
    });

    expect(handler.allowNonHttpProtocols).toBe(true);
    handler.activate(withoutModifier(), "file:///ws/a.ts", undefined as never);
    expect(openFile).not.toHaveBeenCalled();

    handler.activate(withModifier(), "file:///ws/a.ts", undefined as never);
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "/ws/a.ts" }));

    handler.activate(withModifier(), "mailto:dev@athas.dev", undefined as never);
    await vi.waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith("mailto:dev@athas.dev"));
  });

  it("logs links that fail to open", async () => {
    mocks.openUrl.mockRejectedValueOnce(new Error("no handler"));
    const handler = createTerminalLinkHandler({
      tooltip: tooltip(),
      getWorkspaceRoot: () => undefined,
      openFile: vi.fn(),
    });

    handler.activate(withModifier(), "https://athas.dev", undefined as never);

    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });

  it("describes file and web links on hover and ignores other schemes", () => {
    const tip = tooltip();
    const handler = createTerminalLinkHandler({
      tooltip: tip,
      getWorkspaceRoot: () => "/ws",
      openFile: vi.fn(),
    });
    const event = withoutModifier();

    handler.hover!(event, "file:///ws/a.ts", undefined as never);
    expect(tip.show).toHaveBeenLastCalledWith(event, "/ws/a.ts", describeTerminalLinkHint("file"));

    handler.hover!(event, "https://athas.dev", undefined as never);
    expect(tip.show).toHaveBeenLastCalledWith(
      event,
      "https://athas.dev",
      describeTerminalLinkHint("url"),
    );

    handler.hover!(event, "ssh://host", undefined as never);
    expect(tip.show).toHaveBeenCalledTimes(2);
    handler.leave!(event, "", undefined as never);
    expect(tip.hide).toHaveBeenCalledTimes(1);
  });
});

describe("terminal theme", () => {
  function setVariables(variables: Record<string, string>) {
    for (const [name, value] of Object.entries(variables)) {
      document.documentElement.style.setProperty(name, value);
    }
  }

  it("follows the editor theme variables and derives the ANSI palette from syntax colors", async () => {
    const { getTerminalTheme } = await renderTheme({
      "--background": "#101010",
      "--foreground": "#eeeeee",
      "--primary": "#3af",
      "--syntax-keyword": "#aa00aa",
      "--syntax-string": "rgb(0, 200, 0)",
      "--terminal-red": "255 0 0",
      "--terminal-cyan": "0, 255, 255",
      "--terminal-bright-white": "#ffffff",
    });
    const theme = getTerminalTheme();

    expect(theme).toMatchObject({
      background: "#101010",
      foreground: "#eeeeee",
      cursor: "#3af",
      cursorAccent: "#101010",
      selectionBackground: "rgba(51, 170, 255, 0.25)",
      selectionForeground: "#eeeeee",
      magenta: "#aa00aa",
      brightMagenta: "#aa00aa",
      green: "rgb(0, 200, 0)",
      red: "rgb(255 0 0)",
      cyan: "rgb(0, 255, 255)",
      brightWhite: "#ffffff",
    });
  });

  it("falls back to the default palette for missing or invalid variables", async () => {
    const defaults = (await renderTheme({})).getTerminalTheme();
    const invalid = (
      await renderTheme({ "--background": "not-a-color", "--primary": "999 999" })
    ).getTerminalTheme();

    expect(invalid.background).toBe(defaults.background);
    expect(invalid.cursor).toBe(defaults.cursor);
    expect(defaults.selectionBackground).toMatch(/^(rgba?\(|#)/);
    expect(defaults.brightRed).toBe(defaults.red);
  });

  it("applies selection alpha to rgb and rgba accents", async () => {
    const rgb = (await renderTheme({ "--primary": "rgb(10, 20, 30)" })).getTerminalTheme();
    expect(rgb.selectionBackground).toBe("rgb(10, 20, 30 / 0.25)");

    const rgba = (await renderTheme({ "--primary": "rgba(10, 20, 30, 1)" })).getTerminalTheme();
    expect(rgba.selectionBackground).toBe("rgba(10, 20, 30, 0.25)");
  });

  async function renderTheme(variables: Record<string, string>) {
    document.documentElement.removeAttribute("style");
    setVariables(variables);
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    let value!: ReturnType<typeof useTerminalTheme>;
    function Probe() {
      value = useTerminalTheme();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    act(() => root.render(createElement(Probe)));
    act(() => root.unmount());
    return value;
  }
});
