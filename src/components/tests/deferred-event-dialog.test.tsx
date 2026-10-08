// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { emitAppEvent, useAppEvent } from "@/utils/app-events";
import { DeferredEventDialog } from "../deferred-event-dialog";

const EVENT = "athas:open-agent-sessions";

function FakeDialog() {
  const [detail, setDetail] = useState<string | null>(null);
  useAppEvent(EVENT, setDetail);
  return detail ? <p data-testid="dialog">{detail}</p> : null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DeferredEventDialog", () => {
  it("loads the dialog on its first event and hands that event to it", async () => {
    const load = vi.fn(async () => FakeDialog);
    await act(async () => root.render(<DeferredEventDialog event={EVENT} load={load} />));
    expect(load).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");

    await act(async () => {
      emitAppEvent(EVENT, "first");
      emitAppEvent(EVENT, "second");
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="dialog"]')?.textContent).toBe("second");

    await act(async () => {
      emitAppEvent(EVENT, "third");
    });
    expect(container.querySelector('[data-testid="dialog"]')?.textContent).toBe("third");
  });
});
