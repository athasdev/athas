fn main() {
   if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
      println!("cargo:rustc-link-arg-bin=athas=/NODEFAULTLIB:libvcruntime.lib");
   }

   tauri_build::build()
}
