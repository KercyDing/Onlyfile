# Onlyfile VS Code Extension

Minimal VS Code extension scaffold for the `Onlyfile` language.

Current scope:
- file association for `Onlyfile`, `onlyfile`, and `.onlyfile`
- TextMate syntax highlighting
- basic editor language configuration registered from the extension entrypoint
- thin extension entrypoint ready for later LSP client wiring

Suggested next steps:
1. Run `npm install`.
2. Run `npm run build`.
3. Open this folder in VS Code and press `F5` to launch an Extension Development Host.
4. Add a Rust-backed LSP client in `src/extension.ts` once the protocol surface is ready.
