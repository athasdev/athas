// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import UnsavedChangesDialog from "../components/unsaved-changes-dialog";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("@/utils/platform", () => ({ IS_MAC: true }));
vi.mock("@/ui/dialog", () => ({
  default: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => (
    <div role="dialog">
      {children}
      {footer}
    </div>
  ),
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
const callbacks = { onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  invoke.mockReset();
  Object.values(callbacks).forEach((callback) => callback.mockReset());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function render(key: unknown = "decision", strict = false) {
  await act(async () => {
    const dialog = <UnsavedChangesDialog {...callbacks} fileName="same.ts" decisionKey={key} />;
    root.render(strict ? <StrictMode>{dialog}</StrictMode> : dialog);
  });
}

describe("unsaved changes native decisions", () => {
  it("serializes native decisions from different dialog owners", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const secondCancel = vi.fn();
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await act(async () =>
      root.render(
        <>
          <UnsavedChangesDialog {...callbacks} fileName="first.ts" decisionKey="first-owner" />
          <UnsavedChangesDialog
            {...callbacks}
            onCancel={secondCancel}
            fileName="second.ts"
            decisionKey="second-owner"
          />
        </>,
      ),
    );
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => first.resolve("secondary"));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(callbacks.onDiscard).toHaveBeenCalledOnce();
    await act(async () => second.resolve("cancel"));
    expect(secondCancel).toHaveBeenCalledOnce();
  });

  it("issues one sheet under Strict Mode and handles its result", async () => {
    const choice = deferred<string>();
    invoke.mockReturnValue(choice.promise);
    await render("decision", true);
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => choice.resolve("secondary"));
    expect(callbacks.onDiscard).toHaveBeenCalledOnce();
  });

  it("presents a fallback after Save leaves the dialog open", async () => {
    invoke.mockResolvedValue("primary");
    callbacks.onSave.mockResolvedValue(false);
    await render();
    expect(callbacks.onSave).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    )!;
    await act(async () => save.click());
    expect(callbacks.onSave).toHaveBeenCalledTimes(2);
  });

  it("shows the next decision even when both files have the same name", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render({ id: "first" });
    await act(async () => first.resolve("primary"));
    await render({ id: "second" });
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve("secondary"));
    expect(callbacks.onDiscard).toHaveBeenCalledOnce();
  });

  it("ignores an old receipt and serializes a replacement sheet", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render("first");
    await render("second");
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => first.resolve("secondary"));
    expect(callbacks.onDiscard).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve("cancel"));
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
  });

  it("does not show a queued replacement after the dialog unmounts", async () => {
    const first = deferred<string>();
    invoke.mockReturnValue(first.promise);
    await render("first");
    await render("second");
    await act(async () => root.render(null));
    await act(async () => first.resolve("secondary"));
    expect(invoke).toHaveBeenCalledOnce();
    expect(callbacks.onDiscard).not.toHaveBeenCalled();
  });

  it("uses current callbacks without presenting duplicate sheets", async () => {
    const choice = deferred<string>();
    invoke.mockReturnValue(choice.promise);
    await render();
    const currentDiscard = vi.fn();
    await act(async () =>
      root.render(
        <UnsavedChangesDialog
          {...callbacks}
          onDiscard={currentDiscard}
          fileName="same.ts"
          decisionKey="decision"
        />,
      ),
    );
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => choice.resolve("secondary"));
    expect(currentDiscard).toHaveBeenCalledOnce();
    expect(callbacks.onDiscard).not.toHaveBeenCalled();
  });

  it("disables repeated Save while a fallback write is pending", async () => {
    invoke.mockRejectedValue(new Error("Native sheets unavailable"));
    await render();
    const write = deferred<void>();
    callbacks.onSave.mockReturnValue(write.promise);
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    )!;
    await act(async () => save.click());
    expect(save.disabled).toBe(true);
    await act(async () => write.resolve());
    expect(save.disabled).toBe(false);
  });
});
