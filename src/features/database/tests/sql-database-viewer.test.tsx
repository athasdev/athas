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
  return {
    clipboard: [] as string[],
    invoke: vi.fn(),
  };
});

vi.mock("@/features/database/services/database-provider-sidecar", () => ({
  invokeDatabaseProvider: mocks.invoke,
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: async (text: string) => {
    mocks.clipboard.push(text);
  },
}));

import SqlDatabaseViewer from "../providers/sql/sql-database-viewer";
import { createSqlStore, type SqlDatabaseStore } from "../providers/sql/stores/create-sql.store";
import { useDatabaseContextMenuStore } from "../stores/database-context-menu.store";

enableMapSet();

const last = <T,>(items: T[]) => items[items.length - 1];

type Row = [number, string, number | null];
type Args = Record<string, unknown>;

interface FakeDatabase {
  tables: { name: string; kind?: string }[];
  users: Row[];
  teams: [number, string][];
  queryError?: string;
  loadError?: string;
}

let db: FakeDatabase;
let root: Root;
let container: HTMLDivElement;
let useStore: SqlDatabaseStore;

const body = () => within(document.body);
const calls = (command: string) =>
  mocks.invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as Args);

function filterRows<T extends unknown[]>(rows: T[], params: Args, columns: string[]) {
  let result = [...rows];
  const term = params.search_term as string | null;
  if (term) {
    result = result.filter((row) =>
      row.some((value) => String(value).toLowerCase().includes(term.toLowerCase())),
    );
  }
  for (const filter of (params.filters as { column: string; value: string }[]) ?? []) {
    const index = columns.indexOf(filter.column);
    result = result.filter((row) => String(row[index]) === filter.value);
  }
  const sortColumn = params.sort_column as string | null;
  if (sortColumn) {
    const index = columns.indexOf(sortColumn);
    const direction = params.sort_direction === "DESC" ? -1 : 1;
    result.sort((left, right) => (String(left[index]) > String(right[index]) ? 1 : -1) * direction);
  }
  const offset = params.offset as number;
  return {
    columns,
    rows: result.slice(offset, offset + (params.page_size as number)),
    total_count: result.length,
  };
}

function route(command: string, args: Args = {}): unknown {
  switch (command) {
    case "get_sqlite_tables":
      if (db.loadError) throw new Error(db.loadError);
      return db.tables;
    case "get_sqlite_foreign_keys":
      return args.table === "users"
        ? [{ from_column: "team_id", to_table: "teams", to_column: "id" }]
        : [];
    case "query_sqlite": {
      const query = String(args.query);
      if (query.startsWith("PRAGMA table_info")) {
        return query.includes("teams")
          ? {
              columns: [],
              rows: [
                [0, "id", "INTEGER", 1, null, 1],
                [1, "title", "TEXT", 1, null, 0],
              ],
            }
          : {
              columns: [],
              rows: [
                [0, "id", "INTEGER", 1, null, 1],
                [1, "name", "TEXT", 1, null, 0],
                [2, "team_id", "INTEGER", 0, null, 0],
              ],
            };
      }
      if (query.startsWith("PRAGMA user_version")) return { columns: ["v"], rows: [[3]] };
      if (query.includes("sqlite_master")) return { columns: ["n"], rows: [[1]] };
      if (db.queryError) throw new Error(db.queryError);
      return {
        columns: ["name"],
        rows: db.users
          .filter((row) => query.includes("WHERE") === row[1].startsWith("A"))
          .map((row) => [row[1]]),
      };
    }
    case "query_sqlite_filtered": {
      const params = args.params as Args;
      return params.table === "teams"
        ? filterRows(db.teams, params, ["id", "title"])
        : filterRows(db.users, params, ["id", "name", "team_id"]);
    }
    case "update_sqlite_row": {
      const row = db.users.find((candidate) => candidate[0] === args.whereValue)!;
      (args.setColumns as string[]).forEach((column, index) => {
        const value = (args.setValues as unknown[])[index];
        if (column === "name") row[1] = value as string;
        if (column === "team_id") row[2] = value as number | null;
      });
      return null;
    }
    case "insert_sqlite_row": {
      const values = Object.fromEntries(
        (args.columns as string[]).map((column, index) => [
          column,
          (args.values as unknown[])[index],
        ]),
      );
      db.users.push([Number(values.id), String(values.name), (values.team_id as number) ?? null]);
      return null;
    }
    case "delete_sqlite_row":
      db.users = db.users.filter((row) => row[0] !== args.whereValue);
      return null;
    case "execute_sqlite": {
      const statement = String(args.statement);
      const created = statement.match(/^CREATE TABLE "([^"]+)"/);
      if (created) db.tables.push({ name: created[1], kind: "table" });
      const dropped = statement.match(/^DROP TABLE "([^"]+)"/);
      if (dropped) db.tables = db.tables.filter((table) => table.name !== dropped[1]);
      return null;
    }
    default:
      throw new Error(`unexpected command ${command}`);
  }
}

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
    for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function render() {
  await act(async () =>
    root.render(
      <SqlDatabaseViewer
        databasePath="/data/app.sqlite"
        databaseType="sqlite"
        useStore={useStore}
      />,
    ),
  );
  await flush();
}

