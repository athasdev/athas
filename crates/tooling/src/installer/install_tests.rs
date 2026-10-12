//! Download, extraction, and path resolution against temp dirs and a local HTTP fixture server.

use super::*;
use std::{
   collections::HashMap,
   io::{BufRead, BufReader, Write},
   net::{TcpListener, TcpStream},
   sync::{
      Arc,
      atomic::{AtomicUsize, Ordering},
   },
   thread,
};

#[derive(Clone)]
enum Reply {
   Body(Vec<u8>),
   Status(u16),
   /// Advertises `declared` bytes but only sends `body` before closing the connection.
   Truncated {
      declared: u64,
      body: Vec<u8>,
   },
}

struct FixtureServer {
   url: String,
   hits: Arc<AtomicUsize>,
}

impl FixtureServer {
   fn start(routes: Vec<(&str, Reply)>) -> Self {
      let listener = TcpListener::bind("127.0.0.1:0").unwrap();
      let url = format!("http://{}", listener.local_addr().unwrap());
      let routes: HashMap<String, Reply> = routes
         .into_iter()
         .map(|(path, reply)| (path.to_string(), reply))
         .collect();
      let hits = Arc::new(AtomicUsize::new(0));
      let server_hits = Arc::clone(&hits);
      thread::spawn(move || {
         for stream in listener.incoming().flatten() {
            server_hits.fetch_add(1, Ordering::SeqCst);
            serve(stream, &routes);
         }
      });
      Self { url, hits }
   }

   fn url(&self, path: &str) -> String {
      format!("{}{path}", self.url)
   }

   fn hits(&self) -> usize {
      self.hits.load(Ordering::SeqCst)
   }
}

fn serve(mut stream: TcpStream, routes: &HashMap<String, Reply>) {
   let mut reader = BufReader::new(stream.try_clone().unwrap());
   let mut request_line = String::new();
   reader.read_line(&mut request_line).unwrap_or_default();
   loop {
      let mut line = String::new();
      if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
         break;
      }
   }
   let path = request_line
      .split_whitespace()
      .nth(1)
      .unwrap_or_default()
      .to_string();

   let (status, declared, body) = match routes.get(&path).cloned() {
      Some(Reply::Body(body)) => (200, body.len() as u64, body),
      Some(Reply::Status(status)) => (status, 0, Vec::new()),
      Some(Reply::Truncated { declared, body }) => (200, declared, body),
      None => (404, 0, Vec::new()),
   };
   let head = format!(
      "HTTP/1.1 {status} Fixture\r\nContent-Length: {declared}\r\nConnection: close\r\n\r\n"
   );
   let _ = stream.write_all(head.as_bytes());
   let _ = stream.write_all(&body);
   let _ = stream.flush();
}

fn tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
   let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
   let mut builder = tar::Builder::new(encoder);
   for (path, data) in entries {
      let mut header = tar::Header::new_gnu();
      header.set_size(data.len() as u64);
      header.set_mode(0o644);
      builder.append_data(&mut header, path, *data).unwrap();
   }
   builder.into_inner().unwrap().finish().unwrap()
}

fn tar_xz(entries: &[(&str, &[u8])]) -> Vec<u8> {
   let encoder = xz2::write::XzEncoder::new(Vec::new(), 1);
   let mut builder = tar::Builder::new(encoder);
   for (path, data) in entries {
      let mut header = tar::Header::new_gnu();
      header.set_size(data.len() as u64);
      header.set_mode(0o644);
      builder.append_data(&mut header, path, *data).unwrap();
   }
   builder.into_inner().unwrap().finish().unwrap()
}

/// A tar.gz whose single entry names a path outside the extraction root, which `tar::Builder`
/// itself refuses to write.
fn tar_gz_with_raw_path(path: &[u8], data: &[u8]) -> Vec<u8> {
   let mut header = tar::Header::new_old();
   header.as_old_mut().name[..path.len()].copy_from_slice(path);
   header.set_size(data.len() as u64);
   header.set_mode(0o644);
   header.set_cksum();
   let mut raw = header.as_bytes().to_vec();
   raw.extend_from_slice(data);
   raw.resize(raw.len().div_ceil(512) * 512, 0);
   raw.extend_from_slice(&[0; 1024]);

   let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
   encoder.write_all(&raw).unwrap();
   encoder.finish().unwrap()
}

