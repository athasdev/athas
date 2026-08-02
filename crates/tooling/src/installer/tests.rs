use super::*;

#[test]
fn rejects_non_https_binary_urls() {
   assert!(validate_binary_download_url("ftp://example.com/tool.tar.gz").is_err());
   assert!(validate_binary_download_url("file:///etc/passwd").is_err());
   assert!(validate_binary_download_url("javascript:alert(1)").is_err());
   assert!(validate_binary_download_url("not a url").is_err());
}

#[test]
fn rejects_plain_http_in_release_builds() {
   let result = validate_binary_download_url("http://example.com/tool.tar.gz");
   if cfg!(debug_assertions) {
      // Debug builds reject non-localhost HTTP.
      assert!(result.is_err());
   } else {
      assert!(result.is_err());
   }
}

#[test]
fn accepts_https_and_debug_localhost() {
   assert!(validate_binary_download_url("https://example.com/tool.tar.gz").is_ok());
   if cfg!(debug_assertions) {
      assert!(validate_binary_download_url("http://localhost:3000/tool.tar.gz").is_ok());
      assert!(validate_binary_download_url("http://127.0.0.1:8080/tool.tar.gz").is_ok());
   }
}

#[test]
fn finds_system_tool_in_candidate_dirs() {
   let temp = tempfile::tempdir().unwrap();
   let bin_dir = temp.path().join("bin");
   fs::create_dir_all(&bin_dir).unwrap();
   let binary = bin_dir.join(ToolInstaller::bin_file_name("test-language-server"));
   fs::write(&binary, "").unwrap();

   let resolved = ToolInstaller::find_binary_in_dirs("test-language-server", [bin_dir]);

   assert_eq!(resolved.as_deref(), Some(binary.as_path()));
}

#[test]
fn detects_existing_managed_binary_installation() {
   let temp = tempfile::tempdir().unwrap();
   let tools_dir = temp.path().join("binary").join("marksman");
   fs::create_dir_all(&tools_dir).unwrap();
   let binary = tools_dir.join(ToolInstaller::bin_file_name("marksman"));
   fs::write(&binary, "").unwrap();

   let picked = ToolInstaller::pick_binary(&tools_dir, "marksman").unwrap();

   assert_eq!(picked, binary);
}

#[test]
fn creates_node_package_manifest_to_anchor_local_installs() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("bun").join("typescript-language-server");
   fs::create_dir_all(&package_dir).unwrap();

   ToolInstaller::ensure_node_package_manifest(&package_dir).unwrap();

   let package_json = package_dir.join("package.json");
   let manifest = fs::read_to_string(package_json).unwrap();
   assert!(manifest.contains("\"private\": true"));
   assert!(manifest.contains("\"dependencies\": {}"));
}

#[test]
fn preserves_existing_node_package_manifest() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("npm").join("eslint");
   fs::create_dir_all(&package_dir).unwrap();
   let package_json = package_dir.join("package.json");
   fs::write(
      &package_json,
      "{ \"private\": true, \"dependencies\": { \"eslint\": \"*\" } }",
   )
   .unwrap();

   ToolInstaller::ensure_node_package_manifest(&package_dir).unwrap();

   let manifest = fs::read_to_string(package_json).unwrap();
   assert!(manifest.contains("\"eslint\": \"*\""));
}

#[test]
fn installs_pinned_typescript_with_typescript_language_servers() {
   assert_eq!(
      ToolInstaller::node_packages_to_install("typescript-language-server", &[]),
      vec!["typescript-language-server@5.2.0", "typescript@6.0.3"]
   );
   assert_eq!(
      ToolInstaller::node_packages_to_install("eslint", &[]),
      vec!["eslint"]
   );
   assert_eq!(
      ToolInstaller::node_packages_to_install("@vtsls/language-server", &[]),
      vec!["@vtsls/language-server@0.3.0", "typescript@6.0.3"]
   );
   assert_eq!(
      ToolInstaller::node_packages_to_install(
         "@vtsls/language-server",
         &["typescript".to_string()]
      ),
      vec!["@vtsls/language-server@0.3.0", "typescript@6.0.3"]
   );
   assert_eq!(
      ToolInstaller::node_packages_to_install(
         "@vtsls/language-server",
         &["typescript@5.9.3".to_string()]
      ),
      vec!["@vtsls/language-server@0.3.0", "typescript@5.9.3"]
   );
}

