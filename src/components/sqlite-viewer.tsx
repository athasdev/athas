import { invoke } from "@tauri-apps/api/core";
import { Code, Copy, Database, Download, RefreshCw, Search, Table, X } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "./ui/button";

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

        const columns: ColumnInfo[] = result.rows.map(row => ({
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
          const searchableColumns = tableMeta.map(col => col.name).join(' || " " || ');
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
        setSqlHistory(prev => [customQuery, ...prev].slice(0, 10));
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
      .map(row =>
        row
          .map(cell => {
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

    const jsonData = queryResult.rows.map(row => {
      const obj: Record<string, any> = {};
      queryResult.columns.forEach((col, index) => {
        obj[col] = row[index];
      });
      return obj;
    });

    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--primary-bg)] text-[var(--text-color)]">
      {/* Header with DB file info */}
      <div className="px-4 py-2 bg-[var(--secondary-bg)] border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-[var(--text-lighter)]" />
          <span className="font-mono text-sm font-medium">{fileName}</span>
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

      <div className="flex flex-1 min-h-0">
        {/* Sidebar with tables */}
        <div className="w-64 bg-[var(--secondary-bg)] border-r border-[var(--border-color)] flex flex-col">
          <div className="p-3 border-b border-[var(--border-color)]">
            <h3 className="font-mono text-sm font-semibold text-[var(--text-color)] flex items-center gap-2">
              <Database size={16} />
              Tables ({tables.length})
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {tables.map(table => (
              <button
                key={table.name}
                onClick={() => handleTableChange(table.name)}
                className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center gap-1.5 hover:bg-[var(--hover-color)] ${
                  selectedTable === table.name ? "bg-[var(--selected-color)]" : ""
                }`}
              >
                <Table size={12} className="flex-shrink-0" />
                <span className="truncate">{table.name}</span>
              </button>
            ))}
          </div>

          {/* SQL history section */}
          {sqlHistory.length > 0 && (
            <div className="border-t border-[var(--border-color)]">
              <div className="p-2 border-b border-[var(--border-color)]">
                <div className="text-xs font-mono font-medium text-[var(--text-lighter)] uppercase px-2 py-1">
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
                    className="w-full text-left px-3 py-1.5 text-xs font-mono truncate hover:bg-[var(--hover-color)]"
                    title={query}
                  >
                    <Code size={10} className="inline mr-1.5" />
                    {query.length > 25 ? `${query.substring(0, 25)}...` : query}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Query bar */}
          <div className="p-2 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
            {isCustomQuery ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <textarea
                    value={customQuery}
                    onChange={e => setCustomQuery(e.target.value)}
                    className="flex-1 px-2 py-1.5 bg-[var(--primary-bg)] border border-[var(--border-color)] rounded text-xs font-mono h-16 resize-none focus:outline-none focus:border-blue-500"
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
                <div className="flex-1 relative">
                  <Search
                    size={14}
                    className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[var(--text-lighter)]"
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search in table..."
                    className="w-full pl-8 pr-2 py-1.5 bg-[var(--primary-bg)] border border-[var(--border-color)] rounded text-xs font-mono focus:outline-none focus:border-blue-500"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-[var(--text-lighter)] hover:text-[var(--text-color)]"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <Button
                  onClick={() => setIsCustomQuery(true)}
                  variant="default"
                  size="sm"
                  className="text-xs whitespace-nowrap"
                >
                  <Code size={14} className="mr-1" />
                  Custom SQL
                </Button>
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="p-2 m-2 bg-red-50 border border-red-200 text-red-600 rounded-md text-xs">
              {error}
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-center justify-center p-8 flex-1">
              <div className="flex items-center gap-2 font-mono text-sm text-[var(--text-lighter)]">
                <RefreshCw size={16} className="animate-spin" />
                Loading...
              </div>
            </div>
          )}

          {/* Results table */}
          {!isLoading && queryResult && (
            <div className="flex-1 overflow-auto p-0 custom-scrollbar">
              {queryResult.rows.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="font-mono text-sm text-[var(--text-lighter)] italic">
                    No data returned
                  </div>
                </div>
              ) : (
                <table className="w-full border-collapse font-mono text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--secondary-bg)]">
                      {/* Row number column */}
                      <th className="border border-[var(--border-color)] px-2 py-1.5 text-left w-10 bg-[var(--secondary-bg)]">
                        #
                      </th>
                      {queryResult.columns.map((column, i) => (
                        <th
                          key={i}
                          className="border border-[var(--border-color)] px-2 py-1.5 text-left bg-[var(--secondary-bg)] whitespace-nowrap"
                          title={tableMeta.find(c => c.name === column)?.type || ""}
                        >
                          {column}
                          {tableMeta.find(c => c.name === column) && (
                            <span className="ml-1 text-[var(--text-lighter)] text-xs">
                              ({tableMeta.find(c => c.name === column)?.type})
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-[var(--hover-color)]">
                        {/* Row number */}
                        <td className="border border-[var(--border-color)] px-2 py-1 text-[var(--text-lighter)]">
                          {(currentPage - 1) * pageSize + rowIndex + 1}
                        </td>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="border border-[var(--border-color)] px-2 py-1 max-w-[300px] truncate"
                            title={cell === null ? "NULL" : String(cell)}
                          >
                            {cell === null ? (
                              <span className="text-[var(--text-lighter)] italic">NULL</span>
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
            <div className="px-4 py-2 border-t border-[var(--border-color)] bg-[var(--secondary-bg)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--text-lighter)]">
                  {pageSize} rows per page
                </span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="text-xs font-mono bg-[var(--primary-bg)] border border-[var(--border-color)] rounded px-1.5 py-0.5"
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
                  className="text-xs px-1.5"
                >
                  First
                </Button>
                <Button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  variant="ghost"
                  size="sm"
                  className="text-xs px-1.5"
                >
                  Prev
                </Button>

                <span className="text-xs font-mono px-2">
                  Page {currentPage} of {totalPages}
                </span>

                <Button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  variant="ghost"
                  size="sm"
                  className="text-xs px-1.5"
                >
                  Next
                </Button>
                <Button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  variant="ghost"
                  size="sm"
                  className="text-xs px-1.5"
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
