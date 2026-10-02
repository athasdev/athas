/** "+12 -3" in the git colours; renders nothing when nothing changed. */
export function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono tabular-nums">
      {additions > 0 ? <span className="text-git-added">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-git-deleted">-{deletions}</span> : null}
    </span>
  );
}
