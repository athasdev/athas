import { Database, Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useConnectionStore } from "@/features/database/stores/connection-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
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
        description="Manage saved database connections for network databases."
      >
        <SettingRow
          label="New Connection"
          description="Open the database connection dialog to add a new saved connection or open a SQLite file."
        >
          <Button
            onClick={() => setIsDatabaseConnectionVisible(true)}
            variant="secondary"
            size="xs"
            className="gap-1.5"
          >
            <Plus />
            Connect
          </Button>
        </SettingRow>
      </Section>

      <Section
        title="Saved Connections"
        description="SQLite files open directly and are not stored here. Saved entries are used for PostgreSQL, MySQL, MongoDB, and Redis."
      >
        {isLoadingSaved ? (
          <div className="ui-font ui-text-sm px-1 py-2 text-text-lighter">
            Loading saved connections...
          </div>
        ) : savedConnections.length === 0 ? (
          <div className="ui-font ui-text-sm rounded-xl border border-border/60 bg-secondary-bg/40 px-4 py-3 text-text-lighter">
            No saved database connections yet.
          </div>
        ) : (
          <div className="space-y-2">
            {savedConnections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-secondary-bg/40 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Database className="text-text-lighter" />
                    <div className="ui-font ui-text-sm truncate text-text">{connection.name}</div>
                    <Badge variant="default" shape="pill" size="compact" className="uppercase">
                      {formatDbType(connection.db_type)}
                    </Badge>
                  </div>
                  <div className="ui-font ui-text-sm mt-1 truncate text-text-lighter">
                    {connection.host}:{connection.port}
                    {connection.database ? ` / ${connection.database}` : ""}
                  </div>
                </div>
                <Button
                  onClick={() => void deleteConnection(connection.id)}
                  variant="danger"
                  size="xs"
                  className="gap-1.5"
                >
                  <Trash2 />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};
