import { describe, expect, it } from "vite-plus/test";
import { formatEffortLabel, isAutoEffort } from "@/features/ai/lib/effort-levels";

describe("effort levels", () => {
  it("words every agent's effort scale the same way", () => {
    expect(formatEffortLabel("xhigh")).toBe("Extra high");
    expect(formatEffortLabel("x-high", "Xhigh")).toBe("Extra high");
    expect(formatEffortLabel("max")).toBe("Max");
    expect(formatEffortLabel("minimal")).toBe("Minimal");
    expect(formatEffortLabel("medium", "Balanced")).toBe("Medium");
    expect(formatEffortLabel("think-3", "Deep think")).toBe("Deep think");
    expect(formatEffortLabel("ultra")).toBe("Ultra");
  });

  it("reads an agent's default level as Auto", () => {
    expect(isAutoEffort("default")).toBe(true);
    expect(isAutoEffort("Auto")).toBe(true);
    expect(isAutoEffort("high")).toBe(false);
    expect(formatEffortLabel("default", "Default")).toBe("Auto");
  });
});
