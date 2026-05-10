import type { DatabaseType } from "../../models/provider.types";
import type { SqlDatabaseActions, SqlDatabaseState } from "./create-sql-store";
import SqlDatabaseViewer from "./sql-database-viewer";

type SqlStoreHook = () => SqlDatabaseState & { actions: SqlDatabaseActions };

export interface FileSqlViewerProps {
  databasePath: string;
}

export interface ConnectionSqlViewerProps {
  connectionId: string;
}

export function createFileSqlViewer(databaseType: DatabaseType, useStore: SqlStoreHook) {
  return function FileSqlViewer({ databasePath }: FileSqlViewerProps) {
    return (
      <SqlDatabaseViewer
        databasePath={databasePath}
        databaseType={databaseType}
        useStore={useStore}
      />
    );
  };
}

export function createConnectionSqlViewer(databaseType: DatabaseType, useStore: SqlStoreHook) {
  return function ConnectionSqlViewer({ connectionId }: ConnectionSqlViewerProps) {
    return (
      <SqlDatabaseViewer
        connectionId={connectionId}
        databaseType={databaseType}
        useStore={useStore}
      />
    );
  };
}
