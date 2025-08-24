import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

const Menu = ({ children }: Props) => {
  return (
    <div className="w-max min-w-48 rounded-md border border-border bg-primary-bg py-1 shadow-lg">
      {children}
    </div>
  );
};

export default Menu;
