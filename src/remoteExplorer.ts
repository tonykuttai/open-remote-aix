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

        const path = element ? element.resourceUri!.path : this.aixManager.getDefaultPath();

        try {
            const entries = await this.aixManager.readDirectory(path);
            
            // Sort entries: directories first, then files, alphabetically within each group
            entries.sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1;
                if (a.type !== 'directory' && b.type === 'directory') return 1;
                return a.name.localeCompare(b.name);
            });
            
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
            
            // Show error as tree item if we have permission issues
            if (error instanceof Error && error.message.includes('EACCES')) {
                return [new FileItem(
                    'Permission denied',
                    vscode.TreeItemCollapsibleState.None,
                    vscode.Uri.parse(`aixremote:${path}`),
                    'error'
                )];
            }
            
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

        this.tooltip = this.createTooltip();
        this.contextValue = fileType;

        // Set command for files
        if (fileType === 'file') {
            this.command = {
                command: 'aixRemoteExplorer.openFile',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }

        // Set appropriate icons
        this.iconPath = this.getIcon();
    }

    private createTooltip(): string {
        const path = this.resourceUri.path;
        const type = this.fileType === 'directory' ? 'Directory' : 
                    this.fileType === 'file' ? 'File' :
                    this.fileType === 'symlink' ? 'Symbolic Link' :
                    this.fileType === 'error' ? 'Error' : 'Unknown';
        
        if (this.fileType === 'error') {
            return this.label;
        }
        
        return `${type}: ${path}`;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.fileType) {
            case 'directory':
                return new vscode.ThemeIcon('folder');
            case 'file':
                // Enhanced file type detection based on extension
                const ext = this.label.split('.').pop()?.toLowerCase();
                switch (ext) {
                    case 'js':
                    case 'ts':
                    case 'jsx':
                    case 'tsx':
                        return new vscode.ThemeIcon('symbol-method');
                    case 'json':
                        return new vscode.ThemeIcon('symbol-object');
                    case 'md':
                    case 'txt':
                        return new vscode.ThemeIcon('symbol-text');
                    case 'sh':
                    case 'bash':
                        return new vscode.ThemeIcon('terminal');
                    case 'log':
                        return new vscode.ThemeIcon('output');
                    case 'xml':
                    case 'html':
                        return new vscode.ThemeIcon('symbol-misc');
                    case 'py':
                        return new vscode.ThemeIcon('symbol-class');
                    case 'c':
                    case 'cpp':
                    case 'h':
                    case 'hpp':
                        return new vscode.ThemeIcon('symbol-module');
                    case 'sql':
                        return new vscode.ThemeIcon('database');
                    case 'yml':
                    case 'yaml':
                        return new vscode.ThemeIcon('symbol-property');
                    default:
                        return new vscode.ThemeIcon('file');
                }
            case 'symlink':
                return new vscode.ThemeIcon('file-symlink-file');
            case 'error':
                return new vscode.ThemeIcon('error');
            default:
                return new vscode.ThemeIcon('file');
        }
    }
}