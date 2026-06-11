import { PROVIDER_REGISTRY } from "../../providers/provider-registry";
import type { SavedConnection } from "../../stores/connection.store";
import type { ConnectionValidationInput } from "./connection-validation";

type ConnectionConfigInput = Pick<
  ConnectionValidationInput,
  "dbType" | "mode" | "host" | "port" | "database" | "connectionString" | "filePath"
> & {
  name: string;
  username: string;
  workspacePath?: string;
};

export function buildSavedConnectionConfig(
  input: ConnectionConfigInput,
  id?: string,
): SavedConnection {
  const provider = PROVIDER_REGISTRY[input.dbType];
  const defaultPort = provider.defaultPort ?? 0;
  const name = input.name.trim() || `${provider.label} Connection`;
  const normalizedId = id?.trim() || `${input.dbType}-${Date.now()}`;
  const workspacePath = input.workspacePath?.trim();

  if (provider.isFileBased) {
    return {
      id: normalizedId,
      name,
      db_type: input.dbType,
      ...(workspacePath ? { workspace_path: workspacePath } : {}),
      file_path: input.filePath.trim(),
      host: "",
      port: 0,
      database: "",
      username: "",
      connection_string: undefined,
    };
  }

  const normalizedPort =
    Number.isInteger(input.port) && input.port >= 1 && input.port <= 65535
      ? input.port
      : defaultPort;

  return {
    id: normalizedId,
    name,
    db_type: input.dbType,
    ...(workspacePath ? { workspace_path: workspacePath } : {}),
    host: input.host.trim(),
    port: normalizedPort,
    database: input.database.trim(),
    username: input.username.trim(),
    connection_string: input.mode === "string" ? input.connectionString.trim() : undefined,
  };
}
