import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import {
  WarningIcon as AlertTriangle,
  CheckCircleIcon as CheckCircle2,
  InfoIcon as Info,
  XIcon as X,
} from "@/ui/icons";
import { ThinkingOrb } from "@/ui/thinking-orb";

function getToastTheme(): ToasterProps["theme"] {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme-type") === "light" ? "light" : "dark";
}

export function Toaster() {
  const [theme, setTheme] = useState<ToasterProps["theme"]>(getToastTheme);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(getToastTheme()));

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme-type"],
    });
    setTheme(getToastTheme());

    return () => observer.disconnect();
  }, []);

  return (
    <SonnerToaster
      className="font-sans!"
      position="bottom-right"
      expand
      theme={theme}
      icons={{
        success: <CheckCircle2 size={18} />,
        info: <Info size={18} />,
        warning: <AlertTriangle size={18} />,
        error: <AlertTriangle size={18} />,
        loading: <ThinkingOrb state="working" size={20} aria-label="Loading" />,
        close: <X size={14} />,
      }}
      toastOptions={{
        closeButton: true,
        className: "group font-sans! font-normal!",
        descriptionClassName: "font-sans! font-normal!",
        classNames: {
          toast:
            "group rounded-xl! border-border! bg-background! font-sans! font-normal! text-foreground! shadow-(--shadow-popover)! backdrop-blur-sm",
          content: "pr-8",
          title: "ui-text-sm font-sans! font-normal! leading-5! tracking-normal! text-foreground!",
          description:
            "ui-text-sm font-sans! font-normal! leading-5! tracking-normal! text-muted-foreground!",
          icon: "mt-0.5",
          success: "border-border",
          info: "border-border",
          warning: "border-border",
          error: "border-border",
          loading: "border-border",
          closeButton:
            "absolute top-2! right-2! left-auto! m-0! size-4.5! transform-none! rounded-md! border-transparent! bg-transparent! text-subtle-foreground! shadow-none! opacity-0 transition-[transform,opacity,background-color,color] duration-(--app-duration-fast) ease-(--app-ease-smooth) group-hover:opacity-100 hover:bg-accent! hover:text-foreground! active:scale-(--app-press-scale) rtl:right-auto! rtl:left-2!",
          actionButton: "font-sans border-none bg-accent text-foreground hover:bg-border",
          cancelButton: "font-sans border-none bg-accent text-foreground hover:bg-border",
        },
        actionButtonStyle: {
          background: "var(--accent)",
          color: "var(--foreground)",
        },
        cancelButtonStyle: {
          background: "var(--accent)",
          color: "var(--foreground)",
        },
        style: {
          background: "var(--background)",
          border: "1px solid var(--border)",
          color: "var(--foreground)",
          fontWeight: "400",
        },
      }}
    />
  );
}
