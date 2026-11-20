//! The composer's Add context menu (`components/selectors/context-selector.tsx`), its long submenus searchable: attach files,
//! project files, folders, the Git diff, Problems, open tabs, GitHub views and past chats; and editor selections sent to
//! the chat (`services/add-selection-to-agent-chat.ts`).

use std::path::PathBuf;

use gpui::{AppContext as _, ClickEvent, Context, Focusable as _, PathPromptOptions, Window};
use ui::{IconName, MenuEntry, MenuItem};

use crate::{
    SessionView,
    context_refs::{self, ContextRef},
    mentions::Attachment,
};

/// Past chats listed (`pastChats.slice(0, 50)`).
const CHAT_ROWS: usize = 50;
const ADD_CONTEXT_MENU: &str = "add-context";
const SESSIONS: &str = "Sessions";
const PULL_REQUESTS: &str = "Pull requests";
const ISSUES: &str = "Issues";
const OPEN_TABS: &str = "Open tabs";

impl SessionView {
    /// Attaches `reference`, read into text off the UI thread; attaching it again removes it.
    pub fn toggle_context(&mut self, reference: ContextRef, cx: &mut Context<Self>) {
        if let Some(index) = self.pending_context.iter().position(|pending| *pending == reference) {
            self.pending_context.remove(index);
            cx.notify();
            return;
        }
        let existing = self.attachments.iter().position(|attachment| matches!(attachment, Attachment::Context { reference: other, .. } if *other == reference));
        if let Some(index) = existing {
            self.remove_attachment(index, cx);
            return;
        }
        self.attach_context(reference, cx);
    }

