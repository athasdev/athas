import { describe, expect, it } from "vite-plus/test";
import {
  normalizeGenerativeUIView,
  OPEN_EXTERNAL_VIEW_COMMAND,
} from "../ui/services/generative-ui-adapter";

describe("generative UI adapter", () => {
  it("passes canonical structured views through runtime validation", () => {
    expect(
      normalizeGenerativeUIView({
        type: "metric",
        label: "Passing",
        value: 18,
        tone: "success",
      }),
    ).toEqual({
      type: "metric",
      label: "Passing",
      value: 18,
      detail: undefined,
      tone: "success",
    });
  });

  it("converts legacy cards, lists, tables, and actions into structured nodes", () => {
    const view = normalizeGenerativeUIView({
      type: "card",
      props: { title: "Release", description: "Current status" },
      children: [
        { type: "list", props: { items: ["Typecheck", "Build"] } },
        {
          type: "table",
          props: {
            headers: ["Target", "State"],
            rows: [["Linux ARM64", "Ready"]],
          },
        },
      ],
      actions: [
        {
          id: "open",
          label: "Open release",
          url: "https://athas.dev/releases",
          style: "primary",
        },
      ],
    });

    expect(view.type).toBe("card");
    if (view.type !== "card") throw new Error("Expected a card");
    expect(view.children[0]).toMatchObject({ type: "list" });
    expect(view.children[1]).toMatchObject({ type: "table" });
    expect(view.children[2]).toEqual({
      type: "button",
      label: "Open release",
      action: {
        command: OPEN_EXTERNAL_VIEW_COMMAND,
        args: ["https://athas.dev/releases"],
      },
      tone: "accent",
      disabled: undefined,
    });
  });

  it("rejects malformed canonical and legacy payloads", () => {
    expect(() => normalizeGenerativeUIView({ type: "metric", label: "Missing value" })).toThrow(
      "expected a string",
    );
    expect(() => normalizeGenerativeUIView({ type: "unknown", props: {}, children: [] })).toThrow(
      "Unsupported legacy generative UI component: unknown",
    );
  });
});
