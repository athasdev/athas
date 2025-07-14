import { Clock, Folder, FolderOpen } from "lucide-react";

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
  const handleRecentFolderClick = (path: string) => {
    if (onOpenRecentFolder) {
      onOpenRecentFolder(path);
    } else {
      onOpenFolder();
    }
  };

  return (
    <div className="paper-texture paper-noise flex h-screen w-screen flex-col items-center justify-center">
      {/* Logo Section */}
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-1 flex justify-center">
          <img src="/industry.png" alt="athas industries" className="h-48" />
        </div>
        <p className="paper-text-light font-mono font-normal text-xs">v0.1.0</p>
      </div>

      {/* Main Content */}
      <div className="flex w-full max-w-sm flex-col items-center px-4">
        {/* Open Folder Button */}
        <div className="mb-6 w-full">
          <button
            onClick={onOpenFolder}
            className="paper-button flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 font-mono text-sm transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
          >
            <Folder size={16} />
            Open Folder
          </button>
        </div>

        {/* Recent Folders */}
        {recentFolders.length > 0 && (
          <div className="w-full">
            <h3 className="paper-text-secondary mb-2 flex items-center gap-2 font-mono text-xs">
              <Clock size={14} />
              Recent
            </h3>
            <div className="space-y-1.5">
              {recentFolders.map((folder, index) => (
                <button
                  key={index}
                  onClick={() => handleRecentFolderClick(folder.path)}
                  className="paper-recent-item group w-full cursor-pointer rounded-md p-2 text-left transition-all duration-200 active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen
                      size={14}
                      className="paper-text-light group-hover:paper-text-secondary flex-shrink-0 transition-colors"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="paper-text-primary truncate font-mono text-xs">
                        {folder.name}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WelcomeScreen;
