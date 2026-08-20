import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);
const binaryCheckDelay = 400;
const binaryCheckTimeout = 5_000;
const onlyRepositoryUrl = "https://github.com/KercyDing/only";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Onlyfile");
  outputChannel = output;
  context.subscriptions.push(output);

  output.appendLine("Activating Onlyfile extension.");

  registerCommands(context, output);
  registerTaskCodeLens(context);
  registerStructureHighlighting(context);
  registerBinaryValidation(context, output);
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
    vscode.commands.registerCommand(
      "onlyfile.runTask",
      async (uri: vscode.Uri, taskPath: string[]) => runTask(uri, taskPath),
    ),
  );
}

function registerTaskCodeLens(context: vscode.ExtensionContext): void {
  const provider = new TaskCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file", language: "onlyfile" }, provider),
    vscode.languages.registerCodeLensProvider({ scheme: "untitled", language: "onlyfile" }, provider),
  );
}

function registerBinaryValidation(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;

  void validateOnlyBinary(revision, () => revision, output);

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("onlyfile.path")) {
      return;
    }

    revision += 1;
    const currentRevision = revision;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void validateOnlyBinary(currentRevision, () => revision, output);
    }, binaryCheckDelay);
  }));
}

async function validateOnlyBinary(
  revision: number,
  currentRevision: () => number,
  output: vscode.OutputChannel,
): Promise<void> {
  const binaryPath = vscode.workspace.getConfiguration("onlyfile").get<string>("path", "only").trim();
  if (!binaryPath) {
    showBinaryError(revision, currentRevision, output, "Only binary path is empty.");
    return;
  }

  try {
    const { stdout } = await execFileAsync(binaryPath, ["-V"], {
      encoding: "utf8",
      timeout: binaryCheckTimeout,
      windowsHide: true,
    });
    const version = stdout.trim();
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      showBinaryError(
        revision,
        currentRevision,
        output,
        `\`${binaryPath}\` is not an Only executable (received \`${version || "no version"}\`).`,
      );
      return;
    }
    if (revision === currentRevision()) {
      output.appendLine(`Only executable verified: ${binaryPath} (${version})`);
    }
  } catch (error) {
    showBinaryError(
      revision,
      currentRevision,
      output,
      binaryErrorMessage(binaryPath, error),
      isMissingExecutable(error),
    );
  }
}

function showBinaryError(
  revision: number,
  currentRevision: () => number,
  output: vscode.OutputChannel,
  message: string,
  showDownload: boolean = false,
): void {
  if (revision !== currentRevision()) {
    return;
  }
  output.appendLine(message);
  if (!showDownload) {
    void vscode.window.showErrorMessage(message);
    return;
  }
  void vscode.window.showErrorMessage(message, "Download Only").then((action) => {
    if (action === "Download Only") {
      void vscode.env.openExternal(vscode.Uri.parse(onlyRepositoryUrl));
    }
  });
}

function binaryErrorMessage(binaryPath: string, error: unknown): string {
  const code = processErrorCode(error);
  if (code === "ENOENT") {
    return `Only executable not found: \`${binaryPath}\`. Check Onlyfile: Path.`;
  }
  if (code === "EACCES") {
    return `Only executable cannot be run: \`${binaryPath}\`.`;
  }
  if (code === "ETIMEDOUT") {
    return `Only executable did not respond: \`${binaryPath}\`.`;
  }
  return `Could not verify Only executable: \`${binaryPath}\`.`;
}

function isMissingExecutable(error: unknown): boolean {
  return processErrorCode(error) === "ENOENT";
}

function processErrorCode(error: unknown): unknown {
  return typeof error === "object" && error && "code" in error ? error.code : undefined;
}

class TaskCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const groups: Array<{ name: string; indent: number }> = [];
    const groupPattern = /^\s*group\s+([A-Za-z_-][A-Za-z0-9_-]*)\s*\{\s*$/;
    const taskPattern = /^\s*([A-Za-z_-][A-Za-z0-9_-]*)\s*\(([^()]*)\)/;

    for (let line = 0; line < document.lineCount; line += 1) {
      const text = document.lineAt(line).text;
      const group = groupPattern.exec(text);
      if (group) {
        groups.push({ name: group[1], indent: text.search(/\S|$/) });
        continue;
      }
      if (/^\s*\}\s*$/.test(text)) {
        groups.pop();
        continue;
      }

      const task = taskPattern.exec(text);
      const indent = text.search(/\S|$/);
      const expectedIndent = groups.length ? groups.at(-1)!.indent + 4 : 0;
      if (
        !task ||
        indent !== expectedIndent ||
        task[1].startsWith("_") ||
        hasRequiredParameter(task[2])
      ) {
        continue;
      }

      const taskPath = [...groups.map((group) => group.name), task[1]];
      lenses.push(new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
        title: "▶ Run",
        command: "onlyfile.runTask",
        arguments: [document.uri, taskPath],
      }));
    }
    return lenses;
  }
}

function hasRequiredParameter(raw: string): boolean {
  return splitParameters(raw).some((parameter) => {
    const text = parameter.trim();
    return text.length > 0 && !hasUnquotedEquals(text);
  });
}

function splitParameters(raw: string): string[] {
  const parameters: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      parameters.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  parameters.push(raw.slice(start));
  return parameters;
}

function hasUnquotedEquals(raw: string): boolean {
  let quoted = false;
  let escaped = false;
  for (const character of raw) {
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === "=") {
      return true;
    }
  }
  return false;
}

async function runTask(uri: vscode.Uri, taskPath: string[]): Promise<void> {
  const binaryPath = vscode.workspace
    .getConfiguration("onlyfile", uri)
    .get<string>("path", "only")
    .trim();
  if (!binaryPath) {
    void vscode.window.showErrorMessage("Only binary path is empty.");
    return;
  }

  const task = new vscode.Task(
    { type: "onlyfile", task: taskPath.join(".") },
    vscode.TaskScope.Workspace,
    taskPath.join("."),
    "Onlyfile",
    new vscode.ShellExecution(binaryPath, taskPath, { cwd: path.dirname(uri.fsPath) }),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    focus: false,
    panel: vscode.TaskPanelKind.Shared,
    showReuseMessage: true,
    clear: false,
  };
  await vscode.tasks.executeTask(task);
}

function registerStructureHighlighting(context: vscode.ExtensionContext): void {
  const decoration = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor("editorBracketHighlight.foreground1"),
  });

  const updateEditor = (editor: vscode.TextEditor): void => {
    if (editor.document.languageId !== "onlyfile") {
      return;
    }
    editor.setDecorations(decoration, structureDelimiterRanges(editor.document));
  };

  context.subscriptions.push(
    decoration,
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      editors.forEach(updateEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      vscode.window.visibleTextEditors
        .filter((editor) => editor.document === event.document)
        .forEach(updateEditor);
    }),
  );

  vscode.window.visibleTextEditors.forEach(updateEditor);
}

function structureDelimiterRanges(document: vscode.TextDocument): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  const groupIndents: string[] = [];
  const groupPattern = /^(\s*)group\s+[A-Za-z_-][A-Za-z0-9_-]*\s*\{\s*$/;
  const groupClosePattern = /^(\s*)\}\s*$/;
  const metadataPattern = /^\s*\[(?:help|desc|pass|fail)\](?=\s|$)/;

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const line = document.lineAt(lineNumber).text;
    const groupMatch = groupPattern.exec(line);
    if (groupMatch) {
      const brace = line.lastIndexOf("{");
      ranges.push(characterRange(lineNumber, brace));
      groupIndents.push(groupMatch[1]);
      continue;
    }

    const groupCloseMatch = groupClosePattern.exec(line);
    if (groupCloseMatch && groupIndents.at(-1) === groupCloseMatch[1]) {
      ranges.push(characterRange(lineNumber, line.indexOf("}")));
      groupIndents.pop();
      continue;
    }

    if (metadataPattern.test(line)) {
      ranges.push(
        characterRange(lineNumber, line.indexOf("[")),
        characterRange(lineNumber, line.indexOf("]")),
      );
      continue;
    }

  }

  return ranges;
}

function characterRange(line: number, character: number): vscode.Range {
  return new vscode.Range(line, character, line, character + 1);
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
