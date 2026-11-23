{
  description = "Athas: a native code editor built on GPUI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # rust-toolchain.toml pins a nightly that nixpkgs doesn't ship.
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      rust-overlay,
    }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };
        lib = pkgs.lib;

        toolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
        devToolchain = toolchain.override {
          extensions = [
            "rust-src"
            "rust-analyzer"
            "clippy"
            "rustfmt"
          ];
        };

        rustPlatform = pkgs.makeRustPlatform {
          cargo = toolchain;
          rustc = toolchain;
        };

        nativeBuildInputs = with pkgs; [
          pkg-config
          perl # openssl-src, in case something still builds it vendored
          cmake
          makeWrapper
        ];

        buildInputs = with pkgs; [
          # GPUI: fonts, input, windowing
          fontconfig
          freetype
          libxkbcommon
          wayland
          libx11
          libxcb
          libxcursor
          libxi
          libxrandr
          # wgpu renderer (dlopened)
          vulkan-loader
          libGL
          # keyring (secret service), notifications
          dbus
          openssl
          zlib
          zstd
        ];

        # Libraries GPUI and wgpu open at runtime with dlopen, so they need to be on the
        # rpath / LD_LIBRARY_PATH even though nothing links them.
        runtimeLibs = with pkgs; [
          vulkan-loader
          libGL
          wayland
          libxkbcommon
          libx11
          libxcb
          libxcursor
          libxi
          libxrandr
          fontconfig
          freetype
        ];

        env = {
          # Link the system OpenSSL instead of building it from source (ssh2's vendored-openssl).
          OPENSSL_NO_VENDOR = "1";
          ZSTD_SYS_USE_PKG_CONFIG = "1";
        };

        athas = rustPlatform.buildRustPackage (
          env
          // {
            pname = "athas";
            version = (builtins.fromTOML (builtins.readFile ./Cargo.toml)).workspace.package.version;

            # The working tree is big and mostly not source: `target/` runs to tens of GB and
            # `.notes/` is untracked notes. Keep them out of the copy that goes to the store.
            src = lib.cleanSourceWith {
              name = "athas-source";
              src = ./.;
              filter =
                path: type:
                let
                  base = baseNameOf (toString path);
                in
                lib.cleanSourceFilter path type
                && !(
                  type == "directory"
                  && builtins.elem base [
                    "target"
                    "node_modules"
                    ".notes"
                    ".direnv"
                  ]
                );
            };

            cargoLock = {
              lockFile = ./Cargo.lock;
              # gpui, wgpu, font-kit, ... come from git; fetch them by the revs in Cargo.lock.
              allowBuiltinFetchGit = true;
            };

            cargoBuildFlags = [
              "-p"
              "athas"
            ];
            doCheck = false;

            inherit nativeBuildInputs buildInputs;

            postInstall = ''
              install -Dm644 packaging/icons/128x128.png $out/share/icons/hicolor/128x128/apps/athas.png
              install -Dm644 packaging/icons/128x128@2x.png $out/share/icons/hicolor/256x256/apps/athas.png
              mkdir -p $out/share/applications
              cat > $out/share/applications/athas.desktop <<EOF
              [Desktop Entry]
              Type=Application
              Name=Athas
              Comment=A code editor
              Exec=athas %F
              Icon=athas
              StartupWMClass=athas
              Terminal=false
              Categories=Utility;TextEditor;Development;
              Keywords=Code;Editor;Text;Development;Programming;
              EOF
            '';

            postFixup = ''
              patchelf --add-rpath ${lib.makeLibraryPath runtimeLibs} $out/bin/athas
            '';

            meta = {
              description = "A native code editor built on GPUI";
              homepage = "https://athas.dev";
              mainProgram = "athas";
              platforms = lib.platforms.linux;
            };
          }
        );
      in
      {
        packages.default = athas;
        packages.athas = athas;

        apps.default = flake-utils.lib.mkApp { drv = athas; };

        devShells.default = pkgs.mkShell (
          env
          // {
            nativeBuildInputs = nativeBuildInputs ++ [
              devToolchain
              pkgs.python3
            ];
            inherit buildInputs;
            LD_LIBRARY_PATH = lib.makeLibraryPath runtimeLibs;
          }
        );
      }
    );
}
