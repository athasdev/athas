use athas_runtime::process::configure_background_command;
use std::{collections::HashMap, path::Path, process::Command};

pub(super) fn build_extension_command(
   command: &str,
   args: Option<&[String]>,
   env: Option<&HashMap<String, String>>,
   file_path: Option<&str>,
   workspace_folder: Option<&str>,
) -> Command {
   let mut command = Command::new(substitute_variables(command, file_path, workspace_folder));
   configure_background_command(&mut command);
   command.args(
      args
         .unwrap_or_default()
         .iter()
         .map(|arg| substitute_variables(arg, file_path, workspace_folder)),
   );

   if let Some(env) = env {
      command.envs(env.iter().map(|(key, value)| {
         (
            key,
            substitute_variables(value, file_path, workspace_folder),
         )
      }));
   }

   command
}

fn substitute_variables(
   template: &str,
   file_path: Option<&str>,
   workspace_folder: Option<&str>,
) -> String {
   let mut result = template.to_string();

   if let Some(path) = file_path {
      let file_path = Path::new(path);
      result = result.replace("${file}", path);
      result = result.replace(
         "${fileBasename}",
         file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(path),
      );
      result = result.replace(
         "${fileBasenameNoExtension}",
         file_path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(path),
      );
      result = result.replace(
         "${fileDirname}",
         file_path
            .parent()
            .and_then(|parent| parent.to_str())
            .unwrap_or(""),
      );
      let extension = file_path
         .extension()
         .and_then(|extension| extension.to_str())
         .map(|extension| format!(".{extension}"))
         .unwrap_or_default();
      result = result.replace("${fileExtname}", &extension);
   }

   if let Some(workspace) = workspace_folder {
      result = result.replace("${workspaceFolder}", workspace);
   }

   result
}

#[cfg(test)]
mod tests {
   use super::{build_extension_command, substitute_variables};
   use std::collections::HashMap;

   #[test]
   fn substitutes_file_and_workspace_contract() {
      let template = concat!(
         "${file}|${fileBasename}|${fileBasenameNoExtension}|",
         "${fileDirname}|${fileExtname}|${workspaceFolder}"
      );

      assert_eq!(
         substitute_variables(
            template,
            Some("/workspace/src/app.test.ts"),
            Some("/workspace")
         ),
         "/workspace/src/app.test.ts|app.test.ts|app.test|/workspace/src|.ts|/workspace"
      );
   }

   #[test]
   fn leaves_variables_without_matching_context_unchanged() {
      assert_eq!(
         substitute_variables("${file}:${workspaceFolder}", None, None),
         "${file}:${workspaceFolder}"
      );
   }

   #[test]
   fn substitutes_files_without_extensions() {
      assert_eq!(
         substitute_variables(
            "${fileBasenameNoExtension}${fileExtname}",
            Some("Makefile"),
            None
         ),
         "Makefile"
      );
   }

   #[test]
   fn builds_command_with_substituted_args_and_environment() {
      let args = vec!["--file=${fileBasename}".to_string()];
      let env = HashMap::from([("PROJECT_ROOT".to_string(), "${workspaceFolder}".to_string())]);
      let command = build_extension_command(
         "tool",
         Some(&args),
         Some(&env),
         Some("/workspace/src/app.ts"),
         Some("/workspace"),
      );

      assert_eq!(command.get_program(), "tool");
      assert_eq!(command.get_args().collect::<Vec<_>>(), ["--file=app.ts"]);
      assert_eq!(
         command
            .get_envs()
            .find(|(key, _)| *key == "PROJECT_ROOT")
            .and_then(|(_, value)| value),
         Some(std::ffi::OsStr::new("/workspace"))
      );
   }
}
