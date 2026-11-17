use serde::Serialize;

/// One update from a browser tab, delivered on the channel the frontend passed
/// when it created the tab.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(
   tag = "event",
   rename_all = "camelCase",
   rename_all_fields = "camelCase"
)]
pub enum BrowserEvent {
   /// The main frame started loading a page.
   LoadStarted {
      url: String,
   },
   /// The main frame finished loading a page.
   LoadFinished {
      url: String,
   },
   /// The address of the main frame changed, including same-document changes
   /// such as `history.pushState`. History availability is `None` when the
   /// engine doesn't expose it to the page.
   UrlChanged {
      url: String,
      can_go_back: Option<bool>,
      can_go_forward: Option<bool>,
   },
   TitleChanged {
      title: String,
   },
   FaviconChanged {
      url: Option<String>,
   },
   /// The page took keyboard focus, so the pane showing it becomes active.
   Focused,
   /// The user pressed a workbench shortcut while the page had focus.
   Shortcut {
      command: String,
   },
   /// The page asked for a new window; Athas opens the URL as a tab instead.
   OpenInNewTab {
      url: String,
   },
   DownloadStarted {
      url: String,
      path: String,
   },
   DownloadFinished {
      url: String,
      path: Option<String>,
      success: bool,
   },
}
