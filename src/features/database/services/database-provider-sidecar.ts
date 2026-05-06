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

export function getProviderIdForCommand(command: string): DatabaseType {
  const match = COMMAND_PROVIDER_PREFIXES.find(([prefix]) => command.includes(prefix));

  if (!match) {
    throw new Error(`Cannot resolve database provider for command ${command}`);
  }

  return match[1];
}

export async function invokeDatabaseProvider<T>(
  command: string,
  payload: Record<string, unknown>,
  providerId = getProviderIdForCommand(command),
): Promise<T> {
  return invoke<T>("run_database_provider_command", {
    providerId,
    command,
    payload,
  });
}
