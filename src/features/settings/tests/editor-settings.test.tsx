// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
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

import { commands } from "@/bindings/commands";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { EditorSettings } from "../components/tabs/editor-settings";
import { getDefaultSetting, getDefaultSettingsSnapshot } from "../config/default-settings";
import { useSettingsStore } from "../stores/settings.store";
import type { Settings } from "../types/settings.types";

enableMapSet();

let root: Root;
let container: HTMLDivElement;

const body = () => within(document.body);
const settings = () => useSettingsStore.getState().settings;
const row = (label: string) =>
  document.querySelector(`[data-setting-row-label="${label}"]`) as HTMLElement;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function render() {
  await act(async () => root.render(<EditorSettings />));
  await flush();
}

async function choose(label: string, option: string) {
  const control = within(row(label)).getAllByRole("combobox")[0];
  if (control instanceof HTMLInputElement) {
    await click(control.parentElement!.querySelector("button")!);
    await act(async () => {
      fireEvent.change(control, { target: { value: option } });
    });
    await flush();
  } else {
    await click(control);
  }
  const match = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === option,
  );
  if (!match) throw new Error(`No option ${option}`);
  await click(match);
}

async function typeNumber(label: string, value: string) {
  const input = within(row(label)).getByRole("textbox");
  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  });
  await flush();
}

const switches: [string, keyof Settings][] = [
  ["Font Ligatures", "editorFontLigatures"],
  ["Italic Comments", "editorItalicComments"],
  ["Word Wrap", "wordWrap"],
  ["Indent Guides", "renderIndentGuides"],
  ["Highlight Occurrences", "highlightOccurrences"],
  ["Bracket Pair Colorization", "editorBracketPairColorization"],
  ["Show Minimap", "showMinimap"],
  ["Show Outline", "showOutline"],
  ["Sticky Scroll", "editorStickyScroll"],
  ["Show Symbol in Breadcrumb", "breadcrumbShowSymbols"],
  ["Smooth Scrolling", "editorSmoothScrolling"],
  ["Scroll Beyond Last Line", "editorScrollBeyondLastLine"],
  ["Buffer Carousel", "horizontalTabScroll"],
  ["Auto Save", "autoSave"],
  ["Auto-detect Language", "autoDetectLanguage"],
  ["Format on Save", "formatOnSave"],
  ["Lint on Save", "lintOnSave"],
  ["Auto Completion", "autoCompletion"],
  ["Parameter Hints", "parameterHints"],
  ["Inlay Hints", "inlayHints"],
  ["Code Lens", "codeLens"],
  ["Semantic Tokens", "semanticTokens"],
  ["Line Numbers", "lineNumbers"],
];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useSettingsStore.setState({ settings: getDefaultSettingsSnapshot() });
  vi.spyOn(commands, "getMonospaceFonts").mockResolvedValue([]);
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
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("editor settings", () => {
  it.each(switches)("toggles %s and resets it to the default", async (label, key) => {
    await render();
    const initial = getDefaultSetting(key);

    await click(body().getByRole("switch", { name: label }));
    expect(settings()[key]).toBe(!initial);

    await click(body().getByRole("button", { name: `Reset ${label}` }));
    expect(settings()[key]).toBe(initial);
  });

  it("only allows relative line numbers while line numbers are shown", async () => {
    await render();
    const relative = body().getByRole("switch", { name: "Relative Line Numbers" });
    expect(relative.getAttribute("aria-disabled")).not.toBe("true");

    await click(relative);
    expect(settings().vimRelativeLineNumbers).toBe(!getDefaultSetting("vimRelativeLineNumbers"));
    await click(body().getByRole("button", { name: "Reset Relative Line Numbers" }));

    await click(body().getByRole("switch", { name: "Line Numbers" }));
    expect(
      body().getByRole("switch", { name: "Relative Line Numbers" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("chooses whitespace rendering and cursor appearance", async () => {
    await render();

    await choose("Render Whitespace", "Trailing");
    await choose("Cursor Style", "Block Outline");
    await choose("Cursor Blinking", "Phase");

    expect(settings()).toMatchObject({
      renderWhitespace: "trailing",
      editorCursorStyle: "block-outline",
      editorCursorBlinking: "phase",
    });

    await click(body().getByRole("button", { name: "Reset Cursor Style" }));
    expect(settings().editorCursorStyle).toBe(getDefaultSetting("editorCursorStyle"));
  });

  it("picks the default language for new files", async () => {
    await render();

    await choose("Default Language", "Python");

    expect(settings().defaultLanguage).toBe("python");
    await click(body().getByRole("button", { name: "Reset Default Language" }));
    expect(settings().defaultLanguage).toBe(getDefaultSetting("defaultLanguage"));
  });

  it("applies typed font, tab and line height values", async () => {
    await render();

    await typeNumber("Font Size", "18");
    await typeNumber("Line Height", "1.6");
    await typeNumber("Tab Size", "4");
    await typeNumber("Max Open Tabs", "12");

    expect(settings()).toMatchObject({
      fontSize: 18,
      editorLineHeight: 1.6,
      tabSize: 4,
      maxOpenTabs: 12,
    });

    await click(body().getByRole("button", { name: "Reset Font Size" }));
    await click(body().getByRole("button", { name: "Reset Line Height" }));
    await click(body().getByRole("button", { name: "Reset Tab Size" }));
    await click(body().getByRole("button", { name: "Reset Max Open Tabs" }));
    expect(settings()).toMatchObject({
      fontSize: getDefaultSetting("fontSize"),
      editorLineHeight: getDefaultSetting("editorLineHeight"),
      tabSize: getDefaultSetting("tabSize"),
      maxOpenTabs: getDefaultSetting("maxOpenTabs"),
    });
  });
});
