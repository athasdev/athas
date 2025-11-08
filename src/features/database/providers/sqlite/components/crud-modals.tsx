import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOnClickOutside } from "usehooks-ts";
import Button from "@/ui/button";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import type { ColumnInfo } from "../../../models/common.types";

interface CreateRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnInfo[];
  onSubmit: (values: Record<string, any>) => void;
}

export const CreateRowModal = ({
  isOpen,
  onClose,
  tableName,
  columns,
  onSubmit,
}: CreateRowModalProps) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  // Handle click outside
  useOnClickOutside(modalRef as React.RefObject<HTMLElement>, () => {
    if (isOpen) handleClose();
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Convert string values to appropriate types
    const convertedValues: Record<string, any> = {};
    for (const [key, value] of Object.entries(values)) {
      const column = columns.find((col) => col.name === key);
      if (!value || value === "") {
        convertedValues[key] = null;
      } else if (column?.type.toLowerCase().includes("int")) {
        convertedValues[key] = parseInt(value, 10);
      } else if (
        column?.type.toLowerCase().includes("real") ||
        column?.type.toLowerCase().includes("float")
      ) {
        convertedValues[key] = parseFloat(value);
      } else {
        convertedValues[key] = value;
      }
    }

    onSubmit(convertedValues);
    setValues({});
    onClose();
  };

  const handleClose = () => {
    setValues({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-border bg-secondary-bg p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium font-mono text-lg text-text">Add Row to {tableName}</h2>
          <button onClick={handleClose} className="rounded-md p-1 text-text-lighter hover:bg-hover">
            <XIcon size="16" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {columns
            .filter((col) => col.name.toLowerCase() !== "rowid")
            .map((column) => (
              <div key={column.name} className="space-y-1">
                <label
                  htmlFor={`create-${column.name}`}
                  className="block font-mono text-sm text-text"
                >
                  {column.name}
                  <span className="ml-1 text-text-lighter text-xs">({column.type})</span>
                </label>
                <Input
                  id={`create-${column.name}`}
                  type={
                    column.type.toLowerCase().includes("int") ||
                    column.type.toLowerCase().includes("real")
                      ? "number"
                      : "text"
                  }
                  value={values[column.name] || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setValues((prev) => ({ ...prev, [column.name]: e.target.value }))
                  }
                  className="w-full"
                  placeholder={column.notnull ? "Required" : "Optional"}
                />
              </div>
            ))}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="gap-1">
              <PlusIcon size="14" />
              Add Row
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface EditRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnInfo[];
  initialData: Record<string, any>;
  onSubmit: (values: Record<string, any>) => void;
}

export const EditRowModal = ({
  isOpen,
  onClose,
  tableName,
  columns,
  initialData,
  onSubmit,
}: EditRowModalProps) => {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [key, value] of Object.entries(initialData)) {
      initial[key] = value?.toString() || "";
    }
    return initial;
  });
  const editModalRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  // Handle click outside
  useOnClickOutside(editModalRef as React.RefObject<HTMLElement>, () => {
    if (isOpen) handleClose();
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Convert string values to appropriate types
    const convertedValues: Record<string, any> = {};
    for (const [key, value] of Object.entries(values)) {
      const column = columns.find((col) => col.name === key);
      if (!value || value === "") {
        convertedValues[key] = null;
      } else if (column?.type.toLowerCase().includes("int")) {
        convertedValues[key] = parseInt(value, 10);
      } else if (
        column?.type.toLowerCase().includes("real") ||
        column?.type.toLowerCase().includes("float")
      ) {
        convertedValues[key] = parseFloat(value);
      } else {
        convertedValues[key] = value;
      }
    }

    onSubmit(convertedValues);
    onClose();
  };

  const handleClose = () => {
    // Reset to initial values
    const initial: Record<string, string> = {};
    for (const [key, value] of Object.entries(initialData)) {
      initial[key] = value?.toString() || "";
    }
    setValues(initial);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={editModalRef}
        className="w-full max-w-md rounded-lg border border-border bg-secondary-bg p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium font-mono text-lg text-text">Edit Row in {tableName}</h2>
          <button onClick={handleClose} className="rounded-md p-1 text-text-lighter hover:bg-hover">
            <XIcon size="16" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {columns
            .filter((col) => col.name.toLowerCase() !== "rowid")
            .map((column) => (
              <div key={column.name} className="space-y-1">
                <label
                  htmlFor={`edit-${column.name}`}
                  className="block font-mono text-sm text-text"
                >
                  {column.name}
                  <span className="ml-1 text-text-lighter text-xs">({column.type})</span>
                </label>
                <Input
                  id={`edit-${column.name}`}
                  type={
                    column.type.toLowerCase().includes("int") ||
                    column.type.toLowerCase().includes("real")
                      ? "number"
                      : "text"
                  }
                  value={values[column.name] || ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setValues((prev) => ({ ...prev, [column.name]: e.target.value }))
                  }
                  className="w-full"
                  placeholder={column.notnull ? "Required" : "Optional"}
                />
              </div>
            ))}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface CreateTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    tableName: string,
    columns: { name: string; type: string; notnull: boolean }[],
  ) => void;
}

export const CreateTableModal = ({ isOpen, onClose, onSubmit }: CreateTableModalProps) => {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<{ name: string; type: string; notnull: boolean }[]>([
    { name: "", type: "TEXT", notnull: false },
  ]);
  const createTableModalRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  // Handle click outside
  useOnClickOutside(createTableModalRef as React.RefObject<HTMLElement>, () => {
    if (isOpen) handleClose();
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tableName.trim() && columns.every((col) => col.name.trim())) {
      onSubmit(
        tableName.trim(),
        columns.filter((col) => col.name.trim()),
      );
      handleClose();
    }
  };

  const handleClose = () => {
    setTableName("");
    setColumns([{ name: "", type: "TEXT", notnull: false }]);
    onClose();
  };

  const addColumn = () => {
    setColumns((prev) => [...prev, { name: "", type: "TEXT", notnull: false }]);
  };

  const removeColumn = (index: number) => {
    if (columns.length > 1) {
      setColumns((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const updateColumn = (index: number, field: keyof (typeof columns)[0], value: any) => {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, [field]: value } : col)));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={createTableModalRef}
        className="w-full max-w-lg rounded-lg border border-border bg-secondary-bg p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium font-mono text-lg text-text">Create New Table</h2>
          <button onClick={handleClose} className="rounded-md p-1 text-text-lighter hover:bg-hover">
            <XIcon size="16" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="table-name" className="block font-mono text-sm text-text">
              Table Name
            </label>
            <Input
              id="table-name"
              value={tableName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTableName(e.target.value)}
              placeholder="Enter table name"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="block font-mono text-sm text-text">Columns</div>
            {columns.map((column, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={column.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateColumn(index, "name", e.target.value)
                  }
                  placeholder="Column name"
                  className="flex-1"
                  required
                />
                <select
                  value={column.type}
                  onChange={(e) => updateColumn(index, "type", e.target.value)}
                  className="rounded-md border border-border bg-input px-2 py-1 font-mono text-sm text-text"
                >
                  <option value="TEXT">TEXT</option>
                  <option value="INTEGER">INTEGER</option>
                  <option value="REAL">REAL</option>
                  <option value="BLOB">BLOB</option>
                </select>
                <label className="flex items-center gap-1 font-mono text-text text-xs">
                  <input
                    type="checkbox"
                    checked={column.notnull}
                    onChange={(e) => updateColumn(index, "notnull", e.target.checked)}
                    className="rounded"
                  />
                  NOT NULL
                </label>
                {columns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeColumn(index)}
                    className="rounded-md p-1 text-red-400 hover:bg-hover"
                  >
                    <XIcon size="14" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addColumn}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1",
                "font-mono text-sm text-text hover:bg-hover",
              )}
            >
              <PlusIcon size="12" />
              Add Column
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!tableName.trim() || !columns.every((col) => col.name.trim())}
            >
              Create Table
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
