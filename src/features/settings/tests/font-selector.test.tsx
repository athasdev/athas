// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FontInfo } from "@/features/settings/types/font.types";

const commandMocks = vi.hoisted(() => ({
  getSystemFonts: vi.fn(),
  getMonospaceFonts: vi.fn(),
  validateFont: vi.fn(async () => false),
}));

vi.mock("@/bindings/commands", () => ({ commands: commandMocks }));

function font(family: string, isMonospace: boolean): FontInfo {
  return { name: family, family, style: "Regular", is_monospace: isMonospace };
}

const systemFonts = [font("Helvetica", false), font("Menlo", true)];

let root: Root;
let container: HTMLDivElement;

async function mountSelector(
  FontSelector: typeof import("../components/font-selector").FontSelector,
) {
  await act(async () => {
    root.render(<FontSelector value="Helvetica" onChange={() => {}} />);
  });
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function unmountSelector() {
  await act(async () => root.unmount());
  root = createRoot(container);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  for (const mock of Object.values(commandMocks)) mock.mockClear();
  commandMocks.getSystemFonts.mockResolvedValue(systemFonts);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("font selector", () => {
  it("scans the system fonts once per session, not on every page visit", async () => {
    vi.resetModules();
    const { FontSelector } = await import("../components/font-selector");

    await mountSelector(FontSelector);
    await unmountSelector();
    await mountSelector(FontSelector);

    expect(commandMocks.getSystemFonts).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Loading fonts");
  });
});
