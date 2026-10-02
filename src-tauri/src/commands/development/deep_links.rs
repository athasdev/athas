use std::{collections::HashMap, sync::Mutex};
use tauri::State;

const APP_DEEP_LINK_SCHEMES: [&str; 3] = ["athas", "athas-dev", "athas-preview"];

/// Deep links waiting for a workbench window to pick them up. URLs that arrive
/// before the frontend has subscribed (for example the one that launched the
/// app) stay here until the window drains them, so none are lost on cold start.
#[derive(Default)]
pub struct PendingDeepLinks(Mutex<HashMap<String, Vec<String>>>);

impl PendingDeepLinks {
   pub fn push_all(&self, label: &str, urls: Vec<String>) {
      if urls.is_empty() {
         return;
      }

      let mut pending = self.0.lock().expect("pending deep links lock poisoned");
      pending.entry(label.to_string()).or_default().extend(urls);
   }

   fn take(&self, label: &str) -> Vec<String> {
      let mut pending = self.0.lock().expect("pending deep links lock poisoned");
      pending.remove(label).unwrap_or_default()
   }
}

pub fn app_deep_links(urls: &[tauri::Url]) -> Vec<String> {
   urls
      .iter()
      .filter(|url| APP_DEEP_LINK_SCHEMES.contains(&url.scheme()))
      .map(ToString::to_string)
      .collect()
}

#[tauri::command]
#[specta::specta]
pub fn take_pending_deep_links(
   window: tauri::WebviewWindow,
   state: State<'_, PendingDeepLinks>,
) -> Vec<String> {
   let urls = state.take(window.label());
   if !urls.is_empty() {
      log::info!("Drained {} pending deep link(s)", urls.len());
   }
   urls
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn keeps_only_app_scheme_urls() {
      let urls = [
         "athas://open?path=/tmp/file.txt",
         "athas-dev://settings?tab=general",
         "file:///tmp/file.txt",
         "https://athas.dev",
      ]
      .map(|url| tauri::Url::parse(url).expect("valid URL"));

      assert_eq!(
         app_deep_links(&urls),
         vec![
            "athas://open?path=/tmp/file.txt".to_string(),
            "athas-dev://settings?tab=general".to_string(),
         ]
      );
   }

   #[test]
   fn pending_links_are_drained_once_per_window() {
      let pending = PendingDeepLinks::default();
      pending.push_all("main", vec!["athas://open?path=/tmp".into()]);

      assert_eq!(pending.take("other"), Vec::<String>::new());
      assert_eq!(
         pending.take("main"),
         vec!["athas://open?path=/tmp".to_string()]
      );
      assert_eq!(pending.take("main"), Vec::<String>::new());
   }
}
