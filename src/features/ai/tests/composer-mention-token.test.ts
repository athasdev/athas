// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import { parseMentionTokens } from "../lib/file-mentions";
import { getComposerText } from "../utils/chat-composer-dom";

describe("composer mention tokens", () => {
  it("serializes a file chip with the exact path it points at", () => {
    const composer = document.createElement("div");
    composer.innerHTML =
      'Fix <span contenteditable="false" data-mention data-mention-name="page.tsx" data-mention-path="/w/app/(site)/page.tsx">page.tsx</span> please';

    const text = getComposerText(composer);

    expect(text).toBe("Fix @[page.tsx](/w/app/%28site%29/page.tsx) please");
    expect(parseMentionTokens(text)[0]).toMatchObject({
      name: "page.tsx",
      path: "/w/app/(site)/page.tsx",
    });
  });
});
