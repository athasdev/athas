import type { ImageOperationResult } from "../types/image-operation.types";
import { blobToDataURL } from "../utils/canvas-utils";

export interface ImageDraftState {
  initialSrc: string;
  history: string[];
  index: number;
  savedSrc: string;
  revision: number;
  processing: number;
  error: string | null;
}
interface ImageSaveSnapshot {
  source: string;
  revision: number;
  lifetime: object;
}
function initialState(source: string): ImageDraftState {
  return {
    initialSrc: source,
    history: [source],
    index: 0,
    savedSrc: source,
    revision: 0,
    processing: 0,
    error: null,
  };
}

export class ImageEditSession {
  private state: ImageDraftState;
  private lifetime = {};
  private queue = Promise.resolve();
  private active = true;
  private listeners = new Set<() => void>();

  constructor(
    private isOwnerLive: () => boolean = () => true,
    restored?: ImageDraftState,
  ) {
    this.state = restored ? { ...restored, processing: 0 } : initialState("");
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: ImageDraftState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  setSource(source: string, preserveDraft = false) {
    if (preserveDraft && this.state.initialSrc) return;
    this.active = true;
    this.lifetime = {};
    this.queue = Promise.resolve();
    this.publish(initialState(source));
  }
  dispose() {
    this.active = false;
    this.lifetime = {};
  }
  isLive() {
    return this.active && this.isOwnerLive();
  }
  runOperation(transform: (source: string) => Promise<ImageOperationResult>, fallback: string) {
    const owner = this.lifetime;
    const isCurrent = () => this.isLive() && this.lifetime === owner;
    if (!isCurrent() || !this.state.history[this.state.index]) return Promise.resolve();
    this.publish({ ...this.state, processing: this.state.processing + 1, error: null });
    const operation = this.queue.then(async () => {
      if (!isCurrent()) return;
      try {
        const result = await transform(this.state.history[this.state.index]);
        if (!isCurrent()) return;
        const source = await blobToDataURL(result.blob);
        if (!isCurrent()) return;
        const current = this.state;
        const history = current.history.slice(0, current.index + 1);
        if (source !== history[current.index]) history.push(source);
        this.publish({
          ...current,
          history,
          index: history.length - 1,
          revision: current.revision + 1,
          error: null,
        });
      } catch (error) {
        if (isCurrent())
          this.publish({ ...this.state, error: error instanceof Error ? error.message : fallback });
      } finally {
        if (isCurrent()) this.publish({ ...this.state, processing: this.state.processing - 1 });
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  private moveHistory(delta: number) {
    const current = this.state;
    const index = current.index + delta;
    if (!this.isLive() || current.processing || index < 0 || index >= current.history.length)
      return;
    this.publish({ ...current, index, revision: current.revision + 1, error: null });
  }
  undo = () => this.moveHistory(-1);
  redo = () => this.moveHistory(1);
  reset = () => {
    if (!this.isLive()) return;
    const current = this.state;
    this.lifetime = {};
    this.queue = Promise.resolve();
    this.publish({
      ...initialState(current.initialSrc),
      savedSrc: current.savedSrc,
      revision: current.revision + 1,
    });
  };
  captureSave = (): ImageSaveSnapshot | null => {
    const current = this.state;
    const source = current.history[current.index];
    return this.isLive() && source && !current.processing
      ? { source, revision: current.revision, lifetime: this.lifetime }
      : null;
  };
  isSaveCurrent = (snapshot: ImageSaveSnapshot) =>
    this.isLive() && this.lifetime === snapshot.lifetime;
  markSaved = (snapshot: ImageSaveSnapshot) => {
    if (!this.isSaveCurrent(snapshot)) return false;
    const current = this.state;
    this.publish({ ...current, savedSrc: snapshot.source });
    return (
      !current.processing &&
      current.revision === snapshot.revision &&
      current.history[current.index] === snapshot.source
    );
  };
}
