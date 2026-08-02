const EXTENSION_ID = "athas.sentry";
const VIEW_ID = `${EXTENSION_ID}.issues`;
const command = (name) => `${EXTENSION_ID}.${name}`;

let api;
let state = {
  config: { baseUrl: "https://sentry.io", organization: "", project: "" },
  token: "",
  tokenInput: "",
  connected: false,
  loading: false,
  error: "",
  issues: [],
};

const invalidate = () => api.views.invalidate(VIEW_ID);
const cleanBaseUrl = (value) => value.trim().replace(/\/+$/, "");

async function refresh() {
  if (!state.token) return;
  state.loading = true;
  state.error = "";
  invalidate();
  try {
    const organization = encodeURIComponent(state.config.organization.trim());
    const project = encodeURIComponent(state.config.project.trim());
    if (!organization || !project) throw new Error("Organization and project are required.");
    const response = await api.http.request({
      url: `${cleanBaseUrl(state.config.baseUrl)}/api/0/projects/${organization}/${project}/issues/?query=is%3Aunresolved&limit=25`,
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Sentry returned HTTP ${response.status}`);
    }
    state.issues = JSON.parse(response.body);
    state.connected = true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    invalidate();
  }
}

function setupView() {
  const { ui } = api;
  const field = (label, name, placeholder, inputType = "text") =>
    ui.input({
      label,
      value: name === "token" ? state.tokenInput : state.config[name],
      placeholder,
      inputType,
      onChange: ui.action(command("setField"), name),
    });
  return ui.screen(
    { title: "Sentry" },
    ui.section(
      "Connect",
      ui.text(
        "Use an organization auth token with project read access. Credentials stay in Athas secure storage.",
      ),
      field("Sentry URL", "baseUrl", "https://sentry.io", "url"),
      field("Organization slug", "organization", "my-org"),
      field("Project slug", "project", "my-project"),
      field("Auth token", "token", "sntrys_…", "password"),
      state.error ? ui.error("Could not connect", state.error) : null,
      ui.button("Connect", ui.action(command("connect")), { tone: "accent" }),
    ),
  );
}

function levelTone(level) {
  if (level === "fatal" || level === "error") return "error";
  if (level === "warning") return "warning";
  return "muted";
}

function issuesView() {
  const { ui } = api;
  if (state.loading) return ui.screen({ title: "Sentry" }, ui.loading("Loading issues"));
  return ui.screen(
    {
      title: `${state.config.organization}/${state.config.project}`,
      actions: [
        { label: "Refresh", icon: "arrow-clockwise", action: ui.action(command("refresh")) },
        { label: "Disconnect", icon: "sign-out", action: ui.action(command("disconnect")) },
      ],
    },
    state.error ? ui.error("Refresh failed", state.error) : null,
    ui.section(
      "Unresolved issues",
      state.issues.length
        ? ui.list(
            ...state.issues.map((issue) =>
              ui.listItem({
                title: issue.title,
                description: issue.culprit || issue.shortId,
                meta: issue.count ? `${issue.count} events` : undefined,
                badges: [{ label: issue.level || "error", tone: levelTone(issue.level) }],
                onSelect: ui.action(command("open"), issue.permalink),
              }),
            ),
          )
        : ui.empty("No unresolved issues", "This project is looking healthy."),
    ),
  );
}

export async function activate(extensionApi) {
  api = extensionApi;
  state.config = (await api.storage.get("config")) || state.config;
  state.token = (await api.secrets.get("token")) || "";
  state.connected = Boolean(state.token && state.config.organization && state.config.project);

  api.commands.register({
    id: command("setField"),
    title: "Update Sentry setting",
    run(field, value) {
      if (field === "token") state.tokenInput = String(value);
      else state.config = { ...state.config, [field]: String(value) };
      invalidate();
    },
  });
  api.commands.register({
    id: command("connect"),
    title: "Connect Sentry",
    async run() {
      if (!state.tokenInput && !state.token) {
        state.error = "Enter an auth token.";
        invalidate();
        return;
      }
      state.token = state.tokenInput || state.token;
      state.tokenInput = "";
      state.config.baseUrl = cleanBaseUrl(state.config.baseUrl);
      await api.secrets.set("token", state.token);
      await api.storage.set("config", state.config);
      await refresh();
    },
  });
  api.commands.register({ id: command("refresh"), title: "Refresh Sentry", run: refresh });
  api.commands.register({
    id: command("disconnect"),
    title: "Disconnect Sentry",
    async run() {
      await api.secrets.delete("token");
      state = { ...state, token: "", connected: false, issues: [] };
      invalidate();
    },
  });
  api.commands.register({
    id: command("open"),
    title: "Open in Sentry",
    run: (url) => api.opener.openExternal(String(url)),
  });
  api.sidebar.registerView({
    id: VIEW_ID,
    title: "Sentry",
    icon: "warning-circle",
    order: 46,
    render: () => (state.connected ? issuesView() : setupView()),
  });
  if (state.connected) void refresh();
}
