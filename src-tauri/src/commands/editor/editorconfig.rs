use std::{collections::HashMap, path::Path};

const SUPPORTED_KEYS: &[&str] = &[
   "indent_style",
   "indent_size",
   "tab_width",
   "end_of_line",
   "charset",
   "trim_trailing_whitespace",
   "insert_final_newline",
   "max_line_length",
];

#[tauri::command]
pub fn get_editorconfig_properties(file_path: String) -> Result<HashMap<String, String>, String> {
   let path = Path::new(&file_path);
   if !path.exists() {
      return Ok(HashMap::new());
   }

   let mut properties = ec4rs::properties_of(path).map_err(|e| format!("{}", e))?;
   properties.use_fallbacks();

   let mut result = HashMap::new();
   for key in SUPPORTED_KEYS {
      if let Some(value) = properties.get_raw_for_key(key).into_option() {
         result.insert(key.to_string(), value.to_string());
      }
   }

   Ok(result)
}
