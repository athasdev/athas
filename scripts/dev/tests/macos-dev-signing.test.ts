import path from "node:path";
import { describe, expect, it } from "vitest";
import { withMacosDevSigning } from "../macos-dev-signing";

const repoRoot = "/repo/athas";

describe("withMacosDevSigning", () => {
  it("configures the native Apple Silicon Cargo runner", () => {
    const environment = withMacosDevSigning(
      { EXISTING_VALUE: "preserved" },
      {
        arch: "arm64",
        identifier: "com.code.athas.preview",
        platform: "darwin",
        repoRoot,
      },
    );

    expect(environment).toMatchObject({
      EXISTING_VALUE: "preserved",
      ATHAS_DEV_CODE_SIGN_IDENTIFIER: "com.code.athas.preview",
      CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER: path.join(
        repoRoot,
        "scripts/dev/macos-dev-runner.zsh",
      ),
    });
  });

  it("configures the native Intel Cargo runner", () => {
    const environment = withMacosDevSigning(
      {},
      {
        arch: "x64",
        identifier: "com.code.athas.preview",
        platform: "darwin",
        repoRoot,
      },
    );

    expect(environment.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER).toBe(
      path.join(repoRoot, "scripts/dev/macos-dev-runner.zsh"),
    );
  });

  it("leaves non-macOS environments unchanged", () => {
    const environment = { EXISTING_VALUE: "preserved" };

    expect(
      withMacosDevSigning(environment, {
        identifier: "com.code.athas.preview",
        platform: "linux",
        repoRoot,
      }),
    ).toBe(environment);
  });
});
