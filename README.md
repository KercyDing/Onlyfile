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
2. bundled `bin/only-lsp`

## Local development

1. `pnpm install`
2. `pnpm build`
3. Press `F5` in VS Code to launch an Extension Development Host
4. Open an `Onlyfile` or `onlyfile` file

## Packaging

- The extension entrypoint is bundled into `dist/extension.js` for release builds.
- The release package expects either `ONLY_LSP_BIN` or a bundled `bin/only-lsp` binary.
- If the server does not start, check the `Onlyfile` output channel in VS Code.

## Notes

- For a real release, prefer bundling a release `only-lsp` binary instead of a debug build.
- The current package still bundles only one platform-specific `only-lsp` binary.
