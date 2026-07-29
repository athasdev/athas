import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import {
  WarningIcon as AlertTriangle,
  CheckCircleIcon as CheckCircle2,
  InfoIcon as Info,
  XIcon as X,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";

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
      position="bottom-right"
      expand
      theme={theme}
      icons={{
        success: <CheckCircle2 size={18} />,
        info: <Info size={18} />,
        warning: <AlertTriangle size={18} />,
        error: <AlertTriangle size={18} />,
        loading: <Spinner label="Loading" compact />,
        close: <X size={14} />,
      }}
      toastOptions={{
        closeButton: true,
        className: "font-sans font-normal group",
        descriptionClassName: "font-sans font-normal",
        classNames: {
          toast:
            "group font-sans rounded-xl border border-border bg-background text-foreground font-normal shadow-[var(--shadow-popover)] backdrop-blur-sm",
          content: "pr-8",
          title: "font-sans ui-text-sm font-normal leading-5 text-foreground",
          description: "font-sans ui-text-sm font-normal leading-5 text-muted-foreground",
          icon: "mt-0.5",
          success: "border-border",
          info: "border-border",
          warning: "border-border",
          error: "border-border",
          loading: "border-border",
          closeButton:
            "absolute left-auto right-2 top-2 m-0 opacity-0 transition-[transform,opacity,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] group-hover:opacity-100 border-none bg-transparent text-subtle-foreground hover:bg-accent hover:text-foreground active:scale-[var(--app-press-scale)]",
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
