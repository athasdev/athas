import { AlertCircle, Book, Download, Folder, Github, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/button";
import SettingsDialog from "@/settings/components/settings-dialog";
import { useUpdater } from "@/settings/hooks/use-updater";
import { useUIState } from "@/stores/ui-state-store";
import { fetchRawAppVersion } from "@/utils/app-utils";

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
  const [appVersion, setAppVersion] = useState<string>("...");
  const { openSettingsDialog, isSettingsDialogVisible, setIsSettingsDialogVisible } = useUIState();

  // Hide updater in development environment
  const isDevelopment = import.meta.env.MODE === "development";
  const {
    available,
    checking,
    downloading,
    installing,
    error,
    updateInfo,
    downloadAndInstall,
    dismissUpdate,
  } = useUpdater(!isDevelopment);

  useEffect(() => {
    const loadVersion = async () => {
      const version = await fetchRawAppVersion();
      setAppVersion(version);
    };

    loadVersion();
  }, []);

  const handleRecentFolderClick = (path: string) => {
    if (onOpenRecentFolder) {
      onOpenRecentFolder(path);
    } else {
      onOpenFolder();
    }
  };

  const openExternalLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      data-tauri-drag-region
      className="paper-texture paper-noise flex h-screen w-screen select-none flex-col items-center justify-center"
    >
      {/* Logo Section */}
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-1 flex justify-center">
          <img src="/logo.svg" alt="athas industries" className="h-12" draggable="false" />
        </div>
        <div className="flex items-center gap-2 text-text-lighter">
          <p className="font-mono text-xs">v{appVersion}</p>
          {!isDevelopment && checking && (
            <div className="animate-spin text-xs" title="Checking...">
              ⟳
            </div>
          )}
          {!isDevelopment && available && (
            <div className="text-accent text-xs" title={`Update: ${updateInfo?.version}`}>
              •
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex w-full max-w-sm flex-col items-center px-4">
        {/* Update Available Banner */}
        {!isDevelopment && available && (
          <div className="mb-4 w-full">
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Download size={14} className="text-accent" />
                <span className="font-mono text-text text-xs">Update Available</span>
              </div>
              <p className="mb-3 font-mono text-text-light text-xs">v{updateInfo?.version} ready</p>
              <div className="flex gap-2">
                <Button
                  onClick={downloadAndInstall}
                  disabled={downloading || installing}
                  variant="ghost"
                  className="flex-1 gap-1 bg-secondary-bg py-1 text-xs"
                  size="sm"
                >
                  {downloading ? (
                    <>
                      <div className="animate-spin">⟳</div> Download
                    </>
                  ) : installing ? (
                    <>
                      <div className="animate-spin">⟳</div> Install
                    </>
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
                  className="bg-secondary-bg px-2 py-1 text-xs"
                  size="sm"
                >
                  Later
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {!isDevelopment && error && (
          <div className="mb-4 w-full">
            <div className="rounded-md border border-error p-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-error" />
                <span className="font-mono text-text text-xs">Update Error</span>
              </div>
              <p className="mt-1 font-mono text-text-light text-xs">{error}</p>
            </div>
          </div>
        )}

        {/* Open Folder Button */}
        <div className="mb-6 flex w-full justify-center">
          <Button
            onClick={onOpenFolder}
            variant="ghost"
            className="flex gap-2 border border-border bg-secondary-bg px-4 py-3 text-xs"
            size="sm"
          >
            <Folder size={14} />
            Open Folder
          </Button>
        </div>

        {/* Recent Folders */}
        {recentFolders.length > 0 && (
          <div className="w-full">
            <h3 className="mb-2 font-mono text-text text-xs">Recent ({recentFolders.length})</h3>
            <div className="space-y-1.5">
              {recentFolders.map((folder, index) => (
                <Button
                  key={index}
                  onClick={() => handleRecentFolderClick(folder.path)}
                  variant="ghost"
                  className="flex h-auto w-full flex-col justify-start gap-1.5 border border-border bg-secondary-bg p-2"
                  size="sm"
                >
                  <div className="w-full truncate text-left font-mono text-text text-xs">
                    {folder.name}
                  </div>
                  <div className="w-full text-left">
                    <p className="font-mono text-text-lighter text-xs">
                      {folder.path.startsWith("/Users/")
                        ? `~${folder.path.substring(folder.path.indexOf("/", 7))}`
                        : folder.path}
                    </p>
                  </div>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Quick Links */}
        <div className="mt-6 flex w-full justify-center gap-4">
          <button
            onClick={() => openSettingsDialog()}
            className="flex items-center gap-1 text-text-lighter transition-colors hover:text-text"
          >
            <Settings size={14} />
            <span className="text-xs">Settings</span>
          </button>
          <a
            href="https://docs.athas.dev"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              openExternalLink("https://docs.athas.dev");
            }}
            className="flex items-center gap-1 text-text-lighter transition-colors hover:text-text"
          >
            <Book size={14} />
            <span className="text-xs">Docs</span>
          </a>
          <a
            href="https://github.com/athasdev/athas"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              openExternalLink("https://github.com/athasdev/athas");
            }}
            className="flex items-center gap-1 text-text-lighter transition-colors hover:text-text"
          >
            <Github size={14} />
            <span className="text-xs">GitHub</span>
          </a>
        </div>
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={isSettingsDialogVisible}
        onClose={() => setIsSettingsDialogVisible(false)}
      />
    </div>
  );
};

export default WelcomeScreen;
