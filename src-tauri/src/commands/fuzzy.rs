use nucleo_matcher::{
   Config, Matcher, Utf32Str,
   pattern::{Atom, AtomKind, CaseMatching, Normalization},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FuzzyMatchItem {
   pub text: String,
   pub score: i64,
   pub indices: Vec<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FuzzyMatchRequest {
   pub pattern: String,
   pub items: Vec<String>,
   pub case_sensitive: Option<bool>,
   pub normalize: Option<bool>,
}

#[tauri::command]
pub fn fuzzy_match(request: FuzzyMatchRequest) -> Vec<FuzzyMatchItem> {
   if request.pattern.is_empty() || request.items.is_empty() {
      return request
         .items
         .into_iter()
         .map(|text| FuzzyMatchItem {
            text,
            score: 0,
            indices: vec![],
         })
         .collect();
   }

   let case_matching = if request.case_sensitive.unwrap_or(false) {
      CaseMatching::Respect
   } else {
      CaseMatching::Smart
   };

   let normalization = if request.normalize.unwrap_or(true) {
      Normalization::Smart
   } else {
      Normalization::Never
   };

   let atom = Atom::new(
      &request.pattern,
      case_matching,
      normalization,
      AtomKind::Fuzzy,
      false,
   );

   let mut matcher = Matcher::new(Config::DEFAULT);
   let mut matches: Vec<FuzzyMatchItem> = Vec::new();

   for item in request.items {
      let mut indices = Vec::new();
      let mut buf = Vec::new();
      let utf32_str = Utf32Str::new(&item, &mut buf);

      if let Some(score) = atom.indices(utf32_str, &mut matcher, &mut indices) {
         matches.push(FuzzyMatchItem {
            text: item,
            score: score as i64,
            indices,
         });
      }
   }

   // Sort by score in descending order
   matches.sort_by(|a, b| b.score.cmp(&a.score));

   matches
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionFilterRequest {
   pub pattern: String,
   pub completions: Vec<CompletionItem>,
   pub context_word: String,
   pub context_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionItem {
   pub label: String,
   pub kind: Option<i32>,
   pub detail: Option<String>,
   pub documentation: Option<String>,
   pub sort_text: Option<String>,
   pub filter_text: Option<String>,
   pub insert_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilteredCompletion {
   pub item: CompletionItem,
   pub score: i64,
   pub indices: Vec<u32>,
}

#[tauri::command]
pub fn filter_completions(request: CompletionFilterRequest) -> Vec<FilteredCompletion> {
   if request.context_word.is_empty() {
      // Return all completions if no context word
      return request
         .completions
         .into_iter()
         .map(|item| FilteredCompletion {
            item,
            score: 0,
            indices: vec![],
         })
         .collect();
   }

   let atom = Atom::new(
      &request.context_word,
      CaseMatching::Smart,
      Normalization::Smart,
      AtomKind::Fuzzy,
      false,
   );

   let mut matcher = Matcher::new(Config::DEFAULT);
   let mut filtered: Vec<FilteredCompletion> = Vec::new();

   for completion in request.completions {
      let mut indices = Vec::new();
      let mut buf = Vec::new();

      // Use filter_text if available, otherwise use label
      let text_to_match = completion.filter_text.as_ref().unwrap_or(&completion.label);

      let utf32_str = Utf32Str::new(text_to_match, &mut buf);

      if let Some(score) = atom.indices(utf32_str, &mut matcher, &mut indices) {
         let mut final_score = score as i64;

         // Boost score based on completion kind and context
         if let Some(kind) = completion.kind {
            // Base score based on kind
            let base_boost = match kind {
               5 => 100, // Field
               6 => 150, // Variable
               3 => 200, // Function
               4 => 250, // Constructor
               8 => 300, // Interface
               7 => 300, // Class
               _ => 0,
            };

            // Apply context-specific boosts
            let context_multiplier = match request.context_type.as_deref() {
               Some("member") => match kind {
                  3 | 5 => 2.0, // Boost methods and fields for member access
                  _ => 1.0,
               },
               Some("type") => match kind {
                  7..=9 => 2.0, // Boost classes, interfaces, enums for type context
                  _ => 0.5,
               },
               Some("import") => match kind {
                  9 => 2.0, // Boost modules for import context
                  _ => 1.0,
               },
               _ => 1.0,
            };

            final_score += (base_boost as f64 * context_multiplier) as i64;
         }

         // Consider sort_text if available
         if let Some(sort_text) = &completion.sort_text {
            // Lower sort_text should get higher score
            if sort_text.len() <= 3 {
               final_score += 50;
            }
         }

         filtered.push(FilteredCompletion {
            item: completion,
            score: final_score,
            indices,
         });
      }
   }

   // Sort by score in descending order
   filtered.sort_by(|a, b| b.score.cmp(&a.score));

   // Limit to top 50 results
   filtered.truncate(50);

   filtered
}
