import type { GenerativeUIAction, GenerativeUIComponent } from "../types/generative-ui";
import { ProGate } from "./pro-gate";
import { Button } from "@/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ui/card";
import { Item, ItemTitle } from "@/ui/item";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
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
    action.style === "primary" ? "accent" : action.style === "danger" ? "danger" : "default";

  return (
    <Button onClick={handleClick} variant={variant} aria-label={action.label} size="xs">
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
        <Card size="sm">
          {typeof props.title === "string" || typeof props.description === "string" ? (
            <CardHeader>
              {typeof props.title === "string" ? <CardTitle>{props.title}</CardTitle> : null}
              {typeof props.description === "string" ? (
                <CardDescription>{props.description}</CardDescription>
              ) : null}
            </CardHeader>
          ) : null}
          {renderedChildren ? <CardContent>{renderedChildren}</CardContent> : null}
          {renderedActions ? <CardFooter>{renderedActions}</CardFooter> : null}
        </Card>
      );
    case "list":
      return (
        <div className="space-y-1">
          {(props.items as string[] | undefined)?.map((item, i) => (
            <Item key={`item-${i}`} size="xs">
              <ItemTitle className="font-normal">{item}</ItemTitle>
            </Item>
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
          <Table>
            {headers.length > 0 && (
              <TableHeader className="static">
                <TableRow>
                  {headers.map((h, i) => (
                    <TableHead key={`h-${i}`}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
            )}
            <TableBody>
              {rows.map((row, ri) => (
                <TableRow key={`r-${ri}`} className="border-border/50">
                  {row.map((cell, ci) => (
                    <TableCell key={`c-${ri}-${ci}`}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
