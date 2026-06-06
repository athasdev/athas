import { Children, cloneElement, forwardRef, isValidElement } from "react";
import type React from "react";
import { cn } from "@/utils/cn";

type SlotProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
};

type SlotChildProps = React.HTMLAttributes<HTMLElement> & {
  ref?: React.Ref<HTMLElement>;
};

function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    }
  };
}

export const Slot = forwardRef<HTMLElement, SlotProps>(function Slot(
  { children, className, ...props },
  ref,
) {
  const child = Children.only(children);

  if (!isValidElement<SlotChildProps>(child)) {
    return null;
  }

  return cloneElement(child, {
    ...props,
    ...child.props,
    ref: composeRefs(ref, child.props.ref),
    className: cn(className, child.props.className),
  });
});
