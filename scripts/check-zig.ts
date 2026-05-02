const REQUIRED_ZIG_VERSION = "0.16.0";

function parseVersion(version: string): [number, number, number] | null {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionAtLeast(version: string, minimum: string) {
  const current = parseVersion(version);
  const required = parseVersion(minimum);

  if (!current || !required) return false;

  for (let i = 0; i < 3; i += 1) {
    if (current[i] > required[i]) return true;
    if (current[i] < required[i]) return false;
  }

  return true;
}

const zigPath = Bun.which("zig");

if (!zigPath) {
  console.error(
    `Athas requires Zig ${REQUIRED_ZIG_VERSION}+ for Rust builds, but \`zig\` was not found in PATH.`,
  );
  console.error("Install Zig 0.16.x and try again.");
  process.exit(1);
}

const proc = Bun.spawn({
  cmd: [zigPath, "version"],
  stdout: "pipe",
  stderr: "pipe",
});

const version = (await new Response(proc.stdout).text()).trim();
const exitCode = await proc.exited;

if (exitCode !== 0 || !isVersionAtLeast(version, REQUIRED_ZIG_VERSION)) {
  console.error(
    `Athas requires Zig ${REQUIRED_ZIG_VERSION}+ for Rust builds, but found ${version || "an unknown version"} at ${zigPath}.`,
  );
  console.error("Upgrade Zig to 0.16.x and try again.");
  process.exit(1);
}
