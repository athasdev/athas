use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchMatch {
   pub line_number: usize,
   pub line_content: String,
   pub column_start: usize,
   pub column_end: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSearchResult {
   pub file_path: String,
   pub matches: Vec<SearchMatch>,
   pub total_matches: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchFilesRequest {
   pub root_path: String,
   pub query: String,
   pub case_sensitive: Option<bool>,
   pub max_results: Option<usize>,
}

fn should_ignore_file(path: &Path) -> bool {
   let ignored_dirs = [
      "node_modules",
      ".git",
      ".next",
      ".nuxt",
      "dist",
      "build",
      "target",
      ".cache",
      ".vscode",
      ".idea",
      "__pycache__",
      "vendor",
      "coverage",
      ".nyc_output",
      ".pytest_cache",
      ".turbo",
      "out",
      ".vercel",
      ".DS_Store",
   ];

   let ignored_extensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".bmp",
      ".ico",
      ".svg",
      ".mp4",
      ".mp3",
      ".wav",
      ".avi",
      ".mov",
      ".pdf",
      ".zip",
      ".tar",
      ".gz",
      ".rar",
      ".7z",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".lock",
      ".min.js",
      ".min.css",
      ".map",
      ".log",
      ".tmp",
      ".temp",
      ".swp",
      ".swo",
      ".bak",
      ".cache",
      ".pid",
      ".seed",
      ".pid.lock",
      ".dat",
      ".db",
      ".sqlite",
      ".wasm",
   ];

   let ignored_filenames = [
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      ".gitignore",
      ".gitattributes",
      ".eslintcache",
      ".prettierignore",
      ".npmrc",
      ".yarnrc",
      "npm-debug.log",
      "yarn-error.log",
      "yarn-debug.log",
   ];

   // Check if any component of the path contains an ignored directory
   for component in path.components() {
      if let Some(comp_str) = component.as_os_str().to_str() {
         // Ignore hidden directories (starting with .)
         if comp_str.starts_with('.') && ignored_dirs.contains(&comp_str) {
            return true;
         }
         if ignored_dirs.contains(&comp_str) {
            return true;
         }
      }
   }

   // Check filename
   if let Some(file_name) = path.file_name()
      && let Some(name_str) = file_name.to_str()
   {
      // Ignore hidden files (starting with .)
      if name_str.starts_with('.') {
         return true;
      }
      if ignored_filenames.contains(&name_str) {
         return true;
      }
   }

   // Check file extension
   if let Some(ext) = path.extension()
      && let Some(ext_str) = ext.to_str()
   {
      let ext_with_dot = format!(".{}", ext_str);
      if ignored_extensions.contains(&ext_with_dot.as_str()) {
         return true;
      }
   }

   false
}

#[tauri::command]
pub fn search_files_content(request: SearchFilesRequest) -> Result<Vec<FileSearchResult>, String> {
   if request.query.is_empty() {
      return Ok(Vec::new());
   }

   let root = Path::new(&request.root_path);
   if !root.exists() {
      return Err("Root path does not exist".to_string());
   }

   let case_sensitive = request.case_sensitive.unwrap_or(false);
   let max_results = request.max_results.unwrap_or(100);
   let mut results: Vec<FileSearchResult> = Vec::new();

   let query_lower = if case_sensitive {
      request.query.clone()
   } else {
      request.query.to_lowercase()
   };

   for entry in WalkDir::new(root)
      .max_depth(20)
      .follow_links(false)
      .into_iter()
      .filter_entry(|e| !should_ignore_file(e.path()))
   {
      if results.len() >= max_results {
         break;
      }

      let entry = match entry {
         Ok(e) => e,
         Err(_) => continue,
      };

      let path = entry.path();

      // Skip directories
      if path.is_dir() {
         continue;
      }

      // Skip files larger than 1MB
      if let Ok(metadata) = fs::metadata(path)
         && metadata.len() > 1_000_000
      {
         continue;
      }

      // Read file content
      let content = match fs::read_to_string(path) {
         Ok(c) => c,
         Err(_) => continue, // Skip binary files or files we can't read
      };

      let mut file_matches: Vec<SearchMatch> = Vec::new();

      // Search through each line
      for (line_idx, line) in content.lines().enumerate() {
         let search_line = if case_sensitive {
            line.to_string()
         } else {
            line.to_lowercase()
         };

         // Find all occurrences in the line
         let mut start_pos = 0;
         while let Some(pos) = search_line[start_pos..].find(&query_lower) {
            let actual_pos = start_pos + pos;
            file_matches.push(SearchMatch {
               line_number: line_idx + 1,
               line_content: line.to_string(),
               column_start: actual_pos,
               column_end: actual_pos + request.query.len(),
            });

            start_pos = actual_pos + 1;

            // Limit matches per file
            if file_matches.len() >= 50 {
               break;
            }
         }

         if file_matches.len() >= 50 {
            break;
         }
      }

      if !file_matches.is_empty() {
         results.push(FileSearchResult {
            file_path: path.to_string_lossy().to_string(),
            matches: file_matches.clone(),
            total_matches: file_matches.len(),
         });
      }
   }

   Ok(results)
}
