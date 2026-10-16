import { describeMcpServer, MCP_TRANSPORT_LABELS } from "@/features/ai/services/mcp-servers";
import type { McpServerSetting } from "@/features/ai/types/mcp-server.types";
import Badge from "@/ui/badge";
import { menuSeparator, type MenuItem } from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { GroupedSection } from "@/ui/grouped-section";
import {
  BoltIcon,
  BoltSlashIcon,
  PencilIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
} from "@/ui/icons";
import type { useMcpServerEditor } from "../hooks/use-mcp-server-editor";
import {
  buildInstalledMcpRows,
  buildMcpCatalogGroups,
  createMcpDraftFromCatalog,
} from "../services/customize-catalog";
import type { CustomizeTab, McpCatalogEntry } from "../types/customize.types";
import { CustomizeAddButton, CustomizeMoreMenu, CustomizeRow } from "./customize-row";

type McpServerEditor = ReturnType<typeof useMcpServerEditor>;

export function mcpServerMenuItems(server: McpServerSetting, editor: McpServerEditor): MenuItem[] {
  return [
    {
      id: "enabled",
      label: server.enabled ? "Turn off" : "Turn on",
      icon: server.enabled ? <BoltSlashIcon /> : <BoltIcon />,
      onClick: () => void editor.setEnabled(server, !server.enabled),
    },
    {
      id: "edit",
      label: "Edit…",
      icon: <PencilIcon />,
      onClick: () => void editor.openEdit(server),
    },
    menuSeparator("remove-separator"),
    {
      id: "remove",
      label: "Remove",
      icon: <TrashIcon />,
      tone: "destructive",
      onClick: () => void editor.remove(server),
    },
  ];
}

function displayName(server: McpServerSetting, entry?: McpCatalogEntry) {
  return entry && entry.id === server.name.toLowerCase() ? entry.name : server.name;
}

function ServerStatus({ server }: { server?: McpServerSetting }) {
  return server && !server.enabled ? <Badge>Off</Badge> : null;
}

export function McpSection({
  tab,
  query,
  revealedItemId,
  editor,
  onShowCatalog,
}: {
  tab: CustomizeTab;
  query: string;
  revealedItemId: string | null;
  editor: McpServerEditor;
  onShowCatalog: () => void;
}) {
  if (tab === "catalog") {
    const groups = buildMcpCatalogGroups(editor.servers, query);
    if (groups.length === 0) {
      return (
        <EmptyState
          className="min-h-64"
          icon={<PlugsConnectedIcon />}
          title="No MCP servers match"
          action={{
            label: "Add a server by hand",
            icon: <PlusIcon />,
            onClick: () => editor.openNew(),
          }}
        />
      );
    }
    return (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <GroupedSection key={group.id} title={group.label} variant="grid">
            {group.rows.map(({ entry, server }) => (
              <CustomizeRow
                key={entry.id}
                title={entry.name}
                description={entry.description}
                brand={entry.brand}
                status={<ServerStatus server={server} />}
                action={
                  server ? (
                    <CustomizeMoreMenu
                      label={`${entry.name} actions`}
                      items={mcpServerMenuItems(server, editor)}
                    />
                  ) : (
                    <CustomizeAddButton
                      label={`Add ${entry.name}`}
                      onClick={() =>
                        editor.openNew(createMcpDraftFromCatalog(entry), entry.setupNote)
                      }
                    />
                  )
                }
              />
            ))}
          </GroupedSection>
        ))}
      </div>
    );
  }

  const rows = buildInstalledMcpRows(editor.servers, query);
  if (rows.length === 0) {
    return (
      <EmptyState
        className="min-h-64"
        icon={<PlugsConnectedIcon />}
        title={editor.servers.length === 0 ? "No MCP servers yet" : "No MCP servers match"}
        message={
          editor.servers.length === 0
            ? "Servers you add here are passed to every agent session."
            : undefined
        }
        action={{ label: "Browse the catalog", onClick: onShowCatalog }}
        secondaryAction={{
          label: "Add a server",
          icon: <PlusIcon />,
          variant: "ghost",
          onClick: () => editor.openNew(),
        }}
      />
    );
  }

  return (
    <GroupedSection title="Configured" variant="grid">
      {rows.map(({ server, entry }) => (
        <CustomizeRow
          key={server.id}
          title={displayName(server, entry)}
          description={`${MCP_TRANSPORT_LABELS[server.transport]} · ${describeMcpServer(server)}`}
          brand={entry?.brand}
          status={<ServerStatus server={server} />}
          revealed={revealedItemId === server.id}
          action={
            <CustomizeMoreMenu
              label={`${displayName(server, entry)} actions`}
              items={mcpServerMenuItems(server, editor)}
            />
          }
        />
      ))}
    </GroupedSection>
  );
}