#[test]
fn validates_typescript_language_server_companion_package() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("bun").join("typescript-language-server");
   fs::create_dir_all(package_dir.join("node_modules/typescript-language-server")).unwrap();

   let missing = ToolInstaller::validate_node_companion_packages(
      &package_dir,
      "typescript-language-server",
      &[],
   );
   assert!(missing.is_err());

   fs::create_dir_all(package_dir.join("node_modules/typescript")).unwrap();
   let ready = ToolInstaller::validate_node_companion_packages(
      &package_dir,
      "typescript-language-server",
      &[],
   );
   assert!(ready.is_ok());
}

#[test]
fn resolves_node_bin_shim_when_present() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("bun").join("typescript-language-server");
   let bin_path =
      package_dir
         .join("node_modules")
         .join(".bin")
         .join(ToolInstaller::default_node_bin_name(
            "typescript-language-server",
         ));
   fs::create_dir_all(bin_path.parent().unwrap()).unwrap();
   fs::write(&bin_path, "").unwrap();

   let resolved = ToolInstaller::resolve_node_package_binary(
      &package_dir,
      "typescript-language-server",
      "typescript-language-server",
   );

   assert_eq!(resolved.as_deref(), Some(bin_path.as_path()));
}

#[test]
fn resolves_scoped_node_package_entrypoint_when_shim_is_missing() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("bun").join("@vue").join("language-server");
   let package_root = package_dir
      .join("node_modules")
      .join("@vue")
      .join("language-server");
   let entrypoint = package_root.join("bin").join("vue-language-server.js");
   fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();
   fs::write(
      package_root.join("package.json"),
      r#"{
  "name": "@vue/language-server",
  "bin": {
 "vue-language-server": "./bin/vue-language-server.js"
  }
}"#,
   )
   .unwrap();
   fs::write(&entrypoint, "").unwrap();

   let resolved = ToolInstaller::resolve_node_package_binary(
      &package_dir,
      "@vue/language-server",
      "vue-language-server",
   );

   assert_eq!(resolved.as_deref(), Some(entrypoint.as_path()));
}

#[test]
fn resolves_lsp_launch_path_to_package_entrypoint_before_platform_shim() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("bun").join("pyright");
   let package_root = package_dir.join("node_modules").join("pyright");
   let entrypoint = package_root.join("langserver.index.js");
   let shim = package_dir
      .join("node_modules")
      .join(".bin")
      .join(ToolInstaller::default_node_bin_name("pyright-langserver"));

   fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();
   fs::create_dir_all(shim.parent().unwrap()).unwrap();
   fs::write(
      package_root.join("package.json"),
      r#"{
  "name": "pyright",
  "bin": {
 "pyright": "./index.js",
 "pyright-langserver": "./langserver.index.js"
  }
}"#,
   )
   .unwrap();
   fs::write(&entrypoint, "").unwrap();
   fs::write(&shim, "").unwrap();

   let resolved =
      ToolInstaller::resolve_node_package_entrypoint(&package_dir, "pyright", "pyright-langserver");

   assert_eq!(resolved.as_deref(), Some(entrypoint.as_path()));
}

#[test]
fn writes_ruby_wrapper_for_managed_gem_executable() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("ruby").join("solargraph");
   let gem_home = package_dir.join("gems");
   let gem_bin_dir = package_dir.join("gem-bin");
   let gem_command = gem_bin_dir.join(if cfg!(windows) {
      "solargraph.bat"
   } else {
      "solargraph"
   });
   fs::create_dir_all(gem_command.parent().unwrap()).unwrap();
   fs::write(&gem_command, "").unwrap();

   let wrapper =
      ToolInstaller::write_ruby_wrapper(&package_dir, "solargraph", &gem_home, &gem_bin_dir)
         .unwrap();

   assert_eq!(
      wrapper,
      package_dir
         .join("bin")
         .join(ToolInstaller::script_bin_name("solargraph"))
   );
   let content = fs::read_to_string(wrapper).unwrap();
   assert!(content.contains("GEM_HOME"));
   assert!(content.contains(gem_command.to_string_lossy().as_ref()));
}