fn zip(entries: &[(&str, Option<&[u8]>)]) -> Vec<u8> {
   let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
   let options =
      zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
   for (name, data) in entries {
      match data {
         Some(data) => {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
         }
         None => writer.add_directory(*name, options).unwrap(),
      }
   }
   writer.finish().unwrap().into_inner()
}

fn gzip(data: &[u8]) -> Vec<u8> {
   let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
   encoder.write_all(data).unwrap();
   encoder.finish().unwrap()
}

fn config(name: &str, runtime: ToolRuntime) -> ToolConfig {
   ToolConfig {
      name: name.to_string(),
      command: None,
      runtime,
      package: None,
      packages: Vec::new(),
      download_url: None,
      args: Vec::new(),
      env: HashMap::new(),
   }
}

fn with_package(mut config: ToolConfig, package: &str) -> ToolConfig {
   config.package = Some(package.to_string());
   config
}

fn write_file(path: &Path, contents: &str) {
   fs::create_dir_all(path.parent().unwrap()).unwrap();
   fs::write(path, contents).unwrap();
}

#[cfg(unix)]
fn write_script(path: &Path, body: &str) {
   fs::create_dir_all(path.parent().unwrap()).unwrap();
   athas_test_support::write_script(path, body);
}

fn download_error(result: Result<Vec<u8>, ToolError>) -> String {
   match result {
      Err(ToolError::DownloadFailed(message)) => message,
      Err(other) => panic!("expected a download failure, got {other:?}"),
      Ok(bytes) => panic!("expected a download failure, got {} bytes", bytes.len()),
   }
}

const UNKNOWN_TOOL: &str = "athas-test-tool-that-does-not-exist";

#[cfg(unix)]
mod runtimes;

#[tokio::test]
async fn downloads_bytes_and_reports_http_failures() {
   let server = FixtureServer::start(vec![
      ("/tool", Reply::Body(b"binary".to_vec())),
      ("/missing", Reply::Status(404)),
      ("/broken", Reply::Status(503)),
      (
         "/huge",
         Reply::Truncated {
            declared: MAX_BINARY_DOWNLOAD_BYTES + 1,
            body: Vec::new(),
         },
      ),
      (
         "/partial",
         Reply::Truncated {
            declared: 4096,
            body: vec![1; 16],
         },
      ),
   ]);

   assert_eq!(
      ToolInstaller::download_bytes(&server.url("/tool"))
         .await
         .unwrap(),
      b"binary"
   );
   assert_eq!(
      download_error(ToolInstaller::download_bytes(&server.url("/missing")).await),
      format!("HTTP 404 Not Found for {}", server.url("/missing"))
   );
   assert!(
      download_error(ToolInstaller::download_bytes(&server.url("/broken")).await)
         .starts_with("HTTP 503")
   );
   assert!(
      download_error(ToolInstaller::download_bytes(&server.url("/huge")).await)
         .starts_with("Tool download too large")
   );
   // A connection that closes before the advertised length is a failed download, not a short
   // binary.
   download_error(ToolInstaller::download_bytes(&server.url("/partial")).await);

   let hits = server.hits();
   assert!(
      download_error(ToolInstaller::download_bytes("http://example.com/tool").await)
         .contains("HTTPS")
   );
   assert_eq!(
      server.hits(),
      hits,
      "insecure URLs are rejected before any request"
   );

   let closed = TcpListener::bind("127.0.0.1:0").unwrap();
   let closed_url = format!("http://{}/tool", closed.local_addr().unwrap());
   drop(closed);
   download_error(ToolInstaller::download_bytes(&closed_url).await);
}

