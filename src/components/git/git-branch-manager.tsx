import { Check, ChevronDown, GitBranch, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { checkoutBranch, createBranch, deleteBranch, getBranches } from "../../utils/git";

interface GitBranchManagerProps {
  currentBranch?: string;
  repoPath?: string;
  onBranchChange?: () => void;
}

const GitBranchManager = ({ currentBranch, repoPath, onBranchChange }: GitBranchManagerProps) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadBranches();
  }, [repoPath]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showModal) {
        setShowModal(false);
      }
    };

    if (showModal) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showModal]);

  const loadBranches = async () => {
    if (!repoPath) return;

    try {
      const branchList = await getBranches(repoPath);
      setBranches(branchList);
    } catch (error) {
      console.error("Failed to load branches:", error);
    }
  };

  const handleBranchChange = async (branchName: string) => {
    if (!repoPath || !branchName || branchName === currentBranch) return;

    setIsLoading(true);
    try {
      const success = await checkoutBranch(repoPath, branchName);
      if (success) {
        setShowModal(false);
        onBranchChange?.();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!repoPath || !newBranchName.trim()) return;

    setIsLoading(true);
    try {
      const success = await createBranch(repoPath, newBranchName.trim(), currentBranch);
      if (success) {
        setNewBranchName("");
        await loadBranches();
        onBranchChange?.();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteBranch = async (branchName: string) => {
    if (!repoPath || !branchName || branchName === currentBranch) return;

    const confirmed = confirm(`Are you sure you want to delete branch "${branchName}"?`);
    if (!confirmed) return;

    setIsLoading(true);
    try {
      const success = await deleteBranch(repoPath, branchName);
      if (success) {
        await loadBranches();
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!currentBranch) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        disabled={isLoading}
        className="flex items-center gap-1 text-xs text-[var(--text-color)] font-medium hover:bg-[var(--hover-color)] px-2 py-1 rounded disabled:opacity-50"
      >
        <GitBranch size={12} className="text-[var(--text-lighter)]" />
        <span className="max-w-32 truncate">{currentBranch}</span>
        <ChevronDown size={8} />
      </button>

      {showModal && (
        <div
          className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg shadow-xl w-120 max-h-[60vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
              <h3 className="text-xs font-medium text-[var(--text-color)] flex items-center gap-1.5">
                <GitBranch size={12} />
                Branch Manager
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--text-lighter)] hover:text-[var(--text-color)] hover:bg-[var(--hover-color)] p-0.5 rounded"
              >
                <X size={12} />
              </button>
            </div>

            {/* Create New Branch */}
            <div className="px-3 py-2 border-b border-[var(--border-color)]">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-[var(--text-lighter)] font-medium">
                  Create New Branch
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Enter branch name..."
                    value={newBranchName}
                    onChange={e => setNewBranchName(e.target.value)}
                    className="flex-1 bg-[var(--secondary-bg)] text-[var(--text-color)] border border-[var(--border-color)] px-2 py-1.5 text-xs rounded focus:outline-none focus:border-blue-500"
                    onKeyDown={e => {
                      if (e.key === "Enter" && newBranchName.trim()) {
                        e.preventDefault();
                        handleCreateBranch();
                      }
                    }}
                    disabled={isLoading}
                    autoFocus
                  />
                  <button
                    onClick={handleCreateBranch}
                    disabled={!newBranchName.trim() || isLoading}
                    className="px-2 py-1.5 text-xs bg-blue-600 text-white border border-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Plus size={10} />
                    Create
                  </button>
                </div>
                {currentBranch && (
                  <p className="text-[10px] text-[var(--text-lighter)]">
                    From: <span className="font-mono">{currentBranch}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Branch List */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-3 py-1.5 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
                <h4 className="text-[10px] font-medium text-[var(--text-color)]">
                  Branches ({branches.length})
                </h4>
              </div>

              <div className="flex-1 overflow-y-auto">
                {branches.length === 0 ? (
                  <div className="p-3 text-center text-xs text-[var(--text-lighter)] italic">
                    No branches found
                  </div>
                ) : (
                  <div className="p-1">
                    {branches.map(branch => (
                      <div
                        key={branch}
                        className="flex items-center justify-between px-2 py-1.5 hover:bg-[var(--hover-color)] rounded group"
                      >
                        <button
                          onClick={() => handleBranchChange(branch)}
                          disabled={isLoading || branch === currentBranch}
                          className={`flex-1 text-left text-xs flex items-center gap-1.5 disabled:opacity-50 ${
                            branch === currentBranch
                              ? "text-[var(--text-color)] font-medium"
                              : "text-[var(--text-lighter)] hover:text-[var(--text-color)]"
                          }`}
                        >
                          {branch === currentBranch && (
                            <Check size={10} className="text-green-400" />
                          )}
                          <GitBranch size={10} className="text-[var(--text-lighter)]" />
                          <span className="truncate font-mono">{branch}</span>
                          {branch === currentBranch && (
                            <span className="text-[9px] text-green-400 ml-auto">current</span>
                          )}
                        </button>
                        {branch !== currentBranch && (
                          <button
                            onClick={() => handleDeleteBranch(branch)}
                            disabled={isLoading}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 hover:bg-red-400/10 p-0.5 rounded disabled:opacity-50"
                            title="Delete branch"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--secondary-bg)] rounded-b-lg">
              <div className="flex items-center justify-between text-[10px] text-[var(--text-lighter)]">
                <span>
                  Current:{" "}
                  <span className="font-mono text-[var(--text-color)]">{currentBranch}</span>
                </span>
                <span>
                  Press{" "}
                  <kbd className="px-1 py-0.5 bg-[var(--hover-color)] rounded text-[9px]">Esc</kbd>{" "}
                  to close
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GitBranchManager;
