import { createFileSqlViewer } from "../sql/sql-provider-viewer";
import { createSqliteStore } from "./stores/sqlite.store";

export default createFileSqlViewer("sqlite", createSqliteStore);
