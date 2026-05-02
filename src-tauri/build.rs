fn main() {
   if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
      println!("cargo:rustc-link-arg-bin=athas=/NODEFAULTLIB:libvcruntime.lib");
   }

   if std::env::var_os("CARGO_FEATURE_LINUX").is_some()
      && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
   {
      println!("cargo:rustc-link-arg-bin=athas=-Wl,-rpath,$ORIGIN");
   }

   tauri_build::build()
}
