import { describe, expect, it, vi } from "vite-plus/test";
import {
  getRepresentativeIcon,
  getThemePreviewColors,
} from "@/extensions/appearance/appearance-preview";
import { getIconThemePreviewDefinitions } from "@/extensions/icon-themes/icon-theme-preview";
import type { IconThemeContribution } from "@/extensions/types/extension-manifest";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";

const theme: ThemeDefinition = {
  id: "test-theme",
  name: "Test theme",
  description: "Test theme colors",
  category: "Dark",
  cssVariables: {
    "--primary": "#111111",
    "--surface": "#444444",
    "--foreground": "#555555",
    "--background": "#666666",
  },
  syntaxTokens: {
    "--syntax-keyword": "#222222",
    "--syntax-string": "#333333",
  },
};

const iconTheme: IconThemeContribution = {
  id: "test-icons",
  name: "Test Icons",
  preview: { fileName: "README.md", kind: "file" },
  iconDefinitions: {
    file: "./file.svg",
    markdown: "./markdown.svg",
    typescript: "./typescript.svg",
  },
  fileExtensions: {
    ".md": "markdown",
    ".ts": "typescript",
  },
  defaultFile: "file",
};

describe("appearance previews", () => {
  it("prefers accent and syntax colors before neutral surfaces", () => {
    expect(getThemePreviewColors(theme)).toEqual(["#111111", "#222222", "#333333", "#444444"]);
  });

  it("falls back to foreground and background when syntax colors are missing", () => {
    expect(
      getThemePreviewColors({
        ...theme,
        syntaxTokens: undefined,
      }),
    ).toEqual(["#111111", "#444444", "#555555", "#666666"]);
  });

  it("uses an icon theme's explicit preview target", () => {
    expect(getIconThemePreviewDefinitions(iconTheme)).toEqual({
      default: "./markdown.svg",
      light: undefined,
    });

    const getFileIcon = vi.fn(() => ({ url: "./markdown.svg" }));
    expect(
      getRepresentativeIcon({
        id: iconTheme.id,
        name: iconTheme.name,
        description: "",
        preview: { fileName: "README.md", isDirectory: false },
        getFileIcon,
      }),
    ).toEqual({ url: "./markdown.svg" });
    expect(getFileIcon).toHaveBeenCalledWith("README.md", false);
  });

  it("keeps the shared representative-file fallback for older icon themes", () => {
    expect(
      getIconThemePreviewDefinitions({
        ...iconTheme,
        preview: undefined,
      }),
    ).toEqual({ default: "./typescript.svg", light: undefined });
  });

  it("falls back when an explicit preview target has no matching icon", () => {
    expect(
      getIconThemePreviewDefinitions({
        ...iconTheme,
        preview: { fileName: "missing.custom", kind: "file" },
        defaultFile: undefined,
      }),
    ).toEqual({ default: "./typescript.svg", light: undefined });
  });
});
