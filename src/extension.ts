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

const ONLY_RELEASE_API = "https://api.github.com/repos/KercyDing/Onlyfile/releases/latest";
const DOWNLOAD_TIMEOUT_MS = 30_000;

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type LatestRelease = {
  tag_name: string;
  assets: ReleaseAsset[];
};

type CachedBinaryMetadata = {
  version?: string;
  asset?: string;
  extensionVersion?: string;
};

type ResolveServerOptions = {
  forceRedownload?: boolean;
};

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
    vscode.commands.registerCommand("onlyfile.reinstallLsp", async () => {
      const explicitBinary = process.env.ONLY_LSP_BIN;
      const downloaded = await downloadManagedBinary(context, output, { forceRedownload: true });
      if (!downloaded) {
        return;
      }
      await restartLanguageClient(context, output);
      if (explicitBinary && fs.existsSync(explicitBinary)) {
        void vscode.window.showInformationMessage(
          `Reinstalled bundled only-lsp, but ONLY_LSP_BIN is still preferred: ${explicitBinary}`,
        );
      } else {
        void vscode.window.showInformationMessage("Reinstalled only-lsp successfully.");
      }
    }),
  );
}

async function startLanguageClient(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  options?: ResolveServerOptions,
): Promise<boolean> {
  const serverOptions = await resolveServerOptions(context, output, options);
  if (!serverOptions) {
    const message =
      "Onlyfile LSP server was not found. Set ONLY_LSP_BIN or check the Onlyfile output channel.";
    output.appendLine(message);
    void vscode.window.showErrorMessage(message);
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
  options?: ResolveServerOptions,
): Promise<boolean> {
  output.appendLine("Restarting Onlyfile language client.");
  await stopLanguageClient(output);
  return await startLanguageClient(context, output, options);
}

async function resolveServerOptions(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  options?: ResolveServerOptions,
): Promise<ServerOptions | undefined> {
  const explicitBinary = process.env.ONLY_LSP_BIN;
  if (explicitBinary && fs.existsSync(explicitBinary)) {
    output.appendLine(`Using ONLY_LSP_BIN: ${explicitBinary}`);
    const executable = toExecutable(explicitBinary, []);
    return { run: executable, debug: executable };
  }

  const cachedBinary = await resolveCachedBinary(context, output, options);
  if (cachedBinary) {
    output.appendLine(`Using downloaded only-lsp binary: ${cachedBinary}`);
    const executable = toExecutable(cachedBinary, []);
    return { run: executable, debug: executable };
  }

  output.appendLine("No only-lsp server executable was found.");
  return undefined;
}

async function downloadManagedBinary(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  options?: ResolveServerOptions,
): Promise<string | undefined> {
  const platformId = currentPlatformId();
  if (!platformId) {
    output.appendLine(
      `Unsupported platform for only-lsp download: ${process.platform}-${process.arch}`,
    );
    return undefined;
  }

  const cacheDir = path.join(context.globalStorageUri.fsPath, "lsp", platformId);
  const binaryPath = path.join(cacheDir, binaryName("only-lsp"));
  const versionPath = path.join(cacheDir, "version.json");

  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    if (options?.forceRedownload) {
      output.appendLine(`Removing cached only-lsp for ${platformId}.`);
      await fs.promises.rm(binaryPath, { force: true });
      await fs.promises.rm(versionPath, { force: true });
    }

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Onlyfile",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Resolving latest only-lsp release..." });
        const release = await fetchLatestRelease();
        const asset = release.assets.find((candidate) => candidate.name === assetName(platformId));
        if (!asset) {
          output.appendLine(`No only-lsp asset for ${platformId} in ${release.tag_name}.`);
          return undefined;
        }

        output.appendLine(
          `Downloading only-lsp ${release.tag_name} from GitHub for ${platformId}.`,
        );
        progress.report({ message: "Downloading only-lsp from GitHub..." });
        await downloadFile(asset.browser_download_url, binaryPath);

        progress.report({ message: "Installing only-lsp..." });
        await ensureExecutable(binaryPath);
        await fs.promises.writeFile(
          versionPath,
          `${JSON.stringify(
            {
              version: release.tag_name,
              asset: asset.name,
              extensionVersion: extensionReleaseTag(context),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        return binaryPath;
      },
    );
  } catch (error) {
    const message = downloadFailureMessage(error);
    output.appendLine(`Failed to download only-lsp from GitHub: ${message}`);
    void vscode.window.showWarningMessage(`Unable to download only-lsp from GitHub. ${message}`);
    return undefined;
  }
}

async function resolveCachedBinary(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  options?: ResolveServerOptions,
): Promise<string | undefined> {
  const platformId = currentPlatformId();
  if (!platformId) {
    output.appendLine(
      `Unsupported platform for only-lsp download: ${process.platform}-${process.arch}`,
    );
    return undefined;
  }

  const cacheDir = path.join(context.globalStorageUri.fsPath, "lsp", platformId);
  const binaryPath = path.join(cacheDir, binaryName("only-lsp"));
  const versionPath = path.join(cacheDir, "version.json");
  if (!options?.forceRedownload && fs.existsSync(binaryPath)) {
    const metadata = await readCachedBinaryMetadata(versionPath);
    const minimumVersion = extensionReleaseTag(context);
    if (!isCachedBinaryCurrent(metadata, minimumVersion, assetName(platformId))) {
      output.appendLine(
        `Cached only-lsp is stale or missing metadata; expected at least ${minimumVersion}.`,
      );
      return await downloadManagedBinary(context, output, { forceRedownload: true });
    }

    await ensureExecutable(binaryPath);
    return binaryPath;
  }

  return await downloadManagedBinary(context, output, options);
}

async function readCachedBinaryMetadata(
  versionPath: string,
): Promise<CachedBinaryMetadata | undefined> {
  try {
    return JSON.parse(await fs.promises.readFile(versionPath, "utf8")) as CachedBinaryMetadata;
  } catch {
    return undefined;
  }
}

function isCachedBinaryCurrent(
  metadata: CachedBinaryMetadata | undefined,
  minimumVersion: string,
  expectedAsset: string,
): boolean {
  if (!metadata?.version || metadata.asset !== expectedAsset) {
    return false;
  }

  return metadata.extensionVersion === minimumVersion;
}

function extensionReleaseTag(context: vscode.ExtensionContext): string {
  const packageJson = context.extension.packageJSON as { version?: unknown };
  const version = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  return version.startsWith("v") ? version : `v${version}`;
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(ONLY_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "kercyding.onlyfile-vscode",
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub release request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as LatestRelease;
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "User-Agent": "kercyding.onlyfile-vscode" },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`only-lsp download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destination, buffer);
}

async function ensureExecutable(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fs.promises.chmod(filePath, 0o755);
  }
}

function downloadFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    return "The download timed out. Please check your network connection and try again.";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|network/i.test(message)) {
    return "A network error occurred while reaching GitHub. Please check your connection and try again.";
  }
  return "Please check your network connection or set ONLY_LSP_BIN manually.";
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
