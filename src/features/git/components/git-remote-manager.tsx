import {
  GlobeHemisphereWestIcon as Globe,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandItem, CommandList } from "@/ui/command";
import Input from "@/ui/input";
import { matchesSearchQuery } from "@/utils/search-match";
import { addRemote, getRemotes, removeRemote } from "../api/git-remotes-api";
import type { GitRemote } from "../types/git.types";
import GitCommandSurface from "./git-command-surface";

interface GitRemoteManagerProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath?: string;
  onRefresh?: () => void;
}

const GitRemoteManager = ({ isOpen, onClose, repoPath, onRefresh }: GitRemoteManagerProps) => {
  const [query, setQuery] = useState("");
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    void loadRemotes();
  }, [isOpen, repoPath]);

  const handleClose = () => {
    setQuery("");
    setNewRemoteName("");
    setNewRemoteUrl("");
    onClose();
  };

  const filteredRemotes = useMemo(() => {
    if (!query.trim()) return remotes;
    return remotes.filter((remote) => matchesSearchQuery(query, [remote.name, remote.url]));
  }, [query, remotes]);

  const loadRemotes = async () => {
    if (!repoPath) return;

    setIsLoading(true);
    try {
      setRemotes(await getRemotes(repoPath));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddRemote = async () => {
    if (!repoPath || !newRemoteName.trim() || !newRemoteUrl.trim()) return;

    setIsLoading(true);
    try {
      const success = await addRemote(repoPath, newRemoteName.trim(), newRemoteUrl.trim());
      if (!success) return;
      setNewRemoteName("");
      setNewRemoteUrl("");
      await loadRemotes();
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveRemote = async (remoteName: string) => {
    if (!repoPath) return;

    setActionLoading((prev) => new Set(prev).add(remoteName));
    try {
      const success = await removeRemote(repoPath, remoteName);
      if (!success) return;
      await loadRemotes();
      onRefresh?.();
    } finally {
      setActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(remoteName);
        return next;
      });
    }
  };

  return (
    <GitCommandSurface
      isOpen={isOpen}
      onClose={handleClose}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search remotes..."
      meta={`${remotes.length} remote${remotes.length === 1 ? "" : "s"}`}
    >
      <div className="border-border/70 border-b px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-text">
          <Plus className="size-4 text-text-lighter" />
          <span className="ui-text-base font-medium">Add remote</span>
        </div>
        <div className="grid gap-1.5">
          <Input
            type="text"
            placeholder="Remote name"
            value={newRemoteName}
            onChange={(e) => setNewRemoteName(e.target.value)}
            size="xs"
            className="w-full"
          />
          <Input
            type="text"
            placeholder="Remote URL"
            value={newRemoteUrl}
            onChange={(e) => setNewRemoteUrl(e.target.value)}
            size="xs"
            className="w-full"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleAddRemote();
              }
            }}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => void handleAddRemote()}
              disabled={isLoading || !newRemoteName.trim() || !newRemoteUrl.trim()}
              compact
              variant="default"
            >
              {isLoading ? "Adding..." : "Add Remote"}
            </Button>
          </div>
        </div>
      </div>

      <CommandList>
        {isLoading && remotes.length === 0 ? (
          <CommandEmpty>Loading remotes...</CommandEmpty>
        ) : filteredRemotes.length === 0 ? (
          <CommandEmpty>
            {query.trim() ? "No matching remotes" : "No remotes configured"}
          </CommandEmpty>
        ) : (
          filteredRemotes.map((remote) => {
            const isActionLoading = actionLoading.has(remote.name);

            return (
              <CommandItem
                key={remote.name}
                as="div"
                className="ui-font h-auto min-h-8 items-start whitespace-normal px-2 py-1.5 leading-normal"
              >
                <Globe className="mt-0.5 size-4 shrink-0 text-text-lighter" />
                <div className="min-w-0 flex-1">
                  <div className="ui-text-base break-words text-text">{remote.name}</div>
                  <div className="ui-text-base mt-0.5 break-all text-text-lighter">
                    {remote.url}
                  </div>
                </div>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleRemoveRemote(remote.name);
                  }}
                  disabled={isActionLoading}
                  variant="ghost"
                  compact
                  className="shrink-0 text-error hover:bg-error/10 hover:text-error"
                  aria-label={`Remove ${remote.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </CommandItem>
            );
          })
        )}
      </CommandList>
    </GitCommandSurface>
  );
};

export default GitRemoteManager;
