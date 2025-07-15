import * as vscode from 'vscode';
import { AIXRemoteManager } from './aixRemoteManager';

export class AIXFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;
    
    // Add simple caching to reduce repeated stat calls
    private statCache = new Map<string, { stat: vscode.FileStat; timestamp: number }>();
    private readonly CACHE_DURATION = 5000; // 5 seconds

    constructor(private aixManager: AIXRemoteManager) {}

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        // For MVP, we'll implement a simple no-op watcher
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const path = uri.path;
        const now = Date.now();
        
        // Check cache first
        const cached = this.statCache.get(path);
        if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
            return cached.stat;
        }

        try {
            const stats = await this.aixManager.getStat(path);
            
            const fileStat: vscode.FileStat = {
                type: stats.isFile ? vscode.FileType.File : 
                      stats.isDirectory ? vscode.FileType.Directory : 
                      vscode.FileType.SymbolicLink,
                ctime: new Date(stats.created).getTime(),
                mtime: new Date(stats.modified).getTime(),
                size: stats.size
            };
            
            // Cache the result
            this.statCache.set(path, { stat: fileStat, timestamp: now });
            
            return fileStat;
        } catch (error) {
            console.error(`Failed to stat ${uri.path}:`, error);
            
            // Clear from cache on error
            this.statCache.delete(path);
            
            // Check if it's a file not found error specifically
            if (error instanceof Error) {
                if (error.message.includes('ENOENT') || 
                    error.message.includes('not found') || 
                    error.message.includes('No such file') ||
                    (error as any).code === 'ENOENT') {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
            }
            
            // For other errors, throw a more general error
            throw vscode.FileSystemError.Unavailable(uri);
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
            
            // Check if file exists first (use cache)
            let fileExists = true;
            try {
                await this.stat(uri); // This will use cache
            } catch (error) {
                fileExists = false;
            }
            
            // Handle creation/overwrite logic
            if (!fileExists && !options.create) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            
            if (fileExists && !options.overwrite) {
                throw vscode.FileSystemError.FileExists(uri);
            }
            
            const textContent = Buffer.from(content).toString('utf8');
            const success = await this.aixManager.writeFile(path, textContent);
            
            if (!success) {
                throw vscode.FileSystemError.NoPermissions(uri);
            }
            
            // Clear cache for this file since it changed
            this.statCache.delete(path);
            
            // Notify that file has changed/created
            const changeType = fileExists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created;
            this._emitter.fire([{ type: changeType, uri }]);
            
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            
            console.error(`Failed to write file ${uri.path}:`, error);
            throw vscode.FileSystemError.NoPermissions(uri);
        }
    }

    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        // Clear from cache
        this.statCache.delete(uri.path);
        throw vscode.FileSystemError.NoPermissions(uri);
    }

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
        // Clear from cache
        this.statCache.delete(oldUri.path);
        this.statCache.delete(newUri.path);
        throw vscode.FileSystemError.NoPermissions(oldUri);
    }
}