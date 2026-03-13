import { useCallback, useMemo } from "react";
import { useSqliteStore } from "../stores/sqlite-store";
import type { ForeignKeyInfo } from "../sqlite-types";

export function useFkNavigation() {
  const foreignKeys = useSqliteStore.use.foreignKeys();
  const actions = useSqliteStore.use.actions();

  const fkMap = useMemo(() => {
    const map = new Map<string, ForeignKeyInfo>();
    for (const fk of foreignKeys) {
      map.set(fk.from_column, fk);
    }
    return map;
  }, [foreignKeys]);

  const getForeignKey = useCallback(
    (columnName: string): ForeignKeyInfo | undefined => {
      return fkMap.get(columnName);
    },
    [fkMap],
  );

  const isForeignKey = useCallback(
    (columnName: string): boolean => {
      return fkMap.has(columnName);
    },
    [fkMap],
  );

  const navigateToReference = useCallback(
    async (columnName: string, value: unknown) => {
      const fk = fkMap.get(columnName);
      if (!fk || value === null || value === undefined) return;
      await actions.navigateToForeignKey(fk.to_table, fk.to_column, value);
    },
    [fkMap, actions],
  );

  return {
    foreignKeys,
    getForeignKey,
    isForeignKey,
    navigateToReference,
  };
}
