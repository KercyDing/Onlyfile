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
let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Onlyfile");
  outputChannel = output;
  context.subscriptions.push(output);

  output.appendLine("Activating Onlyfile extension.");

  context.subscriptions.push(
    vscode.languages.setLanguageConfiguration("onlyfile", {
      comments: { lineComment: "//" },
      brackets: [
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
      ],
    }),
  );

  registerCommands(context, output);
  await startLanguageClient(context, output);
}

export async function deactivate(): Promise<void> {
  if (!outputChannel) {
    return;
  }

  await stopLanguageClient(outputChannel);
  outputChannel = undefined;
}

function registerCommands(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("onlyfile.restartLsp", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Onlyfile",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "Restarting only-lsp..." });
          const restarted = await restartLanguageClient(context, output);
          if (restarted) {
            void vscode.window.showInformationMessage("Restarted only-lsp successfully.");
          }
        },
      );
    }),
  );
}

async function startLanguageClient(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const serverOptions = await resolveServerOptions(context, output);
  if (!serverOptions) {
    const message =
      "Onlyfile LSP is unavailable for this platform. Set ONLY_LSP_DIR or ONLY_LSP_BIN to use a local server.";
    output.appendLine(message);
    void vscode.window.showWarningMessage(message);
    return false;
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
    return true;
  } catch (error) {
    output.appendLine(`Failed to start Onlyfile language client: ${String(error)}`);
    void vscode.window.showErrorMessage(
      `Failed to start Onlyfile language client: ${String(error)}`,
    );
    client = undefined;
    return false;
  }
}

async function stopLanguageClient(output: vscode.OutputChannel): Promise<void> {
  if (!client) {
    output.appendLine("Onlyfile language client is not running.");
    return;
  }

  output.appendLine("Stopping Onlyfile language client.");
  await client.dispose();
  client = undefined;
  output.appendLine("Onlyfile language client stopped.");
}

async function restartLanguageClient(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<boolean> {
  output.appendLine("Restarting Onlyfile language client.");
  await stopLanguageClient(output);
  return await startLanguageClient(context, output);
}

async function resolveServerOptions(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<ServerOptions | undefined> {
  const explicitBinary = process.env.ONLY_LSP_BIN;
  if (explicitBinary) {
    const resolved = await prepareBinary(explicitBinary, output, "ONLY_LSP_BIN");
    if (resolved) {
      return serverOptions(resolved);
    }
  }

  const explicitDirectory = process.env.ONLY_LSP_DIR;
  if (explicitDirectory) {
    for (const candidate of localDirectoryCandidates(explicitDirectory)) {
      const resolved = await prepareBinary(candidate, output, "ONLY_LSP_DIR");
      if (resolved) {
        return serverOptions(resolved);
      }
    }
    output.appendLine(`ONLY_LSP_DIR has no server for this platform: ${explicitDirectory}`);
  }

  const platformId = currentPlatformId();
  if (!platformId) {
    output.appendLine(`Unsupported only-lsp platform: ${process.platform}-${process.arch}`);
    return undefined;
  }

  const bundledBinary = context.asAbsolutePath(path.join("lsp", assetName(platformId)));
  const resolved = await prepareBinary(bundledBinary, output, "bundled only-lsp");
  if (resolved) {
    return serverOptions(resolved);
  }

  output.appendLine(`Bundled only-lsp is missing for ${platformId}: ${bundledBinary}`);
  return undefined;
}

async function ensureExecutable(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fs.promises.chmod(filePath, 0o755);
  }
}

async function prepareBinary(
  filePath: string,
  output: vscode.OutputChannel,
  source: string,
): Promise<string | undefined> {
  if (!isFile(filePath)) {
    if (source === "ONLY_LSP_BIN") {
      output.appendLine(`ONLY_LSP_BIN does not point to a file: ${filePath}`);
    }
    return undefined;
  }

  try {
    await ensureExecutable(filePath);
  } catch (error) {
    output.appendLine(`Cannot prepare ${source} at ${filePath}: ${String(error)}`);
    return undefined;
  }

  output.appendLine(`Using ${source}: ${filePath}`);
  return filePath;
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function localDirectoryCandidates(directory: string): string[] {
  const candidates = [path.join(directory, binaryName("only-lsp"))];
  const platformId = currentPlatformId();
  if (platformId) {
    candidates.push(path.join(directory, assetName(platformId)));
  }
  return [...new Set(candidates)];
}

function serverOptions(command: string): ServerOptions {
  const executable = toExecutable(command, []);
  return { run: executable, debug: executable };
}

function currentPlatformId(): string | undefined {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "linux-arm64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "win32-x64";
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return "win32-arm64";
  }
  return undefined;
}

function assetName(platformId: string): string {
  return process.platform === "win32" ? `only-lsp-${platformId}.exe` : `only-lsp-${platformId}`;
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
