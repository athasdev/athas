import { motion } from "framer-motion";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOnClickOutside } from "usehooks-ts";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Input from "@/ui/input";
import Select from "@/ui/select";
import type { ColumnInfo } from "../../../models/common.types";
import { buildDatabaseRowValues } from "../utils/value-coercion";

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
    onSubmit(buildDatabaseRowValues(values, columns));
    setValues({});
    onClose();
  };

  const handleClose = () => {
    setValues({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/45 backdrop-blur-sm"
    >
      <motion.div
        ref={modalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="w-full max-w-md rounded-2xl border border-border/70 bg-secondary-bg/95 p-5 shadow-[0_20px_40px_-28px_rgba(0,0,0,0.5)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="ui-font font-medium text-lg text-text">Add Row to {tableName}</h2>
          <Button onClick={handleClose} variant="ghost" size="icon-sm" className="rounded-full">
            <XIcon size="16" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {columns
            .filter((col) => col.name.toLowerCase() !== "rowid")
            .map((column) => (
              <div key={column.name} className="space-y-1">
                <label
                  htmlFor={`create-${column.name}`}
                  className="ui-font block text-sm text-text"
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
      </motion.div>
    </motion.div>
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
    onSubmit(buildDatabaseRowValues(values, columns));
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/45 backdrop-blur-sm"
    >
      <motion.div
        ref={editModalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="w-full max-w-md rounded-2xl border border-border/70 bg-secondary-bg/95 p-5 shadow-[0_20px_40px_-28px_rgba(0,0,0,0.5)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="ui-font font-medium text-lg text-text">Edit Row in {tableName}</h2>
          <Button onClick={handleClose} variant="ghost" size="icon-sm" className="rounded-full">
            <XIcon size="16" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {columns
            .filter((col) => col.name.toLowerCase() !== "rowid")
            .map((column) => (
              <div key={column.name} className="space-y-1">
                <label htmlFor={`edit-${column.name}`} className="ui-font block text-sm text-text">
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
      </motion.div>
    </motion.div>
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/45 backdrop-blur-sm"
    >
      <motion.div
        ref={createTableModalRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="w-full max-w-lg rounded-2xl border border-border/70 bg-secondary-bg/95 p-5 shadow-[0_20px_40px_-28px_rgba(0,0,0,0.5)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="ui-font font-medium text-lg text-text">Create New Table</h2>
          <Button onClick={handleClose} variant="ghost" size="icon-sm" className="rounded-full">
            <XIcon size="16" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="table-name" className="ui-font block text-sm text-text">
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
            <div className="ui-font block text-sm text-text">Columns</div>
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
                <Select
                  value={column.type}
                  onChange={(value) => updateColumn(index, "type", value)}
                  options={[
                    { value: "TEXT", label: "TEXT" },
                    { value: "INTEGER", label: "INTEGER" },
                    { value: "REAL", label: "REAL" },
                    { value: "BLOB", label: "BLOB" },
                  ]}
                  size="md"
                  className="bg-input"
                />
                <label
                  htmlFor={`column-not-null-${index}`}
                  className="ui-font flex items-center gap-1 text-text text-xs"
                >
                  <Checkbox
                    id={`column-not-null-${index}`}
                    checked={column.notnull}
                    onChange={(checked) => updateColumn(index, "notnull", checked)}
                    ariaLabel={`Set ${column.name || `column ${index + 1}`} as not null`}
                  />
                  NOT NULL
                </label>
                {columns.length > 1 && (
                  <Button
                    type="button"
                    onClick={() => removeColumn(index)}
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-full text-red-400"
                  >
                    <XIcon size="14" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              onClick={addColumn}
              variant="ghost"
              size="sm"
              className="rounded-full"
            >
              <PlusIcon size="12" />
              Add Column
            </Button>
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
      </motion.div>
    </motion.div>
  );
};
