import { createSqlStore } from "../../sql/stores/create-sql.store";

export const createPostgresStore = () => createSqlStore("postgres", "connection");
