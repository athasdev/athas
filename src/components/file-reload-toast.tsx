import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

interface ToastItem {
  id: string;
  fileName: string;
  timestamp: number;
}

interface FileReloadToastProps {
  // This component maintains its own state and only uses this prop as a trigger
}

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
    <div className="fixed bottom-4 right-4 z-40 space-y-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="bg-[var(--secondary-bg)] backdrop-blur-sm border border-[var(--border-color)] rounded-lg shadow-lg px-4 py-2 text-sm
                     flex items-center gap-2 text-[var(--text-color)] animate-slide-in-right"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[var(--info-color)]" />
          <span>
            <span className="text-[var(--text-light)]">Reloaded</span>{" "}
            <span className="text-[var(--text-color)] font-medium">{toast.fileName}</span>
          </span>
        </div>
      ))}
    </div>
  );
};

export default FileReloadToast;
