import * as WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';

// Import node-pty with fallback - try multiple locations
let pty: any = null;
try {
    // First try the standard location
    pty = require('node-pty');
    console.log('✅ node-pty loaded from node_modules');
} catch (error) {
    try {
        // Try the custom utility location
        const ptyPath = path.join(os.homedir(), 'utility', 'node-pty');
        pty = require(ptyPath);
        console.log('✅ node-pty loaded from ~/utility/node-pty');
    } catch (customError) {
        console.log('⚠️ node-pty not available, falling back to spawn');
        console.log('  Standard path error:', error instanceof Error ? error.message : String(error));
        console.log('  Custom path error:', customError instanceof Error ? customError.message : String(customError));
    }
}

interface RPCMessage {
    jsonrpc: '2.0';
    method: string;
    params?: any;
    id?: string | number;
}

interface RPCResponse {
    jsonrpc: '2.0';
    result?: any;
    error?: { code: number; message: string; data?: any };
    id: string | number | null;
}

interface TerminalSession {
    process: any; // IPty or ChildProcess
    type: 'pty' | 'spawn';
    cwd: string;
}

class AIXRemoteServer {
    private wss: WebSocket.Server;
    private port: number;
    private activeSessions: Map<string | number, TerminalSession> = new Map();
    private clientConnections: Map<WebSocket, string> = new Map();

    constructor(port: number = 8080) {
        this.port = port;
        this.wss = new WebSocket.Server({ port });
        this.setupServer();
    }

