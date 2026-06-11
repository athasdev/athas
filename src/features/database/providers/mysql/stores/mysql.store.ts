import { createSqlStore } from "../../sql/stores/create-sql.store";

export const useMysqlStore = createSqlStore("mysql", "connection");
