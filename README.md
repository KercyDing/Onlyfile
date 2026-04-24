# Onlyfile VS Code Extension

VS Code support for the `Onlyfile` language.

Current features:

- file association for `Onlyfile` and `onlyfile`
- TextMate syntax highlighting
- editor language configuration for comments, brackets, quotes and so on
- automatic startup of the `only-lsp` language client
- diagnostics, hover, and other LSP features when `only-lsp` is available

The extension resolves the language server in this order:

1. `ONLY_LSP_BIN`
2. cached `only-lsp` downloaded from the latest `KercyDing/Onlyfile` GitHub release

On first launch, the extension downloads the matching `only-lsp` binary for the current platform from GitHub Releases and caches it in the VS Code global storage directory. If the download fails, check the `Onlyfile` output channel.

## Command palette

The extension provides these commands in the VS Code command palette:

- `Onlyfile: Restart LSP` — restarts the running language server
- `Onlyfile: Reinstall LSP` — re-downloads the managed `only-lsp` binary and restarts the language server

If `ONLY_LSP_BIN` is set, it still takes precedence after reinstalling.

## Local development

1. `pnpm install`
2. `pnpm build`
3. Press `F5` in VS Code to launch an Extension Development Host
4. Open an `Onlyfile` or `onlyfile` file

To use a local language server binary during development:

```bash
ONLY_LSP_BIN=/absolute/path/to/only-lsp code .
```
