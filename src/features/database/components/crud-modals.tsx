import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import Select from "@/ui/select";
import type { ColumnInfo, DatabaseRow } from "../types/common.types";
import {
  getInitialCreateTableColumn,
  normalizeCreateTableColumns,
  type CreateTableColumnDraft,
} from "../utils/create-table-form";
import { buildDatabaseRowValues, databaseRowToFormValues } from "../utils/value-coercion";

interface CreateRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnInfo[];
  onSubmit: (values: DatabaseRow) => void;
}

export const CreateRowModal = ({
  isOpen,
  onClose,
  tableName,
  columns,
  onSubmit,
}: CreateRowModalProps) => {
  const [values, setValues] = useState<Record<string, string>>({});

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
    <Dialog onClose={handleClose} title={`Add Row to ${tableName}`} icon={PlusIcon} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {columns
          .filter((col) => col.name.toLowerCase() !== "rowid")
          .map((column, index) => {
            const fieldId = `create-row-field-${index}`;
            return (
              <div key={column.name} className="space-y-1">
                <label htmlFor={fieldId} className="ui-font block ui-text-sm text-text">
                  {column.name}
                  <span className="ml-1 text-text-lighter ui-text-xs">({column.type})</span>
                </label>
                <Input
                  id={fieldId}
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
            );
          })}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose} compact>
            Cancel
          </Button>
          <Button type="submit" className="gap-1" compact>
            <PlusIcon size="14" />
            Add Row
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

interface EditRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnInfo[];
  initialData: DatabaseRow;
  onSubmit: (values: DatabaseRow) => void;
}

export const EditRowModal = ({
  isOpen,
  onClose,
  tableName,
  columns,
  initialData,
  onSubmit,
}: EditRowModalProps) => {
  const [values, setValues] = useState<Record<string, string>>(() =>
    databaseRowToFormValues(initialData),
  );

  useEffect(() => {
    if (isOpen) {
      setValues(databaseRowToFormValues(initialData));
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(buildDatabaseRowValues(values, columns));
    onClose();
  };

  const handleClose = () => {
    setValues(databaseRowToFormValues(initialData));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog onClose={handleClose} title={`Edit Row in ${tableName}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {columns
          .filter((col) => col.name.toLowerCase() !== "rowid")
          .map((column, index) => {
            const fieldId = `edit-row-field-${index}`;
            return (
              <div key={column.name} className="space-y-1">
                <label htmlFor={fieldId} className="ui-font block ui-text-sm text-text">
                  {column.name}
                  <span className="ml-1 text-text-lighter ui-text-xs">({column.type})</span>
                </label>
                <Input
                  id={fieldId}
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
            );
          })}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose} compact>
            Cancel
          </Button>
          <Button type="submit" compact>
            Save Changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

interface CreateTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (tableName: string, columns: CreateTableColumnDraft[]) => void;
}

export const CreateTableModal = ({ isOpen, onClose, onSubmit }: CreateTableModalProps) => {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<CreateTableColumnDraft[]>([getInitialCreateTableColumn()]);
  const normalizedColumns = normalizeCreateTableColumns(columns);
  const canSubmit = tableName.trim().length > 0 && normalizedColumns.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) {
      onSubmit(tableName.trim(), normalizedColumns);
      handleClose();
    }
  };

  const handleClose = () => {
    setTableName("");
    setColumns([getInitialCreateTableColumn()]);
    onClose();
  };

  const addColumn = () => {
    setColumns((prev) => [...prev, getInitialCreateTableColumn()]);
  };

  const removeColumn = (index: number) => {
    if (columns.length > 1) {
      setColumns((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const updateColumn = (
    index: number,
    field: keyof CreateTableColumnDraft,
    value: string | boolean,
  ) => {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, [field]: value } : col)));
  };

  if (!isOpen) return null;

  return (
    <Dialog onClose={handleClose} title="Create New Table" icon={PlusIcon} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="table-name" className="ui-font block ui-text-sm text-text">
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
          <div className="ui-font block ui-text-sm text-text">Columns</div>
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
                className="ui-font flex items-center gap-1 text-text ui-text-xs"
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
                  compact
                  className="rounded-md text-error"
                >
                  <XIcon size="14" />
                </Button>
              )}
            </div>
          ))}
          <Button type="button" onClick={addColumn} variant="ghost" className="rounded-md" compact>
            <PlusIcon size="12" />
            Add Column
          </Button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose} compact>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            Create Table
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
