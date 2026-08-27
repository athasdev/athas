const EXTENSION_ID = "athas.gitlab";
const VIEW_ID = `${EXTENSION_ID}.overview`;
const command = (name) => `${EXTENSION_ID}.${name}`;

let api;
let state = {
  config: { baseUrl: "https://gitlab.com", project: "" },
  token: "",
  connected: false,
  loading: false,
  error: "",
  project: "",
  mergeRequests: [],
  issues: [],
  pipelines: [],
};

const invalidate = () => api.views.invalidate(VIEW_ID);
const cleanBaseUrl = (value) => value.trim().replace(/\/+$/, "");

function projectFromRemote(remoteUrl, host) {
  const sshMatch = remoteUrl.match(/^[^@]+@([^:]+):(.+)$/);
  if (sshMatch && sshMatch[1] === host) return sshMatch[2].replace(/\.git$/, "");
  try {
    const url = new URL(remoteUrl.replace(/^git\+/, ""));
    if (url.hostname === host) return url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {}
  return "";
}

async function request(path) {
  const response = await api.http.request({
    url: `${cleanBaseUrl(state.config.baseUrl)}/api/v4${path}`,
    headers: { "PRIVATE-TOKEN": state.token },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitLab returned HTTP ${response.status}`);
  }
  return JSON.parse(response.body);
}

async function resolveProject() {
  if (state.config.project.trim()) return state.config.project.trim();
  const workspace = await api.workspace.getCurrent();
  const host = new URL(cleanBaseUrl(state.config.baseUrl)).hostname;
  return workspace.remotes.map((remote) => projectFromRemote(remote.url, host)).find(Boolean) || "";
}

async function refresh() {
  if (!state.token) return;
  state.loading = true;
  state.error = "";
  invalidate();
  try {
    const project = await resolveProject();
    if (!project)
      throw new Error("No matching GitLab remote was found. Set a project path in setup.");
    const encoded = encodeURIComponent(project);
    const [mergeRequests, issues, pipelines] = await Promise.all([
      request(`/projects/${encoded}/merge_requests?state=opened&per_page=20`),
      request(`/projects/${encoded}/issues?state=opened&per_page=20`),
      request(`/projects/${encoded}/pipelines?per_page=20`),
    ]);
    state.project = project;
    state.mergeRequests = mergeRequests;
    state.issues = issues;
    state.pipelines = pipelines;
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
  return ui.screen(
    { title: "GitLab" },
    ui.section(
      "Connect",
      ui.callout({
        title: "Credentials stay local",
        description: "Use a personal access token with read_api access.",
        tone: "info",
      }),
      state.error ? ui.error("Could not connect", state.error) : null,
      ui.form(
        {
          submitLabel: "Connect",
          pendingLabel: "Connecting",
          onSubmit: ui.action(command("connect")),
        },
        ui.input({
          name: "baseUrl",
          required: true,
          label: "GitLab URL",
          value: state.config.baseUrl,
          placeholder: "https://gitlab.com",
          inputType: "url",
        }),
        ui.input({
          name: "project",
          label: "Project path (optional)",
          value: state.config.project,
          placeholder: "group/project",
        }),
        ui.input({
          name: "token",
          required: true,
          label: "Personal access token",
          placeholder: "glpat-…",
          inputType: "password",
        }),
      ),
    ),
  );
}

function pipelineState(status) {
  if (status === "success") return "success";
  if (status === "failed" || status === "canceled") return "error";
  if (status === "running" || status === "pending") return "running";
  return "default";
}

function overviewView() {
  const { ui } = api;
  if (state.loading) return ui.screen({ title: "GitLab" }, ui.loading("Loading project"));
  if (state.error && !state.connected) return setupView();
  const pipelineBreakdown = [
    {
      label: "Succeeded",
      value: state.pipelines.filter((pipeline) => pipeline.status === "success").length,
      tone: "success",
    },
    {
      label: "Running",
      value: state.pipelines.filter((pipeline) => ["running", "pending"].includes(pipeline.status))
        .length,
      tone: "accent",
    },
    {
      label: "Failed",
      value: state.pipelines.filter((pipeline) => ["failed", "canceled"].includes(pipeline.status))
        .length,
      tone: "error",
    },
  ].filter((item) => item.value > 0);
  return ui.screen(
    {
      title: state.project || "GitLab",
      actions: [
        { label: "Refresh", icon: "arrow-clockwise", action: ui.action(command("refresh")) },
        { label: "Disconnect", icon: "sign-out", action: ui.action(command("disconnect")) },
      ],
    },
    state.error ? ui.error("Refresh failed", state.error) : null,
    ui.section(
      "Overview",
      ui.row(
        ui.metric({ label: "Merge requests", value: state.mergeRequests.length }),
        ui.metric({ label: "Issues", value: state.issues.length }),
        ui.metric({ label: "Pipelines", value: state.pipelines.length }),
      ),
      pipelineBreakdown.length
        ? ui.barChart({ label: "Pipeline outcomes", items: pipelineBreakdown })
        : null,
    ),
    ui.section(
      "Merge requests",
      state.mergeRequests.length
        ? ui.list(
            ...state.mergeRequests.map((item) =>
              ui.listItem({
                title: `!${item.iid} ${item.title}`,
                description: item.author?.name,
                badges: item.draft ? [{ label: "Draft", tone: "muted" }] : [],
                onSelect: ui.action(command("open"), item.web_url),
              }),
            ),
          )
        : ui.empty("No open merge requests"),
    ),
    ui.section(
      "Issues",
      state.issues.length
        ? ui.list(
            ...state.issues.map((item) =>
              ui.listItem({
                title: `#${item.iid} ${item.title}`,
                description: item.author?.name,
                onSelect: ui.action(command("open"), item.web_url),
              }),
            ),
          )
        : ui.empty("No open issues"),
    ),
    ui.section(
      "Pipelines",
      state.pipelines.length
        ? ui.activity({
            items: state.pipelines.map((item) => ({
              title: `Pipeline #${item.id}`,
              description: item.ref,
              meta: item.status,
              state: pipelineState(item.status),
              onSelect: ui.action(command("open"), item.web_url),
            })),
          })
        : ui.empty("No recent pipelines"),
    ),
  );
}

