import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
}

const Menu = ({ children, ...props }: Props) => {
  return (
    <div
      role="menu"
      className="w-max min-w-48 rounded-md border border-border bg-primary-bg shadow-lg"
      {...props}
    >
      {children}
    </div>
  );
};

export default Menu;
