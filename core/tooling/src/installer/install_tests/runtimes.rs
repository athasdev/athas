//! Package-manager and Java installs driven by fake runtime executables in a temp dir.
//!
//! Every fake appends the command line it was given to a shared log, so the tests can assert on
//! exactly what the installer ran, and creates (or deliberately omits) the files a real package
//! manager would leave behind.

use super::*;

struct Fakes {
   root: tempfile::TempDir,
}

impl Fakes {
   fn new() -> Self {
      let fakes = Self {
         root: tempfile::tempdir().unwrap(),
      };
      fs::create_dir_all(fakes.bin()).unwrap();
      fakes
   }

   fn bin(&self) -> PathBuf {
      self.root.path().join("fake-bin")
   }

   fn tools(&self) -> PathBuf {
      self.root.path().join("tools")
   }

   fn log(&self) -> PathBuf {
      self.root.path().join("calls.log")
   }

   fn env(&self) -> InstallEnv {
      self.env_with_temurin("http://127.0.0.1:9/unused")
   }

   fn env_with_temurin(&self, temurin_url: &str) -> InstallEnv {
      InstallEnv {
         tools_dir: self.tools(),
         runtime_root: self.root.path().join("runtimes"),
         runtimes: RuntimeSource::Dir(self.bin()),
         temurin_url: temurin_url.to_string(),
      }
   }

   /// Writes a fake executable that logs `name args...` and then runs `body`.
   fn fake(&self, name: &str, body: &str) -> PathBuf {
      let path = self.bin().join(name);
      write_script(
         &path,
         &format!("echo \"{name} $*\" >> '{}'\n{body}", self.log().display()),
      );
      path
   }

   fn calls(&self) -> Vec<String> {
      fs::read_to_string(self.log())
         .unwrap_or_default()
         .lines()
         .map(ToString::to_string)
         .collect()
   }
}

fn tool(name: &str, runtime: ToolRuntime, package: &str) -> ToolConfig {
   with_package(config(name, runtime), package)
}

fn installation_error(result: Result<PathBuf, ToolError>) -> String {
   match result {
      Err(ToolError::InstallationFailed(message)) => message,
      other => panic!("expected an installation failure, got {other:?}"),
   }
}

fn runtime_error(result: Result<PathBuf, ToolError>) -> String {
   match result {
      Err(ToolError::RuntimeNotAvailable(message)) => message,
      other => panic!("expected a missing runtime, got {other:?}"),
   }
}

fn assert_executable(path: &Path) {
   use std::os::unix::fs::PermissionsExt;
   assert_eq!(
      fs::metadata(path).unwrap().permissions().mode() & 0o111,
      0o111,
      "{path:?} is not executable"
   );
}

fn java_script(version_line: &str) -> String {
   format!("#!/bin/sh\n[ \"$1\" = -version ] || exit 1\necho '{version_line}' >&2\n")
}

#[tokio::test]
async fn every_package_runtime_requires_a_package() {
   let fakes = Fakes::new();
   for runtime in [
      ToolRuntime::Bun,
      ToolRuntime::Node,
      ToolRuntime::Python,
      ToolRuntime::Go,
      ToolRuntime::Rust,
      ToolRuntime::Ruby,
      ToolRuntime::R,
   ] {
      match ToolInstaller::install_in(&fakes.env(), &config("server", runtime.clone())).await {
         Err(ToolError::ConfigError(message)) => assert_eq!(message, "No package specified"),
         other => panic!("{runtime:?}: expected a config error, got {other:?}"),
      }
   }
   assert!(fakes.calls().is_empty(), "nothing runs without a package");
}

