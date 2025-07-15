import * as vscode from 'vscode';
import { AIXRemoteManager, TerminalSession } from './aixRemoteManager';

export class AIXTerminalProvider implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    private dimensionsEmitter = new vscode.EventEmitter<vscode.TerminalDimensions>();
    
    public readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    public readonly onDidClose: vscode.Event<number | void> = this.closeEmitter.event;
    public readonly onDidChangeName?: vscode.Event<string>;
    public readonly onDidOverrideDimensions?: vscode.Event<vscode.TerminalDimensions | undefined> = this.dimensionsEmitter.event;
    
    private terminalSession: TerminalSession | null = null;
    private currentDirectory: string;
    private dimensions: vscode.TerminalDimensions = { columns: 80, rows: 24 };
    private isFullTerminal: boolean = false;
    private isReady: boolean = false;
    
    constructor(
        private aixManager: AIXRemoteManager,
        private name: string = 'AIX Terminal',
        initialDirectory?: string
    ) {
        this.currentDirectory = initialDirectory || aixManager.getDefaultPath();
        this.isFullTerminal = aixManager.supportsFullTerminal();
    }

    async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
        if (initialDimensions) {
            this.dimensions = initialDimensions;
        }

        try {
            // Create terminal session
            this.terminalSession = await this.aixManager.createTerminalSession(
                this.currentDirectory, 
                this.dimensions.columns, 
                this.dimensions.rows
            );

            // Set up terminal session handlers
            this.terminalSession.onData((data: string) => {
                this.writeEmitter.fire(data);
            });

            this.terminalSession.onExit((exitCode: number, signal?: number) => {
                this.isReady = false;
                this.closeEmitter.fire(exitCode);
            });

            // Wait for terminal to be ready
            const waitForReady = () => {
                if (this.terminalSession && this.terminalSession.isReady()) {
                    this.isReady = true;
                } else {
                    setTimeout(waitForReady, 50);
                }
            };
            waitForReady();

        } catch (error) {
            this.writeEmitter.fire(`Failed to create terminal session: ${error instanceof Error ? error.message : String(error)}\r\n`);
            this.closeEmitter.fire(1);
        }
    }

    close(): void {
        this.isReady = false;
        if (this.terminalSession) {
            this.terminalSession.kill('SIGTERM');
            this.terminalSession = null;
        }
        this.closeEmitter.fire();
    }

    handleInput(data: string): void {
        if (this.terminalSession && this.isReady) {
            this.terminalSession.write(data);
        } else if (!this.isReady) {
            // Queue input until terminal is ready
            setTimeout(() => this.handleInput(data), 100);
        }
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.dimensions = dimensions;
        if (this.terminalSession && this.isReady) {
            this.terminalSession.resize(dimensions.columns, dimensions.rows);
        }
    }

    public getCurrentDirectory(): string {
        return this.currentDirectory;
    }

    public getTerminalType(): 'full' | 'basic' {
        return this.isFullTerminal ? 'full' : 'basic';
    }

    public isTerminalReady(): boolean {
        return this.isReady;
    }
}

export class AIXTerminalManager {
    private terminals: Map<string, AIXTerminalProvider> = new Map();
    private terminalGroups: Map<string, string[]> = new Map(); // Group ID -> Terminal IDs
    
    constructor(private aixManager: AIXRemoteManager) {}

