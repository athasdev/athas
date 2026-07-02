import { PlusIcon as Plus, TrashIcon as Trash2 } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useConnectionStore } from "@/features/database/stores/connection.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import Section, { SettingRow } from "../settings-section";

const formatDbType = (dbType: string) => {
  switch (dbType) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "mongodb":
      return "MongoDB";
    case "redis":
      return "Redis";
    case "sqlite":
      return "SQLite";
    case "duckdb":
      return "DuckDB";
    default:
      return dbType;
  }
};

export const DatabaseSettings = () => {
  const savedConnections = useConnectionStore.use.savedConnections();
  const isLoadingSaved = useConnectionStore.use.isLoadingSaved();
  const { loadSavedConnections, deleteConnection } = useConnectionStore.use.actions();
  const { setIsDatabaseConnectionVisible } = useUIState();

  useEffect(() => {
    void loadSavedConnections();
  }, [loadSavedConnections]);

  return (
    <div className="space-y-4">
      <Section
        title="Connections"
        description="Manage saved database connections for the current workspace."
      >
        <SettingRow label="New Connection" description="Add a database to this workspace.">
          <Button onClick={() => setIsDatabaseConnectionVisible(true)} variant="default" compact>
            <Plus />
            Connect
          </Button>
        </SettingRow>
      </Section>

      <Section
        title="Saved Connections"
        description="Saved entries are scoped to the workspace they were added from."
      >
        {isLoadingSaved ? (
          <div className="ui-font ui-text-base px-1 py-2 text-text-lighter">
            <LoadingIndicator label="Loading saved connections" showLabel compact />
          </div>
        ) : savedConnections.length === 0 ? (
          <div className="ui-font ui-text-base rounded-xl border border-border/60 bg-secondary-bg/40 px-4 py-3 text-text-lighter">
            No saved database connections yet.
          </div>
        ) : (
          <div className="space-y-2">
            {savedConnections.map((connection) => (
              <SettingRow
                key={connection.id}
                label={connection.name}
                labelAccessory={
                  <Badge variant="default" size="compact" className="uppercase">
                    {formatDbType(connection.db_type)}
                  </Badge>
                }
                description={
                  connection.file_path
                    ? connection.file_path
                    : `${connection.host}:${connection.port}${connection.database ? ` / ${connection.database}` : ""}`
                }
                activateOnClick={false}
              >
                <Button
                  onClick={() => void deleteConnection(connection.id)}
                  variant="danger"
                  compact
                >
                  <Trash2 />
                  Remove
                </Button>
              </SettingRow>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};