export async function activate(extensionApi) {
  api = extensionApi;
  state.config = (await api.storage.get("config")) || state.config;
  state.token = (await api.secrets.get("token")) || "";
  state.connected = Boolean(state.token);

  api.commands.register({
    id: command("connect"),
    title: "Connect GitLab",
    async run(values) {
      const form = values && typeof values === "object" ? values : {};
      const token = String(form.token || "");
      if (!token) {
        state.error = "Enter a personal access token.";
        invalidate();
        return;
      }
      state.token = token;
      state.config = {
        baseUrl: cleanBaseUrl(String(form.baseUrl || "https://gitlab.com")),
        project: String(form.project || ""),
      };
      await api.secrets.set("token", state.token);
      await api.storage.set("config", state.config);
      await refresh();
    },
  });
  api.commands.register({ id: command("refresh"), title: "Refresh GitLab", run: refresh });
  api.commands.register({
    id: command("disconnect"),
    title: "Disconnect GitLab",
    async run() {
      await api.secrets.delete("token");
      state = {
        ...state,
        token: "",
        connected: false,
        mergeRequests: [],
        issues: [],
        pipelines: [],
      };
      invalidate();
    },
  });
  api.commands.register({
    id: command("open"),
    title: "Open in GitLab",
    run: (url) => api.opener.openExternal(String(url)),
  });
  api.sidebar.registerView({
    id: VIEW_ID,
    title: "GitLab",
    icon: "git-pull-request",
    order: 45,
    render: () => (state.connected ? overviewView() : setupView()),
  });
  if (state.connected) void refresh();
}
