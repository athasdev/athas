import { convertFileSrc } from "@tauri-apps/api/core";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ProjectCustomIcon } from "../components/project-custom-icon";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

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

  it("continues loading existing project image files through Tauri", () => {
    const markup = renderToStaticMarkup(<ProjectCustomIcon value="/project/logo.png" />);
    expect(convertFileSrc).toHaveBeenCalledWith("/project/logo.png");
    expect(markup).toContain('src="asset:///project/logo.png"');
    expect(markup).toContain("<img");
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
