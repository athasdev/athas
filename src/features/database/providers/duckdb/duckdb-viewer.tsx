import SqlDatabaseViewer from "../sql/sql-database-viewer";
import { useDuckdbStore } from "./stores/duckdb-store";

interface DuckDBViewerProps {
  databasePath: string;
}

export default function DuckDBViewer({ databasePath }: DuckDBViewerProps) {
  return (
    <SqlDatabaseViewer
      databasePath={databasePath}
      databaseType="duckdb"
      useStore={useDuckdbStore}
    />
  );
}