#[test]
fn extracts_supported_archive_formats() {
   let tar_entries: &[(&str, &[u8])] = &[("pkg/bin/tool", b"tool"), ("pkg/README", b"docs")];
   for (name, bytes) in [
      ("tool.tar.gz", tar_gz(tar_entries)),
      ("tool.tgz", tar_gz(tar_entries)),
      ("tool.tar.xz", tar_xz(tar_entries)),
      ("tool.txz", tar_xz(tar_entries)),
   ] {
      let target = tempfile::tempdir().unwrap();
      ToolInstaller::extract_archive(&bytes, &format!("https://x/{name}"), target.path()).unwrap();
      assert_eq!(
         fs::read(target.path().join("pkg/bin/tool")).unwrap(),
         b"tool",
         "{name}"
      );
      assert!(target.path().join("pkg/README").exists(), "{name}");
   }

   let target = tempfile::tempdir().unwrap();
   let archive = zip(&[("pkg/", None), ("pkg/bin/tool", Some(b"zipped"))]);
   ToolInstaller::extract_archive(&archive, "https://x/tool.zip", target.path()).unwrap();
   assert_eq!(
      fs::read(target.path().join("pkg/bin/tool")).unwrap(),
      b"zipped"
   );

   let target = tempfile::tempdir().unwrap();
   ToolInstaller::extract_archive(&gzip(b"gunzipped"), "https://x/tool.gz", target.path()).unwrap();
   assert_eq!(
      fs::read(target.path().join("downloaded-binary")).unwrap(),
      b"gunzipped"
   );

   let target = tempfile::tempdir().unwrap();
   ToolInstaller::extract_archive(b"raw", "https://x/tool", target.path()).unwrap();
   assert_eq!(
      fs::read(target.path().join("downloaded-binary")).unwrap(),
      b"raw"
   );
}

#[test]
fn rejects_corrupt_and_escaping_archives() {
   let root = tempfile::tempdir().unwrap();
   let target = root.path().join("staging");
   fs::create_dir_all(&target).unwrap();

   let escaping = tar_gz_with_raw_path(b"../evil", b"payload");
   match ToolInstaller::extract_archive(&escaping, "https://x/tool.tar.gz", &target) {
      Err(ToolError::InstallationFailed(message)) => {
         assert_eq!(message, "Rejected archive entry with invalid path")
      }
      other => panic!("expected the escaping entry to be rejected, got {other:?}"),
   }
   assert!(!root.path().join("evil").exists());

   let zip_slip = zip(&[
      ("pkg/bin/tool", Some(b"zipped")),
      ("../zip-evil", Some(b"payload")),
   ]);
   match ToolInstaller::extract_archive(&zip_slip, "https://x/tool.zip", &target) {
      Err(ToolError::InstallationFailed(message)) => {
         assert_eq!(message, "Rejected archive entry with invalid path")
      }
      other => panic!("expected the zip-slip entry to be rejected, got {other:?}"),
   }
   assert!(!root.path().join("zip-evil").exists());

   for name in ["tool.zip", "tool.tar.gz", "tool.tar.xz"] {
      let result = ToolInstaller::extract_archive(
         b"definitely not an archive",
         &format!("https://x/{name}"),
         &target,
      );
      assert!(
         matches!(result, Err(ToolError::InstallationFailed(_))),
         "{name}: {result:?}"
      );
   }
   assert!(
      ToolInstaller::extract_archive(b"not gzip", "https://x/tool.gz", &target).is_err(),
      "a corrupt .gz must not install garbage"
   );
}

#[test]
fn picks_the_best_binary_candidate() {
   let staging = tempfile::tempdir().unwrap();
   assert!(matches!(
      ToolInstaller::pick_binary(staging.path(), "tool"),
      Err(ToolError::InstallationFailed(_))
   ));

   write_file(&staging.path().join("LICENSE"), "");
   assert_eq!(
      ToolInstaller::pick_binary(staging.path(), "tool").unwrap(),
      staging.path().join("LICENSE"),
      "any file is better than none"
   );

   write_file(&staging.path().join("bin/tool-aarch64-darwin"), "");
   assert_eq!(
      ToolInstaller::pick_binary(staging.path(), "tool").unwrap(),
      staging.path().join("bin/tool-aarch64-darwin"),
      "a name starting with the command beats unrelated files"
   );
}

