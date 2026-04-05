import SqlDatabaseViewer from "../sql/sql-database-viewer";
import { useMysqlStore } from "./stores/mysql-store";

interface MySQLViewerProps {
  connectionId: string;
}

export default function MySQLViewer({ connectionId }: MySQLViewerProps) {
  return (
    <SqlDatabaseViewer connectionId={connectionId} databaseType="mysql" useStore={useMysqlStore} />
  );
}
