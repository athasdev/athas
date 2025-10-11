import { invoke } from "@tauri-apps/api/core";
import {
  Calendar,
  Code,
  Copy,
  Database,
  Download,
  FileText,
  Filter,
  Hash,
  Info,
  Key,
  PlusIcon,
  RefreshCw,
  Search,
  Settings,
  Table,
  Type,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Button from "../components/ui/button";
import Dropdown from "../components/ui/dropdown";
import { useUIState } from "../stores/ui-state-store";
import { SqliteRowMenu, SqliteTableMenu } from "./components/context-menus";
import { CreateRowModal, CreateTableModal, EditRowModal } from "./components/crud-modals";
import DataViewComponent from "./components/data-view";
import type {
  ColumnFilter,
  ColumnInfo,
  DatabaseInfo,
  QueryResult,
  SQLiteViewerProps,
  TableInfo,
  ViewMode,
} from "./types";

const SQLiteViewer = ({ databasePath }: SQLiteViewerProps) => {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [customQuery, setCustomQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [tableMeta, setTableMeta] = useState<ColumnInfo[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [isCustomQuery, setIsCustomQuery] = useState<boolean>(false);
  const [sqlHistory, setSqlHistory] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("data");
  const [columnFilters, setColumnFilters] = useState<ColumnFilter[]>([]);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [showColumnTypes, setShowColumnTypes] = useState<boolean>(true);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  // Modal states
  const [createRowModal, setCreateRowModal] = useState<{ isOpen: boolean; tableName: string }>({
    isOpen: false,
    tableName: "",
  });
  const [editRowModal, setEditRowModal] = useState<{
    isOpen: boolean;
    tableName: string;
    rowData: Record<string, any>;
  }>({ isOpen: false, tableName: "", rowData: {} });
  const [createTableModal, setCreateTableModal] = useState<boolean>(false);

  // Refresh trigger for data updates
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // UI state for context menus
  const { setSqliteTableMenu } = useUIState();

  // Database file info
  const fileName = databasePath.split("/").pop() || databasePath.split("\\").pop() || "Database";

  // Load table list and database info when component mounts
  useEffect(() => {
    const loadDatabase = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load tables
        const tablesResult = await invoke("get_sqlite_tables", {
          path: databasePath,
        });
        setTables(tablesResult as TableInfo[]);
        if ((tablesResult as TableInfo[]).length > 0) {
          setSelectedTable((tablesResult as TableInfo[])[0].name);
        }

        // Load database info
        try {
          const versionResult = (await invoke("query_sqlite", {
            path: databasePath,
            query: "PRAGMA user_version;",
          })) as QueryResult;

          const indexResult = (await invoke("query_sqlite", {
            path: databasePath,
            query:
              "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';",
          })) as QueryResult;

          setDbInfo({
            version: versionResult.rows[0]?.[0]?.toString() || "0",
            size: 0, // We'll get this from file system if needed
            tables: (tablesResult as TableInfo[]).length,
            indexes: Number(indexResult.rows[0]?.[0]) || 0,
          });
        } catch (infoErr) {
          console.warn("Could not load database info:", infoErr);
        }
      } catch (err) {
        console.error("Error loading SQLite database:", err);
        setError(`Failed to load database: ${err}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadDatabase();
  }, [databasePath]);

  // Get table structure when a table is selected
  useEffect(() => {
    if (!selectedTable) return;

    const loadTableStructure = async () => {
      try {
        setIsLoading(true);
        const result = (await invoke("query_sqlite", {
          path: databasePath,
          query: `PRAGMA table_info(${selectedTable})`,
        })) as QueryResult;

        const columns: ColumnInfo[] = result.rows.map((row) => ({
          name: row[1] as string,
          type: row[2] as string,
          notnull: Boolean(row[3]),
          default_value: row[4] as string | null,
          primary_key: Boolean(row[5]),
        }));

        setTableMeta(columns);
      } catch (err) {
        console.error("Error loading table structure:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadTableStructure();
  }, [databasePath, selectedTable]);

  // Build filtered and sorted query
  const buildDataQuery = useMemo(() => {
    if (!selectedTable || viewMode !== "data") return null;

    const whereConditions: string[] = [];
    const _params: Record<string, any> = {};

    // Add search term filter
    if (searchTerm.trim() && tableMeta.length > 0) {
      const searchableColumns = tableMeta.map((col) => `"${col.name}"`).join(' || " " || ');
      whereConditions.push(`(${searchableColumns}) LIKE "%${searchTerm}%"`);
    }

    // Add column filters
    columnFilters.forEach((filter, index) => {
      const _paramKey = `filter_${index}`;
      switch (filter.operator) {
        case "equals":
          whereConditions.push(`"${filter.column}" = "${filter.value}"`);
          break;
        case "contains":
          whereConditions.push(`"${filter.column}" LIKE "%${filter.value}%"`);
          break;
        case "startsWith":
          whereConditions.push(`"${filter.column}" LIKE "${filter.value}%"`);
          break;
        case "endsWith":
          whereConditions.push(`"${filter.column}" LIKE "%${filter.value}"`);
          break;
        case "gt":
          whereConditions.push(`"${filter.column}" > "${filter.value}"`);
          break;
        case "lt":
          whereConditions.push(`"${filter.column}" < "${filter.value}"`);
          break;
        case "between":
          if (filter.value2) {
            whereConditions.push(
              `"${filter.column}" BETWEEN "${filter.value}" AND "${filter.value2}"`,
            );
          }
          break;
      }
    });

    // Build WHERE clause
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // Build ORDER BY clause
    const orderClause = sortColumn ? `ORDER BY "${sortColumn}" ${sortDirection.toUpperCase()}` : "";

    // Select columns
    const columns =
      selectedColumns.length > 0 ? selectedColumns.map((col) => `"${col}"`).join(", ") : "*";

    return {
      countQuery: `SELECT COUNT(*) FROM "${selectedTable}" ${whereClause}`,
      dataQuery: `SELECT ${columns} FROM "${selectedTable}" ${whereClause} ${orderClause}`,
    };
  }, [
    selectedTable,
    viewMode,
    searchTerm,
    columnFilters,
    sortColumn,
    sortDirection,
    selectedColumns,
    tableMeta,
  ]);

  // Load table data when a table is selected or filters change
  useEffect(() => {
    if (!selectedTable || isCustomQuery || viewMode !== "data" || !buildDataQuery) return;

    const loadTableData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Get total rows for pagination
        const countResult = (await invoke("query_sqlite", {
          path: databasePath,
          query: buildDataQuery.countQuery,
        })) as QueryResult;

        const totalRows = Number(countResult.rows[0][0]);
        setTotalPages(Math.max(1, Math.ceil(totalRows / pageSize)));

        // Get paginated data
        const offset = (currentPage - 1) * pageSize;
        const paginatedQuery = `${buildDataQuery.dataQuery} LIMIT ${pageSize} OFFSET ${offset}`;

        const result = await invoke("query_sqlite", {
          path: databasePath,
          query: paginatedQuery,
        });
        setQueryResult(result as QueryResult);
      } catch (err) {
        console.error("Error querying SQLite table:", err);
        setError(`Failed to query table: ${err}`);
        setQueryResult(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadTableData();
  }, [
    databasePath,
    selectedTable,
    currentPage,
    pageSize,
    isCustomQuery,
    buildDataQuery,
    refreshTrigger,
  ]);

  // Execute custom query
  const executeCustomQuery = async () => {
    if (!customQuery.trim()) return;

    try {
      setIsLoading(true);
      setError(null);
      setIsCustomQuery(true);

      const result = await invoke("query_sqlite", {
        path: databasePath,
        query: customQuery,
      });
      setQueryResult(result as QueryResult);

      // Add to history if not already present
      if (!sqlHistory.includes(customQuery)) {
        setSqlHistory((prev) => [customQuery, ...prev].slice(0, 10));
      }
    } catch (err) {
      console.error("Error executing custom query:", err);
      setError(`Query error: ${err}`);
      setQueryResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Change table selection
  const handleTableChange = (tableName: string) => {
    setSelectedTable(tableName);
    setCurrentPage(1);
    setSearchTerm("");
    setIsCustomQuery(false);
    setColumnFilters([]);
    setSortColumn(null);
    setSelectedColumns([]);
    setViewMode("data");
  };

  // Add column filter
  const addColumnFilter = (column: string) => {
    const newFilter: ColumnFilter = {
      column,
      operator: "contains",
      value: "",
    };
    setColumnFilters([...columnFilters, newFilter]);
  };

  // Update column filter
  const updateColumnFilter = (index: number, updates: Partial<ColumnFilter>) => {
    const newFilters = [...columnFilters];
    newFilters[index] = { ...newFilters[index], ...updates };
    setColumnFilters(newFilters);
    setCurrentPage(1);
  };

  // Remove column filter
  const removeColumnFilter = (index: number) => {
    setColumnFilters(columnFilters.filter((_, i) => i !== index));
    setCurrentPage(1);
  };

  // Handle column sorting
  const handleColumnSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  // Get column type icon
  const getColumnIcon = (type: string, isPrimaryKey: boolean) => {
    if (isPrimaryKey) return <Key size={12} className="text-text-lighter" />;
    const lowerType = type.toLowerCase();
    if (lowerType.includes("int") || lowerType.includes("num"))
      return <Hash size={12} className="text-blue-500" />;
    if (lowerType.includes("text") || lowerType.includes("varchar") || lowerType.includes("char"))
      return <Type size={12} className="text-green-500" />;
    if (lowerType.includes("date") || lowerType.includes("time"))
      return <Calendar size={12} className="text-purple-500" />;
    if (lowerType.includes("blob") || lowerType.includes("binary"))
      return <FileText size={12} className="text-red-500" />;
    return <Type size={12} className="text-gray-500" />;
  };

  // CRUD handlers
  const handleCreateRow = (tableName: string) => {
    setCreateRowModal({ isOpen: true, tableName });
  };

  const handleEditRow = (tableName: string, rowData: Record<string, any>) => {
    setEditRowModal({ isOpen: true, tableName, rowData });
  };

  const handleDeleteRow = async (tableName: string, rowData: Record<string, any>) => {
    try {
      // Find primary key column
      const primaryKeyColumn = tableMeta.find((col) => col.primary_key);
      if (!primaryKeyColumn) {
        setError("Cannot delete row: no primary key found");
        return;
      }

      const primaryKeyValue = rowData[primaryKeyColumn.name];
      if (primaryKeyValue === undefined || primaryKeyValue === null) {
        setError("Cannot delete row: primary key value is missing");
        return;
      }

      await invoke("delete_sqlite_row", {
        path: databasePath,
        table: tableName,
        whereColumn: primaryKeyColumn.name,
        whereValue: primaryKeyValue,
      });

      // Refresh data by triggering useEffect
      setRefreshTrigger((prev) => prev + 1);
      setError(null);
    } catch (err) {
      setError(`Delete failed: ${err}`);
    }
  };

  const handleCreateTable = () => {
    setCreateTableModal(true);
  };

  const handleDeleteTable = async (tableName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete table "${tableName}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await invoke("execute_sqlite", {
        path: databasePath,
        statement: `DROP TABLE "${tableName}"`,
      });

      // Refresh tables list
      const tablesResult = await invoke("get_sqlite_tables", {
        path: databasePath,
      });
      setTables(tablesResult as TableInfo[]);

      // Select first table if current table was deleted
      if (selectedTable === tableName) {
        const newTables = tablesResult as TableInfo[];
        setSelectedTable(newTables.length > 0 ? newTables[0].name : null);
      }

      setError(null);
    } catch (err) {
      setError(`Delete table failed: ${err}`);
    }
  };

  const handleTableContextMenu = (event: React.MouseEvent, tableName: string) => {
    event.preventDefault();
    setSqliteTableMenu({
      x: event.clientX,
      y: event.clientY,
      tableName,
    });
  };

  const handleSubmitCreateRow = async (values: Record<string, any>) => {
    try {
      const columns = Object.keys(values);
      const vals = Object.values(values);

      await invoke("insert_sqlite_row", {
        path: databasePath,
        table: createRowModal.tableName,
        columns,
        values: vals,
      });

      // Refresh data by triggering useEffect
      setRefreshTrigger((prev) => prev + 1);
      setError(null);
    } catch (err) {
      setError(`Insert failed: ${err}`);
    }
  };

  const handleSubmitEditRow = async (values: Record<string, any>) => {
    try {
      // Find primary key column
      const primaryKeyColumn = tableMeta.find((col) => col.primary_key);
      if (!primaryKeyColumn) {
        setError("Cannot update row: no primary key found");
        return;
      }

      const primaryKeyValue = editRowModal.rowData[primaryKeyColumn.name];
      if (primaryKeyValue === undefined || primaryKeyValue === null) {
        setError("Cannot update row: primary key value is missing");
        return;
      }

      // Remove primary key from values to update
      const { [primaryKeyColumn.name]: _, ...updateValues } = values;
      const columns = Object.keys(updateValues);
      const vals = Object.values(updateValues);

      await invoke("update_sqlite_row", {
        path: databasePath,
        table: editRowModal.tableName,
        setColumns: columns,
        setValues: vals,
        whereColumn: primaryKeyColumn.name,
        whereValue: primaryKeyValue,
      });

      // Refresh data by triggering useEffect
      setRefreshTrigger((prev) => prev + 1);
      setError(null);
    } catch (err) {
      setError(`Update failed: ${err}`);
    }
  };

  const handleSubmitCreateTable = async (
    tableName: string,
    columns: { name: string; type: string; notnull: boolean }[],
  ) => {
    try {
      const columnDefs = columns
        .map((col) => `"${col.name}" ${col.type}${col.notnull ? " NOT NULL" : ""}`)
        .join(", ");

      const createTableSql = `CREATE TABLE "${tableName}" (${columnDefs})`;

      await invoke("execute_sqlite", {
        path: databasePath,
        statement: createTableSql,
      });

      // Refresh tables list
      const tablesResult = await invoke("get_sqlite_tables", {
        path: databasePath,
      });
      setTables(tablesResult as TableInfo[]);
      setSelectedTable(tableName);

      setError(null);
    } catch (err) {
      setError(`Create table failed: ${err}`);
    }
  };

  const handleCellEdit = async (rowIndex: number, columnName: string, newValue: any) => {
    if (!selectedTable || !queryResult) return;

    try {
      // Find primary key column
      const primaryKeyColumn = tableMeta.find((col) => col.primary_key);
      if (!primaryKeyColumn) {
        setError("Cannot update cell: no primary key found");
        return;
      }

      // Get the row data
      const row = queryResult.rows[rowIndex];
      const rowData: Record<string, any> = {};
      queryResult.columns.forEach((column, i) => {
        rowData[column] = row[i];
      });

      const primaryKeyValue = rowData[primaryKeyColumn.name];
      if (primaryKeyValue === undefined || primaryKeyValue === null) {
        setError("Cannot update cell: primary key value is missing");
        return;
      }

      await invoke("update_sqlite_row", {
        path: databasePath,
        table: selectedTable,
        setColumns: [columnName],
        setValues: [newValue],
        whereColumn: primaryKeyColumn.name,
        whereValue: primaryKeyValue,
      });

      // Refresh data by triggering useEffect
      setRefreshTrigger((prev) => prev + 1);
      setError(null);
    } catch (err) {
      setError(`Cell update failed: ${err}`);
    }
  };

  // Reset to table view
  const _resetToTableView = () => {
    setIsCustomQuery(false);
    setCurrentPage(1);
    setSearchTerm("");
  };

  // Export results as CSV
  const exportAsCSV = () => {
    if (!queryResult) return;

    const headers = queryResult.columns.map((col) => `"${col}"`).join(",");
    const rows = queryResult.rows
      .map((row) =>
        row
          .map((cell) => {
            if (cell === null) return '""';
            if (typeof cell === "object") return `"${JSON.stringify(cell).replace(/"/g, '""')}"`;
            return `"${String(cell).replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\n");

    const csvContent = `${headers}\n${rows}`;

    // Create blob and download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `${selectedTable || "query_result"}_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy results as JSON
  const copyAsJSON = async () => {
    if (!queryResult) return;

    const jsonData = queryResult.rows.map((row) => {
      const obj: Record<string, any> = {};
      queryResult.columns.forEach((col, index) => {
        obj[col] = row[index];
      });
      return obj;
    });

    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      // Could add toast notification here if available
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg text-text">
      {/* Header */}
      <div className="border-border border-b bg-secondary-bg px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Database size={14} className="text-text-lighter" />
              <span className="font-mono text-sm">{fileName}</span>
              {dbInfo && (
                <span className="font-mono text-text-lighter text-xs">
                  {dbInfo.tables}t {dbInfo.indexes}i
                </span>
              )}
            </div>

            {/* View tabs */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode("data")}
                className={`flex items-center gap-1 px-2 py-1 font-mono text-xs transition-colors ${
                  viewMode === "data" ? "text-text" : "text-text-lighter hover:text-text"
                }`}
                title="Data view"
              >
                <Table size={12} />
                Data
              </button>
              <button
                onClick={() => setViewMode("schema")}
                className={`flex items-center gap-1 px-2 py-1 font-mono text-xs transition-colors ${
                  viewMode === "schema" ? "text-text" : "text-text-lighter hover:text-text"
                }`}
                title="Schema view"
              >
                <Settings size={12} />
                Schema
              </button>
              <button
                onClick={() => setViewMode("info")}
                className={`flex items-center gap-1 px-2 py-1 font-mono text-xs transition-colors ${
                  viewMode === "info" ? "text-text" : "text-text-lighter hover:text-text"
                }`}
                title="Database info"
              >
                <Info size={12} />
                Info
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {viewMode === "data" && !isCustomQuery && (
              <button
                onClick={() => setShowColumnTypes(!showColumnTypes)}
                className="flex items-center gap-1 px-2 py-1 font-mono text-text-lighter text-xs transition-colors hover:text-text"
                title="Toggle column types"
              >
                <Type size={12} />
                Types
              </button>
            )}
            {viewMode === "data" && (
              <button
                onClick={() => setIsCustomQuery(true)}
                className="flex items-center gap-1 px-2 py-1 font-mono text-text-lighter text-xs transition-colors hover:text-text"
                disabled={isCustomQuery}
                title="Custom SQL query"
              >
                <Code size={12} />
                SQL
              </button>
            )}
            {queryResult && (
              <>
                <button
                  onClick={exportAsCSV}
                  className="flex items-center gap-1 px-2 py-1 font-mono text-text-lighter text-xs transition-colors hover:text-text"
                  title="Export as CSV"
                >
                  <Download size={12} />
                  Export
                </button>
                <button
                  onClick={copyAsJSON}
                  className="flex items-center gap-1 px-2 py-1 font-mono text-text-lighter text-xs transition-colors hover:text-text"
                  title="Copy as JSON"
                >
                  <Copy size={12} />
                  JSON
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar with tables */}
        <div className="flex w-64 flex-col border-border border-r bg-secondary-bg">
          <div className="group p-3 pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-mono text-text-lighter text-xs">
                <Database size={12} />
                Tables ({tables.length})
              </div>
              <button
                onClick={handleCreateTable}
                className="rounded px-1 py-0.5 opacity-0 transition-opacity hover:bg-hover hover:opacity-100 group-hover:opacity-100"
                title="Create new table"
              >
                <PlusIcon size={10} className="text-text-lighter hover:text-text" />
              </button>
            </div>
          </div>

          <div className="custom-scrollbar flex-1 overflow-y-auto p-2">
            {tables.map((table) => (
              <button
                key={table.name}
                onClick={() => handleTableChange(table.name)}
                onContextMenu={(e) => handleTableContextMenu(e, table.name)}
                className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-mono text-xs hover:bg-hover ${
                  selectedTable === table.name ? "bg-selected" : ""
                }`}
              >
                <Table size={12} className="flex-shrink-0" />
                <span className="truncate">{table.name}</span>
              </button>
            ))}
          </div>

          {/* SQL history section */}
          {sqlHistory.length > 0 && (
            <div className="border-border border-t">
              <div className="border-border border-b p-2">
                <div className="px-2 py-1 font-medium font-mono text-text-lighter text-xs uppercase">
                  Recent Queries
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto">
                {sqlHistory.map((query, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setCustomQuery(query);
                      setIsCustomQuery(true);
                    }}
                    className="w-full truncate px-3 py-1.5 text-left font-mono text-xs hover:bg-hover"
                    title={query}
                  >
                    <Code size={10} className="mr-1.5 inline" />
                    {query.length > 25 ? `${query.substring(0, 25)}...` : query}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main content area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Query bar */}
          <div className="border-border border-b bg-secondary-bg p-2">
            {isCustomQuery ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <textarea
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    className="h-16 flex-1 resize-none rounded border border-border bg-primary-bg px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
                    placeholder="SELECT * FROM table_name WHERE condition LIMIT 100"
                    disabled={isLoading}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setIsCustomQuery(false)}
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                  >
                    <X size={14} className="mr-1" />
                    Cancel
                  </Button>
                  <Button
                    onClick={executeCustomQuery}
                    variant="default"
                    size="sm"
                    disabled={isLoading || !customQuery.trim()}
                    className="text-xs"
                  >
                    <Code size={14} className="mr-1" />
                    Execute
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="-translate-y-1/2 absolute top-1/2 left-2 transform text-text-lighter"
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search in table..."
                    className="w-full rounded border border-border bg-primary-bg py-1.5 pr-2 pl-8 font-mono text-xs focus:border-blue-500 focus:outline-none"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="-translate-y-1/2 absolute top-1/2 right-2 transform text-text-lighter hover:text-text"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <Button
                  onClick={() => setIsCustomQuery(true)}
                  variant="default"
                  size="sm"
                  className="whitespace-nowrap text-xs"
                >
                  <Code size={14} className="mr-1" />
                  Custom SQL
                </Button>
              </div>
            )}
          </div>

          {/* Column Filters */}
          {viewMode === "data" && columnFilters.length > 0 && (
            <div className="border-border border-b bg-secondary-bg px-3 py-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-text-lighter text-xs">
                  {columnFilters.length} filters
                </span>
                <button
                  onClick={() => setColumnFilters([])}
                  className="font-mono text-text-lighter text-xs hover:text-text"
                >
                  clear
                </button>
              </div>
              <div className="space-y-1">
                {columnFilters.map((filter, index) => (
                  <div key={index} className="flex items-center gap-2 text-xs">
                    <Dropdown
                      value={filter.column}
                      options={tableMeta.map((col) => ({ value: col.name, label: col.name }))}
                      onChange={(value) => updateColumnFilter(index, { column: value })}
                      size="xs"
                      className="min-w-20"
                    />

                    <Dropdown
                      value={filter.operator}
                      options={[
                        { value: "equals", label: "=" },
                        { value: "contains", label: "∋" },
                        { value: "startsWith", label: "^" },
                        { value: "endsWith", label: "$" },
                        { value: "gt", label: ">" },
                        { value: "lt", label: "<" },
                        { value: "between", label: "⇋" },
                      ]}
                      onChange={(value) =>
                        updateColumnFilter(index, { operator: value as ColumnFilter["operator"] })
                      }
                      size="xs"
                      className="min-w-12"
                    />

                    <input
                      type="text"
                      value={filter.value}
                      onChange={(e) => updateColumnFilter(index, { value: e.target.value })}
                      placeholder="value"
                      className="flex-1 border border-border bg-primary-bg px-1 py-0.5 font-mono text-xs"
                    />

                    {filter.operator === "between" && (
                      <input
                        type="text"
                        value={filter.value2 || ""}
                        onChange={(e) => updateColumnFilter(index, { value2: e.target.value })}
                        placeholder="value2"
                        className="flex-1 border border-border bg-primary-bg px-1 py-0.5 font-mono text-xs"
                      />
                    )}

                    <button
                      onClick={() => removeColumnFilter(index)}
                      className="text-text-lighter transition-colors hover:text-red-500"
                      title="Remove filter"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="m-2 rounded-md border border-red-200 bg-red-50 p-2 text-red-600 text-xs">
              {error}
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="flex items-center gap-2 font-mono text-sm text-text-lighter">
                <RefreshCw size={16} className="animate-spin" />
                Loading...
              </div>
            </div>
          )}

          {/* Data View */}
          {!isLoading && viewMode === "data" && queryResult && (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Data View Header */}
              <div className="group flex items-center justify-between border-border border-b bg-secondary-bg px-3 py-2">
                <div className="font-mono text-text-lighter text-xs">
                  {queryResult.rows.length} rows
                </div>
                {selectedTable && (
                  <button
                    onClick={() => handleCreateRow(selectedTable)}
                    className="rounded px-1 py-0.5 opacity-0 transition-opacity hover:bg-hover hover:opacity-100 group-hover:opacity-100"
                    title="Add new row"
                  >
                    <PlusIcon size={10} className="text-text-lighter hover:text-text" />
                  </button>
                )}
              </div>
              <div className="custom-scrollbar flex-1 overflow-auto p-0">
                <DataViewComponent
                  queryResult={queryResult}
                  tableMeta={tableMeta}
                  tableName={selectedTable || ""}
                  currentPage={currentPage}
                  pageSize={pageSize}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  showColumnTypes={showColumnTypes}
                  onColumnSort={handleColumnSort}
                  onAddColumnFilter={addColumnFilter}
                  getColumnIcon={getColumnIcon}
                  onCellEdit={handleCellEdit}
                />
              </div>
            </div>
          )}

          {/* Schema View */}
          {!isLoading && viewMode === "schema" && selectedTable && tableMeta.length > 0 && (
            <div className="flex-1 overflow-auto">
              <div className="border-border border-b bg-secondary-bg p-3">
                <div className="font-mono text-sm">{selectedTable}</div>
                <div className="font-mono text-text-lighter text-xs">
                  {tableMeta.length} columns
                </div>
              </div>

              <div className="divide-y divide-border">
                {tableMeta.map((column) => (
                  <div
                    key={column.name}
                    className="flex items-center justify-between px-3 py-2 hover:bg-hover"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {getColumnIcon(column.type, column.primary_key)}
                      <div className="truncate font-mono text-sm">{column.name}</div>
                      <div className="font-mono text-text-lighter text-xs">{column.type}</div>
                      {column.primary_key && (
                        <div className="font-mono text-text-lighter text-xs">PK</div>
                      )}
                      {column.notnull && (
                        <div className="font-mono text-text-lighter text-xs">NN</div>
                      )}
                      {column.default_value && (
                        <div
                          className="truncate font-mono text-text-lighter text-xs"
                          title={`default: ${column.default_value}`}
                        >
                          def: {column.default_value}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => addColumnFilter(column.name)}
                      className="px-2 py-1 font-mono text-text-lighter text-xs opacity-60 transition-colors hover:text-text hover:opacity-100"
                      title="Filter by this column"
                    >
                      <Filter size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Database Info View */}
          {!isLoading && viewMode === "info" && (
            <div className="flex-1 overflow-auto">
              <div className="divide-y divide-border">
                {/* Database stats */}
                <div className="p-3">
                  <div className="mb-1 font-mono text-sm">{fileName}</div>
                  <div className="flex gap-4 font-mono text-text-lighter text-xs">
                    <span>{dbInfo?.tables || 0} tables</span>
                    <span>{dbInfo?.indexes || 0} indexes</span>
                    <span>v{dbInfo?.version || "0"}</span>
                    {selectedTable && <span>current: {selectedTable}</span>}
                    {columnFilters.length > 0 && <span>{columnFilters.length} filters</span>}
                  </div>
                </div>

                {/* Tables */}
                <div className="p-3">
                  <div className="mb-2 font-mono text-text-lighter text-xs">tables</div>
                  <div className="space-y-1">
                    {tables.map((table) => (
                      <button
                        key={table.name}
                        onClick={() => {
                          handleTableChange(table.name);
                          setViewMode("data");
                        }}
                        className={`block w-full px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-hover ${
                          selectedTable === table.name ? "bg-selected" : ""
                        }`}
                      >
                        {table.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* SQL History */}
                {sqlHistory.length > 0 && (
                  <div className="p-3">
                    <div className="mb-2 font-mono text-text-lighter text-xs">recent queries</div>
                    <div className="max-h-32 space-y-1 overflow-y-auto">
                      {sqlHistory.map((query, index) => (
                        <button
                          key={index}
                          onClick={() => {
                            setCustomQuery(query);
                            setIsCustomQuery(true);
                            setViewMode("data");
                          }}
                          className="block w-full truncate px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-hover"
                          title={query}
                        >
                          {query}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pagination */}
          {!isLoading && viewMode === "data" && queryResult && !isCustomQuery && totalPages > 1 && (
            <div className="flex items-center justify-between border-border border-t bg-secondary-bg px-3 py-2">
              <div className="flex items-center gap-2">
                <Dropdown
                  value={pageSize.toString()}
                  options={[
                    { value: "10", label: "10" },
                    { value: "25", label: "25" },
                    { value: "50", label: "50" },
                    { value: "100", label: "100" },
                    { value: "500", label: "500" },
                  ]}
                  onChange={(value) => {
                    setPageSize(Number(value));
                    setCurrentPage(1);
                  }}
                  size="xs"
                  className="min-w-16"
                />
                <span className="font-mono text-text-lighter text-xs">per page</span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-2 py-1 font-mono text-text-lighter text-xs transition-colors hover:text-text disabled:opacity-50"
                >
                  ← Prev
                </button>

                <span className="px-2 font-mono text-xs">
                  {currentPage} / {totalPages}
                </span>

                <button
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1 font-mono text-text-lighter text-xs transition-colors hover:text-text disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Context Menus */}
      <SqliteTableMenu onCreateRow={handleCreateRow} onDeleteTable={handleDeleteTable} />
      <SqliteRowMenu onEditRow={handleEditRow} onDeleteRow={handleDeleteRow} />

      {/* Modals */}
      <CreateRowModal
        isOpen={createRowModal.isOpen}
        onClose={() => setCreateRowModal({ isOpen: false, tableName: "" })}
        tableName={createRowModal.tableName}
        columns={tableMeta.filter((col) => col.name.toLowerCase() !== "rowid")}
        onSubmit={handleSubmitCreateRow}
      />

      <EditRowModal
        isOpen={editRowModal.isOpen}
        onClose={() => setEditRowModal({ isOpen: false, tableName: "", rowData: {} })}
        tableName={editRowModal.tableName}
        columns={tableMeta.filter((col) => col.name.toLowerCase() !== "rowid")}
        initialData={editRowModal.rowData}
        onSubmit={handleSubmitEditRow}
      />

      <CreateTableModal
        isOpen={createTableModal}
        onClose={() => setCreateTableModal(false)}
        onSubmit={handleSubmitCreateTable}
      />
    </div>
  );
};

export default SQLiteViewer;
