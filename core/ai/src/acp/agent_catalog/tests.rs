use super::*;
use std::{
   io::{BufRead, BufReader, Write},
   net::TcpListener,
   thread,
};

fn contribution(json: serde_json::Value) -> MarketplaceAgentContribution {
   serde_json::from_value(json).unwrap()
}

/// Serves `body` with `status` to every request until the test ends.
fn serve(status: u16, body: &'static str) -> String {
   let listener = TcpListener::bind("127.0.0.1:0").unwrap();
   let address = listener.local_addr().unwrap();
   thread::spawn(move || {
      for stream in listener.incoming().flatten() {
         let mut reader = BufReader::new(&stream);
         let mut line = String::new();
         while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
            line.clear();
         }
         let mut stream = &stream;
         let _ = write!(
            stream,
            "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
         );
      }
   });
   format!("http://{address}/manifests.json")
}

#[test]
fn keeps_terminal_integrations_out_of_the_acp_catalog() {
   assert!(!is_acp_agent_id("claude-code"));
   assert!(!is_acp_agent_id("codex"));
   assert!(!is_acp_agent_id("codex-cli"));
   assert!(is_acp_agent_id("claude-acp"));
}

#[test]
fn bundles_every_official_acp_agent_for_offline_discovery() {
   let agents = bundled_agent_catalog();
   let ids = agents
      .iter()
      .map(|agent| agent.id.as_str())
      .collect::<Vec<_>>();

   assert_eq!(agents.len(), 7);
   assert!(ids.contains(&"claude-acp"));
   assert!(ids.contains(&"antigravity-acp"));
   assert!(agents.iter().all(|agent| agent.can_install));
}

#[test]
fn remote_agent_metadata_overrides_the_bundled_fallback() {
   let mut bundled = AgentConfig::new("test-agent", "Bundled", "test-agent");
   bundled.available_version = Some("1.0.0".to_string());
   let mut remote = bundled.clone();
   remote.name = "Remote".to_string();
   remote.available_version = Some("2.0.0".to_string());
   let other = AgentConfig::new("other", "Another", "other");

   let merged = merge_agent_catalog(vec![remote], vec![bundled, other]);

   assert_eq!(
      merged
         .iter()
         .map(|agent| agent.name.as_str())
         .collect::<Vec<_>>(),
      vec!["Another", "Remote"]
   );
   assert_eq!(merged[1].available_version.as_deref(), Some("2.0.0"));
}

#[test]
fn picks_platform_specific_args_downloads_and_commands() {
   let agent = to_agent_config(
      contribution(serde_json::json!({
         "id": "demo-acp",
         "name": "Demo",
         "binaryName": "demo",
         "args": ["--acp"],
         "argsByPlatform": { "linux-x64": ["--acp", "--linux"] },
         "envVars": { "DEMO": "1" },
         "install": {
            "runtime": "binary",
            "package": "demo",
            "version": "2.0.0",
            "command": "demo",
            "commandsByPlatform": { "linux-x64": "demo-linux" },
            "downloadUrl": "https://example.com/generic.tar.gz",
            "downloadUrls": { "linux-x64": "https://example.com/linux.tar.gz" }
         }
      })),
      Some("linux-x64"),
   );

   assert_eq!(agent.args, vec!["--acp", "--linux"]);
   assert_eq!(agent.env_vars.get("DEMO").map(String::as_str), Some("1"));
   assert_eq!(agent.install_runtime, Some(AgentRuntime::Binary));
   assert_eq!(agent.install_command.as_deref(), Some("demo-linux"));
   assert_eq!(
      agent.install_download_url.as_deref(),
      Some("https://example.com/linux.tar.gz")
   );
   assert_eq!(agent.available_version.as_deref(), Some("2.0.0"));
   assert!(agent.can_install);
   assert!(matches!(agent.source, AgentSource::Extension));
}

#[test]
fn binary_agents_without_a_download_cannot_be_installed() {
   let manifest = serde_json::json!({
      "id": "demo-acp",
      "name": "Demo",
      "binaryName": "demo",
      "args": ["--acp"],
      "install": { "runtime": "binary", "package": "demo" }
   });

   let binary = to_agent_config(contribution(manifest.clone()), None);
   assert_eq!(binary.args, vec!["--acp"]);
   assert!(!binary.can_install);

   let mut node_manifest = manifest;
   node_manifest["install"]["runtime"] = serde_json::json!("node");
   assert!(to_agent_config(contribution(node_manifest), Some("darwin-arm64")).can_install);

   let no_install = to_agent_config(
      contribution(serde_json::json!({ "id": "x", "name": "X", "binaryName": "x" })),
      None,
   );
   assert!(!no_install.can_install);
   assert_eq!(no_install.install_runtime, None);
}

#[test]
fn reads_acp_agents_from_every_manifest() {
   let manifests: HashMap<String, MarketplaceExtensionManifest> =
      serde_json::from_value(serde_json::json!({
         "claude-code": { "agents": [{ "id": "claude-code", "name": "Claude Code", "binaryName": "claude" }] },
         "demo": { "agents": [{ "id": "demo-acp", "name": "Demo", "binaryName": "demo" }] },
         "theme": {}
      }))
      .unwrap();

   let agents = agent_configs_from_manifests(manifests);

   assert_eq!(agents.len(), 1);
   assert_eq!(agents[0].id, "demo-acp");
   assert_eq!(
      extensions_manifest_url("https://cdn.example.com/ext/"),
      "https://cdn.example.com/ext/manifests.json"
   );
}

#[tokio::test]
async fn merges_the_remote_catalog_and_caches_it() {
   let url = serve(
      200,
      r#"{"demo":{"agents":[{"id":"demo-acp","name":"AAA Demo","binaryName":"demo"},{"id":"codex","name":"Codex","binaryName":"codex"}]}}"#,
   );
   let cache = AgentCatalogCache::new();

   let agents = cache.load(&url).await.unwrap();

   assert_eq!(agents.len(), 8);
   assert_eq!(agents[0].id, "demo-acp");
   assert!(!agents.iter().any(|agent| agent.id == "codex"));
   let cached = cache
      .load("http://127.0.0.1:1/unreachable.json")
      .await
      .unwrap();
   assert_eq!(cached.len(), 8, "a fresh cache is reused");
}

#[tokio::test]
async fn falls_back_to_bundled_agents_when_the_catalog_is_unavailable() {
   for url in [
      serve(503, "unavailable"),
      serve(200, "not json"),
      "http://127.0.0.1:1/unreachable.json".to_string(),
   ] {
      let agents = AgentCatalogCache::new().load(&url).await.unwrap();
      assert_eq!(agents.len(), 7, "{url}");
   }
}
