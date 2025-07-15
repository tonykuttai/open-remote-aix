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

    // Initialize managers - set debugMode to false for production
    aixRemoteManager = new AIXRemoteManager(false); // Clean logs by default
    fileSystemProvider = new AIXFileSystemProvider(aixRemoteManager);
    remoteExplorer = new AIXRemoteExplorer(aixRemoteManager);
    terminalManager = new AIXTerminalManager(aixRemoteManager);

    // Register file system provider
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('aixremote', fileSystemProvider, {
            isCaseSensitive: true,
            isReadonly: false  // Enable file creation/editing
        })
    );

    // Register tree data provider
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('aixRemoteExplorer', remoteExplorer)
    );

    // Register main commands
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

    // Terminal commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.openTerminal', async () => {
            await openAIXTerminal();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.newTerminal', async () => {
            await createNewTerminal();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.splitTerminalHorizontal', async () => {
            await splitTerminalHorizontal();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.splitTerminalVertical', async () => {
            await splitTerminalVertical();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.splitTerminalRight', async () => {
            await splitTerminalVertical();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.splitTerminalDown', async () => {
            await splitTerminalHorizontal();
        })
    );

    // File operations
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.openFile', async () => {
            await openRemoteFile();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.createFile', async () => {
            await createNewFile();
        })
    );

    // Explorer commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemoteExplorer.refresh', () => {
            remoteExplorer.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemoteExplorer.openFile', (resource: vscode.Uri) => {
            vscode.window.showTextDocument(resource);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemoteExplorer.openTerminalHere', async (resource: vscode.Uri) => {
            await openTerminalInDirectory(resource);
        })
    );

    // Server management commands
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.debugServer', async () => {
            await debugServer();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.forceRestartServer', async () => {
            await forceRestartServer();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.redeployServer', async () => {
            await redeployServer();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.showServerLogs', async () => {
            await showServerLogs();
        })
    );

    // Debug toggle command
    context.subscriptions.push(
        vscode.commands.registerCommand('aixRemote.toggleDebug', async () => {
            const current = await vscode.window.showQuickPick(['Enable Debug', 'Disable Debug'], {
                placeHolder: 'Choose debug mode'
            });
            
            if (current === 'Enable Debug') {
                aixRemoteManager.setDebugMode(true);
                vscode.window.showInformationMessage('Debug mode enabled');
            } else if (current === 'Disable Debug') {
                aixRemoteManager.setDebugMode(false);
                vscode.window.showInformationMessage('Debug mode disabled');
            }
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

        // Show info about code command
        vscode.window.showInformationMessage(
            `Connected! You can now use 'code filename' in the terminal to open files in VS Code.`
        );

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
        console.error('Connection error:', error);
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

async function splitTerminalHorizontal() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        const terminal = terminalManager.splitHorizontal();
        terminal.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to split terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function splitTerminalVertical() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        const terminal = terminalManager.splitVertical();
        terminal.show();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to split terminal: ${error instanceof Error ? error.message : String(error)}`);
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

async function openRemoteFile() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        const filePath = await vscode.window.showInputBox({
            prompt: 'Enter remote file path to open',
            placeHolder: '/home/user/filename.txt',
            ignoreFocusOut: true
        });

        if (!filePath) {
            return;
        }

        // Create URI for the remote file
        const uri = vscode.Uri.parse(`aixremote:${filePath}`);
        
        // Open the file - this will create it if it doesn't exist
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
        console.error('File open error:', error);
    }
}

async function createNewFile() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        const filePath = await vscode.window.showInputBox({
            prompt: 'Enter path for new file',
            placeHolder: '/home/user/newfile.txt',
            ignoreFocusOut: true
        });

        if (!filePath) {
            return;
        }

        // Create URI for the remote file
        const uri = vscode.Uri.parse(`aixremote:${filePath}`);
        
        // Check if file already exists first
        try {
            await vscode.workspace.fs.stat(uri);
            // File exists, ask user if they want to overwrite
            const overwrite = await vscode.window.showWarningMessage(
                `File ${filePath} already exists. Do you want to overwrite it?`,
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') {
                return;
            }
        } catch (error) {
            // File doesn't exist, which is what we want
        }

        // Create empty file by writing empty content
        await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        
        // Open the newly created file
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(`Created and opened: ${filePath}`);

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create file: ${error instanceof Error ? error.message : String(error)}`);
        console.error('File creation error:', error);
    }
}

// Server management functions
async function debugServer() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        await aixRemoteManager.debugServerStatus();
        vscode.window.showInformationMessage('Debug info logged to console (open Developer Tools to see)');
    } catch (error) {
        vscode.window.showErrorMessage(`Debug failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function forceRestartServer() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        'This will force kill and restart the server. Continue?',
        'Yes', 'No'
    );

    if (confirm !== 'Yes') {
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Force restarting server...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 20, message: "Killing server..." });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            progress.report({ increment: 60, message: "Starting fresh server..." });
            await aixRemoteManager.forceKillAndRestartServer();
            
            progress.report({ increment: 100, message: "Server restarted!" });
        });

        vscode.window.showInformationMessage('Server force restarted successfully');
    } catch (error) {
        vscode.window.showErrorMessage(`Force restart failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function redeployServer() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        'This will redeploy the server with your latest code changes. Continue?',
        'Yes', 'No'
    );

    if (confirm !== 'Yes') {
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Redeploying server...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 20, message: "Stopping server..." });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            progress.report({ increment: 60, message: "Deploying new code..." });
            await aixRemoteManager.redeployServer();
            
            progress.report({ increment: 100, message: "Server redeployed!" });
        });

        vscode.window.showInformationMessage('Server redeployed successfully with latest code');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to redeploy server: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function showServerLogs() {
    if (!aixRemoteManager.isConnected()) {
        vscode.window.showWarningMessage('Not connected to AIX machine');
        return;
    }

    try {
        // Read server logs
        const logs = await aixRemoteManager.executeCommand('tail -100 ~/.aix-remote/server.log 2>/dev/null || echo "No logs available"');
        
        // Show in output channel
        const outputChannel = vscode.window.createOutputChannel('AIX Server Logs');
        outputChannel.clear();
        outputChannel.appendLine('=== AIX Server Logs (Last 100 lines) ===');
        outputChannel.appendLine(logs);
        outputChannel.show();

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to show server logs: ${error instanceof Error ? error.message : String(error)}`);
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