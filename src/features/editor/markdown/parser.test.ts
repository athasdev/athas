import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
  },
}));

import { parseMarkdown } from "./parser";

describe("parseMarkdown", () => {
  it("keeps ordered lists counting across blank lines", () => {
    const html = parseMarkdown("1. One\n\n2. Two\n\n3. Three");

    expect(html).toContain('<ol start="1">');
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("<li>Two</li>");
    expect(html).toContain("<li>Three</li>");
    expect((html.match(/<ol start="1">/g) ?? []).length).toBe(1);
  });
});
