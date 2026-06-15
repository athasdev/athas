import type { DatabaseObjectKind, TableInfo } from "../types/common.types";

export const DATABASE_OBJECT_GROUPS: Array<{
  kind: DatabaseObjectKind;
  label: string;
}> = [
  { kind: "table", label: "Tables" },
  { kind: "view", label: "Views" },
  { kind: "materialized_view", label: "Materialized Views" },
  { kind: "subscription", label: "Subscriptions" },
  { kind: "index", label: "Indexes" },
];

const DATABASE_OBJECT_KINDS = new Set<DatabaseObjectKind>(
  DATABASE_OBJECT_GROUPS.map((group) => group.kind),
);

export function getDatabaseObjectKind(object: TableInfo): DatabaseObjectKind {
  return object.kind && DATABASE_OBJECT_KINDS.has(object.kind) ? object.kind : "table";
}

export function getDatabaseObjectOwner(object: TableInfo): string | null {
  const owner = object.table_name ?? object.tableName;
  if (!owner) return null;
  const normalizedOwner = owner.trim();
  return normalizedOwner.length > 0 ? normalizedOwner : null;
}

function hasDatabaseObjectName(object: TableInfo): boolean {
  return object.name.trim().length > 0;
}

function compareDatabaseObjects(left: TableInfo, right: TableInfo): number {
  return left.name.trim().localeCompare(right.name.trim(), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

export function groupDatabaseObjects(objects: TableInfo[]) {
  const namedObjects = objects.filter(hasDatabaseObjectName);

  return DATABASE_OBJECT_GROUPS.map((group) => ({
    ...group,
    objects: namedObjects
      .filter((object) => getDatabaseObjectKind(object) === group.kind)
      .slice()
      .sort(compareDatabaseObjects),
  })).filter((group) => group.objects.length > 0);
}
