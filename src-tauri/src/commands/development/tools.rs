use crate::features::tools::{
   LanguageToolStatus, ToolInstaller, ToolRegistry, ToolStatus, ToolType,
};
use tauri::AppHandle;

/// Install all tools for a language
#[tauri::command]
pub async fn install_language_tools(
   app_handle: AppHandle,
   language_id: String,
) -> Result<LanguageToolStatus, String> {
   let mut status = LanguageToolStatus::new(&language_id);

   let tools = ToolRegistry::get_tools(&language_id);
   if tools.is_none() {
      return Ok(status);
   }

   let tools = tools.unwrap();

   // Install LSP
   if let Some(config) = tools.get(&ToolType::Lsp) {
      status.lsp = Some(match ToolInstaller::install(&app_handle, config).await {
         Ok(_) => ToolStatus::Installed,
         Err(e) => ToolStatus::Failed(e.to_string()),
      });
   }

   // Install formatter
   if let Some(config) = tools.get(&ToolType::Formatter) {
      status.formatter = Some(match ToolInstaller::install(&app_handle, config).await {
         Ok(_) => ToolStatus::Installed,
         Err(e) => ToolStatus::Failed(e.to_string()),
      });
   }

   // Install linter
   if let Some(config) = tools.get(&ToolType::Linter) {
      status.linter = Some(match ToolInstaller::install(&app_handle, config).await {
         Ok(_) => ToolStatus::Installed,
         Err(e) => ToolStatus::Failed(e.to_string()),
      });
   }

   Ok(status)
}

/// Install a specific tool type for a language
#[tauri::command]
pub async fn install_tool(
   app_handle: AppHandle,
   language_id: String,
   tool_type: String,
) -> Result<ToolStatus, String> {
   let tool_type = match tool_type.as_str() {
      "lsp" => ToolType::Lsp,
      "formatter" => ToolType::Formatter,
      "linter" => ToolType::Linter,
      _ => return Err(format!("Unknown tool type: {}", tool_type)),
   };

   let config = ToolRegistry::get_tool(&language_id, tool_type).ok_or_else(|| {
      format!(
         "No {} configured for {}",
         tool_type_str(&tool_type),
         language_id
      )
   })?;

   match ToolInstaller::install(&app_handle, &config).await {
      Ok(_) => Ok(ToolStatus::Installed),
      Err(e) => Ok(ToolStatus::Failed(e.to_string())),
   }
}

/// Get the status of all tools for a language
#[tauri::command]
pub async fn get_language_tool_status(
   app_handle: AppHandle,
   language_id: String,
) -> Result<LanguageToolStatus, String> {
   let mut status = LanguageToolStatus::new(&language_id);

   let tools = ToolRegistry::get_tools(&language_id);
   if tools.is_none() {
      return Ok(status);
   }

   let tools = tools.unwrap();

   // Check LSP
   if let Some(config) = tools.get(&ToolType::Lsp) {
      status.lsp = Some(
         if ToolInstaller::is_installed(&app_handle, config).unwrap_or(false) {
            ToolStatus::Installed
         } else {
            ToolStatus::NotInstalled
         },
      );
   }

   // Check formatter
   if let Some(config) = tools.get(&ToolType::Formatter) {
      status.formatter = Some(
         if ToolInstaller::is_installed(&app_handle, config).unwrap_or(false) {
            ToolStatus::Installed
         } else {
            ToolStatus::NotInstalled
         },
      );
   }

   // Check linter
   if let Some(config) = tools.get(&ToolType::Linter) {
      status.linter = Some(
         if ToolInstaller::is_installed(&app_handle, config).unwrap_or(false) {
            ToolStatus::Installed
         } else {
            ToolStatus::NotInstalled
         },
      );
   }

   Ok(status)
}

/// Get the path to a tool's binary
#[tauri::command]
pub async fn get_tool_path(
   app_handle: AppHandle,
   language_id: String,
   tool_type: String,
) -> Result<Option<String>, String> {
   let tool_type = match tool_type.as_str() {
      "lsp" => ToolType::Lsp,
      "formatter" => ToolType::Formatter,
      "linter" => ToolType::Linter,
      _ => return Err(format!("Unknown tool type: {}", tool_type)),
   };

   let config = match ToolRegistry::get_tool(&language_id, tool_type) {
      Some(c) => c,
      None => return Ok(None),
   };

   let path = ToolInstaller::get_tool_path(&app_handle, &config).map_err(|e| e.to_string())?;

   if path.exists() {
      Ok(Some(path.to_string_lossy().to_string()))
   } else {
      Ok(None)
   }
}

/// Get available tools for a language
#[tauri::command]
pub fn get_available_tools(language_id: String) -> Result<Vec<String>, String> {
   let tools = ToolRegistry::get_tools(&language_id);
   match tools {
      Some(t) => Ok(t.keys().map(|k| tool_type_str(k).to_string()).collect()),
      None => Ok(vec![]),
   }
}

fn tool_type_str(t: &ToolType) -> &'static str {
   match t {
      ToolType::Lsp => "lsp",
      ToolType::Formatter => "formatter",
      ToolType::Linter => "linter",
   }
}
