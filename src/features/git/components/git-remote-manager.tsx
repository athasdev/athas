import {
  GlobeHemisphereWestIcon as Globe,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from "@/ui/icons";
import { useEffect, useMemo, useState } from "react";
import {
  CommandEmpty,
  CommandForm,
  CommandFormField,
  CommandItemAction,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
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
  const [isAdding, setIsAdding] = useState(false);
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

    setIsAdding(true);
    try {
      const success = await addRemote(repoPath, newRemoteName.trim(), newRemoteUrl.trim());
      if (!success) return;
      setNewRemoteName("");
      setNewRemoteUrl("");
      await loadRemotes();
      onRefresh?.();
    } finally {
      setIsAdding(false);
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
      <CommandForm
        title="Add remote"
        icon={<Plus className="size-4" />}
        columns={2}
        submitLabel="Add remote"
        pendingLabel="Adding..."
        isPending={isAdding}
        submitDisabled={!newRemoteName.trim() || !newRemoteUrl.trim()}
        onSubmit={(event) => {
          event.preventDefault();
          void handleAddRemote();
        }}
      >
        <CommandFormField label="Name" htmlFor="git-remote-name">
          <Input
            id="git-remote-name"
            type="text"
            placeholder="origin"
            value={newRemoteName}
            onChange={(e) => setNewRemoteName(e.target.value)}
            size="sm"
          />
        </CommandFormField>
        <CommandFormField label="URL" htmlFor="git-remote-url">
          <Input
            id="git-remote-url"
            type="text"
            placeholder="https://github.com/owner/repository.git"
            value={newRemoteUrl}
            onChange={(e) => setNewRemoteUrl(e.target.value)}
            size="sm"
          />
        </CommandFormField>
      </CommandForm>

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
              <CommandItemRow
                key={remote.name}
                as="div"
                icon={<Globe className="size-4 text-text-lighter" />}
                title={remote.name}
                description={remote.url}
                contentLayout="stacked"
                action={
                  <CommandItemAction
                    tone="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleRemoveRemote(remote.name);
                    }}
                    disabled={isActionLoading}
                    aria-label={`Remove ${remote.name}`}
                    tooltip="Remove remote"
                  >
                    <Trash2 className="size-3.5" />
                  </CommandItemAction>
                }
              />
            );
          })
        )}
      </CommandList>
    </GitCommandSurface>
  );
};

export default GitRemoteManager;
