//! A page's live state as its native view reports it, and the browser zoom steps.
//!
//! Ported from Athas's `browser-tab.store.ts` and the event handling of `browser-tab-manager.ts`.

use athas_browser::BrowserEvent;

use crate::address::{browser_tab_name, is_blank_page};

/// The zoom steps a browser walks through.
pub const ZOOM_LEVELS: [f64; 13] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

/// Steps the page zoom like a browser does, or resets it when `direction` is 0.
pub fn step_zoom(current: f64, direction: i32) -> f64 {
    match direction.signum() {
        0 => 1.0,
        1 => ZOOM_LEVELS.iter().copied().find(|level| *level > current + 0.001).unwrap_or(current),
        _ => ZOOM_LEVELS.iter().rev().copied().find(|level| *level < current - 0.001).unwrap_or(current),
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PageState {
    pub url: String,
    pub title: Option<String>,
    pub favicon: Option<String>,
    pub is_loading: bool,
    /// `None` while the engine can't tell, in which case the history buttons stay enabled.
    pub can_go_back: Option<bool>,
    pub can_go_forward: Option<bool>,
    pub error: Option<String>,
}

/// What an event changed that the tab outside the page shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Changed {
    pub url: bool,
    pub name: bool,
}

impl PageState {
    pub fn new(url: impl Into<String>) -> Self {
        Self { url: url.into(), ..Self::default() }
    }

    pub fn is_blank(&self) -> bool {
        is_blank_page(&self.url)
    }

    /// The tab's name: the page title, or its host until the page has one.
    pub fn tab_name(&self) -> String {
        browser_tab_name(&self.url, self.title.as_deref())
    }

    pub fn can_go_back(&self) -> bool {
        !self.is_blank() && self.can_go_back != Some(false)
    }

    pub fn can_go_forward(&self) -> bool {
        !self.is_blank() && self.can_go_forward != Some(false)
    }

    /// The user asked for another address.
    pub fn navigate(&mut self, url: &str) -> Changed {
        let name_before = self.tab_name();
        let url_changed = self.url != url;
        self.url = url.to_string();
        self.error = None;
        Changed { url: url_changed, name: self.tab_name() != name_before }
    }

    pub fn fail(&mut self, error: impl Into<String>) {
        self.error = Some(error.into());
        self.is_loading = false;
    }

    pub fn apply(&mut self, event: &BrowserEvent) -> Changed {
        let (url_before, name_before) = (self.url.clone(), self.tab_name());
        match event {
            BrowserEvent::LoadStarted { url } => {
                self.is_loading = true;
                self.error = None;
                self.url = url.clone();
            }
            BrowserEvent::LoadFinished { .. } => self.is_loading = false,
            BrowserEvent::UrlChanged { url, can_go_back, can_go_forward } => {
                self.url = url.clone();
                if can_go_back.is_some() || can_go_forward.is_some() {
                    self.can_go_back = *can_go_back;
                    self.can_go_forward = *can_go_forward;
                }
            }
            BrowserEvent::TitleChanged { title } => self.title = Some(title.clone()),
            BrowserEvent::FaviconChanged { url } => self.favicon = url.clone(),
            _ => {}
        }
        Changed { url: self.url != url_before, name: self.tab_name() != name_before }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_zoom_through_browser_levels() {
        assert_eq!(step_zoom(1.0, 1), 1.1);
        assert_eq!(step_zoom(1.0, -1), 0.9);
        assert_eq!(step_zoom(1.05, 1), 1.1);
        assert_eq!(step_zoom(3.0, 1), 3.0);
        assert_eq!(step_zoom(0.5, -1), 0.5);
        assert_eq!(step_zoom(2.5, 0), 1.0);
    }

    #[test]
    fn follows_a_load_and_its_history() {
        let mut page = PageState::new("about:blank");
        assert!(!page.can_go_back() && !page.can_go_forward());
        assert_eq!(page.navigate("https://athas.dev/"), Changed { url: true, name: true });
        assert!(page.can_go_back(), "history the engine has not reported stays usable");

        let changed = page.apply(&BrowserEvent::LoadStarted { url: "https://athas.dev/".into() });
        assert_eq!(changed, Changed::default());
        assert!(page.is_loading);
        page.apply(&BrowserEvent::UrlChanged { url: "https://athas.dev/docs".into(), can_go_back: Some(true), can_go_forward: Some(false) });
        assert!(page.can_go_back() && !page.can_go_forward());
        page.apply(&BrowserEvent::UrlChanged { url: "https://athas.dev/docs#a".into(), can_go_back: None, can_go_forward: None });
        assert!(!page.can_go_forward(), "a report without history keeps what the engine said before");
        page.apply(&BrowserEvent::LoadFinished { url: "https://athas.dev/docs".into() });
        assert!(!page.is_loading);
    }

    #[test]
    fn names_the_tab_after_the_title_once_it_arrives() {
        let mut page = PageState::new("http://localhost:5173/");
        assert_eq!(page.tab_name(), "localhost:5173");
        let changed = page.apply(&BrowserEvent::TitleChanged { title: "Vite App".into() });
        assert_eq!(changed, Changed { url: false, name: true });
        assert_eq!(page.tab_name(), "Vite App");
    }

    #[test]
    fn a_failure_stops_loading_and_a_new_address_clears_it() {
        let mut page = PageState::new("https://athas.dev/");
        page.apply(&BrowserEvent::LoadStarted { url: "https://athas.dev/".into() });
        page.fail("Failed to open page");
        assert!(!page.is_loading);
        assert_eq!(page.error.as_deref(), Some("Failed to open page"));
        page.navigate("https://athas.dev/");
        assert_eq!(page.error, None);
    }
}
