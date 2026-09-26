import { describe, expect, it } from "vite-plus/test";
import { decodeSvgDataUri, getSvgIconTone } from "../svg-icon-tone";

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;

describe("getSvgIconTone", () => {
  it("treats currentColor and unpainted icons as monochrome", () => {
    expect(getSvgIconTone(svg('<path fill="currentColor" d="M0 0h16v16z"/>'))).toBe("monochrome");
    expect(getSvgIconTone(svg('<path d="M0 0h16v16z"/>'))).toBe("monochrome");
  });

  it("redraws a single color only when it is too dark to read on a dark surface", () => {
    expect(getSvgIconTone(svg('<path fill="#00546B" d="M0 0h16v16z"/>'))).toBe("monochrome");
    expect(getSvgIconTone(svg('<path fill="#000" d="M0 0h16v16z"/>'))).toBe("monochrome");
    expect(getSvgIconTone(svg('<path fill="#3178C6" d="M0 0h16v16z"/>'))).toBe("color");
    expect(getSvgIconTone(svg('<path style="fill: #F7DF1E" d="M0 0h16v16z"/>'))).toBe("color");
  });

  it("keeps multi-color and two-tone marks, which carry their own contrast", () => {
    expect(
      getSvgIconTone(
        svg('<rect fill="#000" width="16" height="16"/><path fill="#fff" d="M4 4h8v8z"/>'),
      ),
    ).toBe("color");
    expect(
      getSvgIconTone(
        svg('<path fill="none" stroke="#e44d26" d="M0 0h16"/><path fill="#f16529" d="M0 0h8"/>'),
      ),
    ).toBe("color");
  });
});

describe("decodeSvgDataUri", () => {
  it("decodes base64 and percent-encoded SVG data URIs", () => {
    const markup = svg('<path fill="currentColor" d="M0 0"/>');
    expect(decodeSvgDataUri(`data:image/svg+xml;base64,${btoa(markup)}`)).toBe(markup);
    expect(decodeSvgDataUri(`data:image/svg+xml,${encodeURIComponent(markup)}`)).toBe(markup);
    expect(decodeSvgDataUri("https://athas.dev/icon.svg")).toBeNull();
  });
});
