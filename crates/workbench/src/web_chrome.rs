//! The web app's chrome at athas.dev/app (`web-workbench/components/web-account-menu.tsx`,
//! `github-repository-content.tsx`): the account menu behind the avatar of the activity bar, and
//! the project picker's GitHub Repository step that opens a repository in a cloud workspace.
//!
//! The workbench draws them; the web build (`athas_web`) installs a [`WebChrome`] with the
//! website's account and repositories, so the desktop app never shows them.

use std::rc::Rc;

use gpui::{AnyElement, App, Context, Global, SharedString, Window, actions, div, prelude::*, px};
use palette::{PaletteRow, Picker, PickerDelegate, fuzzy_match};
use ui::{Button, ButtonVariant, IconName, MenuEntry, MenuSize, OpenMenu};

use crate::Workbench;

actions!(
    workbench,
    [
        /// Opens one of your GitHub repositories in a cloud workspace (web app).
        OpenGithubRepository,
    ]
);

/// A repository the user can open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepositoryEntry {
    pub full_name: String,
    pub private: bool,
    pub description: Option<String>,
}

/// A repository's branches, its default one first when known.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BranchList {
    pub default_branch: Option<String>,
    pub branches: Vec<String>,
}

impl BranchList {
    /// The default branch, then the others in the website's order.
    pub fn ordered(&self) -> Vec<String> {
        self.default_branch.iter().cloned().chain(self.branches.iter().filter(|name| Some(*name) != self.default_branch.as_ref()).cloned()).collect()
    }
}

/// Why the repository step cannot list repositories, and what to do about it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepositoryGate {
    pub title: String,
    pub message: String,
    pub action: String,
}

/// What the web build provides for the chrome. Requests are blocking, as the rest of the web
/// build's calls are.
#[derive(Clone)]
pub struct WebChrome {
    /// The name the avatar shows, once the account is known.
    pub account_name: Rc<dyn Fn(&App) -> Option<String>>,
    /// The account menu's rows; "Open GitHub Repository" dispatches [`OpenGithubRepository`].
    pub account_menu: Rc<dyn Fn(&mut App) -> Vec<MenuEntry>>,
    /// Why repositories cannot open (signed out, no Pro, GitHub not connected).
    pub repository_gate: Rc<dyn Fn(&mut App) -> Option<RepositoryGate>>,
    /// Runs the gate's action, such as going to the sign-in page.
    pub gate_action: Rc<dyn Fn(&mut App)>,
    /// The workspace in use, as "owner/repo on branch", which the step shows instead of a list.
    pub open_workspace: Rc<dyn Fn(&App) -> Option<String>>,
    pub repositories: Rc<dyn Fn(&mut App) -> Result<Vec<RepositoryEntry>, String>>,
    pub branches: Rc<dyn Fn(&str, &mut App) -> Result<BranchList, String>>,
    /// Opens a repository at a branch in a cloud workspace.
    pub open_repository: Rc<dyn Fn(String, String, &mut App)>,
}

impl Global for WebChrome {}

pub fn set_web_chrome(cx: &mut App, chrome: WebChrome) {
    cx.set_global(chrome);
}

pub(crate) fn web_chrome(cx: &App) -> Option<WebChrome> {
    cx.try_global::<WebChrome>().cloned()
}

pub(crate) const ACCOUNT_MENU_KEY: &str = "web-account";

impl Workbench {
    /// The web app's account menu, from the avatar at the foot of the activity bar.
    pub(crate) fn toggle_web_account_menu(&mut self, chrome: &WebChrome, window: &mut Window, cx: &mut Context<Self>) {
        if self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == ACCOUNT_MENU_KEY) {
            self.open_menu = None;
            cx.notify();
            return;
        }
        let entries = (chrome.account_menu)(cx);
        let position = gpui::point(ui::metrics::WORKBENCH_GAP + ui::metrics::RAIL_CONTROL + px(4.), window.viewport_size().height - px(12.));
        self.open_menu = Some(OpenMenu::sized(ACCOUNT_MENU_KEY, entries, MenuSize::Wide, position, gpui::Anchor::BottomLeft, window, cx, |this, _| this.open_menu = None));
        cx.notify();
    }

    pub(crate) fn web_account_menu_open(&self) -> bool {
        self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == ACCOUNT_MENU_KEY)
    }

    /// The GitHub Repository step: a repository, then its branch.
    pub(crate) fn open_github_repository(&mut self, _: &OpenGithubRepository, window: &mut Window, cx: &mut Context<Self>) {
        let Some(chrome) = web_chrome(cx) else { return };
        let delegate = RepositoryPicker::new(chrome, cx);
        let picker = cx.new(|cx| Picker::new(delegate, window, cx));
        self.open_modal(picker, window, cx);
    }
}

/// Where the step is.
enum Step {
    /// Nothing to list: why, with an action.
    Gate(RepositoryGate),
    /// A workspace is in use; it shows instead of the list.
    InUse(String),
    Repositories(Result<Vec<RepositoryEntry>, String>),
    /// `has_default`: the first branch is the repository's default.
    Branches { repo: String, branches: Result<Vec<String>, String>, has_default: bool },
}

/// The repository step in a picker (`GithubRepositoryContent`).
pub(crate) struct RepositoryPicker {
    chrome: WebChrome,
    step: Step,
    /// Indexes into the step's rows that match the query.
    matches: Vec<usize>,
    selected: usize,
}

