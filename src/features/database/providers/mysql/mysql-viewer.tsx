import { createConnectionSqlViewer } from "../sql/sql-provider-viewer";
import { createMysqlStore } from "./stores/mysql.store";

export default createConnectionSqlViewer("mysql", createMysqlStore);
