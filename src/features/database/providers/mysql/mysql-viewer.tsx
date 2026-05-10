import { createConnectionSqlViewer } from "../sql/sql-provider-viewer";
import { useMysqlStore } from "./stores/mysql-store";

export default createConnectionSqlViewer("mysql", useMysqlStore);
