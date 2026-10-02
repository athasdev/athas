/// <reference types="vite/client" />

declare module "monaco-editor/esm/vs/basic-languages/*";
declare module "monaco-editor/esm/vs/language/*";
declare module "monaco-editor/esm/vs/editor/common/services/resolverService.js" {
  export const ITextModelService: unknown;
}
declare module "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js" {
  export const StandaloneServices: { get(serviceId: unknown): unknown };
}
declare module "monaco-editor/esm/vs/editor/common/core/range.js" {
  export class Range {
    constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    );
  }
}
declare module "monaco-editor/esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js" {
  interface PieceTreeContentChange {
    range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    };
    rangeOffset: number;
    rangeLength: number;
    text: string;
  }
  interface PieceTreeTextBuffer {
    getEOL(): string;
    getLength(): number;
    getLinesContent(): string[];
    applyEdits(
      operations: { range: unknown; text: string }[],
      recordTrimAutoWhitespace: boolean,
      computeUndoEdits: boolean,
    ): { changes: PieceTreeContentChange[] };
  }
  export class PieceTreeTextBufferBuilder {
    acceptChunk(chunk: string): void;
    finish(normalizeEOL?: boolean): {
      create(defaultEOL: number): { textBuffer: PieceTreeTextBuffer };
    };
  }
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  electron: {
    showContextMenu: (type: string, data?: any) => void;
    getPath: (path: string) => Promise<string>;
    shell: {
      openExternal: (url: string) => Promise<void>;
      showItemInFolder: (path: string) => void;
      openPath: (path: string) => Promise<string>;
    };
  };
  __fileDragData?: {
    path: string;
    name: string;
    isDir: boolean;
  };
}