    setupServer() {
        console.log(`AIX Remote Server starting on port ${this.port}...`);
        console.log(`Platform: ${os.platform()}, Architecture: ${os.arch()}`);
        console.log(`PTY Support: ${pty ? 'Available' : 'Not Available'}`);
        
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('Client connected');
            
            // Store client connection
            const clientId = `client_${Date.now()}_${Math.random()}`;
            this.clientConnections.set(ws, clientId);
            
            ws.on('message', async (data: WebSocket.Data) => {
                try {
                    const message: RPCMessage = JSON.parse(data.toString());
                    const response = await this.handleMessage(message, ws);
                    
                    // Only send response if there is one (streaming commands return null)
                    if (response !== null) {
                        ws.send(JSON.stringify(response));
                    }
                } catch (error) {
                    const errorResponse: RPCResponse = {
                        jsonrpc: '2.0',
                        error: {
                            code: -32700,
                            message: 'Parse error',
                            data: error instanceof Error ? error.message : String(error)
                        },
                        id: null
                    };
                    ws.send(JSON.stringify(errorResponse));
                }
            });

            ws.on('close', () => {
                console.log('Client disconnected');
                // Clean up any active sessions for this connection
                this.cleanupSessionsForConnection(ws);
                this.clientConnections.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.cleanupSessionsForConnection(ws);
                this.clientConnections.delete(ws);
            });

            // Send welcome message
            const welcome: RPCResponse = {
                jsonrpc: '2.0',
                result: {
                    message: 'Connected to AIX Remote Server',
                    platform: os.platform(),
                    arch: os.arch(),
                    hostname: os.hostname(),
                    ptySupported: !!pty,
                    shell: process.env.SHELL || '/bin/sh'
                },
                id: 'welcome'
            };
            ws.send(JSON.stringify(welcome));
        });

        console.log(`AIX Remote Server listening on port ${this.port}`);
    }

    async handleMessage(message: RPCMessage, ws: WebSocket): Promise<RPCResponse | null> {
        const { method, params, id } = message;
        
        try {
            let result: any;
            
            switch (method) {
                case 'fs.readDir':
                    result = await this.readDirectory(params.path);
                    break;
                case 'fs.readFile':
                    result = await this.readFile(params.path);
                    break;
                case 'fs.writeFile':
                    result = await this.writeFile(params.path, params.content);
                    break;
                case 'fs.stat':
                    result = await this.getStat(params.path);
                    break;
                case 'terminal.exec':
                    result = await this.executeCommand(params.command, params.cwd);
                    break;
                case 'terminal.create':
                    // Create a new terminal session with PTY
                    if (id !== undefined) {
                        this.createTerminalSession(params.cwd, params.cols, params.rows, id, ws);
                    } else {
                        throw new Error('Session ID is required for terminal creation');
                    }
                    return null;
                case 'terminal.input':
                    this.handleTerminalInput(params.sessionId, params.data);
                    return { jsonrpc: '2.0', result: { success: true }, id: id || null };
                case 'terminal.resize':
                    this.handleTerminalResize(params.sessionId, params.cols, params.rows);
                    return { jsonrpc: '2.0', result: { success: true }, id: id || null };
                case 'terminal.kill':
                    this.handleTerminalKill(params.sessionId, params.signal);
                    return { jsonrpc: '2.0', result: { success: true }, id: id || null };
                case 'system.info':
                    result = this.getSystemInfo();
                    break;
                default:
                    throw new Error(`Unknown method: ${method}`);
            }
            
            return {
                jsonrpc: '2.0',
                result,
                id: id || null
            };
        } catch (error) {
            return {
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : String(error)
                },
                id: id || null
            };
        }
    }

    private createTerminalSession(cwd: string = os.homedir(), cols: number = 80, rows: number = 30, sessionId: string | number, ws: WebSocket): void {
        console.log(`Creating terminal session: ${sessionId} (${cols}x${rows})`);
        
        if (pty) {
            // Use node-pty for full terminal support
            try {
                const shell = process.env.SHELL || '/bin/bash';
                const ptyProcess = pty.spawn(shell, [], {
                    name: 'xterm-color',
                    cols: cols,
                    rows: rows,
                    cwd: cwd,
                    env: process.env
                });

                const session: TerminalSession = {
                    process: ptyProcess,
                    type: 'pty',
                    cwd: cwd
                };

                this.activeSessions.set(sessionId, session);

                // Handle PTY data
                ptyProcess.onData((data: string) => {
                    const response: RPCResponse = {
                        jsonrpc: '2.0',
                        result: {
                            type: 'data',
                            data: data
                        },
                        id: sessionId
                    };
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(response));
                    }
                });

                // Handle PTY exit
                ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
                    console.log(`PTY session ${sessionId} exited with code: ${exitCode}, signal: ${signal}`);
                    const response: RPCResponse = {
                        jsonrpc: '2.0',
                        result: {
                            type: 'exit',
                            exitCode: exitCode,
                            signal: signal
                        },
                        id: sessionId
                    };
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(response));
                    }
                    this.activeSessions.delete(sessionId);
                });

                // Send ready signal
                const readyResponse: RPCResponse = {
                    jsonrpc: '2.0',
                    result: {
                        type: 'ready',
                        pid: ptyProcess.pid,
                        shell: shell
                    },
                    id: sessionId
                };
                ws.send(JSON.stringify(readyResponse));

            } catch (error) {
                console.error(`Failed to create PTY session: ${error}`);
                this.fallbackToSpawn(cwd, sessionId, ws);
            }
        } else {
            // Fallback to spawn
            this.fallbackToSpawn(cwd, sessionId, ws);
        }
    }

    private fallbackToSpawn(cwd: string, sessionId: string | number, ws: WebSocket): void {
        console.log(`Using spawn fallback for session: ${sessionId}`);
        
        const shell = process.env.SHELL || '/bin/bash';
        const child = spawn(shell, ['-i'], {  // Interactive shell
            cwd,
            stdio: 'pipe',
            env: process.env
        });

        const session: TerminalSession = {
            process: child,
            type: 'spawn',
            cwd: cwd
        };

        this.activeSessions.set(sessionId, session);

        // Stream stdout
        child.stdout?.on('data', (data: Buffer) => {
            const response: RPCResponse = {
                jsonrpc: '2.0',
                result: {
                    type: 'data',
                    data: data.toString()
                },
                id: sessionId
            };
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response));
            }
        });

        // Stream stderr
        child.stderr?.on('data', (data: Buffer) => {
            const response: RPCResponse = {
                jsonrpc: '2.0',
                result: {
                    type: 'data',
                    data: data.toString()
                },
                id: sessionId
            };
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response));
            }
        });

        // Handle process exit
        child.on('close', (code: number | null) => {
            console.log(`Spawn session ${sessionId} exited with code: ${code}`);
            const response: RPCResponse = {
                jsonrpc: '2.0',
                result: {
                    type: 'exit',
                    exitCode: code || 0
                },
                id: sessionId
            };
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response));
            }
            this.activeSessions.delete(sessionId);
        });

        child.on('error', (error: Error) => {
            console.error(`Spawn session error: ${error}`);
            const response: RPCResponse = {
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Terminal session error',
                    data: error.message
                },
                id: sessionId
            };
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(response));
            }
            this.activeSessions.delete(sessionId);
        });

        // Send ready signal
        const readyResponse: RPCResponse = {
            jsonrpc: '2.0',
            result: {
                type: 'ready',
                pid: child.pid,
                shell: shell
            },
            id: sessionId
        };
        ws.send(JSON.stringify(readyResponse));
    }

    private handleTerminalInput(sessionId: string | number, data: string): void {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            try {
                if (session.type === 'pty') {
                    // PTY handles input directly
                    session.process.write(data);
                } else {
                    // Spawn needs stdin
                    if (session.process.stdin && !session.process.stdin.destroyed) {
                        session.process.stdin.write(data);
                    }
                }
            } catch (error) {
                console.error(`Failed to write to terminal session ${sessionId}:`, error);
            }
        }
    }

    private handleTerminalResize(sessionId: string | number, cols: number, rows: number): void {
        const session = this.activeSessions.get(sessionId);
        if (session && session.type === 'pty') {
            try {
                session.process.resize(cols, rows);
                console.log(`Resized terminal ${sessionId} to ${cols}x${rows}`);
            } catch (error) {
                console.error(`Failed to resize terminal ${sessionId}:`, error);
            }
        }
    }

    private handleTerminalKill(sessionId: string | number, signal: string = 'SIGTERM'): void {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            try {
                console.log(`Killing terminal session ${sessionId} with signal ${signal}`);
                if (session.type === 'pty') {
                    session.process.kill(signal);
                } else {
                    session.process.kill(signal);
                }
                this.activeSessions.delete(sessionId);
            } catch (error) {
                console.error(`Failed to kill terminal session ${sessionId}:`, error);
            }
        }
    }

    private cleanupSessionsForConnection(ws: WebSocket): void {
        console.log('Cleaning up terminal sessions for disconnected client');
        for (const [sessionId, session] of this.activeSessions.entries()) {
            try {
                if (session.type === 'pty') {
                    session.process.kill('SIGTERM');
                } else {
                    session.process.kill('SIGTERM');
                }
                console.log(`Killed terminal session ${sessionId}`);
            } catch (error) {
                console.log(`Failed to kill terminal session ${sessionId}:`, error);
            }
        }
        this.activeSessions.clear();
    }

    // File system methods (unchanged)
    async readDirectory(dirPath: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
                if (err) {
                    reject(err);
                    return;
                }
                const result = entries.map(entry => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' :
                          entry.isSymbolicLink() ? 'symlink' : 'file',
                    path: path.join(dirPath, entry.name)
                }));
                resolve(result);
            });
        });
    }

    async readFile(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(data);
            });
        });
    }

    async writeFile(filePath: string, content: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            fs.writeFile(filePath, content, 'utf8', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(true);
            });
        });
    }

    async getStat(filePath: string): Promise<any> {
        return new Promise((resolve, reject) => {
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    size: stats.size,
                    isFile: stats.isFile(),
                    isDirectory: stats.isDirectory(),
                    isSymbolicLink: stats.isSymbolicLink(),
                    modified: stats.mtime,
                    created: stats.birthtime,
                    mode: stats.mode
                });
            });
        });
    }

    // Simple command execution (for non-terminal commands)
    async executeCommand(command: string, cwd = process.cwd()): Promise<any> {
        return new Promise((resolve, reject) => {
            const child = spawn('sh', ['-c', command], {
                cwd,
                stdio: 'pipe'
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                resolve({
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    command,
                    cwd
                });
            });

            child.on('error', (error) => {
                reject(error);
            });
        });
    }

    getSystemInfo(): any {
        return {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            uptime: os.uptime(),
            loadavg: os.loadavg(),
            freemem: os.freemem(),
            totalmem: os.totalmem(),
            cpus: os.cpus().length,
            nodeVersion: process.version,
            cwd: process.cwd(),
            ptySupported: !!pty,
            shell: process.env.SHELL || '/bin/sh',
            env: {
                USER: process.env.USER,
                HOME: process.env.HOME,
                SHELL: process.env.SHELL,
                PATH: process.env.PATH
            }
        };
    }
}

// Start the server
const server = new AIXRemoteServer(8080);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down AIX Remote Server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down AIX Remote Server...');
    process.exit(0);
});

export { AIXRemoteServer };