const grid = () => body().getByLabelText("Database rows");
const rowCount = () => grid().parentElement!.querySelector("span")?.textContent;
const columnValues = (column: number) =>
  [...grid().querySelectorAll("tbody tr:not([aria-hidden])")].map(
    (row) => row.querySelectorAll("td")[column + 1]?.textContent,
  );
const cell = (row: number, column: number) =>
  grid().querySelectorAll("tbody tr:not([aria-hidden])")[row].querySelectorAll("td")[column + 1];
const header = (name: string) =>
  [...grid().querySelectorAll("th")].find((th) => th.textContent?.startsWith(name))!;
const sqlEditor = () => document.querySelector("textarea") as HTMLTextAreaElement;

async function key(init: KeyboardEventInit) {
  await act(async () => {
    fireEvent.keyDown(grid(), init);
  });
  await flush();
}

async function openSqlEditor() {
  await click(button("Open SQL editor"));
}

async function typeSql(value: string) {
  await act(async () => {
    const editor = sqlEditor();
    editor.focus();
    fireEvent.change(editor, { target: { value, selectionStart: value.length } });
  });
  await flush();
}

async function rightClick(element: Element) {
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 10, clientY: 10 });
  });
  await flush();
}

async function chooseMenuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!item) throw new Error(`No menu item ${label}`);
  await click(item);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  db = {
    tables: [
      { name: "users", kind: "table" },
      { name: "teams", kind: "table" },
    ],
    users: [
      [1, "Ada", 10],
      [2, "Grace", 20],
      [3, "Linus", null],
    ],
    teams: [
      [10, "Compilers"],
      [20, "Kernels"],
    ],
  };
  mocks.clipboard.length = 0;
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string, args?: Args) => route(command, args));
  useStore = createSqlStore("sqlite", "file");
  useDatabaseContextMenuStore.getState().actions.setTableMenu(null);
  useDatabaseContextMenuStore.getState().actions.setRowMenu(null);
  localStorage.clear();
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  HTMLElement.prototype.setPointerCapture = () => {};
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
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
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SQL database viewer", () => {
  it("opens the first table with its rows and column types", async () => {
    await render();

    expect(body().getByText("Objects (2)")).toBeTruthy();
    expect(rowCount()).toBe("3 rows");
    expect(columnValues(1)).toEqual(["Ada", "Grace", "Linus"]);
    expect(header("name").textContent).toContain("TEXT NN");
    expect(header("id").textContent).toContain("INTEGER PK NN");
    expect(cell(2, 2).textContent).toBe("NULL");

    await click(button("Toggle column types"));
    expect(header("name").textContent).not.toContain("TEXT");
  });

  it("reports a database that cannot be opened", async () => {
    db.loadError = "file is not a database";
    await render();

    expect(body().getByText("Failed to load database: file is not a database")).toBeTruthy();
    expect(body().queryByLabelText("Database rows")).toBeNull();
  });

  it("shows an empty table", async () => {
    db.users = [];
    await render();

    expect(body().getByText("No data")).toBeTruthy();
  });

  it("searches rows after typing pauses and clears the search", async () => {
    await render();

    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Search..."), { target: { value: "gra" } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await flush();

    expect((last(calls("query_sqlite_filtered"))!.params as Args).search_term).toBe("gra");
    expect(columnValues(1)).toEqual(["Grace"]);

    await click(button("Clear search"));
    expect(columnValues(1)).toEqual(["Ada", "Grace", "Linus"]);
  });

  it("sorts by a column and flips the direction on the next click", async () => {
    await render();

    await click(header("name"));
    expect((last(calls("query_sqlite_filtered"))!.params as Args).sort_direction).toBe("ASC");

    await click(header("name"));
    expect(last(calls("query_sqlite_filtered"))!.params as Args).toMatchObject({
      sort_column: "name",
      sort_direction: "DESC",
    });
    expect(columnValues(1)).toEqual(["Linus", "Grace", "Ada"]);
  });

  it("adds a column filter from the header", async () => {
    await render();

    await click(button("Filter by name"));

    expect(body().getByPlaceholderText("value")).toBeTruthy();
    await click(button("Clear all filters"));
    expect(body().queryByPlaceholderText("value")).toBeNull();
  });

  it("edits a cell in place and saves it to the database", async () => {
    await render();

    await act(async () => {
      fireEvent.doubleClick(cell(1, 1));
    });
    const input = cell(1, 1).querySelector("input")!;
    expect(input.value).toBe("Grace");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Grace Hopper" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await flush();

    expect(last(calls("update_sqlite_row"))).toMatchObject({
      table: "users",
      setColumns: ["name"],
      setValues: ["Grace Hopper"],
      whereColumn: "id",
      whereValue: 2,
    });
    expect(columnValues(1)).toEqual(["Ada", "Grace Hopper", "Linus"]);
  });

  it("does not edit primary keys and abandons an edit on Escape", async () => {
    await render();

    await act(async () => {
      fireEvent.doubleClick(cell(0, 0));
    });
    expect(cell(0, 0).querySelector("input")).toBeNull();

    await act(async () => {
      fireEvent.doubleClick(cell(0, 1));
    });
    await act(async () => {
      fireEvent.keyDown(cell(0, 1).querySelector("input")!, { key: "Escape" });
    });
    await flush();
    expect(cell(0, 1).querySelector("input")).toBeNull();
    expect(calls("update_sqlite_row")).toEqual([]);
  });

  it("moves through cells with the keyboard and copies the selection", async () => {
    await render();

    await click(cell(0, 1));
    await key({ key: "ArrowDown", shiftKey: true });
    await key({ key: "ArrowRight", shiftKey: true });
    await act(async () => {
      fireEvent.keyDown(grid(), { key: "c", metaKey: true });
    });
    await flush();
    expect(last(mocks.clipboard)).toBe("Ada\t10\nGrace\t20");

    await act(async () => {
      fireEvent.keyDown(grid(), { key: "c", ctrlKey: true, shiftKey: true });
    });
    await flush();
    expect(last(mocks.clipboard)).toBe("name\tteam_id\nAda\t10\nGrace\t20");

    await key({ key: "Escape" });
    await key({ key: "c", metaKey: true });
    await flush();
    expect(mocks.clipboard).toHaveLength(2);
  });

  it("selects rows and the whole grid from the headers", async () => {
    await render();

    await click(grid().querySelector("tbody tr td")!);
    await act(async () => {
      fireEvent.keyDown(grid(), { key: "c", metaKey: true });
    });
    await flush();
    expect(last(mocks.clipboard)).toBe("1\tAda\t10");

    await click(body().getByLabelText("Select all visible cells"));
    await act(async () => {
      fireEvent.keyDown(grid(), { key: "c", metaKey: true });
    });
    await flush();
    expect(last(mocks.clipboard)?.split("\n")).toHaveLength(3);

    await key({ key: "Home", ctrlKey: true });
    await key({ key: "End", shiftKey: true });
    await key({ key: "c", metaKey: true });
    await flush();
    expect(last(mocks.clipboard)).toBe("1\tAda\t10");
  });

  it("starts editing the active cell with Enter and tabs between cells", async () => {
    await render();

    await click(cell(0, 0));
    await act(async () => {
      fireEvent.keyDown(grid(), { key: "Tab" });
    });
    await act(async () => {
      fireEvent.keyDown(grid(), { key: "Enter" });
    });
    await flush();

    expect(cell(0, 1).querySelector("input")?.value).toBe("Ada");
  });

  it("follows a foreign key to the referenced row", async () => {
    await render();

    await click(within(cell(0, 2)).getByRole("button"));

    expect(useStore.getState().selectedTable).toBe("teams");
    expect(useStore.getState().columnFilters).toEqual([
      { column: "id", operator: "equals", value: "10" },
    ]);
    expect(columnValues(1)).toEqual(["Compilers"]);
  });

  it("runs SQL from the editor and records it in history", async () => {
    await render();
    await openSqlEditor();

    expect(body().getByText("Cmd/Ctrl+Enter to run")).toBeTruthy();
    expect(button("Execute").disabled).toBe(true);
    await typeSql("SELECT name FROM users WHERE name LIKE 'A%'");
    await act(async () => {
      fireEvent.keyDown(sqlEditor(), { key: "Enter", metaKey: true });
    });
    await flush();

    expect(last(calls("query_sqlite"))).toEqual({
      path: "/data/app.sqlite",
      query: "SELECT name FROM users WHERE name LIKE 'A%'",
    });
    expect(rowCount()).toBe("1 query rows");
    expect(columnValues(0)).toEqual(["Ada"]);
    expect(body().getByText(/^Last run \d+ms$/)).toBeTruthy();
    expect(useStore.getState().sqlHistory).toEqual(["SELECT name FROM users WHERE name LIKE 'A%'"]);
    expect(button("Add row").disabled).toBe(true);

    await click(button("Cancel"));
    expect(sqlEditor()).toBeNull();
    expect(rowCount()).toBe("3 rows");
  });

  it("shows query errors", async () => {
    db.queryError = 'near "SELEC": syntax error';
    await render();
    await openSqlEditor();

    await typeSql("SELEC 1");
    await click(button("Execute"));

    expect(body().getByText('Query error: near "SELEC": syntax error')).toBeTruthy();
  });

  it("runs only the selected statement", async () => {
    await render();
    await openSqlEditor();
    await typeSql("SELECT name FROM users;\nSELECT 2;");

    await act(async () => {
      sqlEditor().setSelectionRange(0, 22);
      fireEvent.keyUp(sqlEditor(), { key: "Shift" });
    });
    expect(body().getByText("Selection will run")).toBeTruthy();
    await click(button("Run Selection"));

    expect(last(calls("query_sqlite"))?.query).toBe("SELECT name FROM users");
  });

  it("completes table names in the SQL editor", async () => {
    await render();
    await openSqlEditor();

    await typeSql("SELECT * FROM tea");
    await click(body().getByRole("button", { name: "Insert SQL table teams" }));

    expect(sqlEditor().value).toBe("SELECT * FROM teams");
  });

  it("copies the visible rows as JSON and exports them as CSV", async () => {
    let exported: Blob | undefined;
    let downloadName = "";
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: (blob: Blob) => {
          exported = blob;
          return "blob:export";
        },
        revokeObjectURL: () => {},
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    await render();

    await click(button("Copy as JSON"));
    expect(JSON.parse(last(mocks.clipboard)!)[0]).toEqual({ id: 1, name: "Ada", team_id: 10 });

    await click(button("Export as CSV"));
    expect(downloadName).toMatch(/^users.*\.csv$/);
    expect((await exported!.text()).split(/\r?\n/)[0]).toBe('"id","name","team_id"');
  });

  it("adds a row through the add row dialog", async () => {
    await render();

    await click(button("Add row"));
    expect(body().getByText("Add Row to users")).toBeTruthy();
    await act(async () => {
      fireEvent.change(document.getElementById("create-row-field-0")!, { target: { value: "4" } });
      fireEvent.change(document.getElementById("create-row-field-1")!, {
        target: { value: "Barbara" },
      });
    });
    await click(button("Add Row"));

    expect(last(calls("insert_sqlite_row"))).toMatchObject({
      table: "users",
      columns: expect.arrayContaining(["id", "name"]),
    });
    expect(columnValues(1)).toContain("Barbara");
    expect(body().queryByText("Add Row to users")).toBeNull();
  });

  it("edits and deletes rows from the row menu", async () => {
    await render();

    await rightClick(grid().querySelectorAll("tbody tr")[2]);
    await chooseMenuItem("Edit Row");
    expect((document.getElementById("edit-row-field-1") as HTMLInputElement).value).toBe("Linus");
    await act(async () => {
      fireEvent.change(document.getElementById("edit-row-field-1")!, {
        target: { value: "Linus T" },
      });
    });
    await click(button("Save Changes"));
    expect(last(calls("update_sqlite_row"))).toMatchObject({ whereColumn: "id", whereValue: 3 });
    expect(columnValues(1)).toEqual(["Ada", "Grace", "Linus T"]);

    await rightClick(grid().querySelectorAll("tbody tr")[0]);
    await chooseMenuItem("Delete Row");
    expect(last(calls("delete_sqlite_row"))).toMatchObject({ whereColumn: "id", whereValue: 1 });
    expect(columnValues(1)).toEqual(["Grace", "Linus T"]);
  });

  it("creates a table and drops it from the table menu", async () => {
    await render();

    await click(button("Create table"));
    expect(button("Create Table").disabled).toBe(true);
    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Enter table name"), {
        target: { value: "audit" },
      });
      fireEvent.change(body().getByPlaceholderText("Column name"), {
        target: { value: "event" },
      });
    });
    await click(button("Add Column"));
    expect(body().getAllByPlaceholderText("Column name")).toHaveLength(2);
    await click(button("Remove column 2"));
    await click(document.querySelector('[aria-label="Set event as not null"]')!);
    await click(button("Create Table"));

    expect(last(calls("execute_sqlite"))?.statement).toBe(
      'CREATE TABLE "audit" ("event" TEXT NOT NULL)',
    );
    expect(body().getByText("Objects (3)")).toBeTruthy();

    await rightClick(body().getByRole("button", { name: "Select table audit" }));
    await chooseMenuItem("Delete Table");
    expect(last(calls("execute_sqlite"))?.statement).toBe('DROP TABLE "audit"');
    expect(body().getByText("Objects (2)")).toBeTruthy();
  });

  it("pages through large tables", async () => {
    db.users = Array.from({ length: 120 }, (_, index): Row => [
      index + 1,
      `User ${index + 1}`,
      null,
    ]);
    await render();

    expect(body().getByText("/ 3")).toBeTruthy();
    await click(button("Next page"));

    expect((last(calls("query_sqlite_filtered"))!.params as Args).offset).toBe(50);
    expect(grid().querySelector("tbody tr:not([aria-hidden]) td")?.textContent).toBe("51");
  });

  it("reopens, reruns and forgets queries from the history", async () => {
    await render();
    await openSqlEditor();
    await typeSql("SELECT name FROM users WHERE id = 1");
    await click(button("Execute"));
    await click(button("Cancel"));

    const query = "SELECT name FROM users WHERE id = 1";
    await click(button(`Open query: ${query}`));
    expect(sqlEditor().value).toBe(query);
    await click(button("Cancel"));

    const executed = calls("query_sqlite").length;
    await click(button(`Run query from history: ${query}`));
    expect(calls("query_sqlite")).toHaveLength(executed + 1);
    expect(rowCount()).toBe("1 query rows");

    await click(button(`Remove query from history: ${query}`));
    expect(useStore.getState().sqlHistory).toEqual([]);
  });

  it("moves around the grid with arrows, paging keys and shift-tab", async () => {
    db.users = Array.from({ length: 30 }, (_, index): Row => [
      index + 1,
      `User ${index + 1}`,
      null,
    ]);
    await render();

    await click(cell(0, 0));
    await key({ key: "PageDown" });
    await key({ key: "PageDown" });
    await key({ key: "PageUp" });
    await key({ key: "ArrowRight" });
    await key({ key: "ArrowRight" });
    await key({ key: "ArrowLeft" });
    await key({ key: "ArrowUp" });
    await key({ key: "c", metaKey: true });
    expect(last(mocks.clipboard)).toBe("User 10");

    await key({ key: "Tab", shiftKey: true });
    await key({ key: "c", metaKey: true });
    expect(last(mocks.clipboard)).toBe("10");

    await key({ key: "a", ctrlKey: true });
    await key({ key: "c", metaKey: true });
    expect(last(mocks.clipboard)?.split("\n")).toHaveLength(30);
  });

  it("extends a row selection with shift-click and copies a cell from its menu", async () => {
    await render();

    await click(grid().querySelectorAll("tbody tr")[0].querySelector("td")!);
    await act(async () => {
      fireEvent.click(grid().querySelectorAll("tbody tr")[1].querySelector("td")!, {
        shiftKey: true,
      });
    });
    await flush();
    await key({ key: "c", metaKey: true });
    expect(last(mocks.clipboard)).toBe("1\tAda\t10\n2\tGrace\t20");

    await key({ key: "Escape" });
    await rightClick(within(cell(1, 1)).getByText("Grace"));
    await chooseMenuItem("Copy value");
    expect(last(mocks.clipboard)).toBe("Grace");
  });

  it("deletes rows by their values when the table has no primary key", async () => {
    mocks.invoke.mockImplementation(async (command: string, args?: Args) => {
      if (command === "query_sqlite" && String(args?.query).startsWith("PRAGMA table_info")) {
        return { columns: [], rows: [[0, "name", "TEXT", 0, null, 0]] };
      }
      if (command === "query_sqlite_filtered") {
        return { columns: ["name"], rows: [["Ada"], ["Grace"]], total_count: 2 };
      }
      if (command === "delete_sqlite_row_by_values") return null;
      return route(command, args);
    });
    await render();

    await rightClick(grid().querySelectorAll("tbody tr")[1]);
    await chooseMenuItem("Delete Row");

    expect(last(calls("delete_sqlite_row_by_values"))).toMatchObject({
      table: "users",
      identity: { columns: ["name"], values: ["Grace"] },
    });
  });

  it("switches to the schema and info views", async () => {
    await render();

    await click(body().getByRole("tab", { name: "Switch to Schema view" }));
    expect(body().queryByLabelText("Database rows")).toBeNull();
    expect(body().getAllByText("team_id").length).toBeGreaterThan(0);

    await click(body().getByRole("tab", { name: "Switch to Info view" }));
    expect(body().queryByLabelText("Database rows")).toBeNull();

    await click(body().getByRole("button", { name: "Select table teams" }));
    expect(useStore.getState().selectedTable).toBe("teams");
    expect(body().getByLabelText("Database rows")).toBeTruthy();
  });
});
