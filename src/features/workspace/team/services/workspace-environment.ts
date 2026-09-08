import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import { joinPath } from "@/utils/path-helpers";

export interface WorkspaceEnvironmentInfo {
  kind: "local" | "remote" | "wsl";
  requirements: { name: string; version: string }[];
  files: string[];
}
export async function inspectWorkspaceEnvironment(root: string): Promise<WorkspaceEnvironmentInfo> {
  const provider = getWorkspaceResourceProvider(root);
  const entries = await provider.readDirectory(root, root);
  const files = entries.map((entry) => entry.name);
  const requirements: WorkspaceEnvironmentInfo["requirements"] = [];
  if (files.includes("package.json")) {
    const manifest = JSON.parse(await provider.readText(joinPath(root, "package.json"))) as {
      engines?: Record<string, unknown>;
      packageManager?: unknown;
    };
    for (const [name, version] of Object.entries(manifest.engines ?? {})) {
      if (typeof version === "string") requirements.push({ name, version });
    }
    if (typeof manifest.packageManager === "string")
      requirements.push({ name: "Package manager", version: manifest.packageManager });
  }
  if (files.includes("Cargo.toml")) requirements.push({ name: "Rust", version: "Cargo project" });
  if (files.includes("go.mod")) requirements.push({ name: "Go", version: "Go module" });
  if (files.includes("pyproject.toml"))
    requirements.push({ name: "Python", version: "Python project" });
  return { kind: provider.kind, requirements, files };
}
