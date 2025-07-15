import * as vscode from 'vscode';
import { AIXRemoteManager } from './aixRemoteManager';

export class AIXFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    constructor(private aixManager: AIXRemoteManager) {}

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        // For MVP, we'll implement a simple no-op watcher
        // In the full version, this would use file system watching
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        try {
            const path = uri.path;
            const stats = await this.aixManager.getStat(path);
            
            return {
                type: stats.isFile ? vscode.FileType.File : 
                      stats.isDirectory ? vscode.FileType.Directory : 
                      vscode.FileType.SymbolicLink,
                ctime: new Date(stats.created).getTime(),
                mtime: new Date(stats.modified).getTime(),
                size: stats.size
            };
        } catch (error) {
            console.error(`Failed to stat ${uri.path}:`, error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        try {
            const path = uri.path;
            const entries = await this.aixManager.readDirectory(path);
            
            return entries.map(entry => [
                entry.name,
                entry.type === 'file' ? vscode.FileType.File :
                entry.type === 'directory' ? vscode.FileType.Directory :
                vscode.FileType.SymbolicLink
            ]);
        } catch (error) {
            console.error(`Failed to read directory ${uri.path}:`, error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        // For MVP, we'll implement this later
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        try {
            const path = uri.path;
            const content = await this.aixManager.readFile(path);
            return Buffer.from(content, 'utf8');
        } catch (error) {
            console.error(`Failed to read file ${uri.path}:`, error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        try {
            const path = uri.path;
            const textContent = Buffer.from(content).toString('utf8');
            await this.aixManager.writeFile(path, textContent);
            
            // Notify that file has changed
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        } catch (error) {
            console.error(`Failed to write file ${uri.path}:`, error);
            throw vscode.FileSystemError.NoPermissions(uri);
        }
    }

    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        // For MVP, we'll implement this later
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
        // For MVP, we'll implement this later
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }
}