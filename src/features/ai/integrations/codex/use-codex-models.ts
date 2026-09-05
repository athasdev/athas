import { useCallback, useEffect, useState } from "react";
import { listCodexComposerModels } from "./codex-composer-catalog";
import type { CodexModelOption } from "./codex-types";

export function useCodexModels(cwd: string) {
  const [state, setState] = useState<{
    cwd: string;
    models: CodexModelOption[];
    loading: boolean;
    error: string | null;
  }>({ cwd, models: [], loading: true, error: null });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let current = true;
    setState((state) => ({
      cwd,
      models: state.cwd === cwd ? state.models : [],
      loading: true,
      error: null,
    }));
    void listCodexComposerModels(cwd, revision > 0)
      .then((models) => {
        if (current) setState({ cwd, models, loading: false, error: null });
      })
      .catch((error) => {
        if (current) setState((state) => ({ ...state, loading: false, error: String(error) }));
      });
    return () => {
      current = false;
    };
  }, [cwd, revision]);
  return {
    models: state.cwd === cwd ? state.models : [],
    loading: state.cwd !== cwd || state.loading,
    error: state.cwd === cwd ? state.error : null,
    retry,
  };
}
