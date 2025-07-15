import * as vscode from 'vscode';
import { AIXRemoteManager } from './aixRemoteManager';
import { AIXFileSystemProvider } from './fileSystemProvider';
import { AIXRemoteExplorer } from './remoteExplorer';
import { AIXTerminalManager } from './terminalProvider';

let aixRemoteManager: AIXRemoteManager;
let fileSystemProvider: AIXFileSystemProvider;
let remoteExplorer: AIXRemoteExplorer;
let terminalManager: AIXTerminalManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('AIX Remote Development extension is now active!');

    // Initialize managers
    aixRemoteManager = new AIXRemoteManager();
    fileSystemProvider = new AIXFileSystemProvider(aixRemoteManager);
    remoteExplorer = new AIXRemoteExplorer(aixRemoteManager);
    terminalManager = new AIXTerminalManager(aixRemoteManager);

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

    // Updated terminal command - now creates integrated terminal
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.openTerminal', async () => {
            await openAIXTerminal();
        })
    );

    // New command for creating additional terminals
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.newTerminal', async () => {
            await createNewTerminal();
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

    // Command to open terminal in specific directory (for context menu)
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemoteExplorer.openTerminalHere', async (resource: vscode.Uri) => {
            await openTerminalInDirectory(resource);
        })
    );

    // Clean up terminals on extension deactivation
    context.subscriptions.push({
        dispose: () => {
            terminalManager.dispose();
        }
    });
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
        
        // Note: Existing terminals will continue to work until closed
        // but new terminals cannot be created
        
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
        const terminal = terminalManager.createTerminal();
        terminal.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function createNewTerminal() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter terminal name (optional)',
            placeHolder: 'e.g., Build Terminal',
            ignoreFocusOut: true
        });

        const terminal = terminalManager.createTerminal(name || undefined);
        terminal.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function openTerminalInDirectory(resource: vscode.Uri) {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        // Get directory path
        let directoryPath: string;
        
        try {
            const stat = await aixRemoteManager.getStat(resource.path);
            if (stat.isDirectory) {
                directoryPath = resource.path;
            } else {
                // If it's a file, use parent directory
                directoryPath = resource.path.substring(0, resource.path.lastIndexOf('/'));
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Cannot access path: ${resource.path}`);
            return;
        }

        const terminal = terminalManager.createTerminal(
            `Terminal (${directoryPath.split('/').pop()})`,
            directoryPath
        );
        terminal.show();

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function deactivate() {
    if (aixRemoteManager) {
        aixRemoteManager.disconnect();
    }
    if (terminalManager) {
        terminalManager.dispose();
    }
}