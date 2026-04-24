# Onlyfile VS Code Extension

VS Code support for the `Onlyfile` language.

Current features:
- file association for `Onlyfile` and `onlyfile`
- TextMate syntax highlighting
- editor language configuration for `#` comments, brackets, and quotes
- automatic startup of the `only-lsp` language client
- diagnostics, hover, and other LSP features when `only-lsp` is available

The extension resolves the language server in this order:
1. `ONLY_LSP_BIN`
2. cached `only-lsp` downloaded from the latest `KercyDing/Onlyfile` GitHub release

On first launch, the extension downloads the matching `only-lsp` binary for the current platform from GitHub Releases and caches it in the VS Code global storage directory. If the download fails, check the `Onlyfile` output channel.

## Local development

1. `pnpm install`
2. `pnpm build`
3. Press `F5` in VS Code to launch an Extension Development Host
4. Open an `Onlyfile` or `onlyfile` file

To use a local language server binary during development:

```bash
ONLY_LSP_BIN=/absolute/path/to/only-lsp code .
```

## Packaging

- The extension entrypoint is bundled into `dist/extension.js` for release builds.
- The VSIX no longer bundles `only-lsp`; it downloads the server on demand from GitHub Releases.
- If the server does not start, check the `Onlyfile` output channel in VS Code.

## Releasing `only-lsp` assets

This repository includes a manual GitHub Actions workflow at `.github/workflows/build-only-lsp.yml`.
Running it will:

- clone `KercyDing/only`
- build `only-lsp` for macOS arm64, macOS x64, Linux x64, and Windows x64
- generate `.sha256` files for each asset
- publish a timestamped GitHub release in `KercyDing/Onlyfile`

The extension downloads assets from the latest release using these names:

- `only-lsp-darwin-arm64`
- `only-lsp-darwin-x64`
- `only-lsp-linux-x64`
- `only-lsp-win32-x64.exe`
