<div align="center">
  <img src="public/icon.png" alt="Athas" width="120">
  <h1>Athas</h1>
  <p>A lightweight, cross-platform code editor, built with <a href="https://tauri.app/" title="Tauri">Tauri</a> (Rust and React) with Git support, AI agents, vim keybindings.</p>
  <img src="public/screenshot.png" alt="Athas Screenshot" width="800">
</div>

## Features

- External editor support (Neovim, Helix, etc.)
- Git integration
- AI agents
- Terminal

## Download

Get the latest version from the [releases page](https://github.com/athasdev/athas/releases).

## Documentation

See the [documentation](https://athas.dev/docs).

## Extensions Catalog and CDN

- Rebuild catalog from `extensions/*/extension.json`:
  - `bun extensions:index`
- Validate catalog is up to date (CI check):
  - `bun extensions:check`
- Sync `extensions/` to CDN root (server-side):
  - `EXTENSIONS_CDN_ROOT=/var/www/athas/extensions bun deploy:extensions:cdn`

`deploy.yml` also supports CDN sync via `EXTENSIONS_CDN_ROOT` GitHub secret.

## Contributing

Contributions are welcome! See the [contributing guide](CONTRIBUTING.md).

## Support

- [Issues](https://github.com/athasdev/athas/issues)
- [Discussions](https://github.com/athasdev/athas/discussions)
- [Discord](https://discord.gg/DD8F38wFMv)

## License

[AGPL-3.0](LICENSE)
