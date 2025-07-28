import { AlertCircle, Download, Folder } from "lucide-react";
import Button from "@/components/ui/button";
import { useUpdater } from "@/settings/hooks/use-updater";
import { cn } from "@/utils/cn";

interface RecentFolder {
  name: string;
  path: string;
  lastOpened: string;
}

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  recentFolders?: RecentFolder[];
  onOpenRecentFolder?: (path: string) => void;
}

const WelcomeScreen = ({
  onOpenFolder,
  recentFolders = [],
  onOpenRecentFolder,
}: WelcomeScreenProps) => {
  const {
    available,
    checking,
    downloading,
    installing,
    error,
    updateInfo,
    downloadAndInstall,
    dismissUpdate,
  } = useUpdater(true);

  const handleRecentFolderClick = (path: string) => {
    if (onOpenRecentFolder) {
      onOpenRecentFolder(path);
    } else {
      onOpenFolder();
    }
  };

  return (
    <div
      className={cn(
        "paper-texture paper-noise",
        "flex h-screen w-screen select-none flex-col items-center justify-center",
      )}
    >
      {/* Logo Section */}
      <div className={cn("mb-6 flex flex-col items-center")}>
        <div className={cn("mb-1 flex justify-center")}>
          <img src="/logo.svg" alt="athas industries" className={cn("h-12")} draggable="false" />
        </div>
        <div className={cn("flex items-center gap-2")}>
          <p className={cn("paper-text-light font-mono font-normal text-xs")}>v0.1.0</p>
          {checking && (
            <div className={cn("paper-text-light text-xs")} title="Checking for updates...">
              ⟳
            </div>
          )}
          {available && (
            <div
              className={cn("paper-text-accent text-xs")}
              title={`Update available: ${updateInfo?.version}`}
            >
              •
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className={cn("flex w-full max-w-sm flex-col items-center px-4")}>
        {/* Update Available Banner */}
        {available && (
          <div className={cn("mb-4 w-full")}>
            <div className={cn("paper-border rounded-md border p-3")}>
              <div className={cn("mb-2 flex items-center gap-2")}>
                <Download size={14} className={cn("paper-text-accent")} />
                <span className={cn("paper-text-primary font-mono text-xs")}>Update Available</span>
              </div>
              <p className={cn("paper-text-secondary mb-3 font-mono text-xs")}>
                Version {updateInfo?.version} is ready to install
              </p>
              <div className={cn("flex gap-2")}>
                <Button
                  onClick={downloadAndInstall}
                  disabled={downloading || installing}
                  variant="ghost"
                  className={cn(
                    "paper-button flex-1 gap-2 py-1 text-xs",
                    "transition-all duration-200",
                  )}
                  size="sm"
                >
                  {downloading ? (
                    "⟳ Downloading"
                  ) : installing ? (
                    "⟳ Installing"
                  ) : (
                    <>
                      <Download size={12} />
                      Install
                    </>
                  )}
                </Button>
                <Button
                  onClick={dismissUpdate}
                  variant="ghost"
                  className={cn(
                    "paper-button-secondary px-2 py-1 text-xs",
                    "transition-all duration-200",
                  )}
                  size="sm"
                >
                  Later
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className={cn("mb-4 w-full")}>
            <div className={cn("paper-border rounded-md border border-red-200 p-3")}>
              <div className={cn("flex items-center gap-2")}>
                <AlertCircle size={14} className={cn("text-red-500")} />
                <span className={cn("paper-text-primary font-mono text-xs")}>Update Error</span>
              </div>
              <p className={cn("paper-text-secondary mt-1 font-mono text-xs")}>{error}</p>
            </div>
          </div>
        )}

        {/* Open Folder Button */}
        <div className={cn("mb-6 w-full")}>
          <Button
            onClick={onOpenFolder}
            variant="ghost"
            className={cn("paper-button w-full gap-2 py-2 text-sm", "transition-all duration-200")}
            size="sm"
          >
            <Folder size={14} />
            Open Folder
          </Button>
        </div>

        {/* Recent Folders */}
        {recentFolders.length > 0 && (
          <div className={cn("w-full")}>
            <h3 className={cn("paper-text-secondary", "mb-2 font-mono text-xs")}>Recent</h3>
            <div className={cn("space-y-1.5")}>
              {recentFolders.map((folder, index) => (
                <Button
                  key={index}
                  onClick={() => handleRecentFolderClick(folder.path)}
                  variant="ghost"
                  className={cn(
                    "paper-recent-item group h-auto w-full justify-start p-2",
                    "transition-all duration-200",
                  )}
                  size="sm"
                >
                  <div className={cn("paper-text-primary truncate font-mono text-xs")}>
                    {folder.name}
                  </div>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WelcomeScreen;
