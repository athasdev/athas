import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import type { FileSearchResult, SearchMatch } from "@/features/file-search/lib/file-search-api";
import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

const EXPANDED_CONTEXT_LINES = 7;
const emptyBuffers: PaneContent[] = [];
const emptyPaths: string[] = [];
const subscribeToNothing = () => () => {};
interface ContextSource {
  content: string;
  bufferId?: string;
}
interface ContextView {
  workspaceId: string;
  searchKey: string;
  inputQuery: string;
  searchRevision: number;
  results: FileSearchResult[];
  disabled: boolean;
}
function matchesSource(content: string, matches: SearchMatch[]): boolean {
  const lines = content.split(/\r\n|\r|\n/);
  return (
    matches.length > 0 &&
    matches.every((match) => lines[match.line_number - 1] === match.line_content.replace(/\r$/, ""))
  );
}
function findSource(buffers: PaneContent[], path: string) {
  return buffers.find(
    (buffer): buffer is EditorContent =>
      buffer.type === "editor" && !buffer.isVirtual && buffer.path === path,
  );
}
export function useSearchContext(view: ContextView) {
  const store = workspaceRuntimeRegistry.hasWorkspace(view.workspaceId)
    ? useBufferStore.getStore(view.workspaceId)
    : null;
  const session = useMemo(
    () => ({
      store,
      workspaceId: view.workspaceId,
      requests: new Map<string, Promise<void>>(),
      reads: new Map<string, Promise<string>>(),
      live: true,
    }),
    [store, view.workspaceId, view.searchKey, view.inputQuery, view.searchRevision],
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const viewRef = useRef(view);
  viewRef.current = view;
  const [state, setState] = useState({
    session,
    contents: {} as Record<string, ContextSource>,
    pending: new Set<string>(),
  });
  const expandedPaths = useMemo(
    () => (state.session === session ? Object.keys(state.contents) : emptyPaths),
    [state, session],
  );
  const getExpandedSources = useMemo(() => {
    let lastSources: Array<EditorContent | undefined> = [];
    return () => {
      const buffers = store?.getState().buffers ?? emptyBuffers;
      const nextSources = expandedPaths.map((path) => findSource(buffers, path));
      if (
        nextSources.length === lastSources.length &&
        nextSources.every((source, index) => source === lastSources[index])
      ) {
        return lastSources;
      }
      lastSources = nextSources;
      return lastSources;
    };
  }, [store, expandedPaths]);
  const expandedSources = useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    getExpandedSources,
  );
  const isCurrent = useCallback(
    () =>
      session.live &&
      sessionRef.current === session &&
      !!session.store &&
      workspaceRuntimeRegistry.getWorkspace(session.workspaceId)?.stores.get("editor-buffer") ===
        session.store,
    [session],
  );
  useEffect(() => {
    session.live = true;
    return () => {
      session.live = false;
      session.requests.clear();
      session.reads.clear();
    };
  }, [session]);
  const expandContext = useCallback(
    (filePath: string): Promise<void> => {
      if (!isCurrent() || viewRef.current.disabled) return Promise.resolve();
      const existing = session.requests.get(filePath);
      if (existing) return existing;
      const matches = viewRef.current.results.find(
        (result) => result.file_path === filePath,
      )?.matches;
      if (!matches?.length || !session.store) return Promise.resolve();
      setState((previous) => ({
        session,
        contents: previous.session === session ? previous.contents : {},
        pending: new Set([...(previous.session === session ? previous.pending : []), filePath]),
      }));
      const original = findSource(session.store.getState().buffers, filePath);
      let read = original ? Promise.resolve(original.content) : session.reads.get(filePath);
      if (!read) {
        read = Promise.resolve().then(() => {
          if (!isCurrent() || !session.requests.has(filePath))
            throw new Error("Context loading was cancelled.");
          return getWorkspaceResourceProvider(filePath).readText(filePath);
        });
        session.reads.set(filePath, read);
      }
      const task = read
        .then((content) => {
          if (!isCurrent() || session.requests.get(filePath) !== task) return;
          const current = findSource(session.store?.getState().buffers ?? [], filePath);
          if (original && !current)
            throw new Error(
              "The file was closed while loading context. Expand it again to read the saved file.",
            );
          const source = current?.content ?? content;
          if (!matchesSource(source, matches))
            throw new Error(
              "The file changed since this search. Refresh search before expanding context.",
            );
          setState((previous) => ({
            session,
            contents: {
              ...(previous.session === session ? previous.contents : {}),
              [filePath]: { content: source, bufferId: current?.id },
            },
            pending: previous.session === session ? previous.pending : new Set<string>(),
          }));
        })
        .catch((error) => {
          if (
            isCurrent() &&
            session.requests.get(filePath) === task &&
            workspaceRuntimeRegistry.getActiveWorkspaceId() === session.workspaceId
          )
            toast.error(error instanceof Error ? error.message : "Failed to expand search context");
        })
        .finally(() => {
          if (session.reads.get(filePath) === read) session.reads.delete(filePath);
          if (session.requests.get(filePath) !== task) return;
          session.requests.delete(filePath);
          if (!isCurrent()) return;
          setState((previous) => {
            if (previous.session !== session) return previous;
            const pending = new Set(previous.pending);
            pending.delete(filePath);
            return { ...previous, pending };
          });
        });
      session.requests.set(filePath, task);
      return task;
    },
    [session, isCurrent],
  );
  const collapseContext = useCallback(
    (filePath: string) => {
      if (!isCurrent()) return;
      session.requests.delete(filePath);
      setState((previous) => {
        if (previous.session !== session) return previous;
        const contents = { ...previous.contents };
        delete contents[filePath];
        const pending = new Set(previous.pending);
        pending.delete(filePath);
        return { ...previous, contents, pending };
      });
    },
    [session, isCurrent],
  );
  const sourceContentByPath = useMemo(() => {
    if (state.session !== session || !isCurrent()) return {};
    const contents: Record<string, string> = {};
    for (const [index, path] of expandedPaths.entries()) {
      const saved = state.contents[path];
      const current = expandedSources[index];
      if (saved.bufferId && current?.id !== saved.bufferId) continue;
      const source = current?.content ?? saved.content;
      const matches = view.results.find((result) => result.file_path === path)?.matches ?? [];
      if (matchesSource(source, matches)) contents[path] = source;
    }
    return contents;
  }, [state, session, isCurrent, expandedPaths, expandedSources, view.results]);
  const contextLinesByFile = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(sourceContentByPath).map((path) => [path, EXPANDED_CONTEXT_LINES]),
      ),
    [sourceContentByPath],
  );
  const isContextExpanded = useCallback(
    (path: string) => Object.prototype.hasOwnProperty.call(sourceContentByPath, path),
    [sourceContentByPath],
  );
  const isContextLoading = useCallback(
    (path: string) => state.session === session && state.pending.has(path),
    [state, session],
  );
  return {
    expandContext,
    collapseContext,
    sourceContentByPath,
    contextLinesByFile,
    isContextExpanded,
    isContextLoading,
  };
}
