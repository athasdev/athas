import { useState } from "react";
import type { DatabaseType } from "../../types/provider.types";
import type { SqlDatabaseActions, SqlDatabaseState } from "./stores/create-sql.store";
import SqlDatabaseViewer from "./sql-database-viewer";

type SqlStoreHook = () => SqlDatabaseState & { actions: SqlDatabaseActions };
type SqlStoreFactory = () => SqlStoreHook;

export interface FileSqlViewerProps {
  databasePath: string;
}

export interface ConnectionSqlViewerProps {
  connectionId: string;
}

export function createFileSqlViewer(databaseType: DatabaseType, createStore: SqlStoreFactory) {
  return function FileSqlViewer({ databasePath }: FileSqlViewerProps) {
    const [useStore] = useState(() => createStore());

    return (
      <SqlDatabaseViewer
        databasePath={databasePath}
        databaseType={databaseType}
        useStore={useStore}
      />
    );
  };
}

export function createConnectionSqlViewer(
  databaseType: DatabaseType,
  createStore: SqlStoreFactory,
) {
  return function ConnectionSqlViewer({ connectionId }: ConnectionSqlViewerProps) {
    const [useStore] = useState(() => createStore());

    return (
      <SqlDatabaseViewer
        connectionId={connectionId}
        databaseType={databaseType}
        useStore={useStore}
      />
    );
  };
}
