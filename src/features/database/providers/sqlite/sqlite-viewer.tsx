import { createFileSqlViewer } from "../sql/sql-provider-viewer";
import { useSqliteStore } from "./stores/sqlite.store";

export default createFileSqlViewer("sqlite", useSqliteStore);
