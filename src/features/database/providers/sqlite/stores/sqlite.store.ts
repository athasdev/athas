import { createSqlStore } from "../../sql/stores/create-sql.store";

export const createSqliteStore = () => createSqlStore("sqlite", "file");
