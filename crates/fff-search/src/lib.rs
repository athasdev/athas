use anyhow::{Context, Result};
use fff_search::{
   FilePicker, FilePickerOptions, FrecencyTracker, FuzzySearchOptions, PaginationArgs, QueryParser,
   SharedFrecency, SharedPicker,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct FffSearch {
   picker: SharedPicker,
   frecency: SharedFrecency,
   db_path: PathBuf,
}

#[derive(Debug, Serialize, Clone)]
pub struct FffSearchHit {
   pub path: String,
   pub name: String,
   pub relative_path: String,
   pub score: i32,
}

impl FffSearch {
   pub fn new(frecency_db_path: impl Into<PathBuf>) -> Result<Self> {
      let db_path = frecency_db_path.into();
      if let Some(parent) = db_path.parent() {
         std::fs::create_dir_all(parent)
            .with_context(|| format!("creating frecency db dir {:?}", parent))?;
      }

      let picker = SharedPicker::default();
      let frecency = SharedFrecency::default();

      let tracker = FrecencyTracker::new(&db_path, false)
         .with_context(|| format!("opening frecency db at {:?}", db_path))?;
      frecency
         .init(tracker)
         .context("initializing shared frecency")?;

      Ok(Self {
         picker,
         frecency,
         db_path,
      })
   }

   pub fn set_workspace(&self, base_path: &Path) -> Result<()> {
      let options = FilePickerOptions {
         base_path: base_path.to_string_lossy().into_owned(),
         watch: true,
         ..Default::default()
      };

      FilePicker::new_with_shared_state(self.picker.clone(), self.frecency.clone(), options)
         .context("initializing fff FilePicker")?;
      Ok(())
   }

   pub fn search(&self, query: &str, limit: usize) -> Result<Vec<FffSearchHit>> {
      let guard = self.picker.read().context("reading picker")?;
      let Some(picker) = guard.as_ref() else {
         return Ok(Vec::new());
      };

      let parser = QueryParser::default();
      let parsed = parser.parse(query);

      let opts = FuzzySearchOptions {
         pagination: PaginationArgs {
            offset: 0,
            limit: limit.max(1),
         },
         ..Default::default()
      };

      let result = FilePicker::fuzzy_search(picker.get_files(), &parsed, None, opts);

      let hits: Vec<FffSearchHit> = result
         .items
         .iter()
         .zip(result.scores.iter())
         .map(|(item, score)| FffSearchHit {
            path: item.path.to_string_lossy().into_owned(),
            name: item.file_name.clone(),
            relative_path: item.relative_path.clone(),
            score: score.total,
         })
         .collect();

      Ok(hits)
   }

   pub fn track_access(&self, path: &Path) -> Result<()> {
      let guard = self.frecency.read().context("reading frecency")?;
      if let Some(tracker) = guard.as_ref() {
         tracker.track_access(path).context("track_access")?;
      }
      Ok(())
   }

   pub fn db_path(&self) -> &Path {
      &self.db_path
   }
}
