import {
  GlobeHemisphereWestIcon as Globe,
  CopyIcon,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from "@/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/ui/dropdown";
import { SidebarForm, SidebarFooter, SidebarListMenuItem, SidebarScrollArea } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import { writeClipboardText } from "@/utils/clipboard";
import { matchesSearchQuery } from "@/utils/search-match";
import { addRemote, getRemotes, removeRemote } from "../api/git-remotes-api";
import type { GitRemote } from "../types/git.types";

interface GitRemoteManagerProps {
  query: string;
  repoPath?: string;
  onRefresh?: () => void;
}

const GitRemoteManager = ({ query, repoPath, onRefresh }: GitRemoteManagerProps) => {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteUrl, setNewRemoteUrl] = useState("");
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    void loadRemotes();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [repoPath]);

  const filteredRemotes = useMemo(() => {
    if (!query.trim()) return remotes;
    return remotes.filter((remote) => matchesSearchQuery(query, [remote.name, remote.url]));
  }, [query, remotes]);

  const loadRemotes = async () => {
    if (!repoPath) return;

    const requestId = ++loadRequestIdRef.current;
    setIsLoading(true);
    try {
      const nextRemotes = await getRemotes(repoPath);
      if (requestId === loadRequestIdRef.current) {
        setRemotes(nextRemotes);
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoading(false);
      }
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
      setIsCreateOpen(false);
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

  const handleCopyRemoteUrl = async (remote: GitRemote) => {
    try {
      await writeClipboardText(remote.url);
      toast.success(`${remote.name} URL copied`);
    } catch (error) {
      console.error("Failed to copy remote URL:", error);
      toast.error("Failed to copy remote URL");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarScrollArea className="min-h-0 flex-1">
        {isCreateOpen ? (
          <SidebarForm
            title="Add remote"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAddRemote();
            }}
            actions={
              <>
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  disabled={!newRemoteName.trim() || !newRemoteUrl.trim() || isAdding}
                >
                  {isAdding ? "Adding..." : "Add"}
                </Button>
              </>
            }
          >
            <FieldGroup className="gap-2">
              <Field>
                <FieldLabel htmlFor="git-remote-name">Name</FieldLabel>
                <Input
                  id="git-remote-name"
                  type="text"
                  placeholder="origin"
                  value={newRemoteName}
                  onChange={(event) => setNewRemoteName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="git-remote-url">URL</FieldLabel>
                <Input
                  id="git-remote-url"
                  type="text"
                  placeholder="https://github.com/owner/repository.git"
                  value={newRemoteUrl}
                  onChange={(event) => setNewRemoteUrl(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </SidebarForm>
        ) : null}

        {isLoading && remotes.length === 0 ? (
          <EmptyState layout="sidebar" message={<Spinner label="Loading remotes" showLabel />} />
        ) : filteredRemotes.length === 0 ? (
          <EmptyState
            layout="sidebar"
            title={query.trim() ? "No matching remotes" : "No remotes configured"}
          />
        ) : (
          filteredRemotes.map((remote) => {
            const isActionLoading = actionLoading.has(remote.name);

            return (
              <SidebarListMenuItem
                key={remote.name}
                leading={<Globe />}
                description={remote.url}
                disabled={isActionLoading}
                onClick={() => void handleCopyRemoteUrl(remote)}
                aria-label={`Copy URL for ${remote.name}`}
                title={remote.url}
                menuLabel={`Actions for ${remote.name}`}
                menu={
                  <>
                    <DropdownMenuItem onClick={() => void handleCopyRemoteUrl(remote)}>
                      <CopyIcon />
                      Copy remote URL
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => void handleRemoveRemote(remote.name)}
                      disabled={isActionLoading}
                    >
                      <Trash2 />
                      Remove remote
                    </DropdownMenuItem>
                  </>
                }
              >
                {remote.name}
              </SidebarListMenuItem>
            );
          })
        )}
      </SidebarScrollArea>
      {!isCreateOpen ? (
        <SidebarFooter>
          <div className="p-1 pb-0">
            <Button className="w-full" type="button" onClick={() => setIsCreateOpen(true)}>
              <Plus />
              Add remote
            </Button>
          </div>
        </SidebarFooter>
      ) : null}
    </div>
  );
};

export default GitRemoteManager;
