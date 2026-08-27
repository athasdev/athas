pub(super) fn normalize_jsonc(input: &str) -> String {
   strip_json_trailing_commas(&strip_json_comments(input))
}

fn strip_json_comments(input: &str) -> String {
   let mut output = String::with_capacity(input.len());
   let mut chars = input.chars().peekable();
   let mut in_string = false;
   let mut escaped = false;

   while let Some(ch) = chars.next() {
      if in_string {
         output.push(ch);
         if escaped {
            escaped = false;
         } else if ch == '\\' {
            escaped = true;
         } else if ch == '"' {
            in_string = false;
         }
         continue;
      }

      if ch == '"' {
         in_string = true;
         output.push(ch);
         continue;
      }

      if ch == '/' {
         match chars.peek() {
            Some('/') => {
               chars.next();
               for next in chars.by_ref() {
                  if next == '\n' {
                     output.push('\n');
                     break;
                  }
               }
               continue;
            }
            Some('*') => {
               chars.next();
               let mut previous = '\0';
               for next in chars.by_ref() {
                  if next == '\n' {
                     output.push('\n');
                  }
                  if previous == '*' && next == '/' {
                     break;
                  }
                  previous = next;
               }
               continue;
            }
            _ => {}
         }
      }

      output.push(ch);
   }

   output
}

fn strip_json_trailing_commas(input: &str) -> String {
   let mut output = String::with_capacity(input.len());
   let mut chars = input.chars().peekable();
   let mut in_string = false;
   let mut escaped = false;

   while let Some(ch) = chars.next() {
      if in_string {
         output.push(ch);
         if escaped {
            escaped = false;
         } else if ch == '\\' {
            escaped = true;
         } else if ch == '"' {
            in_string = false;
         }
         continue;
      }

      if ch == '"' {
         in_string = true;
         output.push(ch);
         continue;
      }

      if ch == ',' {
         let mut lookahead = chars.clone();
         while matches!(lookahead.peek(), Some(next) if next.is_whitespace()) {
            lookahead.next();
         }
         if matches!(lookahead.peek(), Some('}' | ']')) {
            continue;
         }
      }

      output.push(ch);
   }

   output
}