    pub fn attach_context(&mut self, reference: ContextRef, cx: &mut Context<Self>) {
        let root = self.info.cwd.clone();
        let label = reference.label(root.as_deref());
        let content = match &reference {
            ContextRef::Problems if root.is_none() => Some(context_refs::format_problems(&context_refs::current_problems(cx), None)),
            ContextRef::Selection { path, text, .. } => Some(context_refs::format_selection(path, text)),
            ContextRef::Tab { path: None, .. } => Some(context_refs::resolve_tab(&reference, root.as_deref())),
            ContextRef::Problems | ContextRef::Folder(_) | ContextRef::GitDiff { .. } | ContextRef::Tab { .. } => None,
        };
        // Problems in files the project keeps from the AI stay out (`allowsPath`).
        let problems = if matches!(reference, ContextRef::Problems) && root.is_some() { context_refs::current_problems(cx) } else { Vec::new() };
        if let Some(content) = content {
            self.add_attachment(Attachment::Context { reference, label, content });
            self.watch_tab_attachments(cx);
            cx.notify();
            return;
        }
        let Some(repo) = root.clone().or_else(|| match &reference {
            ContextRef::Folder(path) | ContextRef::Tab { path: Some(path), .. } => Some(path.clone()),
            _ => None,
        }) else {
            self.input_notice = Some("Open a project to attach its Git changes".into());
            cx.notify();
            return;
        };
        let work = reference.clone();
        self.pending_context.push(reference.clone());
        cx.spawn(async move |this, cx| {
            let content = cx
                .background_spawn(async move {
                    let policy = ai_tools::context_policy(Some(&repo));
                    match (&work, policy) {
                        (ContextRef::Folder(_) | ContextRef::GitDiff { .. } | ContextRef::Problems, Err(error)) => error,
                        (ContextRef::Folder(path), Ok(policy)) => context_refs::resolve_folder_within(path, Some(&policy)),
                        (ContextRef::GitDiff { staged }, Ok(policy)) => context_refs::resolve_git_diff_within(&repo, *staged, Some(&policy)),
                        (ContextRef::Problems, Ok(policy)) => context_refs::format_problems_within(&problems, Some(&repo), Some(&policy)),
                        (ContextRef::Tab { .. }, _) => context_refs::resolve_tab(&work, Some(&repo)),
                        _ => String::new(),
                    }
                })
                .await;
            this.update(cx, |this, cx| {
                // Taken off again while it was read.
                let Some(index) = this.pending_context.iter().position(|pending| *pending == reference) else { return };
                this.pending_context.remove(index);
                this.add_attachment(Attachment::Context { reference, label, content });
                this.refresh_tab_attachments(cx);
                this.watch_tab_attachments(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// A pull request, issue, commit or diff dragged from a sidebar (`addSidebarResourceToContext`):
    /// its tab opens and goes along as context.
    pub fn attach_dragged_resource(&mut self, resource: &ui::DraggedResource, cx: &mut Context<Self>) {
        if resource.kind == ui::WORKTREE_KIND {
            let reference = ContextRef::Folder(PathBuf::from(&resource.id));
            if !self.has_context(&reference) {
                self.attach_context(reference, cx);
            }
            return;
        }
        workbench_api::open_resource(cx, &resource.kind, &resource.id, &resource.title);
        let reference = ContextRef::Tab { title: resource.title.clone(), path: None, kind: Some(resource.kind.clone()), id: Some(resource.id.clone()) };
        if !self.attachments.iter().any(|attachment| matches!(attachment, Attachment::Context { reference: other, .. } if *other == reference)) {
            self.attach_context(reference, cx);
        }
    }

    /// Files and folders dragged from the file tree: images attach as images, files as files and
    /// folders as their tree with the small files in it.
    pub fn attach_dragged_entry(&mut self, entry: &file_tree::DraggedEntry, cx: &mut Context<Self>) {
        let (folders, files): (Vec<_>, Vec<_>) = entry.sources().map(|(path, is_dir)| (path.to_path_buf(), is_dir)).partition(|(_, is_dir)| *is_dir);
        for (path, _) in folders {
            let reference = ContextRef::Folder(path);
            if !self.has_context(&reference) {
                self.attach_context(reference, cx);
            }
        }
        self.attach_paths(files.into_iter().map(|(path, _)| path).collect(), cx);
    }

    /// `editor.addSelectionToChat`: lines of a file the editor selected go along with the next
    /// prompt.
    pub fn add_selection(&mut self, path: PathBuf, start_line: usize, end_line: usize, text: String, window: &mut Window, cx: &mut Context<Self>) {
        if text.trim().is_empty() {
            return;
        }
        self.attach_context(ContextRef::Selection { path, start_line, end_line, text }, cx);
        self.composer.update(cx, |composer, cx| composer.focus(window, cx));
    }

    fn has_context(&self, reference: &ContextRef) -> bool {
        self.context_attached(reference)
    }

    /// Whether `reference` is attached, or being read to attach.
    pub(crate) fn context_attached(&self, reference: &ContextRef) -> bool {
        self.pending_context.contains(reference) || self.attachments.iter().any(|attachment| matches!(attachment, Attachment::Context { reference: other, .. } if other == reference))
    }

    pub(crate) fn open_add_context_menu(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.load_saved_sessions(cx);
        self.load_github_lists(cx);
        let (entries, _) = self.add_context_entries(cx);
        self.show_menu(ADD_CONTEXT_MENU, entries, event, window, cx);
    }

    /// Rebuilds the open Add context menu after a top-level row was toggled, so its check marks
    /// follow; the menu stays open (`closeOnClick={false}`). A row in a submenu flips its own mark
    /// instead, so the submenu stays open with its query.
    fn refresh_add_context_menu(&mut self, submenu: Option<&'static str>, window: &mut Window, cx: &mut Context<Self>) {
        if submenu.is_some() {
            return;
        }
        let Some(open) = self.open_menu.as_ref().filter(|open| open.key.as_ref() == ADD_CONTEXT_MENU) else { return };
        let menu = open.menu.clone();
        let (entries, submenus) = self.add_context_entries(cx);
        let index = submenu.and_then(|label| submenus.iter().find(|(name, _)| *name == label).map(|(_, index)| *index));
        menu.update(cx, |menu, cx| {
            menu.set_entries(entries, cx);
            if let Some(index) = index {
                menu.highlight(Some(index), true, window, cx);
            }
        });
        window.focus(&menu.focus_handle(cx), cx);
    }

    /// The open Add context menu shows the project's files once they are listed.
    pub(crate) fn project_files_listed(&mut self, cx: &mut Context<Self>) {
        let Some(open) = self.open_menu.as_ref().filter(|open| open.key.as_ref() == ADD_CONTEXT_MENU) else { return };
        let menu = open.menu.clone();
        let (entries, _) = self.add_context_entries(cx);
        menu.update(cx, |menu, cx| menu.set_entries(entries, cx));
    }

    /// The menu's rows, and where each submenu sits among them.
    fn add_context_entries(&mut self, cx: &mut Context<Self>) -> (Vec<MenuEntry>, Vec<(&'static str, usize)>) {
        let mut submenus = Vec::new();
        let view = cx.entity();
        let root = self.info.cwd.clone();
        let mut entries = vec![MenuEntry::Item(MenuItem::new("Attach files…").icon(IconName::Paperclip).on_select({
            let view = view.clone();
            move |_, cx| {
                let paths = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: true, prompt: None });
                let view = view.clone();
                cx.spawn(async move |cx| {
                    if let Ok(Ok(Some(paths))) = paths.await {
                        view.update(cx, |view, cx| view.attach_paths(paths, cx));
                    }
                })
                .detach();
            }
        }))];

        // Sections with nothing in them stay out of the menu.
        // Errors, warnings and infos; hints are not counted (`diagnosticCounts`).
        let problems = context_refs::current_problems(cx).iter().filter(|problem| problem.severity != "hint").count();
        if problems > 0 {
            let mut problems_item = self.reference_item("Problems".into(), IconName::Warning, ContextRef::Problems, None, &view);
            if let MenuEntry::Item(item) = problems_item {
                problems_item = MenuEntry::Item(item.trailing_text(problems.to_string()));
            }
            entries.push(problems_item);
        }

        let chats: Vec<MenuEntry> = self
            .saved_sessions
            .as_ref()
            .map(|sessions| sessions.iter().filter(|session| session.id != self.info.id).take(CHAT_ROWS).cloned().collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .map(|session| {
                let attachment = Attachment::Session { id: session.id.clone(), title: session.title.clone() };
                let checked = self.attachments.contains(&attachment);
                let view = view.clone();
                let title = if session.title.is_empty() { "Untitled session".to_string() } else { session.title.clone() };
                MenuEntry::Item(MenuItem::new(title).icon(IconName::History).checked(checked).keep_open().on_select(move |window, cx| {
                    let attachment = attachment.clone();
                    view.update(cx, |view, cx| {
                        match view.attachments.iter().position(|other| *other == attachment) {
                            Some(index) => view.remove_attachment(index, cx),
                            None => {
                                view.add_attachment(attachment);
                                cx.notify();
                            }
                        }
                        view.refresh_add_context_menu(Some(SESSIONS), window, cx);
                    });
                }))
            })
            .collect();
        if !chats.is_empty() {
            let count = chats.len();
            submenus.push((SESSIONS, entries.len()));
            entries.push(MenuEntry::Item(
                MenuItem::new(SESSIONS).icon(IconName::History).trailing_text(count.to_string()).searchable_submenu("Search sessions...", "No matching sessions").submenu(chats),
            ));
        }

        let github_item = |kind: &str, number: u64, title: &str| ContextRef::Tab { title: title.to_string(), path: None, kind: Some(kind.to_string()), id: Some(number.to_string()) };
        let pull_rows: Vec<MenuEntry> = self
            .github_prs
            .iter()
            .flatten()
            .map(|pr| {
                let number = pr.number.max(0) as u64;
                let reference = github_item("github-pr", number, &pr.title);
                match self.reference_item(format!("#{number} {}", pr.title), IconName::GitPullRequest, reference, Some(PULL_REQUESTS), &view) {
                    MenuEntry::Item(item) => MenuEntry::Item(item.keywords(format!("{} {}", pr.author, pr.head))),
                    other => other,
                }
            })
            .collect();
        if !pull_rows.is_empty() {
            let count = pull_rows.len();
            submenus.push((PULL_REQUESTS, entries.len()));
            entries.push(MenuEntry::Item(
                MenuItem::new(PULL_REQUESTS).icon(IconName::GitPullRequest).trailing_text(count.to_string()).searchable_submenu("Search pull requests...", "No matching pull requests").submenu(pull_rows),
            ));
        }
        let issue_rows: Vec<MenuEntry> = self
            .github_issues
            .iter()
            .flatten()
            .map(|(number, title, _, _)| {
                let reference = github_item("github-issue", *number, title);
                self.reference_item(format!("#{number} {title}"), IconName::CircleDot, reference, Some(ISSUES), &view)
            })
            .collect();
        if !issue_rows.is_empty() {
            let count = issue_rows.len();
            submenus.push((ISSUES, entries.len()));
            entries.push(MenuEntry::Item(
                MenuItem::new(ISSUES).icon(IconName::CircleDot).trailing_text(count.to_string()).searchable_submenu("Search issues...", "No matching issues").submenu(issue_rows),
            ));
        }

        let tab_rows: Vec<MenuEntry> = workbench_api::open_tabs(cx)
            .iter()
            .map(ContextRef::from_tab)
            .map(|reference| {
                let ContextRef::Tab { title, path, kind, .. } = &reference else { unreachable!() };
                let icon = if path.is_some() { IconName::File } else { IconName::Columns };
                let keywords = [path.as_ref().map(|path| path.to_string_lossy().into_owned()), kind.clone(), Some(reference.describe(root.as_deref()).1)].into_iter().flatten().collect::<Vec<_>>().join(" ");
                match self.reference_item(title.clone(), icon, reference.clone(), Some(OPEN_TABS), &view) {
                    MenuEntry::Item(item) => MenuEntry::Item(item.keywords(keywords)),
                    other => other,
                }
            })
            .collect();
        if !tab_rows.is_empty() {
            let count = tab_rows.len();
            submenus.push((OPEN_TABS, entries.len()));
            entries.push(MenuEntry::Item(
                MenuItem::new(OPEN_TABS).icon(IconName::Files).trailing_text(count.to_string()).searchable_submenu("Search open tabs...", "No matching open tabs").submenu(tab_rows),
            ));
        }
        (entries, submenus)
    }

    /// The project's open issues and pull requests, read once per session when GitHub is
    /// signed in; the open Add context menu shows them when they arrive.
    fn load_github_lists(&mut self, cx: &mut Context<Self>) {
        if self.loading_github.is_some() || self.github_prs.is_some() || self.github_issues.is_some() {
            return;
        }
        let Some(root) = self.info.cwd.clone() else { return };
        let issues = github_panel::quick_open::open_issues(root.clone(), cx);
        let prs = github_panel::quick_open::open_pull_requests(root, cx);
        if issues.is_none() && prs.is_none() {
            return;
        }
        self.loading_github = Some(cx.spawn(async move |this, cx| {
            let issues = match issues {
                Some(task) => Some(task.await),
                None => None,
            };
            let prs = match prs {
                Some(task) => task.await,
                None => None,
            };
            this.update(cx, |this, cx| {
                this.github_issues = Some(issues.unwrap_or_default());
                this.github_prs = Some(prs.unwrap_or_default());
                this.project_files_listed(cx);
            })
            .ok();
        }));
    }

    fn reference_item(&self, label: String, icon: IconName, reference: ContextRef, submenu: Option<&'static str>, view: &gpui::Entity<Self>) -> MenuEntry {
        let checked = self.has_context(&reference);
        let view = view.clone();
        MenuEntry::Item(MenuItem::new(label).icon(icon).checked(checked).keep_open().on_select(move |window, cx| {
            let reference = reference.clone();
            view.update(cx, |view, cx| {
                view.toggle_context(reference, cx);
                view.refresh_add_context_menu(submenu, window, cx);
            });
        }))
    }
}
