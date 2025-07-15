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

        // Send initial messages
        this.writeEmitter.fire('\r\n\x1b[1;32m┌─ AIX Remote Terminal ─┐\x1b[0m\r\n');
        this.writeEmitter.fire(`\x1b[1;32m│\x1b[0m Connected to: ${this.aixManager.getHost()}\r\n`);
        
        if (this.isFullTerminal) {
            this.writeEmitter.fire(`\x1b[1;32m│\x1b[0m Terminal type: Full PTY (node-pty)\r\n`);
        } else {
            this.writeEmitter.fire(`\x1b[1;32m│\x1b[0m Terminal type: Basic (spawn fallback)\r\n`);
        }
        
        this.writeEmitter.fire(`\x1b[1;32m└─────────────────────────┘\x1b[0m\r\n\r\n`);
        
        try {
            // Create terminal session
            this.writeEmitter.fire('Initializing terminal session...\r\n');
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
                if (signal) {
                    this.writeEmitter.fire(`\r\n\x1b[33m[Terminal session ended with signal ${signal}]\x1b[0m\r\n`);
                } else {
                    this.writeEmitter.fire(`\r\n\x1b[33m[Terminal session ended with exit code ${exitCode}]\x1b[0m\r\n`);
                }
                this.closeEmitter.fire(exitCode);
            });

            // Wait for terminal to be ready
            const waitForReady = () => {
                if (this.terminalSession && this.terminalSession.isReady()) {
                    this.isReady = true;
                    this.writeEmitter.fire('\x1b[2J\x1b[H'); // Clear screen and reset cursor
                } else {
                    setTimeout(waitForReady, 100);
                }
            };
            waitForReady();

        } catch (error) {
            this.writeEmitter.fire(`\x1b[31mFailed to create terminal session: ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`);
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
                disposable.dispose();
            }
        });

        return terminal;
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

    dispose(): void {
        // Close all terminals
        this.terminals.forEach(provider => {
            provider.close();
        });
        this.terminals.clear();
    }

    getTerminalCount(): number {
        return this.terminals.size;
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
    }
}