impl RepositoryPicker {
    fn new(chrome: WebChrome, cx: &mut App) -> Self {
        let step = if let Some(gate) = (chrome.repository_gate)(cx) {
            Step::Gate(gate)
        } else if let Some(workspace) = (chrome.open_workspace)(cx) {
            Step::InUse(workspace)
        } else {
            Step::Repositories((chrome.repositories)(cx))
        };
        let mut picker = Self { chrome, step, matches: Vec::new(), selected: 0 };
        picker.filter("");
        picker
    }

    fn rows(&self) -> Vec<String> {
        match &self.step {
            Step::Repositories(Ok(repos)) => repos.iter().map(|repo| repo.full_name.clone()).collect(),
            Step::Branches { branches: Ok(branches), .. } => branches.clone(),
            _ => Vec::new(),
        }
    }

    fn filter(&mut self, query: &str) {
        let query = query.trim();
        self.matches = self.rows().iter().enumerate().filter(|(_, name)| query.is_empty() || fuzzy_match(query, name).is_some()).map(|(index, _)| index).collect();
        self.selected = 0;
    }

    fn back_to_repositories(&mut self, cx: &mut App) {
        self.step = Step::Repositories((self.chrome.repositories)(cx));
        self.filter("");
    }
}

impl PickerDelegate for RepositoryPicker {
    fn placeholder(&self) -> SharedString {
        match &self.step {
            Step::Branches { repo, .. } => format!("Branch of {repo}").into(),
            _ => "Search your GitHub repositories".into(),
        }
    }

    fn match_count(&self) -> usize {
        self.matches.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.filter(query);
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, _: &mut Context<Picker<Self>>) -> AnyElement {
        let row = self.matches.get(index).copied().unwrap_or_default();
        match &self.step {
            Step::Repositories(Ok(repos)) => {
                let repo = &repos[row];
                let mut item = PaletteRow::new(repo.full_name.clone()).icon(if repo.private { IconName::Lock } else { IconName::Github }).selected(selected);
                if let Some(description) = repo.description.as_ref().filter(|description| !description.is_empty()) {
                    item = item.description(description.clone());
                }
                item.into_any_element()
            }
            Step::Branches { branches: Ok(branches), has_default, .. } => {
                let name = &branches[row];
                let mut item = PaletteRow::new(name.clone()).icon(IconName::GitBranch).selected(selected);
                if row == 0 && *has_default {
                    item = item.badge("Default");
                }
                item.into_any_element()
            }
            _ => div().into_any_element(),
        }
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(row) = self.matches.get(index).copied() else { return false };
        match &self.step {
            Step::Repositories(Ok(repos)) => {
                let repo = repos[row].full_name.clone();
                let list = (self.chrome.branches)(&repo, cx);
                let has_default = list.as_ref().is_ok_and(|list| list.default_branch.is_some());
                self.step = Step::Branches { repo, branches: list.map(|list| list.ordered()), has_default };
                self.filter("");
                cx.defer_in(window, |picker, window, cx| {
                    picker.set_query("", cx);
                    picker.refresh_matches(window, cx);
                });
                false
            }
            Step::Branches { repo, branches: Ok(branches), .. } => {
                (self.chrome.open_repository)(repo.clone(), branches[row].clone(), cx);
                true
            }
            _ => false,
        }
    }

    fn empty_message(&self) -> SharedString {
        match &self.step {
            Step::Gate(gate) => format!("{}. {}", gate.title, gate.message).into(),
            Step::InUse(workspace) => format!("{workspace} is open in a cloud workspace. Stop it from the account menu to open another.").into(),
            Step::Repositories(Err(error)) | Step::Branches { branches: Err(error), .. } => error.clone().into(),
            Step::Repositories(Ok(repos)) if repos.is_empty() => "No repositories found.".into(),
            Step::Branches { branches: Ok(branches), .. } if branches.is_empty() => "This repository has no branches.".into(),
            _ => "No matching repositories".into(),
        }
    }

    fn leading_element(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        matches!(self.step, Step::Branches { .. }).then(|| {
            Button::icon("repository-back", IconName::ArrowLeft)
                .variant(ButtonVariant::Ghost)
                .tooltip("Back to repositories")
                .on_click(cx.listener(|picker, _, window, cx| {
                    picker.delegate.back_to_repositories(cx);
                    picker.set_query("", cx);
                    picker.refresh_matches(window, cx);
                }))
                .into_any_element()
        })
    }

    fn footer(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        let Step::Gate(gate) = &self.step else { return None };
        let action = self.chrome.gate_action.clone();
        Some(
            div()
                .flex()
                .justify_end()
                .p(px(8.))
                .child(Button::new("repository-gate", gate.action.clone()).variant(ButtonVariant::Accent).on_click(cx.listener(move |picker, _, window, cx| {
                    action(cx);
                    picker.dismiss(window, cx);
                })))
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_branch_comes_first() {
        let list = BranchList { default_branch: Some("main".into()), branches: vec!["dev".into(), "main".into(), "fix".into()] };
        assert_eq!(list.ordered(), ["main", "dev", "fix"]);
        let list = BranchList { default_branch: None, branches: vec!["dev".into()] };
        assert_eq!(list.ordered(), ["dev"]);
    }
}
