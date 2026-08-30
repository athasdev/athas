const EXTENSION_ID = "athas.ai.v0";
const PROVIDER_ID = "v0";
const DIALOG_ID = `${EXTENSION_ID}.designSystems`;
const command = (name) => `${EXTENSION_ID}.${name}`;
const MODEL_IDS = new Set(["v0-auto", "v0-mini", "v0-pro", "v0-max", "v0-max-fast"]);
const DIRECTORY_URL = "https://ui.shadcn.com/r/registries.json";
const MAX_PROFILES = 50;
const SUGGESTIONS = [
  {
    id: "suggested-registry-starter",
    name: "Registry Starter",
    registryUrl: "https://registry-starter.vercel.app/r/registry.json",
    homepage: "https://registry-starter.vercel.app",
    description: "Vercel registry starter with theme, shadcn/ui primitives, and sample blocks.",
  },
];

let api;
let state = {
  profiles: [],
  activeId: "",
  suggestions: SUGGESTIONS,
  adding: false,
  form: { name: "", registryUrl: "" },
  error: "",
};

function trim(value, maximum = 500) {
  const normalized = typeof value === "string" ? value.trim().slice(0, maximum) : "";
  return normalized || undefined;
}

function stableId(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/https?:\/\//g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "v0-design-system"
  );
}

function normalizeProfiles(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  const urls = new Set();
  const profiles = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const registryUrl = trim(candidate.registryUrl);
    if (!registryUrl) continue;
    const name = trim(candidate.name, 120) || registryUrl;
    const id = trim(candidate.id, 120) || stableId(`${name}-${registryUrl}`);
    if (ids.has(id) || urls.has(registryUrl)) continue;
    ids.add(id);
    urls.add(registryUrl);
    profiles.push({
      id,
      name,
      registryUrl,
      ...(trim(candidate.description, 240)
        ? { description: trim(candidate.description, 240) }
        : {}),
      ...(trim(candidate.homepage) ? { homepage: trim(candidate.homepage) } : {}),
      ...(trim(candidate.tailwindConfigPath)
        ? { tailwindConfigPath: trim(candidate.tailwindConfigPath) }
        : {}),
      ...(trim(candidate.globalsCssPath) ? { globalsCssPath: trim(candidate.globalsCssPath) } : {}),
      ...(trim(candidate.componentsJsonPath)
        ? { componentsJsonPath: trim(candidate.componentsJsonPath) }
        : {}),
    });
    if (profiles.length === MAX_PROFILES) break;
  }

  return profiles;
}

function activeProfile() {
  return state.profiles.find((profile) => profile.id === state.activeId) || null;
}

function systemPromptContext() {
  const profile = activeProfile();
  if (!profile) return "";
  const lines = [
    "Use this design system for generated UI:",
    `- Name: ${profile.name}`,
    `- Registry URL: ${profile.registryUrl}`,
  ];
  if (profile.description) lines.push(`- Notes: ${profile.description}`);
  if (profile.tailwindConfigPath)
    lines.push(`- Tailwind config path: ${profile.tailwindConfigPath}`);
  if (profile.globalsCssPath) lines.push(`- Global CSS path: ${profile.globalsCssPath}`);
  if (profile.componentsJsonPath)
    lines.push(`- components.json path: ${profile.componentsJsonPath}`);
  lines.push(
    "- Prefer registry components, tokens, CSS variables, Tailwind configuration, and shadcn-compatible primitives from this design system when creating UI.",
  );
  return lines.join("\n");
}

function formatConversation(messages) {
  const conversation = messages.filter((message) => message.role !== "system");
  const latestUserMessage = [...conversation].reverse().find((message) => message.role === "user");
  if (conversation.length === 1 && latestUserMessage) return latestUserMessage.content;
  return conversation
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}:\n${message.content}`)
    .join("\n\n");
}

function buildPayload(request) {
  const systemMessage = request.messages.find((message) => message.role === "system");
  const payload = {
    message: formatConversation(request.messages),
    responseMode: "experimental_stream",
    chatPrivacy: "private",
  };
  if (systemMessage?.content?.trim()) {
    payload.system = `${systemMessage.content}

