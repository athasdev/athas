use fontdb::Database;
use serde::{Deserialize, Serialize};

const MONOSPACE_SAMPLE: [char; 8] = [' ', '0', 'A', 'M', 'W', 'i', 'm', '_'];

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq, Hash)]
pub struct FontInfo {
   pub name: String,
   pub family: String,
   pub style: String,
   pub is_monospace: bool,
}

fn has_uniform_advances(advances: impl IntoIterator<Item = Option<u16>>) -> bool {
   let mut advances = advances.into_iter();
   let Some(Some(expected)) = advances.next() else {
      return false;
   };

   advances.all(|advance| advance == Some(expected))
}

fn has_monospace_glyph_metrics(db: &Database, face_id: fontdb::ID) -> bool {
   db.with_face_data(face_id, |font_data, face_index| {
      let Ok(parsed_face) = ttf_parser::Face::parse(font_data, face_index) else {
         return false;
      };

      has_uniform_advances(MONOSPACE_SAMPLE.map(|character| {
         parsed_face
            .glyph_index(character)
            .and_then(|glyph_id| parsed_face.glyph_hor_advance(glyph_id))
      }))
   })
   .unwrap_or(false)
}

fn get_system_fonts_sync() -> Vec<FontInfo> {
   let mut db = Database::new();
   db.load_system_fonts();

   // Group faces by family to detect monospace properly
   let mut font_map: std::collections::HashMap<String, (bool, fontdb::ID)> =
      std::collections::HashMap::new();

   for face in db.faces() {
      if let Some(family) = face.families.first() {
         let family_name = &family.0;
         // A font family is considered monospace if ANY of its variants are monospace
         font_map
            .entry(family_name.clone())
            .and_modify(|(is_mono, _)| *is_mono = *is_mono || face.monospaced)
            .or_insert((face.monospaced, face.id));
      }
   }

   let mut fonts: Vec<FontInfo> = font_map
      .into_iter()
      .map(
         |(family, (has_monospace_metadata, representative_face_id))| {
            let is_monospace =
               has_monospace_metadata || has_monospace_glyph_metrics(&db, representative_face_id);

            FontInfo {
               name: family.clone(),
               family: family.clone(),
               style: "Regular".to_string(),
               is_monospace,
            }
         },
      )
      .collect();

   fonts.sort_by_key(|font| font.family.clone());
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

#[cfg(test)]
mod tests {
   use super::has_uniform_advances;

   #[test]
   fn accepts_matching_glyph_advances() {
      assert!(has_uniform_advances([Some(600), Some(600), Some(600)]));
   }

   #[test]
   fn rejects_missing_or_proportional_glyph_advances() {
      assert!(!has_uniform_advances([Some(600), None, Some(600)]));
      assert!(!has_uniform_advances([Some(600), Some(320), Some(600)]));
   }
}
