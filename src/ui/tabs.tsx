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
        /** Filled pills. The active tab takes the selected fill. */
        default: "gap-chrome-tight",
        /** Text with an underline marking the active tab. */
        line: "gap-chrome",
        /** Pills that shrink to their icon when inactive, for a narrow sidebar header. */
        sidebar: "min-w-0 max-w-full gap-chrome-tight",
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
        "relative inline-flex h-chrome-control flex-1 select-none items-center justify-center gap-chrome-loose whitespace-nowrap rounded-md px-2 font-sans font-medium ui-text-chrome text-subtle-foreground outline-none transition-[background-color,color,box-shadow] duration-fast ease-smooth hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 data-active:bg-selected data-active:text-foreground group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:hover:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-2 group-data-[variant=line]/tabs-list:after:-bottom-px group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:after:rounded-full group-data-[variant=line]/tabs-list:after:bg-transparent group-data-[variant=line]/tabs-list:data-active:after:bg-primary group-data-[variant=sidebar]/tabs-list:min-w-0 group-data-[variant=sidebar]/tabs-list:flex-none group-data-[variant=sidebar]/tabs-list:data-active:shrink motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
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
