/// <reference types="vite/client" />

interface Window {
  electron: {
    showContextMenu: (type: string, data?: any) => void;
    getPath: (path: string) => Promise<string>;
    shell: {
      openExternal: (url: string) => Promise<void>;
      showItemInFolder: (path: string) => void;
      openPath: (path: string) => Promise<string>;
    };
  };
}
