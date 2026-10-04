use std::{env, path::PathBuf};

fn main() {
   let mut arguments = env::args().skip(1).collect::<Vec<_>>();
   let command = if arguments.first().is_some_and(|arg| arg == "run") {
      arguments.remove(0);
      "run"
   } else {
      if arguments.first().is_some_and(|arg| arg == "agent") {
         arguments.remove(0);
      }
      "agent"
   };
   let desktop = env::var_os("ATHAS_DESKTOP_BIN")
      .map(PathBuf::from)
      .unwrap_or_else(|| {
         let name = if cfg!(windows) { "athas.exe" } else { "athas" };
         env::current_exe().unwrap_or_default().with_file_name(name)
      });
   std::process::exit(athas_agent_cli::run_cli(command, &arguments, desktop));
}
