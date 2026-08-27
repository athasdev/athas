import path from "node:path";

interface MacosDevSigningOptions {
  arch?: NodeJS.Architecture;
  identifier: string;
  platform?: NodeJS.Platform;
  repoRoot?: string;
}

export function withMacosDevSigning(
  environment: NodeJS.ProcessEnv,
  options: MacosDevSigningOptions,
): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return environment;

  const arch = options.arch ?? process.arch;
  const target = arch === "arm64" ? "AARCH64_APPLE_DARWIN" : "X86_64_APPLE_DARWIN";
  const repoRoot = options.repoRoot ?? path.resolve(import.meta.dirname, "../..");

  return {
    ...environment,
    [`CARGO_TARGET_${target}_RUNNER`]: path.join(repoRoot, "scripts/dev/macos-dev-runner.zsh"),
    ATHAS_DEV_CODE_SIGN_IDENTIFIER: options.identifier,
  };
}