#[cfg(unix)]
#[test]
fn installs_single_file_downloads_under_the_command_name() {
   use std::os::unix::fs::PermissionsExt;
   let staging = tempfile::tempdir().unwrap();
   let install = tempfile::tempdir().unwrap();
   let install_dir = install.path().join("tool");
   write_file(&install_dir.join("stale-file"), "old");
   fs::write(staging.path().join("downloaded-binary"), "new").unwrap();

   let installed =
      ToolInstaller::install_extracted_binary(staging.path(), &install_dir, "tool", "tool-cli")
         .unwrap();

   assert_eq!(installed, install_dir.join("tool-cli"));
   assert_eq!(fs::read_to_string(&installed).unwrap(), "new");
   assert_eq!(
      fs::metadata(&installed).unwrap().permissions().mode() & 0o777,
      0o755
   );
   assert!(
      !install_dir.join("stale-file").exists(),
      "a reinstall replaces the previous install"
   );
}

#[tokio::test]
async fn downloads_and_installs_binaries() {
   let server = FixtureServer::start(vec![
      (
         "/tool.tar.gz",
         Reply::Body(tar_gz(&[("tool-1.0/bin/tool", b"archived")])),
      ),
      ("/tool-raw", Reply::Body(b"raw tool".to_vec())),
      ("/gone.tar.gz", Reply::Status(410)),
   ]);
   let tools = tempfile::tempdir().unwrap();

   let installed = ToolInstaller::download_binary(
      &tools.path().join("archived"),
      "tool",
      "tool",
      &server.url("/tool.tar.gz"),
   )
   .await
   .unwrap();
   assert_eq!(installed, tools.path().join("archived/tool-1.0/bin/tool"));
   assert_eq!(fs::read(&installed).unwrap(), b"archived");

   let installed = ToolInstaller::download_binary(
      &tools.path().join("raw"),
      "tool",
      "tool",
      &server.url("/tool-raw"),
   )
   .await
   .unwrap();
   assert_eq!(
      installed,
      tools
         .path()
         .join("raw")
         .join(ToolInstaller::bin_file_name("tool"))
   );

   let result = ToolInstaller::download_binary(
      &tools.path().join("gone"),
      "tool",
      "tool",
      &server.url("/gone.tar.gz"),
   )
   .await;
   assert!(matches!(result, Err(ToolError::DownloadFailed(_))));
   assert!(
      !tools.path().join("gone").exists(),
      "a failed download leaves no install directory behind"
   );
}

#[tokio::test]
async fn binary_tools_reuse_managed_installs_before_downloading() {
   let server = FixtureServer::start(vec![("/fresh-tool", Reply::Body(b"fresh".to_vec()))]);
   let tools = tempfile::tempdir().unwrap();

   let mut managed = config(UNKNOWN_TOOL, ToolRuntime::Binary);
   managed.download_url = Some(server.url("/fresh-tool"));
   let existing = tools
      .path()
      .join("binary")
      .join(UNKNOWN_TOOL)
      .join(ToolInstaller::bin_file_name(UNKNOWN_TOOL));
   write_file(&existing, "managed");
   assert_eq!(
      ToolInstaller::install_binary_in(tools.path(), &managed, UNKNOWN_TOOL)
         .await
         .unwrap(),
      existing
   );
   assert!(ToolInstaller::is_installed_in(tools.path(), &managed).unwrap());
   assert_eq!(server.hits(), 0);

   let legacy_tools = tempfile::tempdir().unwrap();
   let legacy = legacy_tools
      .path()
      .join("bin")
      .join(ToolInstaller::bin_file_name(UNKNOWN_TOOL));
   write_file(&legacy, "legacy");
   assert_eq!(
      ToolInstaller::install_binary_in(legacy_tools.path(), &managed, UNKNOWN_TOOL)
         .await
         .unwrap(),
      legacy
   );
   assert_eq!(
      ToolInstaller::tool_path_in(legacy_tools.path(), &managed).unwrap(),
      legacy
   );

   let empty_tools = tempfile::tempdir().unwrap();
   let mut without_url = config(UNKNOWN_TOOL, ToolRuntime::Binary);
   match ToolInstaller::install_binary_in(empty_tools.path(), &without_url, UNKNOWN_TOOL).await {
      Err(ToolError::NotFound(message)) => assert!(message.contains("no managed binary")),
      other => panic!("expected NotFound, got {other:?}"),
   }
   assert!(!ToolInstaller::is_installed_in(empty_tools.path(), &without_url).unwrap());
   assert_eq!(
      ToolInstaller::tool_path_in(empty_tools.path(), &without_url).unwrap(),
      empty_tools
         .path()
         .join("binary")
         .join(UNKNOWN_TOOL)
         .join(ToolInstaller::bin_file_name(UNKNOWN_TOOL))
   );

   without_url.download_url = Some(server.url("/fresh-tool"));
   let downloaded =
      ToolInstaller::install_binary_in(empty_tools.path(), &without_url, UNKNOWN_TOOL)
         .await
         .unwrap();
   assert_eq!(fs::read(&downloaded).unwrap(), b"fresh");
   assert_eq!(server.hits(), 1);
   assert!(ToolInstaller::is_installed_in(empty_tools.path(), &without_url).unwrap());
}

