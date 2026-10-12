// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return { open: vi.fn() };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: vi.fn() }));

import { commands, type SavedConnection } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { ConnectionDialog } from "../components/connection/connection-dialog";
import { useConnectionStore } from "../stores/connection.store";

enableMapSet();

let root: Root;
let container: HTMLDivElement;
let onClose = vi.fn<() => void>();
let savedRows: SavedConnection[];

const body = () => within(document.body);
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

function button(name: string) {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );
  if (!match) throw new Error(`No button ${name}`);
  return match;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function type(id: string, value: string) {
  await act(async () => {
    fireEvent.change(field(id), { target: { value } });
  });
}

async function render() {
  await act(async () => root.render(<ConnectionDialog isOpen onClose={onClose} />));
  await flush();
}

async function chooseType(label: string) {
  const trigger = [...document.querySelectorAll<HTMLElement>('[role="combobox"]')][0];
  await click(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!option) throw new Error(`No option ${label}`);
  await click(option);
}

const errorText = () => document.querySelector('[data-slot="marker"]')?.textContent ?? null;
const databaseBuffers = () =>
  useBufferStore
    .getState()
    .buffers.filter((buffer) => buffer.type === "database")
    .map((buffer) => ({ path: buffer.path, name: buffer.name }));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useProjectStore.setState({ rootFolderPath: "/work/app" });
  useConnectionStore.setState({ savedConnections: [], activeConnections: [] });
  savedRows = [];
  onClose = vi.fn<() => void>();
  mocks.open.mockReset();
  vi.spyOn(commands, "saveConnection").mockImplementation(async (connection) => {
    savedRows.push(connection);
    return null as never;
  });
  vi.spyOn(commands, "listSavedConnections").mockImplementation(async () => savedRows);
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("database connection dialog", () => {
  it("renders nothing while closed", async () => {
    await act(async () => root.render(<ConnectionDialog isOpen={false} onClose={onClose} />));

    expect(document.body.textContent).toBe("");
  });

  it("requires a file for SQLite and opens the chosen database", async () => {
    mocks.open.mockResolvedValue("/work/app/data/app.sqlite");
    await render();

    expect(button("Open database").disabled).toBe(true);
    expect(body().queryByRole("button", { name: "Test connection" })).toBeNull();

    await click(button("Browse"));
    expect(field("db-conn-file").value).toBe("/work/app/data/app.sqlite");
    expect(field("db-conn-name").value).toBe("app.sqlite");

    await click(button("Open database"));

    expect(savedRows).toEqual([
      expect.objectContaining({
        name: "app.sqlite",
        db_type: "sqlite",
        file_path: "/work/app/data/app.sqlite",
        workspace_path: "/work/app",
      }),
    ]);
    expect(databaseBuffers()).toEqual([{ path: "/work/app/data/app.sqlite", name: "app.sqlite" }]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a typed name when browsing for a file", async () => {
    mocks.open.mockResolvedValueOnce(null).mockResolvedValueOnce("/tmp/cache.db");
    await render();
    await type("db-conn-name", "Cache");

    await click(button("Browse"));
    expect(field("db-conn-file").value).toBe("");

    await click(button("Browse"));
    expect(field("db-conn-name").value).toBe("Cache");
  });

  it("validates server fields before allowing a connection", async () => {
    await render();
    await chooseType("PostgreSQL");

    expect(field("db-conn-port").value).toBe("5432");
    expect(button("Connect").disabled).toBe(true);

    await click(button("Test connection"));
    expect(errorText()).toBe("Enter a database name");

    await type("db-conn-database", "app");
    expect(errorText()).toBeNull();
    await type("db-conn-port", "70000");
    await click(button("Test connection"));
    expect(errorText()).toBe("Enter a valid port");

    await type("db-conn-port", "5433");
    await type("db-conn-host", " ");
    expect(button("Connect").disabled).toBe(true);
    await type("db-conn-host", "db.internal");
    expect(button("Connect").disabled).toBe(false);
  });

  it("tests the connection with the typed password", async () => {
    const test = vi.spyOn(commands, "testConnection").mockResolvedValueOnce(null as never);
    await render();
    await chooseType("PostgreSQL");
    await type("db-conn-database", "app");
    await type("db-conn-username", "athas");
    await type("db-conn-password", "s3cret");

    await click(button("Test connection"));

    expect(test).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "localhost",
        port: 5432,
        database: "app",
        username: "athas",
      }),
      "s3cret",
    );
    expect(body().getByText("Connection test successful")).toBeTruthy();

    await type("db-conn-host", "db.internal");
    expect(body().queryByText("Connection test successful")).toBeNull();
  });

  it("shows why a connection test failed", async () => {
    vi.spyOn(commands, "testConnection").mockRejectedValueOnce(
      new Error("password authentication failed for user athas"),
    );
    await render();
    await chooseType("PostgreSQL");
    await type("db-conn-database", "app");

    await click(button("Test connection"));

    expect(errorText()).toBe("password authentication failed for user athas");
  });

  it("saves, stores the password, connects and opens the connection", async () => {
    const storeCredential = vi
      .spyOn(commands, "storeDbCredential")
      .mockResolvedValue(null as never);
    const connect = vi.spyOn(commands, "connectDatabase").mockResolvedValue(null as never);
    await render();
    await chooseType("MySQL");
    await type("db-conn-name", "Orders");
    await type("db-conn-database", "orders");
    await type("db-conn-password", "pw");
    await click(body().getByRole("checkbox", { name: "Save password securely" }));

    await click(button("Connect"));

    const saved = savedRows[0];
    expect(saved).toMatchObject({ name: "Orders", db_type: "mysql", port: 3306 });
    expect(storeCredential).toHaveBeenCalledWith(saved.id, "pw");
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ database: "orders", port: 3306 }),
      "pw",
    );
    expect(useConnectionStore.getState().activeConnections).toEqual([
      expect.objectContaining({ id: saved.id, name: "Orders", status: "connected" }),
    ]);
    expect(databaseBuffers()).toEqual([{ path: `connection://${saved.id}`, name: "Orders" }]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("connects with a connection string and keeps the dialog open on failure", async () => {
    vi.spyOn(commands, "connectDatabase").mockRejectedValueOnce(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    await chooseType("PostgreSQL");

    await click(body().getByRole("tab", { name: "Connection string mode" }));
    expect(field("db-conn-host")).toBeNull();
    expect(button("Connect").disabled).toBe(true);
    await type("db-conn-string", "postgres://u:p@db:5432/app");
    await click(button("Connect"));

    expect(savedRows[0]).toMatchObject({ connection_string: "postgres://u:p@db:5432/app" });
    expect(errorText()).toBe("connection refused");
    expect(onClose).not.toHaveBeenCalled();
    expect(databaseBuffers()).toEqual([]);
  });

  it("omits the database field for Redis", async () => {
    await render();
    await chooseType("Redis");

    expect(field("db-conn-database")).toBeNull();
    expect(field("db-conn-port").value).toBe("6379");
    expect(button("Connect").disabled).toBe(false);
  });
});
