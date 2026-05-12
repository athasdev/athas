import { describe, expect, test } from "vite-plus/test";
import { buildDefaultFilename } from "./build-default-filename";

describe("buildDefaultFilename", () => {
  test("with path: produces basename-L{start}-L{end}.png", () => {
    expect(
      buildDefaultFilename({ bufferPath: "/a/b/staging.rs", startLine: 42, endLine: 48 } as any),
    ).toBe("staging-rs-L42-L48.png");
  });

  test("dotted filenames have all dots replaced", () => {
    expect(
      buildDefaultFilename({ bufferPath: "/a/my.config.ts", startLine: 1, endLine: 10 } as any),
    ).toBe("my-config-ts-L1-L10.png");
  });

  test("Windows path separators are honored", () => {
    expect(
      buildDefaultFilename({
        bufferPath: "C:\\\\a\\\\b\\\\file.rs",
        startLine: 1,
        endLine: 2,
      } as any),
    ).toBe("file-rs-L1-L2.png");
  });

  test("no path uses codesnap-{ts}.png", () => {
    const out = buildDefaultFilename(
      { bufferPath: null, startLine: 1, endLine: 1 } as any,
      () => 1700000000000,
    );
    expect(out).toBe("codesnap-1700000000000.png");
  });
});
