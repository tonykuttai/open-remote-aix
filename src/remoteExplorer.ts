import * as vscode from 'vscode';
import { AIXRemoteManager } from './aixRemoteManager';

export class AIXRemoteExplorer implements vscode.TreeDataProvider<FileItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> = new vscode.EventEmitter<FileItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private aixManager: AIXRemoteManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileItem): Promise<FileItem[]> {
        if (!this.aixManager.isConnected()) {
            return [];
        }

        const path = element ? element.resourceUri!.path : '/home';

        try {
            const entries = await this.aixManager.readDirectory(path);
            
            return entries.map(entry => {
                const uri = vscode.Uri.parse(`aixremote:${entry.path}`);
                
                return new FileItem(
                    entry.name,
                    entry.type === 'directory' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    uri,
                    entry.type
                );
            });
        } catch (error) {
            console.error('Failed to read directory:', error);
            return [];
        }
    }
}

export class FileItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly resourceUri: vscode.Uri,
        public readonly fileType: string
    ) {
        super(label, collapsibleState);

        this.tooltip = `${this.label} (${this.fileType})`;
        this.contextValue = fileType;

        if (fileType === 'file') {
            this.command = {
                command: 'aixRemoteExplorer.openFile',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }

        // Set appropriate icons
        if (fileType === 'directory') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (fileType === 'file') {
            this.iconPath = new vscode.ThemeIcon('file');
        } else if (fileType === 'symlink') {
            this.iconPath = new vscode.ThemeIcon('file-symlink-file');
        }
    }
}