v0 Platform API rules:
- Generate and edit inside the remote v0 sandbox.
- Do not claim that you created, edited, or inspected files on the user's local filesystem.
- If the user asks for local filesystem changes, explain that this v0 provider can generate the app remotely and return the v0 chat or preview link.`;
  }
  if (MODEL_IDS.has(request.modelId)) payload.modelConfiguration = { modelId: request.modelId };
  return payload;
}

async function requestJson(url, headers) {
  const response = await api.http.request({ url, headers });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request returned HTTP ${response.status}`);
  }
  return JSON.parse(response.body);
}

async function saveState() {
  await Promise.all([
    api.storage.set("designSystems", state.profiles),
    api.storage.set("activeDesignSystemId", state.activeId),
    api.settings.set("v0DesignSystems", state.profiles),
    api.settings.set("activeV0DesignSystemId", state.activeId),
  ]);
  registerSettingsAction();
  api.views.invalidate(DIALOG_ID);
}

function registerSettingsAction() {
  api.ai.registerSettingsAction({
    id: `${EXTENSION_ID}.settings.designSystems`,
    providerId: PROVIDER_ID,
    label: "v0 Design System",
    buttonLabel: "Select",
    description: activeProfile()?.name || "Use v0 defaults",
    icon: "palette",
    commandId: command("openDesignSystems"),
  });
}

function profileFromRegistry(registry, fallback) {
  const record =
    registry && typeof registry === "object" && !Array.isArray(registry) ? registry : {};
  const itemCount = Array.isArray(record.items) ? record.items.length : 0;
  return {
    id: fallback.id,
    name: trim(record.name, 120) || fallback.name,
    registryUrl: fallback.registryUrl,
    ...(trim(record.description, 240) || fallback.description || itemCount
      ? {
          description:
            trim(record.description, 240) || fallback.description || `${itemCount} registry items`,
        }
      : {}),
    ...(trim(record.homepage) || fallback.homepage
      ? { homepage: trim(record.homepage) || fallback.homepage }
      : {}),
  };
}

async function addProfile(candidate) {
  state.error = "";
  try {
    const registry = await requestJson(candidate.registryUrl);
    const profile = profileFromRegistry(registry, candidate);
    state.profiles = normalizeProfiles([
      ...state.profiles.filter((saved) => saved.registryUrl !== profile.registryUrl),
      profile,
    ]);
    state.activeId = profile.id;
    state.adding = false;
    state.form = { name: "", registryUrl: "" };
    await saveState();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    api.views.invalidate(DIALOG_ID);
  }
}

function designSystemsView() {
  const { ui } = api;
  const current = activeProfile();
  return ui.screen(
    { title: "v0 Design Systems" },
    ui.callout({
      title: current?.name || "v0 defaults",
      description: current?.registryUrl || "No registry context is added to v0 prompts.",
      tone: current ? "info" : "default",
    }),
    state.error ? ui.error("Could not update the design system", state.error) : null,
    ui.section(
      "Saved",
      ui.button("Use v0 defaults", ui.action(command("selectProfile"), ""), {
        tone: current ? "ghost" : "accent",
      }),
      state.profiles.length
        ? ui.list(
            ...state.profiles.map((profile) =>
              ui.disclosure(
                {
                  title: profile.name,
                  description: profile.description || profile.registryUrl,
                  open: profile.id === state.activeId,
                },
                ui.text(profile.registryUrl, "muted"),
                ui.row(
                  ui.button("Select", ui.action(command("selectProfile"), profile.id), {
                    tone: profile.id === state.activeId ? "accent" : "default",
                  }),
                  ui.button("Remove", ui.action(command("removeProfile"), profile.id), {
                    tone: "ghost",
                  }),
                ),
              ),
            ),
          )
        : ui.empty("No saved design systems"),
    ),
    ui.section(
      "Discover",
      ui.list(
        ...state.suggestions
          .filter(
            (suggestion) =>
              !state.profiles.some((profile) => profile.registryUrl === suggestion.registryUrl),
          )
          .slice(0, 20)
          .map((suggestion) =>
            ui.listItem({
              title: suggestion.name,
              description: suggestion.description || suggestion.registryUrl,
              onSelect: ui.action(command("addSuggestion"), suggestion.id),
            }),
          ),
      ),
    ),
    ui.section(
      "Custom registry",
      state.adding
        ? ui.stack(
            ui.input({
              name: "name",
              label: "Name",
              value: state.form.name,
              placeholder: "Product UI",
              onChange: ui.action(command("setField"), "name"),
            }),
            ui.input({
              name: "registryUrl",
              label: "Registry URL",
              value: state.form.registryUrl,
              placeholder: "https://example.com/r/registry.json",
              inputType: "url",
              onChange: ui.action(command("setField"), "registryUrl"),
            }),
            ui.row(
              ui.button("Add", ui.action(command("addCustom")), { tone: "accent" }),
              ui.button("Cancel", ui.action(command("toggleAdd")), { tone: "ghost" }),
            ),
          )
        : ui.button("Add registry", ui.action(command("toggleAdd"))),
    ),
  );
}

