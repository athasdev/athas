use fontdb::Database;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub struct FontInfo {
   pub name: String,
   pub family: String,
   pub style: String,
   pub is_monospace: bool,
}

fn get_system_fonts_sync() -> Vec<FontInfo> {
   let mut db = Database::new();
   db.load_system_fonts();

   // Group faces by family to detect monospace properly
   let mut font_map: std::collections::HashMap<String, bool> = std::collections::HashMap::new();

   for face in db.faces() {
      if let Some(family) = face.families.first() {
         let family_name = &family.0;
         // A font family is considered monospace if ANY of its variants are monospace
         font_map
            .entry(family_name.clone())
            .and_modify(|is_mono| *is_mono = *is_mono || face.monospaced)
            .or_insert(face.monospaced);
      }
   }

   let mut fonts: Vec<FontInfo> = font_map
      .into_iter()
      .map(|(family, is_monospace)| FontInfo {
         name: family.clone(),
         family: family.clone(),
         style: "Regular".to_string(),
         is_monospace,
      })
      .collect();

   fonts.sort_by(|a, b| a.family.cmp(&b.family));
   fonts
}

#[tauri::command]
pub async fn get_system_fonts() -> Result<Vec<FontInfo>, String> {
   Ok(get_system_fonts_sync())
}

#[tauri::command]
pub async fn get_monospace_fonts() -> Result<Vec<FontInfo>, String> {
   let all_fonts = get_system_fonts_sync();
   let monospace_fonts: Vec<FontInfo> = all_fonts
      .into_iter()
      .filter(|font| font.is_monospace)
      .collect();
   Ok(monospace_fonts)
}

#[tauri::command]
pub async fn validate_font(font_family: String) -> Result<bool, String> {
   let fonts = get_system_fonts_sync();
   let is_valid = fonts.iter().any(|font| font.family == font_family);
   Ok(is_valid)
}
