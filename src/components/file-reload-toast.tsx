import { RefreshCw } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

interface ToastItem {
  id: string;
  fileName: string;
  timestamp: number;
}

type FileReloadToastProps = Record<string, never>;

// Keep track of toasts outside component to handle rapid updates
let toastCounter = 0;

const FileReloadToast: React.FC<FileReloadToastProps> = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    // Listen for custom event
    const handleFileReloaded = (event: CustomEvent) => {
      const path = event.detail.path;
      const fileName = path.split("/").pop() || path;

      const newToast: ToastItem = {
        id: `toast-${++toastCounter}`,
        fileName,
        timestamp: Date.now(),
      };

      setToasts(prev => [...prev, newToast]);

      // Remove this specific toast after 3 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== newToast.id));
      }, 3000);
    };

    window.addEventListener("file-reloaded", handleFileReloaded as any);

    return () => {
      window.removeEventListener("file-reloaded", handleFileReloaded as any);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 space-y-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="flex animate-slide-in-right items-center gap-2 rounded-lg border border-border bg-secondary-bg px-4 py-2 text-sm text-text shadow-lg backdrop-blur-sm"
        >
          <RefreshCw className="h-3.5 w-3.5 text-info" />
          <span>
            <span className="text-text-light">Reloaded</span>{" "}
            <span className="font-medium text-text">{toast.fileName}</span>
          </span>
        </div>
      ))}
    </div>
  );
};

export default FileReloadToast;
