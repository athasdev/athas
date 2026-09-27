import { describe, expect, it } from "vitest";
import { crashReportBuild, isBenignWindowError, isExpectedCancellation } from "../lib/crash-noise";

describe("crash report noise", () => {
  it("treats ResizeObserver loop notices as benign", () => {
    expect(
      isBenignWindowError("ResizeObserver loop completed with undelivered notifications."),
    ).toBe(true);
    expect(isBenignWindowError("ResizeObserver loop limit exceeded")).toBe(true);
    expect(isBenignWindowError("Uncaught Error: ResizeObserver loop limit exceeded")).toBe(true);
  });

  it("keeps real window errors", () => {
    expect(isBenignWindowError("TypeError: Cannot read properties of undefined")).toBe(false);
    expect(isBenignWindowError("ResizeObserver is not defined")).toBe(false);
    expect(isBenignWindowError(null)).toBe(false);
  });

  it("recognizes Monaco cancellations", () => {
    const canceled = new Error("Canceled");
    canceled.name = "Canceled";
    expect(isExpectedCancellation(canceled)).toBe(true);
    expect(isExpectedCancellation("Canceled: Canceled")).toBe(true);
    expect(isExpectedCancellation(new Error("Model not found"))).toBe(false);
  });

  it("labels the build a report came from", () => {
    expect(crashReportBuild(true)).toBe("dev");
    expect(crashReportBuild(false)).toBe("release");
  });
});
