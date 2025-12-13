import { Download, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import Dialog from "@/ui/dialog";
import type { DownloadProgress, UpdateInfo } from "../hooks/use-updater";

interface UpdateDialogProps {
  updateInfo: UpdateInfo;
  downloadProgress: DownloadProgress | null;
  downloading: boolean;
  installing: boolean;
  error: string | null;
  onDownload: () => void;
  onDismiss: () => void;
}

const UpdateDialog = ({
  updateInfo,
  downloadProgress,
  downloading,
  installing,
  error,
  onDownload,
  onDismiss,
}: UpdateDialogProps) => {
  const isUpdating = downloading || installing;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isUpdating) {
        e.preventDefault();
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, isUpdating]);

  return (
    <Dialog
      title="Update Available"
      icon={Download}
      onClose={onDismiss}
      size="sm"
      footer={
        <>
          <button
            onClick={onDismiss}
            disabled={isUpdating}
            className="rounded border border-border bg-primary-bg px-3 py-1.5 text-text text-xs transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Later
          </button>
          <button
            onClick={onDownload}
            disabled={isUpdating}
            className="rounded bg-accent px-3 py-1.5 text-white text-xs transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading
              ? `Downloading ${downloadProgress?.percentage ?? 0}%`
              : installing
                ? "Installing..."
                : "Update Now"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-text text-xs">
          <p>
            A new version of Athas is available:{" "}
            <span className="font-semibold">{updateInfo.version}</span>
          </p>
          <p className="mt-1 text-text-lighter">Current version: {updateInfo.currentVersion}</p>
        </div>

        {updateInfo.body && (
          <div className="rounded border border-border bg-secondary-bg p-3">
            <h4 className="mb-2 font-medium text-text-lighter text-xs">Release Notes</h4>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-text text-xs">
              {updateInfo.body}
            </div>
          </div>
        )}

        {downloading && downloadProgress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-text-lighter text-xs">
              <span>Downloading update...</span>
              <span>{downloadProgress.percentage}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary-bg">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${downloadProgress.percentage}%` }}
              />
            </div>
          </div>
        )}

        {installing && (
          <div className="flex items-center gap-2 text-text-lighter text-xs">
            <RefreshCw size={12} className="animate-spin" />
            <span>Installing update... The app will restart automatically.</span>
          </div>
        )}

        {error && (
          <div className="rounded border border-error/30 bg-error/10 p-2 text-error text-xs">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default UpdateDialog;
