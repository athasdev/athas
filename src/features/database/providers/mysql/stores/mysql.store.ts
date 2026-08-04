import { createSqlStore } from "../../sql/stores/create-sql.store";

export const createMysqlStore = () => createSqlStore("mysql", "connection");