#[tokio::test]
async fn bun_installs_the_package_and_its_peers_into_the_tool_dir() {
   let fakes = Fakes::new();
   fakes.fake(
      "bun",
      r#"echo "PATH ${PATH%%:*}" >> "$(dirname "$0")/../calls.log"
mkdir -p node_modules/.bin node_modules/typescript
printf '#!/bin/sh\n' > node_modules/.bin/typescript-language-server"#,
   );
   let config = tool(
      "typescript-language-server",
      ToolRuntime::Bun,
      "typescript-language-server",
   );

   let installed = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let package_dir = fakes.tools().join("bun/typescript-language-server");
   assert_eq!(
      installed,
      package_dir.join("node_modules/.bin/typescript-language-server")
   );
   assert_executable(&installed);
   assert_eq!(
      fakes.calls(),
      vec![
         "bun add typescript-language-server@5.2.0 typescript@6.0.3".to_string(),
         format!("PATH {}", fakes.bin().display()),
      ],
      "bun runs `add` with pinned versions and its own dir first on PATH"
   );
   assert!(
      fs::read_to_string(package_dir.join("package.json"))
         .unwrap()
         .contains("\"private\": true"),
      "a manifest keeps bun from walking up to an unrelated package.json"
   );
   assert_eq!(
      ToolInstaller::tool_path_in(&fakes.tools(), &config).unwrap(),
      installed
   );
   assert!(ToolInstaller::is_installed_in(&fakes.tools(), &config).unwrap());
}

#[tokio::test]
async fn bun_failures_fall_back_to_npm_in_the_same_dir() {
   let fakes = Fakes::new();
   fakes.fake("bun", "echo 'lockfile corrupt' >&2\nexit 1");
   fakes.fake(
      "node",
      "[ \"$2\" = install ] || exit 9\nmkdir -p node_modules/.bin\ntouch node_modules/.bin/lsp",
   );
   write_file(&fakes.bin().join("npm-cli.js"), "");
   let config = tool("lsp", ToolRuntime::Bun, "some-lsp");

   let installed = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   assert_eq!(
      installed,
      fakes.tools().join("bun/some-lsp/node_modules/.bin/lsp")
   );
   assert_eq!(
      fakes.calls(),
      vec![
         "bun add some-lsp".to_string(),
         format!(
            "node {} install some-lsp",
            fakes.bin().join("npm-cli.js").display()
         ),
      ]
   );
}

#[tokio::test]
async fn reports_both_errors_when_bun_and_npm_fail() {
   let fakes = Fakes::new();
   let config = tool("lsp", ToolRuntime::Bun, "some-lsp");

   let message = installation_error(ToolInstaller::install_in(&fakes.env(), &config).await);
   assert_eq!(
      message,
      "Bun install failed: Runtime 'Runtime 'bun' not found on system' not available; npm \
       fallback failed: Runtime 'Runtime 'node' not found on system' not available"
   );

   fakes.fake("node", "exit 0");
   let message = installation_error(ToolInstaller::install_in(&fakes.env(), &config).await);
   assert!(
      message.ends_with(
         "npm fallback failed: Runtime 'The Node.js runtime is missing npm-cli.js' not available"
      ),
      "{message}"
   );
}

#[tokio::test]
async fn npm_installs_scoped_packages_and_resolves_their_bin_entrypoint() {
   let fakes = Fakes::new();
   fakes.fake(
      "node",
      r#"pkg=node_modules/@vtsls/language-server
mkdir -p "$pkg/bin" node_modules/typescript
echo '{"bin":{"vtsls":"bin/vtsls.js"}}' > "$pkg/package.json"
touch "$pkg/bin/vtsls.js""#,
   );
   write_file(&fakes.bin().join("npm-cli.js"), "");
   let config = tool("vtsls", ToolRuntime::Node, "@vtsls/language-server");

   let installed = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let package_dir = fakes.tools().join("npm/@vtsls/language-server");
   assert_eq!(
      installed,
      package_dir.join("node_modules/@vtsls/language-server/bin/vtsls.js")
   );
   assert_executable(&installed);
   assert_eq!(
      fakes.calls(),
      vec![format!(
         "node {} install @vtsls/language-server@0.3.0 typescript@6.0.3",
         fakes.bin().join("npm-cli.js").display()
      )]
   );
   assert_eq!(
      ToolInstaller::lsp_launch_path_in(&fakes.tools(), &config).unwrap(),
      installed
   );
}

#[tokio::test]
async fn npm_installs_missing_a_peer_are_not_reported_as_installed() {
   let fakes = Fakes::new();
   fakes.fake(
      "node",
      "mkdir -p node_modules/.bin\ntouch node_modules/.bin/typescript-language-server",
   );
   write_file(&fakes.bin().join("npm-cli.js"), "");
   let config = tool(
      "typescript-language-server",
      ToolRuntime::Node,
      "typescript-language-server",
   );

   ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let message = installation_error(ToolInstaller::tool_path_in(&fakes.tools(), &config));
   assert!(
      message.contains("required dependency 'typescript' is missing"),
      "{message}"
   );
}

