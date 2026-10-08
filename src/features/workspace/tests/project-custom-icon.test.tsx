// @vitest-environment jsdom
import { convertFileSrc } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { ProjectCustomIcon } from "../project-icons/components/project-custom-icon";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));
vi.mock("@/bindings/commands", () => ({
  commands: { allowAssetPath: vi.fn(async () => null) },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("custom project icon rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders saved emoji directly without requesting an image", () => {
    const markup = renderToStaticMarkup(<ProjectCustomIcon value="emoji:🚀" />);
    expect(markup).toContain("🚀");
    expect(markup).not.toContain("<img");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it("renders saved built-in icons without requesting an image", () => {
    const markup = renderToStaticMarkup(<ProjectCustomIcon value="icon:code" />);
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("<img");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it("allows project image files in the asset scope before loading them", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<ProjectCustomIcon value="/project/logo.png" />);
    });

    expect(commands.allowAssetPath).toHaveBeenCalledWith("/project/logo.png");
    expect(convertFileSrc).toHaveBeenCalledWith("/project/logo.png");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("asset:///project/logo.png");
    act(() => root.unmount());
  });

  it("falls back safely for symbols absent from the current catalog", () => {
    for (const value of ["icon:missing", "emoji:missing"]) {
      const markup = renderToStaticMarkup(<ProjectCustomIcon value={value} />);
      expect(markup).toContain("<svg");
      expect(markup).not.toContain("<img");
    }
    expect(convertFileSrc).not.toHaveBeenCalled();
  });
});
