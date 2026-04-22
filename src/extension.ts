import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  Executable,
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Onlyfile");
  context.subscriptions.push(output);

  output.appendLine("Activating Onlyfile extension.");

  context.subscriptions.push(
    vscode.languages.setLanguageConfiguration("onlyfile", {
      comments: { lineComment: "#" },
      brackets: [["[", "]"], ["(", ")"]],
      autoClosingPairs: [
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: "\"", close: "\"" },
      ],
    }),
  );

  const serverOptions = resolveServerOptions(context, output);
  if (!serverOptions) {
    const message =
      "Onlyfile LSP server was not found. Set ONLY_LSP_BIN or keep the Rust repo at ../only.";
    output.appendLine(message);
    void vscode.window.showErrorMessage(message);
    return;
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "onlyfile" },
      { scheme: "untitled", language: "onlyfile" },
    ],
    outputChannel: output,
    traceOutputChannel: output,
    revealOutputChannelOn: RevealOutputChannelOn.Never,
  };

  client = new LanguageClient(
    "onlyfile-lsp",
    "Onlyfile Language Server",
    serverOptions,
    clientOptions,
  );

  output.appendLine("Starting Onlyfile language client.");

  try {
    await client.start();
    output.appendLine("Onlyfile language client started.");
  } catch (error) {
    output.appendLine(`Failed to start Onlyfile language client: ${String(error)}`);
    void vscode.window.showErrorMessage(
      `Failed to start Onlyfile language client: ${String(error)}`,
    );
  }
}

export async function deactivate(): Promise<void> {
  await client?.dispose();
  client = undefined;
}

function resolveServerOptions(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): ServerOptions | undefined {
  const explicitBinary = process.env.ONLY_LSP_BIN;
  if (explicitBinary && fs.existsSync(explicitBinary)) {
    output.appendLine(`Using ONLY_LSP_BIN: ${explicitBinary}`);
    const executable = toExecutable(explicitBinary, []);
    return { run: executable, debug: executable };
  }

  const repoRoot = path.resolve(context.extensionPath, "../only");
  output.appendLine(`Resolved only repo root: ${repoRoot}`);

  const builtBinary = path.join(repoRoot, "target", "debug", binaryName("only-lsp"));
  if (fs.existsSync(builtBinary)) {
    output.appendLine(`Using built only-lsp binary: ${builtBinary}`);
    const executable = toExecutable(builtBinary, [], repoRoot);
    return { run: executable, debug: executable };
  }

  const manifest = path.join(repoRoot, "Cargo.toml");
  if (fs.existsSync(manifest)) {
    output.appendLine("Using cargo run fallback for only-lsp.");
    const executable = toExecutable(
      "cargo",
      ["run", "-p", "only-lsp", "--quiet", "--"],
      repoRoot,
    );
    return { run: executable, debug: executable };
  }

  output.appendLine("No only-lsp server executable or Cargo.toml was found.");
  return undefined;
}

function toExecutable(command: string, args: string[], cwd?: string): Executable {
  return {
    command,
    args,
    transport: TransportKind.stdio,
    options: cwd ? { cwd } : undefined,
  };
}

function binaryName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}
