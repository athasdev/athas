import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
}

const Menu = ({ children, ...props }: Props) => {
  return (
    <div
      role="menu"
      className="w-max min-w-[240px] max-w-[min(480px,calc(100vw-16px))] rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      {...props}
    >
      {children}
    </div>
  );
};

export default Menu;
