import * as vscode from 'vscode';
import { AIXRemoteManager } from './aixRemoteManager';
import { AIXFileSystemProvider } from './fileSystemProvider';
import { AIXRemoteExplorer } from './remoteExplorer';

let aixRemoteManager: AIXRemoteManager;
let fileSystemProvider: AIXFileSystemProvider;
let remoteExplorer: AIXRemoteExplorer;

export function activate(context: vscode.ExtensionContext) {
    console.log('AIX Remote Development extension is now active!');

    // Initialize managers
    aixRemoteManager = new AIXRemoteManager();
    fileSystemProvider = new AIXFileSystemProvider(aixRemoteManager);
    remoteExplorer = new AIXRemoteExplorer(aixRemoteManager);

    // Register file system provider
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('aixremote', fileSystemProvider, {
            isCaseSensitive: true
        })
    );

    // Register tree data provider
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('aixRemoteExplorer', remoteExplorer)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.connect', async () => {
            await connectToAIX();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.disconnect', async () => {
            await disconnectFromAIX();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.openTerminal', async () => {
            await openAIXTerminal();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemoteExplorer.refresh', () => {
            remoteExplorer.refresh();
        })
    );

    // Register file opening command
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemoteExplorer.openFile', (resource: vscode.Uri) => {
            vscode.window.showTextDocument(resource);
        })
    );
}

async function connectToAIX() {
    try {
        // Get connection string in username@hostname format
        const connectionString = await vscode.window.showInputBox({
            prompt: 'Enter connection (username@hostname or hostname)',
            placeHolder: 'e.g., varghese@cpap8104.rtp.raleigh.ibm.com',
            ignoreFocusOut: true
        });

        if (!connectionString) {
            return;
        }

        const password = await vscode.window.showInputBox({
            prompt: 'Enter password (or leave empty for key-based auth)',
            password: true,
            ignoreFocusOut: true
        });

        // Show connecting progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Connecting to AIX machine...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });

            progress.report({ increment: 20, message: "Establishing SSH connection..." });
            await aixRemoteManager.connect(connectionString, password || undefined);

            progress.report({ increment: 60, message: "Deploying server..." });
            // Server deployment happens inside connect()
            
            progress.report({ increment: 80, message: "Starting services..." });
            await new Promise(resolve => setTimeout(resolve, 1000));

            progress.report({ increment: 100, message: "Connected!" });
        });

        // Set context for UI updates
        vscode.commands.executeCommand('setContext', 'aixRemote.connected', true);
        
        // Refresh explorer
        remoteExplorer.refresh();

        vscode.window.showInformationMessage(`Connected to AIX machine: ${aixRemoteManager.getHost()}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function disconnectFromAIX() {
    try {
        await aixRemoteManager.disconnect();
        vscode.commands.executeCommand('setContext', 'aixRemote.connected', false);
        remoteExplorer.refresh();
        vscode.window.showInformationMessage('Disconnected from AIX machine');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function openAIXTerminal() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        const command = await vscode.window.showInputBox({
            prompt: 'Enter command to execute',
            placeHolder: 'e.g., ls -la',
            ignoreFocusOut: true
        });

        if (!command) {
            return;
        }

        const result = await aixRemoteManager.executeCommand(command);
        
        // Show result in output channel
        const output = vscode.window.createOutputChannel('AIX Terminal');
        output.clear();
        output.appendLine(`$ ${command}`);
        output.appendLine(`Exit Code: ${result.exitCode}`);
        if (result.stdout) {
            output.appendLine('--- STDOUT ---');
            output.appendLine(result.stdout);
        }
        if (result.stderr) {
            output.appendLine('--- STDERR ---');
            output.appendLine(result.stderr);
        }
        output.show();

    } catch (error) {
        vscode.window.showErrorMessage(`Command failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function deactivate() {
    if (aixRemoteManager) {
        aixRemoteManager.disconnect();
    }
}