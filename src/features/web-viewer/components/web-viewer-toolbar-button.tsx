import type React from "react";

interface WebViewerToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  "aria-label": string;
}

export function WebViewerToolbarButton({
  onClick,
  disabled,
  title,
  children,
  "aria-label": ariaLabel,
}: WebViewerToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-text-light transition-colors hover:bg-hover hover:text-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-light"
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