#[test]
fn resolves_tool_paths_for_each_runtime() {
   let tools = tempfile::tempdir().unwrap();
   let root = tools.path();
   let bin = ToolInstaller::bin_file_name;

   let mut command = with_package(config("pylsp", ToolRuntime::Python), "python-lsp-server");
   command.command = Some("pylsp-cli".to_string());
   let cases = [
      (
         command,
         root
            .join("python/python-lsp-server")
            .join(if cfg!(windows) { "Scripts" } else { "bin" })
            .join(bin("pylsp-cli")),
      ),
      (
         config("gopls", ToolRuntime::Go),
         root.join("go/bin").join(bin("gopls")),
      ),
      (
         config("taplo", ToolRuntime::Rust),
         root.join("cargo/bin").join(bin("taplo")),
      ),
      (
         with_package(config("solargraph", ToolRuntime::Ruby), "solargraph"),
         root
            .join("ruby/solargraph/bin")
            .join(ToolInstaller::script_bin_name("solargraph")),
      ),
      (
         with_package(config("r-languageserver", ToolRuntime::R), "languageserver"),
         root
            .join("r/languageserver/bin")
            .join(ToolInstaller::script_bin_name("r-languageserver")),
      ),
   ];
   for (config, expected) in cases {
      assert_eq!(
         ToolInstaller::tool_path_in(root, &config).unwrap(),
         expected
      );
      assert_eq!(
         ToolInstaller::lsp_launch_path_in(root, &config).unwrap(),
         expected
      );
      assert!(!ToolInstaller::is_installed_in(root, &config).unwrap());
   }

   for runtime in [
      ToolRuntime::Bun,
      ToolRuntime::Node,
      ToolRuntime::Python,
      ToolRuntime::Ruby,
      ToolRuntime::R,
   ] {
      let config = config("tool", runtime.clone());
      assert!(
         matches!(
            ToolInstaller::tool_path_in(root, &config),
            Err(ToolError::ConfigError(_))
         ),
         "{runtime:?} requires a package"
      );
   }

   let system = config(UNKNOWN_TOOL, ToolRuntime::System);
   assert!(matches!(
      ToolInstaller::tool_path_in(root, &system),
      Err(ToolError::NotFound(message)) if message.contains(UNKNOWN_TOOL)
   ));
   assert!(ToolInstaller::is_installed_in(root, &system).is_err());
}

