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
2. `ONLY_LSP_DIR`
3. the matching `only-lsp` binary bundled in the extension

The published VSIX contains binaries for macOS, Linux, and Windows on x64 and ARM64. The extension does not download executables at runtime. If the current platform binary is absent, syntax highlighting remains available but the language server is not started.

## Command palette

The extension provides these commands in the VS Code command palette:

- `Onlyfile: Restart LSP` — restarts the running language server

## Local development

1. `pnpm install`
2. `pnpm build`
3. Press `F5` in VS Code to launch an Extension Development Host
4. Open an `Onlyfile` or `onlyfile` file

To use a local language server build directory during development:

```bash
ONLY_LSP_DIR=/absolute/path/to/only/target/release code .
```

An exact binary path is also supported:

```bash
ONLY_LSP_BIN=/absolute/path/to/only-lsp code .
```

## Packaging

The `package.yml` workflow builds all six supported `only-lsp` binaries, embeds them in the VSIX, and publishes the VSIX together with the standalone binaries and SHA256 files in the GitHub release for the extension version.
