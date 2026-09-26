interface AcpJsonBlockProps {
  value: unknown;
  /** Shown instead of the value when it is empty. */
  emptyLabel?: string;
}

/** Pretty JSON for a message or capability, selectable and wrapped. */
export function AcpJsonBlock({ value, emptyLabel = "Not sent" }: AcpJsonBlockProps) {
  if (value === null || value === undefined) {
    return <p className="text-subtle-foreground ui-text-sm">{emptyLabel}</p>;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-surface px-3 py-2 font-mono text-foreground whitespace-pre-wrap wrap-anywhere select-text ui-text-sm">
      {text}
    </pre>
  );
}