#[test]
fn resolves_node_tools_from_bun_and_npm_package_dirs() {
   let tools = tempfile::tempdir().unwrap();
   let root = tools.path();
   let bun = with_package(
      config("yaml-language-server", ToolRuntime::Bun),
      "yaml-language-server@1.0.0",
   );
   let npm = with_package(
      config("yaml-language-server", ToolRuntime::Node),
      "yaml-language-server",
   );
   let shim_name = ToolInstaller::default_node_bin_name("yaml-language-server");

   assert_eq!(
      ToolInstaller::tool_path_in(root, &bun).unwrap(),
      root
         .join("bun/yaml-language-server/node_modules/.bin")
         .join(&shim_name),
      "the expected shim path before installation"
   );
   assert!(!ToolInstaller::is_installed_in(root, &bun).unwrap());
   assert_eq!(
      ToolInstaller::lsp_launch_path_in(root, &npm).unwrap(),
      root
         .join("npm/yaml-language-server/node_modules/.bin")
         .join(&shim_name)
   );

   let bun_shim = root
      .join("bun/yaml-language-server/node_modules/.bin")
      .join(&shim_name);
   write_file(&bun_shim, "");
   assert_eq!(ToolInstaller::tool_path_in(root, &bun).unwrap(), bun_shim);
   assert_eq!(
      ToolInstaller::lsp_launch_path_in(root, &bun).unwrap(),
      bun_shim,
      "the shim is the launch path when the package has no entrypoint"
   );
   assert!(ToolInstaller::is_installed_in(root, &bun).unwrap());

   let package_root = root.join("npm/yaml-language-server/node_modules/yaml-language-server");
   write_file(
      &package_root.join("package.json"),
      r#"{ "bin": "./bin/server.js" }"#,
   );
   write_file(&package_root.join("bin/server.js"), "");
   assert_eq!(
      ToolInstaller::tool_path_in(root, &npm).unwrap(),
      package_root.join("./bin/server.js")
   );
   assert_eq!(
      ToolInstaller::lsp_launch_path_in(root, &npm).unwrap(),
      package_root.join("./bin/server.js")
   );

   let mut with_companion = npm.clone();
   with_companion.packages = vec!["yaml".to_string()];
   for result in [
      ToolInstaller::tool_path_in(root, &with_companion),
      ToolInstaller::lsp_launch_path_in(root, &with_companion),
   ] {
      assert!(matches!(
         result,
         Err(ToolError::InstallationFailed(message)) if message.contains("'yaml' is missing")
      ));
   }
}

#[test]
fn finds_package_binaries_by_walking_node_modules() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("bun").join("meta-package");
   let dependency = package_dir.join("node_modules/@scope/real-server");
   write_file(
      &dependency.join("package.json"),
      r#"{ "bin": { "other": "other.js", "real-server": "dist/cli.js" } }"#,
   );
   write_file(&dependency.join("dist/cli.js"), "");
   // A bin shim directory never counts as a package root.
   write_file(
      &package_dir.join("node_modules/.bin/nested/package.json"),
      r#"{ "bin": { "real-server": "fake.js" } }"#,
   );
   write_file(&package_dir.join("node_modules/.bin/nested/fake.js"), "");

   assert_eq!(
      ToolInstaller::resolve_node_package_binary(&package_dir, "meta-package", "real-server"),
      Some(dependency.join("dist/cli.js"))
   );
   assert_eq!(
      ToolInstaller::resolve_node_package_binary(&package_dir, "meta-package", "absent"),
      None,
      "the walk does not fall back to an unrelated first bin"
   );

   let identity_root = package_dir.join("node_modules/meta-package");
   write_file(
      &identity_root.join("package.json"),
      r#"{ "bin": { "first": "first.js", "second": "second.js" } }"#,
   );
   write_file(&identity_root.join("first.js"), "");
   assert_eq!(
      ToolInstaller::resolve_node_package_entrypoint(&package_dir, "meta-package", "absent"),
      Some(identity_root.join("first.js")),
      "the named package falls back to its first bin"
   );
   assert_eq!(
      ToolInstaller::resolve_node_package_entrypoint(&package_dir, "meta-package", "second"),
      None,
      "a declared bin that is missing on disk does not resolve"
   );

   write_file(
      &identity_root.join("package.json"),
      r#"{ "bin": { "escape": "../../outside.js" } }"#,
   );
   assert_eq!(
      ToolInstaller::resolve_node_package_entrypoint_from_root(&identity_root, "escape", true),
      None
   );
   write_file(&identity_root.join("package.json"), "not json");
   assert_eq!(
      ToolInstaller::resolve_node_package_entrypoint_from_root(&identity_root, "first", true),
      None
   );
}

#[test]
fn companion_validation_includes_known_peer_packages_once() {
   assert_eq!(
      ToolInstaller::node_companion_packages_to_validate(
         "typescript-language-server",
         &["typescript".to_string(), "prettier".to_string()]
      ),
      vec!["typescript", "prettier"]
   );
   assert_eq!(
      ToolInstaller::node_companion_packages_to_validate("@vtsls/language-server", &[]),
      vec!["typescript"]
   );
   assert!(ToolInstaller::node_companion_packages_to_validate("eslint", &[]).is_empty());
   assert_eq!(
      ToolInstaller::node_package_install_spec("typescript"),
      "typescript@6.0.3"
   );
   assert_eq!(ToolInstaller::node_package_install_spec("eslint"), "eslint");
}

