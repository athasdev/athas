// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDatabaseBrandImage } from "@/ui/brand-marks";
import { DatabaseSidebar } from "../components/database-sidebar";
import { useConnectionStore, type SavedConnection } from "../stores/connection.store";

const mocks = vi.hoisted(() => ({
  openDatabaseBuffer: vi.fn(),
  getAllProjectFiles: vi.fn(),
  open: vi.fn(),
  rootFolderPath: "/workspace" as string | null,
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: Object.assign(() => undefined, {
    use: { actions: () => ({ openDatabaseBuffer: mocks.openDatabaseBuffer }) },
  }),
}));
vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: (select: (state: unknown) => unknown) =>
    select({ ...mocks, filesVersion: 0 }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

const saved: SavedConnection = {
  id: "local",
  name: "Local database",
  db_type: "sqlite",
  workspace_path: "/workspace",
  file_path: "/workspace/local.sqlite",
  host: "",
  port: 0,
  database: "",
  username: "",
};
const actions = {
  loadSavedConnections: vi.fn(),
  connect: vi.fn(),
  deleteConnection: vi.fn(),
  getCredential: vi.fn(),
  saveConnection: vi.fn(),
  storeCredential: vi.fn(),
};
let root: Root;
let container: HTMLDivElement;
const originalActions = useConnectionStore.getState().actions;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.rootFolderPath = "/workspace";
  mocks.getAllProjectFiles.mockResolvedValue([
    { name: "detected.db", path: "/workspace/detected.db", isDir: false },
  ]);
  actions.loadSavedConnections.mockResolvedValue(undefined);
  actions.saveConnection.mockResolvedValue(undefined);
  actions.connect.mockResolvedValue("remote");
  actions.getCredential.mockResolvedValue("stored-password");
  useConnectionStore.setState({
    savedConnections: [
      saved,
      { ...saved, id: "other", name: "Other workspace", workspace_path: "/other" },
    ],
    activeConnections: [],
    isLoadingSaved: false,
    actions: { ...originalActions, ...actions },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useConnectionStore.setState({ actions: originalActions });
});

const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.startsWith(name),
  )!;

async function render() {
  await act(async () => root.render(<DatabaseSidebar />));
}

