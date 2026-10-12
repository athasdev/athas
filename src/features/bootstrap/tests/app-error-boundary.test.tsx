// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AppErrorBoundary } from "../components/app-error-boundary";

const mocks = vi.hoisted(() => ({ recordCrashReport: vi.fn(async () => true) }));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordCrashReport: mocks.recordCrashReport,
}));

let root: Root;
let container: HTMLDivElement;

function BrokenView(): never {
  throw new Error("Terminal link tooltip is not ready.");
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.recordCrashReport.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("app error boundary", () => {
  it("renders its children while they render", async () => {
    await act(async () =>
      root.render(
        <AppErrorBoundary>
          <p>workbench</p>
        </AppErrorBoundary>,
      ),
    );

    expect(container.textContent).toBe("workbench");
  });

  it("shows an error state instead of an empty window when a view throws", async () => {
    await act(async () =>
      root.render(
        <AppErrorBoundary>
          <BrokenView />
        </AppErrorBoundary>,
      ),
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Terminal link tooltip is not ready.");
    expect(container.querySelector("button")?.textContent).toBe("Reload window");
    await vi.waitFor(() =>
      expect(mocks.recordCrashReport).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "render_error",
          message: "Terminal link tooltip is not ready.",
        }),
      ),
    );
  });
});
