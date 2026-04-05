import type { GenerativeUIAction, GenerativeUIComponent } from "../types/generative-ui";
import { ProGate } from "./pro-gate";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface GenerativeUIRendererProps {
  component: GenerativeUIComponent;
}

function ActionButton({ action }: { action: GenerativeUIAction }) {
  const handleClick = () => {
    if (action.url) {
      window.open(action.url, "_blank", "noopener,noreferrer");
    }
  };

  const variant =
    action.style === "primary" ? "primary" : action.style === "danger" ? "danger" : "secondary";

  return (
    <Button onClick={handleClick} variant={variant} size="sm" aria-label={action.label}>
      {action.label}
    </Button>
  );
}

function RenderComponent({ component }: { component: GenerativeUIComponent }) {
  const { type, props, children, actions } = component;

  const renderedChildren = children?.map((child, i) => (
    <RenderComponent key={`${child.type}-${i}`} component={child} />
  ));

  const renderedActions = actions && actions.length > 0 && (
    <div className="flex gap-2 pt-2">
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
    </div>
  );

  switch (type) {
    case "card":
      return (
        <div className="rounded-lg border border-border bg-secondary-bg/50 p-3">
          {typeof props.title === "string" && (
            <h3 className="mb-1 font-medium text-sm text-text">{props.title}</h3>
          )}
          {typeof props.description === "string" && (
            <p className="text-text-lighter text-xs">{props.description}</p>
          )}
          {renderedChildren}
          {renderedActions}
        </div>
      );
    case "list":
      return (
        <div className="space-y-1">
          {(props.items as string[] | undefined)?.map((item, i) => (
            <div
              key={`item-${i}`}
              className="rounded-md px-2 py-1 text-text text-xs hover:bg-hover"
            >
              {item}
            </div>
          ))}
          {renderedChildren}
          {renderedActions}
        </div>
      );
    case "table": {
      const headers = (props.headers as string[]) ?? [];
      const rows = (props.rows as string[][]) ?? [];
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            {headers.length > 0 && (
              <thead>
                <tr className="border-border border-b">
                  {headers.map((h, i) => (
                    <th
                      key={`h-${i}`}
                      className="px-2 py-1 text-left font-medium text-text-lighter"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, ri) => (
                <tr key={`r-${ri}`} className="border-border/50 border-b last:border-0">
                  {row.map((cell, ci) => (
                    <td key={`c-${ri}-${ci}`} className="px-2 py-1 text-text">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {renderedActions}
        </div>
      );
    }
    case "form":
      return (
        <div className={cn("space-y-2", typeof props.className === "string" && props.className)}>
          {renderedChildren}
          {renderedActions}
        </div>
      );
    case "custom":
      return (
        <div>
          {renderedChildren}
          {renderedActions}
        </div>
      );
    default:
      return null;
  }
}

export function GenerativeUIRenderer({ component }: GenerativeUIRendererProps) {
  return (
    <ProGate>
      <RenderComponent component={component} />
    </ProGate>
  );
}
