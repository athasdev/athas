import { invoke } from "@tauri-apps/api/core";
import { Code, Copy, Database, Download, RefreshCw, Search, Table, X } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "../components/ui/button";

interface SQLiteViewerProps {
  databasePath: string;
}

interface TableInfo {
  name: string;
}

interface QueryResult {
  columns: string[];
  rows: any[][];
}

interface ColumnInfo {
  name: string;
  type: string;
}

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

  // Database file info
  const fileName = databasePath.split("/").pop() || databasePath.split("\\").pop() || "Database";

  // Load table list when component mounts
  useEffect(() => {
    const loadTables = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await invoke("get_sqlite_tables", {
          path: databasePath,
        });
        setTables(result as TableInfo[]);
        if ((result as TableInfo[]).length > 0) {
          setSelectedTable((result as TableInfo[])[0].name);
        }
      } catch (err) {
        console.error("Error loading SQLite tables:", err);
        setError(`Failed to load database tables: ${err}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadTables();
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

  // Load table data when a table is selected or page changes
  useEffect(() => {
    if (!selectedTable || isCustomQuery) return;

    const loadTableData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Get total rows for pagination
        const countResult = (await invoke("query_sqlite", {
          path: databasePath,
          query: `SELECT COUNT(*) FROM "${selectedTable}"`,
        })) as QueryResult;

        const totalRows = Number(countResult.rows[0][0]);
        setTotalPages(Math.max(1, Math.ceil(totalRows / pageSize)));

        // Get paginated data
        const offset = (currentPage - 1) * pageSize;
        let query = `SELECT * FROM "${selectedTable}" LIMIT ${pageSize} OFFSET ${offset}`;

        // Apply search if present
        if (searchTerm.trim()) {
          // Search across all columns
          const searchableColumns = tableMeta.map((col) => col.name).join(' || " " || ');
          query = `SELECT * FROM "${selectedTable}" WHERE (${searchableColumns}) LIKE "%${searchTerm}%" LIMIT ${pageSize} OFFSET ${offset}`;
        }

        const result = await invoke("query_sqlite", {
          path: databasePath,
          query,
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
  }, [databasePath, selectedTable, currentPage, pageSize, searchTerm, isCustomQuery, tableMeta]);

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
  };

  // Reset to table view
  const resetToTableView = () => {
    setIsCustomQuery(false);
    setCurrentPage(1);
    setSearchTerm("");
  };

  // Export results as CSV
  const exportAsCSV = () => {
    if (!queryResult) return;

    const headers = queryResult.columns.join(",");
    const rows = queryResult.rows
      .map((row) =>
        row
          .map((cell) => {
            if (cell === null) return "";
            return typeof cell === "object"
              ? JSON.stringify(cell).replace(/"/g, '""')
              : String(cell).replace(/"/g, '""');
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
    link.setAttribute("download", `${selectedTable || "query_result"}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy results as JSON
  const copyAsJSON = () => {
    if (!queryResult) return;

    const jsonData = queryResult.rows.map((row) => {
      const obj: Record<string, any> = {};
      queryResult.columns.forEach((col, index) => {
        obj[col] = row[index];
      });
      return obj;
    });

    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg text-text">
      {/* Header with DB file info */}
      <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-4 py-2">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-text-lighter" />
          <span className="font-medium font-mono text-sm">{fileName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={resetToTableView}
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={!isCustomQuery}
          >
            <Table size={14} className="mr-1" />
            Table View
          </Button>
          <Button
            onClick={exportAsCSV}
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={!queryResult}
          >
            <Download size={14} className="mr-1" />
            Export CSV
          </Button>
          <Button
            onClick={copyAsJSON}
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={!queryResult}
          >
            <Copy size={14} className="mr-1" />
            Copy JSON
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar with tables */}
        <div className="flex w-64 flex-col border-border border-r bg-secondary-bg">
          <div className="border-border border-b p-3">
            <h3 className="flex items-center gap-2 font-mono font-semibold text-sm text-text">
              <Database size={16} />
              Tables ({tables.length})
            </h3>
          </div>

          <div className="custom-scrollbar flex-1 overflow-y-auto p-2">
            {tables.map((table) => (
              <button
                key={table.name}
                onClick={() => handleTableChange(table.name)}
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

          {/* Results table */}
          {!isLoading && queryResult && (
            <div className="custom-scrollbar flex-1 overflow-auto p-0">
              {queryResult.rows.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="font-mono text-sm text-text-lighter italic">No data returned</div>
                </div>
              ) : (
                <table className="w-full border-collapse font-mono text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-secondary-bg">
                      {/* Row number column */}
                      <th className="w-10 border border-border bg-secondary-bg px-2 py-1.5 text-left">
                        #
                      </th>
                      {queryResult.columns.map((column, i) => (
                        <th
                          key={i}
                          className="whitespace-nowrap border border-border bg-secondary-bg px-2 py-1.5 text-left"
                          title={tableMeta.find((c) => c.name === column)?.type || ""}
                        >
                          {column}
                          {tableMeta.find((c) => c.name === column) && (
                            <span className="ml-1 text-text-lighter text-xs">
                              ({tableMeta.find((c) => c.name === column)?.type})
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-hover">
                        {/* Row number */}
                        <td className="border border-border px-2 py-1 text-text-lighter">
                          {(currentPage - 1) * pageSize + rowIndex + 1}
                        </td>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="max-w-[300px] truncate border border-border px-2 py-1"
                            title={cell === null ? "NULL" : String(cell)}
                          >
                            {cell === null ? (
                              <span className="text-text-lighter italic">NULL</span>
                            ) : typeof cell === "object" ? (
                              <span className="text-blue-500">{JSON.stringify(cell)}</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Pagination */}
          {!isLoading && queryResult && !isCustomQuery && totalPages > 1 && (
            <div className="flex items-center justify-between border-border border-t bg-secondary-bg px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-text-lighter text-xs">
                  {pageSize} rows per page
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded border border-border bg-primary-bg px-1.5 py-0.5 font-mono text-xs"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={500}>500</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-xs"
                >
                  First
                </Button>
                <Button
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-xs"
                >
                  Prev
                </Button>

                <span className="px-2 font-mono text-xs">
                  Page {currentPage} of {totalPages}
                </span>

                <Button
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-xs"
                >
                  Next
                </Button>
                <Button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-xs"
                >
                  Last
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SQLiteViewer;