    createTerminal(name?: string, initialDirectory?: string): vscode.Terminal {
        if (!this.aixManager.isConnected()) {
            throw new Error('Not connected to AIX machine');
        }

        const terminalName = name || `AIX (${this.aixManager.getHost().split('.')[0]})`;
        const provider = new AIXTerminalProvider(this.aixManager, terminalName, initialDirectory);
        
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            pty: provider
        });

        // Store reference for cleanup
        const terminalId = `${terminalName}-${Date.now()}`;
        this.terminals.set(terminalId, provider);

        // Clean up when terminal is disposed
        const disposable = vscode.window.onDidCloseTerminal((closedTerminal) => {
            if (closedTerminal === terminal) {
                this.terminals.delete(terminalId);
                this.removeFromGroups(terminalId);
                disposable.dispose();
            }
        });

        return terminal;
    }

    createSplitTerminal(direction: 'horizontal' | 'vertical' = 'horizontal', name?: string, initialDirectory?: string): vscode.Terminal {
        if (!this.aixManager.isConnected()) {
            throw new Error('Not connected to AIX machine');
        }

        // Get the active terminal to determine split behavior
        const activeTerminal = vscode.window.activeTerminal;
        const terminalName = name || `AIX Split (${this.aixManager.getHost().split('.')[0]})`;
        
        const provider = new AIXTerminalProvider(this.aixManager, terminalName, initialDirectory);
        
        // Create terminal with location based on split direction
        // Note: VS Code's terminal splitting API is different - we'll create a regular terminal
        // and let VS Code handle the splitting through commands
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            pty: provider
        });

        // Store reference
        const terminalId = `${terminalName}-${Date.now()}`;
        this.terminals.set(terminalId, provider);

        // Group management for split terminals
        if (activeTerminal) {
            this.addToGroup(activeTerminal, terminal, terminalId);
        }

        // Clean up when terminal is disposed
        const disposable = vscode.window.onDidCloseTerminal((closedTerminal) => {
            if (closedTerminal === terminal) {
                this.terminals.delete(terminalId);
                this.removeFromGroups(terminalId);
                disposable.dispose();
            }
        });

        return terminal;
    }

    private addToGroup(parentTerminal: vscode.Terminal, newTerminal: vscode.Terminal, terminalId: string): void {
        // Find existing group for parent terminal
        let groupId: string | undefined;
        for (const [gId, terminals] of this.terminalGroups.entries()) {
            if (terminals.some(tId => {
                const provider = this.terminals.get(tId);
                return provider && this.getTerminalByProvider(provider) === parentTerminal;
            })) {
                groupId = gId;
                break;
            }
        }

        // Create new group if none exists
        if (!groupId) {
            groupId = `group-${Date.now()}`;
            const parentId = this.getTerminalIdByTerminal(parentTerminal);
            if (parentId) {
                this.terminalGroups.set(groupId, [parentId]);
            }
        }

        // Add new terminal to group
        const group = this.terminalGroups.get(groupId);
        if (group) {
            group.push(terminalId);
        }
    }

    private removeFromGroups(terminalId: string): void {
        for (const [groupId, terminals] of this.terminalGroups.entries()) {
            const index = terminals.indexOf(terminalId);
            if (index !== -1) {
                terminals.splice(index, 1);
                if (terminals.length === 0) {
                    this.terminalGroups.delete(groupId);
                }
                break;
            }
        }
    }

    private getTerminalIdByTerminal(terminal: vscode.Terminal): string | undefined {
        for (const [id, provider] of this.terminals.entries()) {
            if (this.getTerminalByProvider(provider) === terminal) {
                return id;
            }
        }
        return undefined;
    }

    private getTerminalByProvider(provider: AIXTerminalProvider): vscode.Terminal | undefined {
        // This is a limitation - VS Code doesn't provide direct access to terminal from provider
        // We'll need to track this differently
        return undefined;
    }

    createInteractiveTerminal(name?: string, initialDirectory?: string, options?: {
        shellCommand?: string;
        shellArgs?: string[];
    }): vscode.Terminal {
        const terminal = this.createTerminal(name, initialDirectory);
        
        // If specific shell options are provided, send them after terminal is ready
        if (options?.shellCommand) {
            setTimeout(() => {
                // Get the provider to send custom shell command
                const provider = Array.from(this.terminals.values()).find(p => 
                    p.getTerminalType() === 'full' || p.getTerminalType() === 'basic'
                );
                if (provider && provider.isTerminalReady()) {
                    const command = options.shellArgs ? 
                        `${options.shellCommand} ${options.shellArgs.join(' ')}` : 
                        options.shellCommand;
                    provider.handleInput(command + '\n');
                }
            }, 1000);
        }

        return terminal;
    }

    // Quick split methods for common operations
    splitHorizontal(name?: string, initialDirectory?: string): vscode.Terminal {
        const terminal = this.createSplitTerminal('horizontal', name, initialDirectory);
        
        // After creating terminal, trigger VS Code's split command
        setTimeout(() => {
            if (vscode.window.activeTerminal === terminal) {
                vscode.commands.executeCommand('workbench.action.terminal.splitInActiveWorkspace');
            }
        }, 100);
        
        return terminal;
    }

    splitVertical(name?: string, initialDirectory?: string): vscode.Terminal {
        const terminal = this.createSplitTerminal('vertical', name, initialDirectory);
        
        // After creating terminal, trigger VS Code's split command
        setTimeout(() => {
            if (vscode.window.activeTerminal === terminal) {
                vscode.commands.executeCommand('workbench.action.terminal.split');
            }
        }, 100);
        
        return terminal;
    }

    dispose(): void {
        // Close all terminals
        this.terminals.forEach(provider => {
            provider.close();
        });
        this.terminals.clear();
        this.terminalGroups.clear();
    }

    getTerminalCount(): number {
        return this.terminals.size;
    }

    getGroupCount(): number {
        return this.terminalGroups.size;
    }

    supportsFullTerminal(): boolean {
        return this.aixManager.supportsFullTerminal();
    }

    getActiveTerminals(): AIXTerminalProvider[] {
        return Array.from(this.terminals.values());
    }

    async closeAllTerminals(): Promise<void> {
        const closePromises = Array.from(this.terminals.values()).map(provider => {
            return new Promise<void>((resolve) => {
                provider.close();
                resolve();
            });
        });
        
        await Promise.all(closePromises);
        this.terminals.clear();
        this.terminalGroups.clear();
    }
}