#[test]
fn rejects_ruby_wrapper_when_gem_executable_is_missing() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("ruby").join("solargraph");

   let result = ToolInstaller::write_ruby_wrapper(
      &package_dir,
      "solargraph",
      &package_dir.join("gems"),
      &package_dir.join("gem-bin"),
   );

   assert!(matches!(result, Err(ToolError::InstallationFailed(_))));
}

#[test]
fn writes_r_wrapper_for_managed_r_package() {
   let temp = tempfile::tempdir().unwrap();
   let package_dir = temp.path().join("r").join("languageserver");
   let rscript_path = temp.path().join(ToolInstaller::bin_file_name("Rscript"));
   let r_library_dir = package_dir.join("library");
   fs::create_dir_all(&r_library_dir).unwrap();
   fs::write(&rscript_path, "").unwrap();

   let wrapper = ToolInstaller::write_r_wrapper(
      &package_dir,
      "r-languageserver",
      &rscript_path,
      &r_library_dir,
   )
   .unwrap();

   assert_eq!(
      wrapper,
      package_dir
         .join("bin")
         .join(ToolInstaller::script_bin_name("r-languageserver"))
   );
   let content = fs::read_to_string(wrapper).unwrap();
   assert!(content.contains("R_LIBS_USER"));
   assert!(content.contains("languageserver::run()"));
   assert!(content.contains(rscript_path.to_string_lossy().as_ref()));
}

#[test]
fn rejects_unsafe_node_package_bin_paths() {
   let temp = tempfile::tempdir().unwrap();
   let package_root = temp.path().join("node_modules").join("bad-package");

   assert!(ToolInstaller::safe_package_bin_path(&package_root, "../bad.js").is_none());
   assert!(ToolInstaller::safe_package_bin_path(&package_root, "/tmp/bad.js").is_none());
   assert!(
      ToolInstaller::safe_package_bin_path(&package_root, "./bin/good.js")
         .unwrap()
         .ends_with("bin/good.js")
   );
}

#[test]
fn picks_binary_case_insensitively_from_archive() {
   let temp = tempfile::tempdir().unwrap();
   let binary = temp.path().join(if cfg!(windows) {
      "OmniSharp.exe"
   } else {
      "OmniSharp"
   });
   fs::write(&binary, "").unwrap();

   let picked = ToolInstaller::pick_binary(temp.path(), "omnisharp").unwrap();

   assert_eq!(picked, binary);
}

#[test]
fn preserves_binary_archive_layout_when_installing() {
   let staging = tempfile::tempdir().unwrap();
   let install = tempfile::tempdir().unwrap();
   let install_dir = install.path().join("dart");
   let dart = staging.path().join("dart-sdk").join("bin").join("dart");
   let snapshot = staging
      .path()
      .join("dart-sdk")
      .join("bin")
      .join("snapshots")
      .join("analysis_server.dart.snapshot");
   fs::create_dir_all(snapshot.parent().unwrap()).unwrap();
   fs::write(&dart, "").unwrap();
   fs::write(&snapshot, "").unwrap();

   let installed =
      ToolInstaller::install_extracted_binary(staging.path(), &install_dir, "dart", "dart")
         .unwrap();

   assert_eq!(
      installed,
      install_dir.join("dart-sdk").join("bin").join("dart")
   );
   assert!(
      install_dir
         .join("dart-sdk")
         .join("bin")
         .join("snapshots")
         .join("analysis_server.dart.snapshot")
         .exists()
   );
}

#[test]
fn installs_binary_archive_using_configured_command_name() {
   let staging = tempfile::tempdir().unwrap();
   let install = tempfile::tempdir().unwrap();
   let install_dir = install.path().join("elixir-ls");
   let launcher = staging.path().join(if cfg!(windows) {
      "language_server.bat"
   } else {
      "language_server.sh"
   });
   let launch_script = staging.path().join("launch.sh");
   fs::write(&launcher, "").unwrap();
   fs::write(&launch_script, "").unwrap();

   let command_name = if cfg!(windows) {
      "language_server.bat"
   } else {
      "language_server.sh"
   };
   let installed = ToolInstaller::install_extracted_binary(
      staging.path(),
      &install_dir,
      "elixir-ls",
      command_name,
   )
   .unwrap();

   assert_eq!(installed, install_dir.join(command_name));
   assert!(install_dir.join("launch.sh").exists());
}