async function loadLegacySettings() {
  state.profiles = normalizeProfiles(await api.settings.get("v0DesignSystems"));
  state.activeId = String((await api.settings.get("activeV0DesignSystemId")) || "");
  await api.storage.set("designSystems", state.profiles);
  await api.storage.set("activeDesignSystemId", state.activeId);
}

async function loadDirectory() {
  try {
    const directory = await requestJson(DIRECTORY_URL);
    const discovered = Array.isArray(directory)
      ? directory.flatMap((entry) => {
          if (!entry || typeof entry !== "object" || typeof entry.name !== "string") return [];
          if (
            typeof entry.url !== "string" ||
            entry.url.includes("{style}") ||
            !entry.url.includes("{name}")
          )
            return [];
          return [
            {
              id: `directory-${stableId(entry.name)}`,
              name: entry.name,
              registryUrl: entry.url.replace("{name}", "registry"),
              description: trim(entry.description, 240),
              homepage: trim(entry.homepage),
            },
          ];
        })
      : [];
    state.suggestions = [...SUGGESTIONS, ...discovered];
    api.views.invalidate(DIALOG_ID);
  } catch {}
}

export async function activate(extensionApi) {
  api = extensionApi;
  await loadLegacySettings();

  api.ai.registerProvider({
    id: PROVIDER_ID,
    buildHeaders(apiKey) {
      return {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      };
    },
    buildPayload,
    buildUrl: () => "https://api.v0.dev/v1/chats",
    async validateApiKey(apiKey) {
      if (!String(apiKey).trim()) return false;
      try {
        await requestJson("https://api.v0.dev/v1/user", { Authorization: `Bearer ${apiKey}` });
        return true;
      } catch {
        return false;
      }
    },
    getSystemPromptContext: systemPromptContext,
  });

  api.commands.register({
    id: command("openDesignSystems"),
    title: "AI: v0 Design System",
    category: "AI",
    run() {
      api.dialog.open({
        id: DIALOG_ID,
        title: "v0 Design Systems",
        width: 680,
        height: 720,
        render: designSystemsView,
      });
    },
  });
  api.commands.register({
    id: command("selectProfile"),
    title: "Select v0 design system",
    palette: false,
    async run(id) {
      state.activeId = String(id || "");
      await saveState();
    },
  });
  api.commands.register({
    id: command("removeProfile"),
    title: "Remove v0 design system",
    palette: false,
    async run(id) {
      state.profiles = state.profiles.filter((profile) => profile.id !== String(id));
      if (state.activeId === String(id)) state.activeId = "";
      await saveState();
    },
  });
  api.commands.register({
    id: command("addSuggestion"),
    title: "Add v0 design system",
    palette: false,
    run(id) {
      const suggestion = state.suggestions.find((item) => item.id === String(id));
      if (suggestion) return addProfile(suggestion);
    },
  });
  api.commands.register({
    id: command("toggleAdd"),
    title: "Add custom v0 design system",
    palette: false,
    run() {
      state.adding = !state.adding;
      state.error = "";
      api.views.invalidate(DIALOG_ID);
    },
  });
  api.commands.register({
    id: command("setField"),
    title: "Update v0 design system field",
    palette: false,
    run(field, value) {
      if (field === "name" || field === "registryUrl") {
        state.form = { ...state.form, [field]: String(value) };
        api.views.invalidate(DIALOG_ID);
      }
    },
  });
  api.commands.register({
    id: command("addCustom"),
    title: "Save custom v0 design system",
    palette: false,
    run() {
      const registryUrl = trim(state.form.registryUrl);
      if (!registryUrl) {
        state.error = "Registry URL is required.";
        api.views.invalidate(DIALOG_ID);
        return;
      }
      const name = trim(state.form.name, 120) || registryUrl;
      return addProfile({ id: stableId(`${name}-${registryUrl}`), name, registryUrl });
    },
  });

  registerSettingsAction();
  void loadDirectory();
}
