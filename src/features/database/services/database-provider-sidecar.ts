import { invoke } from "@tauri-apps/api/core";
import type { DatabaseType } from "../models/provider.types";

const COMMAND_PROVIDER_PREFIXES: Array<[string, DatabaseType]> = [
  ["sqlite", "sqlite"],
  ["duckdb", "duckdb"],
  ["postgres", "postgres"],
  ["mysql", "mysql"],
  ["mongo", "mongodb"],
  ["redis", "redis"],
];

function commandHasProviderToken(command: string, token: string): boolean {
  return (
    command === token ||
    command.startsWith(`${token}_`) ||
    command.endsWith(`_${token}`) ||
    command.includes(`_${token}_`)
  );
}

export function getProviderIdForCommand(command: string): DatabaseType {
  const matches = COMMAND_PROVIDER_PREFIXES.filter(([prefix]) =>
    commandHasProviderToken(command, prefix),
  );

  if (matches.length === 0) {
    throw new Error(`Cannot resolve database provider for command ${command}`);
  }

  if (matches.length > 1) {
    throw new Error(`Ambiguous database provider command ${command}`);
  }

  return matches[0][1];
}

export async function invokeDatabaseProvider<T>(
  command: string,
  payload: Record<string, unknown>,
  providerId?: DatabaseType,
): Promise<T> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    throw new Error("Database provider command is required");
  }
  const resolvedProviderId = (providerId ?? getProviderIdForCommand(normalizedCommand)).trim();
  if (!resolvedProviderId) {
    throw new Error("Database provider id is required");
  }

  return invoke<T>("run_database_provider_command", {
    providerId: resolvedProviderId,
    command: normalizedCommand,
    payload,
  });
}
