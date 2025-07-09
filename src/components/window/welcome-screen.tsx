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
    <div className="flex flex-col items-center justify-center h-screen w-screen paper-texture paper-noise">
      {/* Logo Section */}
      <div className="flex flex-col items-center mb-6">
        <div className="flex justify-center mb-1">
          <img src="/industry.png" alt="athas industries" className="h-48" />
        </div>
        <p className="font-mono text-xs paper-text-light font-normal">v0.1.0</p>
      </div>

      {/* Main Content */}
      <div className="flex flex-col items-center w-full max-w-sm px-4">
        {/* Open Folder Button */}
        <div className="mb-6 w-full">
          <button
            onClick={onOpenFolder}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 font-mono text-sm paper-button rounded-md transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
          >
            <Folder size={16} />
            Open Folder
          </button>
        </div>

        {/* Recent Folders */}
        {recentFolders.length > 0 && (
          <div className="w-full">
            <h3 className="font-mono text-xs paper-text-secondary mb-2 flex items-center gap-2">
              <Clock size={14} />
              Recent
            </h3>
            <div className="space-y-1.5">
              {recentFolders.map((folder, index) => (
                <button
                  key={index}
                  onClick={() => handleRecentFolderClick(folder.path)}
                  className="w-full p-2 rounded-md paper-recent-item transition-all duration-200 text-left group cursor-pointer active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen
                      size={14}
                      className="paper-text-light group-hover:paper-text-secondary transition-colors flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs paper-text-primary truncate">
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
