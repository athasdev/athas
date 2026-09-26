import { describe, expect, it } from "vite-plus/test";
import { claimRunAbortController } from "@/features/ai/lib/run-abort-controller";

describe("claimRunAbortController", () => {
  it("lets a run clear only the controller it owns", () => {
    const ref: { current: AbortController | null } = { current: null };
    const stopped = claimRunAbortController(ref);
    const next = claimRunAbortController(ref);

    stopped.release();
    expect(ref.current).toBe(next.controller);
    next.release();
    expect(ref.current).toBeNull();
  });
});