describe("database sidebar", () => {
  it("opens saved and detected workspace databases while keeping navigation available", async () => {
    await render();
    expect(container.textContent).not.toContain("Other workspace");
    await act(async () => button("Local database").click());
    expect(mocks.openDatabaseBuffer).toHaveBeenCalledWith(
      "/workspace/local.sqlite",
      "Local database",
      "sqlite",
    );
    await act(async () => button("detected.db").click());
    expect(mocks.openDatabaseBuffer).toHaveBeenCalledWith(
      "/workspace/detected.db",
      "detected.db",
      "sqlite",
    );
    expect(button("Add database")).toBeDefined();
    expect(button("Local database")).toBeDefined();
  });

  it("reuses saved credentials when opening a network connection", async () => {
    const connection = {
      ...saved,
      id: "remote",
      name: "Remote",
      db_type: "postgres" as const,
      file_path: undefined,
      host: "localhost",
      port: 5432,
      database: "app",
    };
    useConnectionStore.setState({ savedConnections: [connection] });
    await render();
    await act(async () => button("Remote").click());
    expect(actions.connect).toHaveBeenCalledWith(connection, "stored-password");
    expect(mocks.openDatabaseBuffer).toHaveBeenCalledWith(
      "connection://remote",
      "Remote",
      "postgres",
      "remote",
    );
    expect(button("Remote")).toBeDefined();
  });

  it("adds a file database to the current workspace and returns to its list", async () => {
    mocks.open.mockResolvedValue("/workspace/new.sqlite");
    await render();
    await act(async () => button("Add database").click());
    await act(async () => button("SQLite").click());
    await act(async () => button("Choose database file").click());
    expect(actions.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ file_path: "/workspace/new.sqlite", workspace_path: "/workspace" }),
    );
    expect(mocks.openDatabaseBuffer).toHaveBeenCalledWith(
      "/workspace/new.sqlite",
      "new.sqlite",
      "sqlite",
    );
    expect(button("Local database")).toBeDefined();
  });

  it("reports connection failures without losing the database list", async () => {
    const connection = {
      ...saved,
      id: "remote",
      name: "Remote",
      db_type: "postgres" as const,
      file_path: undefined,
    };
    useConnectionStore.setState({ savedConnections: [connection] });
    actions.connect.mockRejectedValueOnce(new Error("Connection refused"));
    await render();
    await act(async () => button("Remote").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Connection refused");
    expect(button("Remote").disabled).toBe(false);
  });

  it("shows compact providers in one list and returns from setup to the provider chooser", async () => {
    await render();
    await act(async () => button("Add database").click());
    expect(container.textContent).not.toContain("Local files");
    expect(container.textContent).not.toContain("Servers");
    for (const name of ["SQLite", "DuckDB", "PostgreSQL", "MySQL", "MongoDB", "Redis"]) {
      expect(button(name).textContent).toBe(name);
    }
    expect(button("SQLite").querySelector("img")?.getAttribute("src")).toBe(
      getDatabaseBrandImage("sqlite"),
    );
    expect(container.querySelector('[aria-label="Add database"]')).toBeNull();
    await act(async () => button("PostgreSQL").click());
    expect(container.querySelector('input[id="database-sidebar-host"]')).not.toBeNull();
    await act(async () => button("Back to database providers").click());
    expect(button("SQLite")).toBeDefined();
    await act(async () => button("Back to databases").click());
    expect(button("Local database")).toBeDefined();
  });

  it("filters databases and providers independently from the header", async () => {
    await render();
    const filter = () => container.querySelector<HTMLInputElement>('input[placeholder^="Filter"]')!;
    const typeFilter = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          filter(),
          value,
        );
        filter().dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await typeFilter("local");
    expect(button("Local database")).toBeDefined();
    expect(button("detected.db")).toBeUndefined();
    await act(async () => button("Add database").click());
    expect(filter().value).toBe("");
    await typeFilter("post");
    expect(button("PostgreSQL")).toBeDefined();
    expect(button("SQLite")).toBeUndefined();
    await act(async () => button("PostgreSQL").click());
    await act(async () => button("Back to database providers").click());
    expect(filter().value).toBe("post");
    await typeFilter("unknown");
    expect(container.textContent).toContain("No matching providers.");
    await act(async () => button("Clear filter").click());
    expect(button("SQLite")).toBeDefined();
    expect(document.activeElement).toBe(filter());
    await act(async () => button("Back to databases").click());
    expect(filter().value).toBe("local");
    await act(async () => {
      filter().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(button("detected.db")).toBeDefined();
  });

  it("shows providers immediately without filtering in an empty workspace", async () => {
    useConnectionStore.setState({ savedConnections: [] });
    mocks.getAllProjectFiles.mockResolvedValue([]);
    await render();
    expect(container.querySelector("input")).toBeNull();
    expect(button("Add database")).toBeUndefined();
    for (const provider of ["SQLite", "DuckDB", "PostgreSQL", "MySQL", "MongoDB", "Redis"]) {
      expect(button(provider)).toBeDefined();
    }
    await act(async () => button("PostgreSQL").click());
    expect(container.querySelector('form[aria-label="PostgreSQL connection"]')).not.toBeNull();
    await act(async () => button("Back to database providers").click());
    expect(container.querySelector("input")).toBeNull();
    expect(button("SQLite")).toBeDefined();
    expect(button("Back to databases")).toBeUndefined();
  });

  it("does not mistake filtered results for an empty workspace", async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filter databases"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "missing",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No matching databases.");
    expect(button("SQLite")).toBeUndefined();
    expect(input.isConnected).toBe(true);
    await act(async () => button("Clear filter").click());
    expect(button("Local database")).toBeDefined();
  });

  it("submits network connection fields and disables the form while connecting", async () => {
    let finishConnection!: (id: string) => void;
    actions.connect.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishConnection = resolve;
        }),
    );
    await render();
    await act(async () => button("Add database").click());
    await act(async () => button("PostgreSQL").click());
    await act(async () => {
      for (const [name, value] of Object.entries({
        name: "App",
        host: "db.example.test",
        port: "5433",
        database: "app",
        username: "alice",
        password: "secret",
      })) {
        const input = container.querySelector<HTMLInputElement>(`#database-sidebar-${name}`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => button("Add database").click());
    expect(actions.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "App",
        host: "db.example.test",
        port: 5433,
        database: "app",
        username: "alice",
        db_type: "postgres",
        workspace_path: "/workspace",
      }),
      "secret",
    );
    expect(button("Connecting…").disabled).toBe(true);
    expect([...container.querySelectorAll("fieldset")].every((fieldset) => fieldset.disabled)).toBe(
      true,
    );
    await act(async () => finishConnection("new-connection"));
    expect(mocks.openDatabaseBuffer).toHaveBeenCalledWith(
      "connection://new-connection",
      "App",
      "postgres",
      "new-connection",
    );
    expect(button("Local database")).toBeDefined();
  });

  it("requires a workspace before adding a database", async () => {
    mocks.rootFolderPath = null;
    await render();
    expect(button("Add database")).toBeUndefined();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("Open a workspace to add databases.");
  });
});
