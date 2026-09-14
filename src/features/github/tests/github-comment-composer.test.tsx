// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GitHubCommentComposer } from "../components/github-comment-composer";

vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

vi.mock("../components/github-markdown", () => ({
  default: ({ content }: { content: string }) => <div data-preview>{content}</div>,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(
  onSubmit: () => Promise<boolean>,
  initialValue = "Draft **comment**",
  disabled = false,
) {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <GitHubCommentComposer
        value={value}
        onChange={setValue}
        onSubmit={async () => {
          const saved = await onSubmit();
          if (saved) setValue("");
          return saved;
        }}
        isSubmitting={false}
        disabled={disabled}
      />
    );
  }
  await act(async () => root.render(<Harness />));
}

function sendShortcut(options: KeyboardEventInit = {}) {
  container.querySelector("form")!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
}

describe("GitHub comment composer", () => {
  it("keeps the exact Markdown draft when switching between write and preview", async () => {
    await mount(vi.fn());
    const preview = Array.from(container.querySelectorAll<HTMLButtonElement>("[role=tab]")).find(
      (tab) => tab.textContent === "Preview",
    )!;
    await act(async () => preview.click());
    expect(container.querySelector("[data-preview]")?.textContent).toBe("Draft **comment**");
    const write = Array.from(container.querySelectorAll<HTMLButtonElement>("[role=tab]")).find(
      (tab) => tab.textContent === "Write",
    )!;
    await act(async () => write.click());
    expect(container.querySelector("textarea")?.value).toBe("Draft **comment**");
  });

  it("posts only once for repeated shortcuts while a request is pending", async () => {
    let finish!: (value: boolean) => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await mount(onSubmit);
    await act(async () => {
      sendShortcut();
      sendShortcut();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    await act(async () => finish(true));
    expect(container.querySelector("textarea")?.value).toBe("");
    expect(container.querySelector("textarea")?.disabled).toBe(false);
  });

  it("retains failed drafts and allows retry without leaving the editor", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(true);
    await mount(onSubmit);
    await act(async () => sendShortcut());
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Connection lost");
    expect(container.querySelector("textarea")?.value).toBe("Draft **comment**");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button[type=submit]")!.click(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  it("shows an inline error when the issue mutation reports failure", async () => {
    await mount(vi.fn().mockResolvedValue(false));
    await act(async () => sendShortcut());
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Your draft is still here",
    );
    expect(container.querySelector("textarea")?.value).toBe("Draft **comment**");
  });

  it.each(["", "   \n  "])("does not submit an empty comment", async (value) => {
    const onSubmit = vi.fn();
    await mount(onSubmit, value);
    await act(async () => sendShortcut());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true);
  });

  it("does not submit locked conversations or IME composition", async () => {
    const onSubmit = vi.fn();
    await mount(onSubmit, "Draft", true);
    await act(async () => sendShortcut());
    expect(onSubmit).not.toHaveBeenCalled();
    await mount(onSubmit);
    await act(async () => sendShortcut({ isComposing: true }));
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => sendShortcut({ metaKey: false, ctrlKey: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
