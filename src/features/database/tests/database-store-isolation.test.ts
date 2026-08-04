import { describe, expect, it } from "vite-plus/test";
import { createMongoDbStore } from "@/features/database/providers/mongodb/stores/mongodb.store";
import { createRedisStore } from "@/features/database/providers/redis/stores/redis.store";
import { createSqlStore } from "@/features/database/providers/sql/stores/create-sql.store";

describe("database viewer store isolation", () => {
  it("keeps SQL viewer instances independent", () => {
    const firstStore = createSqlStore("sqlite", "file");
    const secondStore = createSqlStore("sqlite", "file");

    firstStore.setState({ databasePath: "/tmp/first.sqlite", selectedTable: "users" });
    secondStore.setState({ databasePath: "/tmp/second.sqlite", selectedTable: "events" });
    firstStore.getState().actions.reset();

    expect(secondStore.getState()).toMatchObject({
      databasePath: "/tmp/second.sqlite",
      selectedTable: "events",
    });
  });

  it("keeps MongoDB viewer instances independent", () => {
    const firstStore = createMongoDbStore();
    const secondStore = createMongoDbStore();

    firstStore.setState({ connectionId: "mongo-first", selectedDatabase: "app" });
    secondStore.setState({ connectionId: "mongo-second", selectedDatabase: "analytics" });
    firstStore.getState().actions.reset();

    expect(secondStore.getState()).toMatchObject({
      connectionId: "mongo-second",
      selectedDatabase: "analytics",
    });
  });

  it("keeps Redis viewer instances independent", () => {
    const firstStore = createRedisStore();
    const secondStore = createRedisStore();

    firstStore.setState({ connectionId: "redis-first", selectedKey: "session:first" });
    secondStore.setState({ connectionId: "redis-second", selectedKey: "session:second" });
    firstStore.getState().actions.reset();

    expect(secondStore.getState()).toMatchObject({
      connectionId: "redis-second",
      selectedKey: "session:second",
    });
  });
});