#[tokio::test]
async fn pip_installs_into_a_per_package_virtualenv() {
   let fakes = Fakes::new();
   let log = fakes.log();
   fakes.fake(
      "python3",
      &format!(
         r#"[ "$1 $2" = "-m venv" ] || exit 9
mkdir -p "$3/bin"
cat > "$3/bin/pip" <<EOF
#!/bin/sh
echo "pip \$*" >> '{log}'
touch "$3/bin/pylsp"
EOF
chmod +x "$3/bin/pip""#,
         log = log.display()
      ),
   );
   let config = tool("pylsp", ToolRuntime::Python, "python-lsp-server");

   let installed = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let venv = fakes.tools().join("python/python-lsp-server");
   assert_eq!(installed, venv.join("bin/pylsp"));
   assert_executable(&installed);
   assert_eq!(
      fakes.calls(),
      vec![
         format!("python3 -m venv {}", venv.display()),
         "pip install python-lsp-server".to_string(),
      ]
   );
   assert_eq!(
      ToolInstaller::tool_path_in(&fakes.tools(), &config).unwrap(),
      installed
   );
}

#[tokio::test]
async fn pip_failures_stop_the_install() {
   let config = tool("pylsp", ToolRuntime::Python, "python-lsp-server");

   let fakes = Fakes::new();
   assert_eq!(
      runtime_error(ToolInstaller::install_in(&fakes.env(), &config).await),
      "Runtime 'python3' not found on system"
   );

   fakes.fake("python3", "echo 'ensurepip is not available' >&2\nexit 1");
   assert_eq!(
      installation_error(ToolInstaller::install_in(&fakes.env(), &config).await),
      "Failed to create venv: ensurepip is not available\n"
   );

   fakes.fake("python3", "exit 0");
   let message = installation_error(ToolInstaller::install_in(&fakes.env(), &config).await);
   assert!(
      message.contains("No such file"),
      "a venv without pip cannot install anything: {message}"
   );

   let pip = fakes.tools().join("python/python-lsp-server/bin/pip");
   write_script(&pip, "echo 'no matching distribution' >&2\nexit 1");
   assert_eq!(
      installation_error(ToolInstaller::install_in(&fakes.env(), &config).await),
      "pip install failed: no matching distribution\n"
   );

   write_script(&pip, "exit 0");
   let message = installation_error(ToolInstaller::install_in(&fakes.env(), &config).await);
   assert!(message.contains("Binary not found"), "{message}");
}

#[tokio::test]
async fn go_installs_the_latest_module_into_a_managed_gopath() {
   let fakes = Fakes::new();
   fakes.fake(
      "go",
      "echo \"GOPATH $GOPATH\" >> \"$(dirname \"$0\")/../calls.log\"\nmkdir -p \
       \"$GOPATH/bin\"\ntouch \"$GOPATH/bin/gopls\"",
   );
   let config = tool("gopls", ToolRuntime::Go, "golang.org/x/tools/gopls");

   let installed = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let gopath = fakes.tools().join("go");
   assert_eq!(installed, gopath.join("bin/gopls"));
   assert_executable(&installed);
   assert_eq!(
      fakes.calls(),
      vec![
         "go install golang.org/x/tools/gopls@latest".to_string(),
         format!("GOPATH {}", gopath.display()),
      ]
   );
}

#[tokio::test]
async fn go_and_cargo_failures_stop_the_install() {
   let go = tool("gopls", ToolRuntime::Go, "golang.org/x/tools/gopls");
   let cargo = tool("taplo", ToolRuntime::Rust, "taplo-cli");

   let fakes = Fakes::new();
   assert_eq!(
      runtime_error(ToolInstaller::install_in(&fakes.env(), &go).await),
      "Runtime 'go' not found on system"
   );
   assert_eq!(
      runtime_error(ToolInstaller::install_in(&fakes.env(), &cargo).await),
      "Runtime 'cargo' not found on system"
   );

   fakes.fake("go", "echo 'module not found' >&2\nexit 1");
   fakes.fake("cargo", "echo 'could not find taplo-cli' >&2\nexit 101");
   assert_eq!(
      installation_error(ToolInstaller::install_in(&fakes.env(), &go).await),
      "go install failed: module not found\n"
   );
   assert_eq!(
      installation_error(ToolInstaller::install_in(&fakes.env(), &cargo).await),
      "cargo install failed: could not find taplo-cli\n"
   );

   fakes.fake("go", "exit 0");
   let message = installation_error(ToolInstaller::install_in(&fakes.env(), &go).await);
   assert!(message.contains("Binary not found"), "{message}");
}

