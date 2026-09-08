import type { TeamWorkspace } from "../types/team-workspace";

export const TEAM_WORKSPACE_FILE = "athas.workspace.json";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, keys: string[]) {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`Unknown team workspace field: ${unknown}`);
}

export function parseTeamWorkspace(content: string): TeamWorkspace {
  if (content.length > 100_000) throw new Error("Team workspace exceeds 100 KB.");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`${TEAM_WORKSPACE_FILE} must contain valid JSON.`);
  }
  if (!record(value) || value.version !== 1) {
    throw new Error("Team workspace version must be 1.");
  }
  assertKeys(value, [
    "version",
    "name",
    "instructions",
    "commands",
    "description",
    "repositories",
    "recommendedExtensions",
  ]);
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 120) {
    throw new Error("Enter a team workspace name of up to 120 characters.");
  }
  if (typeof value.instructions !== "string" || value.instructions.length > 20_000) {
    throw new Error("AI instructions must be text of up to 20,000 characters.");
  }
  if (!Array.isArray(value.commands) || value.commands.length > 40) {
    throw new Error("A team workspace can contain up to 40 commands.");
  }
  const names = new Set<string>();
  const commands = value.commands.map((entry: unknown) => {
    if (!record(entry)) throw new Error("Each team command must be an object.");
    assertKeys(entry, ["name", "command", "workingDirectory"]);
    if (typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 120) {
      throw new Error("Each command needs a name of up to 120 characters.");
    }
    const name = entry.name.trim();
    if (names.has(name.toLowerCase())) throw new Error(`Duplicate command name: ${name}`);
    names.add(name.toLowerCase());
    if (
      typeof entry.command !== "string" ||
      !entry.command.trim() ||
      entry.command.length > 4_000 ||
      entry.command.includes("\0")
    ) {
      throw new Error(`Enter a command of up to 4,000 characters for ${name}.`);
    }
    if (entry.workingDirectory !== undefined && typeof entry.workingDirectory !== "string") {
      throw new Error(`Working directory for ${name} must be text.`);
    }
    const directory =
      (entry.workingDirectory as string | undefined)?.trim().replace(/\\/g, "/") || ".";
    if (
      directory.startsWith("/") ||
      directory.includes(":") ||
      directory.split("/").includes("..") ||
      Array.from(directory).some((character) => character.charCodeAt(0) < 32)
    ) {
      throw new Error(`Working directory for ${name} must be a relative path inside the project.`);
    }
    return { name, command: entry.command.trim(), workingDirectory: directory };
  });
  const extra: Pick<TeamWorkspace, "description" | "repositories" | "recommendedExtensions"> = {};
  if (value.description !== undefined) {
    if (typeof value.description !== "string" || value.description.length > 2_000)
      throw new Error("Description must be text of up to 2,000 characters.");
    extra.description = value.description.trim();
  }
  if (value.repositories !== undefined) {
    if (!Array.isArray(value.repositories) || value.repositories.length > 40)
      throw new Error("A workspace can contain up to 40 repositories.");
    const ids = new Set<string>();
    extra.repositories = value.repositories.map((entry: unknown) => {
      if (!record(entry)) throw new Error("Each repository must be an object.");
      assertKeys(entry, ["id", "name", "url"]);
      if (
        typeof entry.id !== "string" ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(entry.id) ||
        ids.has(entry.id)
      )
        throw new Error("Each repository needs a unique ID.");
      ids.add(entry.id);
      if (typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 120)
        throw new Error("Each repository needs a name of up to 120 characters.");
      if (entry.url !== undefined && (typeof entry.url !== "string" || entry.url.length > 2_000))
        throw new Error("Repository URL must be text.");
      const url = (entry.url as string | undefined)?.trim();
      if (url) {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("Use an HTTPS repository URL.");
        }
        if (
          parsed.protocol !== "https:" ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash
        )
          throw new Error("Use an HTTPS repository URL without credentials or query parameters.");
      }
      return { id: entry.id, name: entry.name.trim(), ...(url ? { url } : {}) };
    });
  }
  if (value.recommendedExtensions !== undefined) {
    if (
      !Array.isArray(value.recommendedExtensions) ||
      value.recommendedExtensions.length > 100 ||
      value.recommendedExtensions.some(
        (id: unknown) => typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(id),
      )
    )
      throw new Error("Use up to 100 valid extension IDs.");
    extra.recommendedExtensions = [...new Set(value.recommendedExtensions as string[])];
  }
  return {
    version: 1,
    name: value.name.trim(),
    instructions: value.instructions.trim(),
    commands,
    ...extra,
  };
}

export function createTeamWorkspace(name: string): TeamWorkspace {
  return { version: 1, name, instructions: "", commands: [] };
}
