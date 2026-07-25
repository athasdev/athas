import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex min-h-0 min-w-0 gap-2 data-[orientation=horizontal]:flex-col",
        className,
      )}
      orientation={orientation}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center text-text-lighter group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "gap-0.5 rounded-lg bg-secondary-bg/55 p-0.5",
        segmented: "min-h-6 items-stretch overflow-hidden rounded-lg bg-secondary-bg/55",
        line: "gap-1 bg-transparent",
        bare: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

const tabsTriggerVariants = cva(
  "relative inline-flex flex-1 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-sans font-normal text-text-lighter outline-none transition-[background-color,border-color,color,box-shadow] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:bg-hover/50 hover:text-text focus-visible:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent/20 disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-hover/80 data-[active]:text-text group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[active]:bg-transparent group-data-[variant=bare]/tabs-list:bg-transparent group-data-[variant=bare]/tabs-list:data-[active]:bg-hover/80 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      size: {
        xs: "h-6 px-2 ui-text-sm",
        sm: "h-7 px-2.5 ui-text-sm",
        md: "min-h-8 px-3 ui-text-base",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

function TabsTrigger({
  className,
  size = "sm",
  ...props
}: TabsPrimitive.Tab.Props & VariantProps<typeof tabsTriggerVariants>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ size }), className)}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("min-h-0 min-w-0 flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants, tabsTriggerVariants };
