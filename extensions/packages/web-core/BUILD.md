Web Core Package
================

Contents: lsp/node_modules for these packages:
 - vscode-html-languageserver-bin
 - vscode-css-languageserver-bin
 - vscode-json-languageserver-bin
 - yaml-language-server

Build steps:
1. Install packages into `lsp/` (Bun or npm).
2. Create per-platform archives (the content is identical, but we ship per-platform tarballs for consistency):
   - web-core-darwin-arm64.tar.gz
   - web-core-darwin-x64.tar.gz
   - web-core-linux-x64.tar.gz
   - web-core-win32-x64.tar.gz
3. Compute SHA-256 for each and update extension.json installation.platforms.*.checksum/size.
4. Upload tarballs to https://athas.dev/extensions/packages/web-core/ and update registry.json.

