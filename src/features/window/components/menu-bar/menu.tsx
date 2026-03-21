import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
}

const Menu = ({ children, ...props }: Props) => {
  return (
    <div
      role="menu"
      className="w-max min-w-48 rounded-xl border border-border/80 bg-secondary-bg/95 p-1 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      {...props}
    >
      {children}
    </div>
  );
};

export default Menu;
