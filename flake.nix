{
  description = "Athas development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/1c3fe55ad329cbcb28471bb30f05c9827f724c76";
    flake-utils.url = "github:numtide/flake-utils/11707dc2f618dd54ca8739b309ec4fc024de578b";
    rust-overlay = {
      url = "github:oxalica/rust-overlay/146e7bf7569b8288f24d41d806b9f584f7cfd5b5";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    zig-overlay = {
      url = "github:mitchellh/zig-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      rust-overlay,
      zig-overlay,
      ...
    }:
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
      ]
      (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };
        in
        let
          athas = pkgs.callPackage ./nix/package.nix { };
        in
        {
          devShells.default = pkgs.callPackage ./nix/dev-shell.nix {
            zig = zig-overlay.packages.${system}."0.16.0";
          };

          packages = {
            default = athas;
            athas = athas;
          };

          apps.default = {
            type = "app";
            program = "${athas}/bin/athas";
            meta = {
              description = "Run the Athas editor (prebuilt Linux release)";
            };
          };
        }
      );
}
