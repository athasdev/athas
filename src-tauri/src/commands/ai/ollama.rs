use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::command;
use url::Url;

const DEFAULT_OLLAMA_BASE_URL: &str = "http://localhost:11434";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaProbeResponse {
   normalized_url: String,
   models: Vec<OllamaModel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
   id: String,
   name: String,
   max_tokens: usize,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
   #[serde(default)]
   models: Vec<OllamaTagModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagModel {
   name: String,
}

fn normalize_ollama_base_url(input: &str) -> String {
   let trimmed = input.trim().trim_end_matches('/');
   if trimmed.is_empty() {
      DEFAULT_OLLAMA_BASE_URL.to_string()
   } else {
      trimmed.to_string()
   }
}

fn validate_ollama_base_url(input: &str) -> Result<(), String> {
   let parsed = Url::parse(input).map_err(|_| "Invalid Ollama URL".to_string())?;

   match parsed.scheme() {
      "http" | "https" => {}
      _ => return Err("Invalid Ollama URL".to_string()),
   }

   if parsed.host_str().is_none() {
      return Err("Invalid Ollama URL".to_string());
   }

   Ok(())
}

#[command]
pub async fn probe_ollama_endpoint(base_url: String) -> Result<OllamaProbeResponse, String> {
   let normalized_url = normalize_ollama_base_url(&base_url);
   validate_ollama_base_url(&normalized_url)?;

   let client = Client::builder()
      .timeout(Duration::from_secs(3))
      .build()
      .map_err(|error| format!("Failed to create Ollama client: {}", error))?;

   let tags_url = format!("{}/api/tags", normalized_url);
   let response = client
      .get(&tags_url)
      .send()
      .await
      .map_err(|error| format!("Failed to connect to Ollama: {}", error))?;

   if !response.status().is_success() {
      return Err(format!(
         "Ollama endpoint returned HTTP {}",
         response.status()
      ));
   }

   let payload = response
      .json::<OllamaTagsResponse>()
      .await
      .map_err(|error| format!("Failed to read Ollama response: {}", error))?;

   let models = payload
      .models
      .into_iter()
      .map(|model| OllamaModel {
         id: model.name.clone(),
         name: model.name,
         max_tokens: 4096,
      })
      .collect();

   Ok(OllamaProbeResponse {
      normalized_url,
      models,
   })
}

#[cfg(test)]
mod tests {
   use std::{
      io::{Read, Write},
      net::TcpListener,
      thread,
   };

   use super::{DEFAULT_OLLAMA_BASE_URL, normalize_ollama_base_url, validate_ollama_base_url};
   use crate::commands::ai::ollama::probe_ollama_endpoint;

   #[test]
   fn normalizes_empty_base_url_to_default() {
      assert_eq!(normalize_ollama_base_url(""), DEFAULT_OLLAMA_BASE_URL);
      assert_eq!(normalize_ollama_base_url("   "), DEFAULT_OLLAMA_BASE_URL);
   }

   #[test]
   fn trims_trailing_slashes() {
      assert_eq!(
         normalize_ollama_base_url("http://localhost:11434///"),
         DEFAULT_OLLAMA_BASE_URL
      );
   }

   #[test]
   fn accepts_http_and_https_urls() {
      assert!(validate_ollama_base_url("http://localhost:11434").is_ok());
      assert!(validate_ollama_base_url("https://ollama.example.com/base").is_ok());
   }

   #[test]
   fn rejects_invalid_urls() {
      assert!(validate_ollama_base_url("localhost:11434").is_err());
      assert!(validate_ollama_base_url("ftp://localhost:11434").is_err());
      assert!(validate_ollama_base_url("http://").is_err());
   }

   #[tokio::test]
   async fn probes_custom_port_and_returns_models() {
      let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
      let address = listener.local_addr().expect("read local addr");

      thread::spawn(move || {
         let (mut stream, _) = listener.accept().expect("accept request");
         let mut buffer = [0_u8; 1024];
         let _ = stream.read(&mut buffer);

         let body = r#"{"models":[{"name":"llama3.2"}]}"#;
         let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
         );

         stream
            .write_all(response.as_bytes())
            .expect("write response");
      });

      let result = probe_ollama_endpoint(format!("http://{}", address))
         .await
         .expect("probe endpoint");

      assert_eq!(result.normalized_url, format!("http://{}", address));
      assert_eq!(result.models.len(), 1);
      assert_eq!(result.models[0].id, "llama3.2");
      assert_eq!(result.models[0].name, "llama3.2");
   }
}
