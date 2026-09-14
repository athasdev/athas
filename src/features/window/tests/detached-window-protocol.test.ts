import { describe, expect, it } from "vite-plus/test";
import {
  getDetachedWindowChannelName,
  parseDetachedWindowUrl,
} from "@/features/window/detached/detached-window-protocol";

describe("parseDetachedWindowUrl", () => {
  it("recognizes every detached window kind", () => {
    expect(
      parseDetachedWindowUrl(new URL("http://localhost/?view=detached&kind=agent&channel=abc-123")),
    ).toEqual({ kind: "agent", channel: "abc-123" });
    expect(
      parseDetachedWindowUrl(new URL("http://localhost/?view=detached&kind=resource&channel=r-1")),
    ).toEqual({ kind: "resource", channel: "r-1" });
    expect(
      parseDetachedWindowUrl(
        new URL("http://localhost/?view=detached&kind=standalone&channel=main-1"),
      ),
    ).toEqual({ kind: "standalone", channel: "main-1" });
  });

  it("passes the payload through untouched", () => {
    const payload = JSON.stringify({ content: { type: "pullRequest", prNumber: 5 } });
    const url = new URL("http://localhost/?view=detached&kind=resource&channel=r-1");
    url.searchParams.set("payload", payload);
    expect(parseDetachedWindowUrl(url)).toEqual({ kind: "resource", channel: "r-1", payload });
  });

  it("ignores partial, unknown or unsafe requests", () => {
    for (const query of [
      "",
      "?view=detached",
      "?view=detached&kind=agent",
      "?view=detached&channel=abc",
      "?view=detached&kind=browser&channel=abc",
      "?view=detached&kind=agent&channel=../bad",
      "?view=agents&agentWindow=abc",
      "?target=open&type=directory&path=/workspace",
    ]) {
      expect(parseDetachedWindowUrl(new URL(`http://localhost/${query}`))).toBeNull();
    }
  });

  it("derives one channel name per window", () => {
    expect(getDetachedWindowChannelName("abc")).toBe("athas-window-abc");
  });
});