#[tokio::test]
async fn cargo_installs_into_a_managed_cargo_home() {
   let fakes = Fakes::new();
   fakes.fake(
      "cargo",
      "echo \"CARGO_HOME $CARGO_HOME\" >> \"$(dirname \"$0\")/../calls.log\"\nmkdir -p \
       \"$CARGO_HOME/bin\"\ntouch \"$CARGO_HOME/bin/taplo\"",
   );
   let config = tool("taplo", ToolRuntime::Rust, "taplo-cli");

   let installed = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let cargo_home = fakes.tools().join("cargo");
   assert_eq!(installed, cargo_home.join("bin/taplo"));
   assert_executable(&installed);
   assert_eq!(
      fakes.calls(),
      vec![
         "cargo install taplo-cli".to_string(),
         format!("CARGO_HOME {}", cargo_home.display()),
      ]
   );
}

#[tokio::test]
async fn gem_installs_into_a_managed_gem_home_behind_a_wrapper() {
   let fakes = Fakes::new();
   fakes.fake(
      "gem",
      r#"[ "$GEM_HOME" = "$GEM_PATH" ] || exit 9
bindir=$6
printf '#!/bin/sh\necho "solargraph GEM_HOME=$GEM_HOME $*"\n' > "$bindir/solargraph"
chmod +x "$bindir/solargraph""#,
   );
   let config = tool("solargraph", ToolRuntime::Ruby, "solargraph");

   let wrapper = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let package_dir = fakes.tools().join("ruby/solargraph");
   assert_eq!(wrapper, package_dir.join("bin/solargraph"));
   assert_executable(&wrapper);
   assert_eq!(
      fakes.calls(),
      vec![format!(
         "gem install solargraph --install-dir {} --bindir {} --no-document",
         package_dir.join("gems").display(),
         package_dir.join("gem-bin").display()
      )]
   );
   let output = Command::new(&wrapper).arg("stdio").output().unwrap();
   assert_eq!(
      String::from_utf8_lossy(&output.stdout),
      format!(
         "solargraph GEM_HOME={} stdio\n",
         package_dir.join("gems").display()
      ),
      "the wrapper points the gem at its private GEM_HOME"
   );
   assert_eq!(
      ToolInstaller::tool_path_in(&fakes.tools(), &config).unwrap(),
      wrapper
   );
}

#[tokio::test]
async fn gem_failures_stop_the_install() {
   let config = tool("solargraph", ToolRuntime::Ruby, "solargraph");

   let fakes = Fakes::new();
   assert_eq!(
      runtime_error(ToolInstaller::install_in(&fakes.env(), &config).await),
      "RubyGems 'gem' was not found. Install Ruby to use Ruby language tools."
   );

   fakes.fake("gem", "echo 'could not find a valid gem' >&2\nexit 2");
   assert_eq!(
      installation_error(ToolInstaller::install_in(&fakes.env(), &config).await),
      "gem install failed: could not find a valid gem\n"
   );

   fakes.fake("gem", "exit 0");
   let message = installation_error(ToolInstaller::install_in(&fakes.env(), &config).await);
   assert!(
      message.starts_with("gem install did not create expected executable"),
      "{message}"
   );
}

