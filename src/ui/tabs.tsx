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
  "group/tabs-list inline-flex w-fit items-center justify-center text-subtle-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "gap-chrome-tight bg-transparent",
        line: "gap-chrome bg-transparent",
        bare: "gap-chrome bg-transparent",
        sidebar: "min-w-0 max-w-full gap-chrome-tight bg-transparent",
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

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-chrome-control flex-1 select-none items-center justify-center gap-chrome-loose whitespace-nowrap rounded-chrome border border-transparent px-2 font-sans font-normal ui-text-chrome text-subtle-foreground outline-none transition-[background-color,border-color,color,box-shadow] duration-fast ease-smooth hover:bg-accent/50 hover:text-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 data-active:bg-accent/80 data-active:text-foreground group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=bare]/tabs-list:bg-transparent group-data-[variant=bare]/tabs-list:data-active:bg-accent/80 group-data-[variant=sidebar]/tabs-list:min-w-0 group-data-[variant=sidebar]/tabs-list:flex-none group-data-[variant=sidebar]/tabs-list:data-active:shrink motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
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

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