#[cfg(unix)]
#[test]
fn reports_package_manager_failures() {
   let root = tempfile::tempdir().unwrap();
   let package_dir = root.path().join("package");
   fs::create_dir_all(&package_dir).unwrap();
   let failing = root.path().join("bin/failing-pm");
   write_script(&failing, "echo 'registry unreachable' >&2\nexit 1");
   let succeeding = root.path().join("bin/succeeding-pm");
   write_script(&succeeding, "exit 0");

   let install = |manager: &Path| {
      ToolInstaller::install_node_package(
         (manager, None),
         "Bun",
         &package_dir,
         "some-server",
         "some-server",
         &[],
         "add",
      )
   };

   match install(&failing) {
      Err(ToolError::InstallationFailed(message)) => {
         assert!(message.starts_with("Bun install failed"), "{message}");
         assert!(message.contains("registry unreachable"), "{message}");
      }
      other => panic!("expected install failure, got {other:?}"),
   }
   match install(&root.path().join("bin/missing-pm")) {
      Err(ToolError::InstallationFailed(message)) => {
         assert!(message.contains("could not start"), "{message}")
      }
      other => panic!("expected spawn failure, got {other:?}"),
   }
   match install(&succeeding) {
      Err(ToolError::InstallationFailed(message)) => assert_eq!(
         message,
         "Binary 'some-server' not found after installing package 'some-server' via Bun"
      ),
      other => panic!("expected missing binary failure, got {other:?}"),
   }
}

#[cfg(unix)]
#[test]
fn validates_installed_binaries_and_marks_them_executable() {
   use std::os::unix::fs::PermissionsExt;
   let temp = tempfile::tempdir().unwrap();
   let binary = temp.path().join("tool");

   assert!(matches!(
      ToolInstaller::validate_and_prepare(&binary),
      Err(ToolError::InstallationFailed(message)) if message.contains("Binary not found")
   ));

   fs::write(&binary, "").unwrap();
   fs::set_permissions(&binary, fs::Permissions::from_mode(0o600)).unwrap();
   assert_eq!(
      ToolInstaller::validate_and_prepare(&binary).unwrap(),
      binary
   );
   assert_eq!(
      fs::metadata(&binary).unwrap().permissions().mode() & 0o777,
      0o755
   );
}

#[cfg(unix)]
#[test]
fn reads_paths_and_java_versions_from_helper_commands() {
   let temp = tempfile::tempdir().unwrap();
   let existing = temp.path().join("found-tool");
   fs::write(&existing, "").unwrap();

   let printer = temp.path().join("print-path");
   write_script(&printer, &format!("echo '  {}  '", existing.display()));
   let printer = printer.to_string_lossy().into_owned();
   assert_eq!(
      ToolInstaller::command_stdout_path(&printer, &[]),
      Some(existing.clone())
   );

   let missing = temp.path().join("print-missing");
   write_script(&missing, "echo /definitely/not/here");
   assert_eq!(
      ToolInstaller::command_stdout_path(&missing.to_string_lossy(), &[]),
      None
   );

   let failing = temp.path().join("fail");
   write_script(&failing, &format!("echo '{}'\nexit 2", existing.display()));
   assert_eq!(
      ToolInstaller::command_stdout_path(&failing.to_string_lossy(), &[]),
      None
   );
   assert_eq!(ToolInstaller::command_stdout_path(UNKNOWN_TOOL, &[]), None);

   let java = temp.path().join("java");
   write_script(
      &java,
      "[ \"$1\" = \"-version\" ] || exit 1\necho 'openjdk version \"17.0.2\" 2022-01-18' >&2",
   );
   assert_eq!(ToolInstaller::java_major_version(&java), Some(17));
   assert_eq!(
      ToolInstaller::java_major_version(&temp.path().join("no-java")),
      None
   );
}