#[tokio::test]
async fn r_installs_into_a_managed_library_behind_a_wrapper() {
   let fakes = Fakes::new();
   fakes.fake(
      "Rscript",
      "echo \"R_LIBS_USER $R_LIBS_USER\" >> \"$(dirname \"$0\")/../calls.log\"",
   );
   let config = tool("r-languageserver", ToolRuntime::R, "languageserver");

   let wrapper = ToolInstaller::install_in(&fakes.env(), &config)
      .await
      .unwrap();

   let package_dir = fakes.tools().join("r/languageserver");
   let library = package_dir.join("library");
   assert_eq!(wrapper, package_dir.join("bin/r-languageserver"));
   assert_executable(&wrapper);
   let calls = fakes.calls();
   assert_eq!(calls.len(), 2, "{calls:?}");
   assert!(
      calls[0].starts_with("Rscript --vanilla -e local({ lib <- Sys.getenv('R_LIBS_USER');"),
      "{}",
      calls[0]
   );
   assert!(
      calls[0].contains("install.packages(\"languageserver\", lib = lib, repos = repos)"),
      "the package name is passed as a quoted R string: {}",
      calls[0]
   );
   assert_eq!(calls[1], format!("R_LIBS_USER {}", library.display()));

   let output = Command::new(&wrapper).arg("--debug").output().unwrap();
   assert!(output.status.success());
   assert_eq!(
      fakes.calls()[2..],
      [
         "Rscript --vanilla -e library(\"languageserver\", lib.loc=Sys.getenv(\"R_LIBS_USER\")); \
          languageserver::run() --debug"
            .to_string(),
         format!("R_LIBS_USER {}", library.display()),
      ],
      "the wrapper starts the server from the managed library"
   );
}

#[tokio::test]
async fn r_failures_stop_the_install() {
   let config = tool("r-languageserver", ToolRuntime::R, "languageserver");

   let fakes = Fakes::new();
   assert_eq!(
      runtime_error(ToolInstaller::install_in(&fakes.env(), &config).await),
      "Rscript was not found. Install R to use R language tools."
   );

   fakes.fake("Rscript", "echo 'package not available' >&2\nexit 1");
   assert_eq!(
      installation_error(ToolInstaller::install_in(&fakes.env(), &config).await),
      "R package install failed: package not available\n"
   );
   assert!(!fakes.tools().join("r/languageserver/bin").exists());
}

#[tokio::test]
async fn system_and_binary_tools_prefer_what_is_already_installed() {
   let server = FixtureServer::start(vec![("/fresh-tool", Reply::Body(b"fresh".to_vec()))]);
   let fakes = Fakes::new();

   match ToolInstaller::install_in(&fakes.env(), &config("clangd", ToolRuntime::System)).await {
      Err(ToolError::NotFound(message)) => assert!(message.starts_with("clangd ")),
      other => panic!("expected NotFound, got {other:?}"),
   }
   let system_clangd = fakes.fake("clangd", "exit 0");
   assert_eq!(
      ToolInstaller::install_in(&fakes.env(), &config("clangd", ToolRuntime::System))
         .await
         .unwrap(),
      system_clangd
   );

   let mut binary = config("clangd", ToolRuntime::Binary);
   binary.download_url = Some(server.url("/fresh-tool"));
   assert_eq!(
      ToolInstaller::install_in(&fakes.env(), &binary)
         .await
         .unwrap(),
      system_clangd,
      "a system binary wins over a download"
   );
   assert_eq!(server.hits(), 0);

   let managed = ToolInstaller::install_managed_in(&fakes.env(), &binary)
      .await
      .unwrap();
   assert_eq!(managed, fakes.tools().join("binary/clangd/clangd"));
   assert_eq!(fs::read(&managed).unwrap(), b"fresh");
   assert_eq!(server.hits(), 1, "a managed install always downloads");

   fs::remove_file(&system_clangd).unwrap();
   let mut unknown = config("zls", ToolRuntime::Binary);
   unknown.download_url = Some(server.url("/fresh-tool"));
   assert_eq!(
      ToolInstaller::install_in(&fakes.env(), &unknown)
         .await
         .unwrap(),
      fakes.tools().join("binary/zls/zls")
   );

   match ToolInstaller::install_managed_in(&fakes.env(), &config("zls", ToolRuntime::Binary)).await
   {
      Err(ToolError::NotFound(message)) => {
         assert_eq!(message, "zls has no managed binary download URL")
      }
      other => panic!("expected NotFound, got {other:?}"),
   }
   let go_tool = tool("gopls", ToolRuntime::Go, "golang.org/x/tools/gopls");
   assert_eq!(
      runtime_error(ToolInstaller::install_managed_in(&fakes.env(), &go_tool).await),
      "Runtime 'go' not found on system",
      "non-binary managed installs go through the package runtime"
   );
}

