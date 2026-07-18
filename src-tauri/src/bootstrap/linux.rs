pub fn configure_graphics_fallback() {
   if linux_gpu_enabled() {
      return;
   }

   set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

   #[cfg(feature = "linux")]
   set_env_if_missing("LIBGL_ALWAYS_SOFTWARE", "1");
}

#[cfg(feature = "linux")]
pub fn cef_command_line_args() -> Vec<(&'static str, Option<&'static str>)> {
   if linux_gpu_enabled() {
      return Vec::new();
   }

   vec![("--disable-gpu", None), ("--disable-gpu-compositing", None)]
}

fn linux_gpu_enabled() -> bool {
   std::env::var("ATHAS_ENABLE_LINUX_GPU").is_ok_and(|value| {
      let value = value.trim();
      value == "1" || value.eq_ignore_ascii_case("true")
   })
}

fn set_env_if_missing(key: &str, value: &str) {
   if std::env::var_os(key).is_none() {
      // SAFETY: Called during process bootstrap before Tauri starts worker threads.
      unsafe {
         std::env::set_var(key, value);
      }
   }
}
