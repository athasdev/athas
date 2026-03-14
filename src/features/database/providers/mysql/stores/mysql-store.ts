import { createSqlStore } from "../../sql/create-sql-store";

export const useMysqlStore = createSqlStore("mysql", "connection");