#[tokio::test]
async fn java_prefers_a_recent_system_java_then_a_managed_one() {
   let server = FixtureServer::start(vec![("/temurin", Reply::Status(500))]);
   let fakes = Fakes::new();
   let env = fakes.env_with_temurin(&server.url("/temurin"));

   let system_java = fakes.bin().join("java");
   write_script(
      &system_java,
      "echo 'openjdk version \"21.0.4\" 2024-07-16' >&2",
   );
   assert_eq!(
      ToolInstaller::java_executable_in(&env).await.unwrap(),
      system_java
   );

   write_script(&system_java, "echo 'java version \"1.8.0_402\"' >&2");
   let managed_java = ToolInstaller::managed_java_install_dir(&fakes.tools()).join("jdk/bin/java");
   write_script(&managed_java, "echo 'openjdk version \"21.0.4\"' >&2");
   assert_eq!(
      ToolInstaller::java_executable_in(&env).await.unwrap(),
      managed_java,
      "Java 8 on the system is too old, so the managed Temurin is used"
   );
   assert_eq!(server.hits(), 0);

   write_script(&managed_java, "echo 'openjdk version \"17.0.2\"' >&2");
   assert!(
      matches!(
         ToolInstaller::java_executable_in(&env).await,
         Err(ToolError::DownloadFailed(message)) if message.starts_with("HTTP 500")
      ),
      "an outdated managed Java is replaced by a fresh download"
   );
   assert_eq!(server.hits(), 1);
}

#[tokio::test]
async fn java_downloads_and_verifies_a_managed_temurin() {
   let jdk = |version_line: &str| {
      Reply::Body(tar_gz(&[
         ("jdk-21.0.4+7/release", b"JAVA_VERSION=\"21\"".as_slice()),
         (
            "jdk-21.0.4+7/bin/java",
            java_script(version_line).into_bytes().as_slice(),
         ),
      ]))
   };
   let server = FixtureServer::start(vec![
      ("/jdk21", jdk("openjdk version \"21.0.4\" 2024-07-16")),
      ("/jdk17", jdk("openjdk version \"17.0.2\" 2022-01-18")),
      ("/silent", jdk("")),
      ("/corrupt", Reply::Body(b"not an archive".to_vec())),
   ]);

   let fakes = Fakes::new();
   let installed =
      ToolInstaller::java_executable_in(&fakes.env_with_temurin(&server.url("/jdk21")))
         .await
         .unwrap();
   assert_eq!(
      installed,
      ToolInstaller::managed_java_install_dir(&fakes.tools()).join("jdk-21.0.4+7/bin/java")
   );
   assert_executable(&installed);
   assert!(
      installed
         .parent()
         .unwrap()
         .parent()
         .unwrap()
         .join("release")
         .exists(),
      "the whole JDK is installed, not just the launcher"
   );
   let hits = server.hits();
   ToolInstaller::java_executable_in(&fakes.env_with_temurin(&server.url("/jdk21")))
      .await
      .unwrap();
   assert_eq!(server.hits(), hits, "the managed JDK is reused");

   for (path, expected) in [
      (
         "/jdk17",
         "Managed Java runtime is version 17, expected 21 or newer",
      ),
      (
         "/silent",
         "Could not determine the managed Java runtime version",
      ),
   ] {
      let fakes = Fakes::new();
      assert_eq!(
         installation_error(
            ToolInstaller::java_executable_in(&fakes.env_with_temurin(&server.url(path))).await
         ),
         expected
      );
   }

   let fakes = Fakes::new();
   let message = installation_error(
      ToolInstaller::java_executable_in(&fakes.env_with_temurin(&server.url("/corrupt"))).await,
   );
   assert!(message.contains("tar.gz"), "{message}");
   assert!(!ToolInstaller::managed_java_install_dir(&fakes.tools()).exists());
}

#[test]
fn temurin_downloads_target_the_current_platform() {
   let url = ToolInstaller::temurin_download_url();
   let os = match std::env::consts::OS {
      "macos" => "mac",
      "windows" => "windows",
      _ => "linux",
   };
   assert!(
      url.starts_with(&format!(
         "https://api.adoptium.net/v3/binary/latest/{MANAGED_JAVA_MAJOR}/ga/{os}/"
      )),
      "{url}"
   );
   assert!(url.ends_with("/jdk/hotspot/normal/eclipse"), "{url}");
}
