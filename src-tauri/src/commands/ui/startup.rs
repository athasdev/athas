use std::time::Instant;
use tauri::State;

pub struct StartupTiming {
   started_at: Instant,
}

impl StartupTiming {
   pub fn new() -> Self {
      Self {
         started_at: Instant::now(),
      }
   }

   pub fn record(&self, milestone: &str) {
      log::info!(
         "[startup] {milestone} elapsedMs={}",
         self.started_at.elapsed().as_millis()
      );
   }
}

fn is_allowed_renderer_milestone(milestone: &str) -> bool {
   matches!(
      milestone,
      "frontend:entry"
         | "react:scheduled"
         | "app:first-frame"
         | "workbench:first-frame"
         | "bootstrap:complete"
         | "workspace:ready"
         | "workspace:error"
         | "editor:first-ready"
   )
}

#[tauri::command]
pub fn record_startup_milestone(
   timing: State<'_, StartupTiming>,
   milestone: String,
) -> Result<(), String> {
   if !is_allowed_renderer_milestone(&milestone) {
      return Err("Unknown startup milestone".to_string());
   }

   timing.record(&milestone);
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn accepts_only_known_renderer_milestones() {
      assert!(is_allowed_renderer_milestone("workbench:first-frame"));
      assert!(is_allowed_renderer_milestone("editor:first-ready"));
      assert!(!is_allowed_renderer_milestone("arbitrary-event"));
   }
}
