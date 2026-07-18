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
            "group font-sans rounded-xl border border-border bg-primary-bg text-text font-normal shadow-[var(--shadow-popover)] backdrop-blur-sm",
          content: "pr-8",
          title: "font-sans ui-text-sm font-normal leading-5 text-text",
          description: "font-sans ui-text-sm font-normal leading-5 text-text-light",
          icon: "mt-0.5",
          success: "border-border",
          info: "border-border",
          warning: "border-border",
          error: "border-border",
          loading: "border-border",
          closeButton:
            "absolute left-auto right-2 top-2 m-0 opacity-0 transition-[transform,opacity,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] group-hover:opacity-100 border-none bg-transparent text-text-lighter hover:bg-hover hover:text-text active:scale-[var(--app-press-scale)]",
          actionButton: "font-sans border-none bg-hover text-text hover:bg-border",
          cancelButton: "font-sans border-none bg-hover text-text hover:bg-border",
        },
        actionButtonStyle: {
          background: "var(--color-hover)",
          color: "var(--color-text)",
        },
        cancelButtonStyle: {
          background: "var(--color-hover)",
          color: "var(--color-text)",
        },
        style: {
          background: "var(--color-primary-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text)",
          fontWeight: "400",
        },
      }}
    />
  );
}
