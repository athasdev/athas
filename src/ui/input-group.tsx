import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentProps } from "react";
import { Button, type ButtonProps } from "@/ui/button";
import Input, { type InputProps } from "@/ui/input";
import Textarea from "@/ui/textarea";
import { cn } from "@/utils/cn";

function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex min-h-7 w-full min-w-0 items-center rounded-chrome border border-border bg-surface text-foreground outline-none transition-colors has-disabled:opacity-50 has-[[data-slot=input-group-control]:focus-visible]:border-border-strong has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-border-strong/35 has-[[data-slot][aria-invalid=true]]:border-destructive has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto",
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text select-none items-center justify-center gap-2 py-1 font-sans ui-text-sm font-medium text-subtle-foreground group-data-[disabled=true]/input-group:opacity-50 [&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        "inline-start": "order-first pl-2",
        "inline-end": "order-last pr-2",
        "block-start": "order-first w-full justify-start px-2.5 pt-2",
        "block-end": "order-last w-full justify-start px-2.5 pb-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  },
);

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        event.currentTarget.parentElement
          ?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")
          ?.focus();
      }}
      {...props}
    />
  );
}

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  iconOnly = false,
  ...props
}: Omit<ButtonProps, "type"> & {
  type?: "button" | "submit" | "reset";
}) {
  return (
    <Button
      type={type}
      variant={variant}
      iconOnly={iconOnly}
      className={cn("h-5 shadow-none", iconOnly ? "w-5" : "px-1.5", className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 font-sans ui-text-sm text-subtle-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

const InputGroupInput = forwardRef<HTMLInputElement, InputProps>(function InputGroupInput(
  { className, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      data-slot="input-group-control"
      variant="ghost"
      className={cn(
        "min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0",
        className,
      )}
      {...props}
    />
  );
});

const InputGroupTextarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(
  function InputGroupTextarea({ className, ...props }, ref) {
    return (
      <Textarea
        ref={ref}
        data-slot="input-group-control"
        variant="ghost"
        className={cn(
          "min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0",
          className,
        )}
        {...props}
      />
    );
  },
);

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
};