#[test]
fn reports_unknown_system_tools() {
   match ToolInstaller::find_system_tool(UNKNOWN_TOOL) {
      Err(ToolError::NotFound(message)) => assert_eq!(
         message,
         format!("{UNKNOWN_TOOL} (system tool not found in PATH or known toolchain locations)")
      ),
      other => panic!("expected NotFound, got {other:?}"),
   }
   assert_eq!(
      ToolInstaller::find_binary_in_dirs(UNKNOWN_TOOL, ToolInstaller::common_system_tool_dirs()),
      None
   );
}

#[test]
fn copies_nested_directories() {
   let source = tempfile::tempdir().unwrap();
   let target = tempfile::tempdir().unwrap();
   write_file(&source.path().join("a/b/c.txt"), "deep");
   write_file(&source.path().join("top.txt"), "top");

   ToolInstaller::copy_dir_all(source.path(), &target.path().join("copy")).unwrap();

   assert_eq!(
      fs::read_to_string(target.path().join("copy/a/b/c.txt")).unwrap(),
      "deep"
   );
   assert_eq!(
      fs::read_to_string(target.path().join("copy/top.txt")).unwrap(),
      "top"
   );
   assert!(ToolInstaller::copy_dir_all(&source.path().join("missing"), target.path()).is_err());
}

#[tokio::test]
async fn extracts_the_java_debug_bundle_from_the_extension_package() {
   let jar = "extension/server/com.microsoft.java.debug.plugin-0.53.0.jar";
   let vsix = zip(&[
      ("extension/package.json", Some(b"{}")),
      (jar, Some(b"jar bytes")),
   ]);
   let server = FixtureServer::start(vec![
      ("/plain.vsix", Reply::Body(vsix.clone())),
      ("/gzipped.vsix", Reply::Body(gzip(&vsix))),
      (
         "/empty.vsix",
         Reply::Body(zip(&[("extension/package.json", Some(b"{}"))])),
      ),
      ("/garbage.vsix", Reply::Body(b"garbage".to_vec())),
      ("/bad-gzip.vsix", Reply::Body(vec![0x1f, 0x8b, 0, 1, 2])),
      ("/missing.vsix", Reply::Status(404)),
   ]);
   let temp = tempfile::tempdir().unwrap();

   for source in ["/plain.vsix", "/gzipped.vsix"] {
      let bundle = temp
         .path()
         .join(source.trim_start_matches('/'))
         .join("java-debug")
         .join(JAVA_DEBUG_BUNDLE_NAME);
      let installed =
         ToolInstaller::ensure_java_debug_bundle_at(bundle.clone(), &server.url(source))
            .await
            .unwrap();
      assert_eq!(installed, bundle);
      assert_eq!(fs::read(&bundle).unwrap(), b"jar bytes", "{source}");
   }

   let hits = server.hits();
   let existing = temp
      .path()
      .join("plain.vsix/java-debug")
      .join(JAVA_DEBUG_BUNDLE_NAME);
   ToolInstaller::ensure_java_debug_bundle_at(existing, &server.url("/missing.vsix"))
      .await
      .unwrap();
   assert_eq!(
      server.hits(),
      hits,
      "an existing bundle is not downloaded again"
   );

   for (source, expected) in [
      ("/empty.vsix", "does not contain the debugger bundle"),
      (
         "/garbage.vsix",
         "Failed to read Java debug extension package",
      ),
      (
         "/bad-gzip.vsix",
         "Failed to decode Java debug extension package",
      ),
   ] {
      let bundle = temp.path().join("failed").join(JAVA_DEBUG_BUNDLE_NAME);
      match ToolInstaller::ensure_java_debug_bundle_at(bundle.clone(), &server.url(source)).await {
         Err(ToolError::InstallationFailed(message)) => {
            assert!(message.contains(expected), "{source}: {message}")
         }
         other => panic!("{source}: expected an installation failure, got {other:?}"),
      }
      assert!(!bundle.exists());
   }
   assert!(matches!(
      ToolInstaller::ensure_java_debug_bundle_at(
         temp.path().join("missing").join(JAVA_DEBUG_BUNDLE_NAME),
         &server.url("/missing.vsix")
      )
      .await,
      Err(ToolError::DownloadFailed(_))
   ));
}
