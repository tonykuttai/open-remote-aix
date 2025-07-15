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
    error?: { code: number | string; message: string; data?: any };
    id: string | number | null;
}

interface TerminalSession {
    process: any; // IPty or ChildProcess
    type: 'pty' | 'spawn';
    cwd: string;
    websocket: WebSocket; // Track which websocket owns this session
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
        console.log(`Working Directory: ${process.cwd()}`);
        console.log(`User: ${os.userInfo().username}`);
        
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('🔗 Client connected');
            
            // Store client connection
            const clientId = `client_${Date.now()}_${Math.random()}`;
            this.clientConnections.set(ws, clientId);
            
            ws.on('message', async (data: WebSocket.Data) => {
                try {
                    const message: RPCMessage = JSON.parse(data.toString());
                    console.log(`📨 Received: ${message.method} (id: ${message.id})`);
                    
                    // Handle vscode.openFile and vscode.openWorkspace specially - forward to all clients
                    if (message.method === 'vscode.openFile' || message.method === 'vscode.openWorkspace') {
                        this.handleVSCodeRequest(message, ws);
                        return;
                    }
                    
                    const response = await this.handleMessage(message, ws);
                    
                    // Only send response if there is one (streaming commands return null)
                    if (response !== null) {
                        ws.send(JSON.stringify(response));
                    }
                } catch (error) {
                    console.error('❌ Error handling message:', error);
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
                console.log('🔌 Client disconnected');
                // Clean up any active sessions for this connection
                this.cleanupSessionsForConnection(ws);
                this.clientConnections.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
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
                    shell: process.env.SHELL || '/bin/sh',
                    cwd: process.cwd(),
                    user: os.userInfo().username
                },
                id: 'welcome'
            };
            ws.send(JSON.stringify(welcome));
        });

        console.log(`🚀 AIX Remote Server listening on port ${this.port}`);
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
            console.error(`❌ Error in ${method}:`, error);
            
            // Map specific error types to appropriate error codes
            let errorCode: string | number = -32603; // Internal error
            let errorMessage = 'Internal error';
            
            if (error instanceof Error) {
                errorMessage = error.message;
                
                // Map filesystem errors to specific codes
                if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
                    errorCode = 'ENOENT';
                    errorMessage = `File not found: ${params?.path || 'unknown path'}`;
                } else if (error.message.includes('EACCES')) {
                    errorCode = 'EACCES';
                    errorMessage = `Permission denied: ${params?.path || 'unknown path'}`;
                } else if (error.message.includes('EISDIR')) {
                    errorCode = 'EISDIR';
                    errorMessage = `Is a directory: ${params?.path || 'unknown path'}`;
                }
            }
            
            return {
                jsonrpc: '2.0',
                error: {
                    code: errorCode,
                    message: errorMessage,
                    data: error instanceof Error ? error.stack : String(error)
                },
                id: id || null
            };
        }
    }

    // Combined handler for both vscode.openFile and vscode.openWorkspace
    private handleVSCodeRequest(message: RPCMessage, requestingWs: WebSocket): void {
        const { filePath, isDirectory } = message.params || {};
        console.log(`📂 Opening ${isDirectory ? 'workspace' : 'file'} in VS Code: ${filePath}`);
        
        // Find VS Code client connection
        for (const [ws, clientId] of this.clientConnections.entries()) {
            if (ws !== requestingWs && ws.readyState === WebSocket.OPEN) {
                // Forward the request to VS Code
                ws.send(JSON.stringify(message));
                console.log(`✅ Forwarded ${isDirectory ? 'workspace' : 'file'} open request to VS Code client`);
                
                // Send success response back to terminal
                const response: RPCResponse = {
                    jsonrpc: '2.0',
                    result: { 
                        success: true, 
                        forwarded: true,
                        filePath: filePath,
                        isDirectory: isDirectory || false
                    },
                    id: message.id || null
                };
                requestingWs.send(JSON.stringify(response));
                return;
            }
        }
        
        // No VS Code client found - still send success but indicate not forwarded
        console.log(`⚠️ VS Code client not found, but sending success response`);
        const errorResponse: RPCResponse = {
            jsonrpc: '2.0',
            result: { 
                success: true,
                forwarded: false,
                message: 'VS Code not connected, but request processed'
            },
            id: message.id || null
        };
        requestingWs.send(JSON.stringify(errorResponse));
    }

    private createTerminalSession(cwd: string = os.homedir(), cols: number = 80, rows: number = 30, sessionId: string | number, ws: WebSocket): void {
        console.log(`🖥️ Creating terminal session ${sessionId} in ${cwd}`);
        
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
                    cwd: cwd,
                    websocket: ws
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
                    console.log(`🏁 Terminal session ${sessionId} exited with code ${exitCode}`);
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
                console.log(`✅ PTY terminal session ${sessionId} ready (PID: ${ptyProcess.pid})`);

            } catch (error) {
                console.log(`❌ PTY failed, falling back to spawn:`, error);
                this.fallbackToSpawn(cwd, sessionId, ws);
            }
        } else {
            // Fallback to spawn
            this.fallbackToSpawn(cwd, sessionId, ws);
        }
    }

    private fallbackToSpawn(cwd: string, sessionId: string | number, ws: WebSocket): void {
        console.log(`🔄 Using spawn fallback for terminal session ${sessionId}`);
        
        const shell = process.env.SHELL || '/bin/bash';
        const child = spawn(shell, ['-i'], {  // Interactive shell
            cwd,
            stdio: 'pipe',
            env: process.env
        });

        const session: TerminalSession = {
            process: child,
            type: 'spawn',
            cwd: cwd,
            websocket: ws
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
            console.log(`🏁 Spawn terminal session ${sessionId} exited with code ${code}`);
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
            console.error(`❌ Spawn terminal session ${sessionId} error:`, error);
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
        console.log(`✅ Spawn terminal session ${sessionId} ready (PID: ${child.pid})`);
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
                console.error(`❌ Failed to write to terminal session ${sessionId}:`, error);
            }
        } else {
            console.warn(`⚠️ Terminal session ${sessionId} not found for input`);
        }
    }

    private handleTerminalResize(sessionId: string | number, cols: number, rows: number): void {
        const session = this.activeSessions.get(sessionId);
        if (session && session.type === 'pty') {
            try {
                session.process.resize(cols, rows);
                console.log(`📐 Resized terminal ${sessionId} to ${cols}x${rows}`);
            } catch (error) {
                // Ignore resize errors silently
            }
        }
    }

    private handleTerminalKill(sessionId: string | number, signal: string = 'SIGTERM'): void {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            try {
                console.log(`🔪 Killing terminal session ${sessionId} with ${signal}`);
                if (session.type === 'pty') {
                    session.process.kill(signal);
                } else {
                    session.process.kill(signal);
                }
                this.activeSessions.delete(sessionId);
            } catch (error) {
                console.error(`❌ Failed to kill terminal session ${sessionId}:`, error);
            }
        }
    }

    private cleanupSessionsForConnection(ws: WebSocket): void {
        console.log('🧹 Cleaning up terminal sessions for disconnected client');
        const sessionsToClean: (string | number)[] = [];
        
        // Find sessions belonging to this websocket
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (session.websocket === ws) {
                sessionsToClean.push(sessionId);
            }
        }
        
        // Clean up the sessions
        for (const sessionId of sessionsToClean) {
            const session = this.activeSessions.get(sessionId);
            if (session) {
                try {
                    if (session.type === 'pty') {
                        session.process.kill('SIGTERM');
                    } else {
                        session.process.kill('SIGTERM');
                    }
                    console.log(`🗑️ Killed terminal session ${sessionId}`);
                } catch (error) {
                    console.log(`❌ Failed to kill terminal session ${sessionId}:`, error);
                }
                this.activeSessions.delete(sessionId);
            }
        }
    }

    // File system methods
    async readDirectory(dirPath: string): Promise<any[]> {
        console.log(`📁 Reading directory: ${dirPath}`);
        return new Promise((resolve, reject) => {
            fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
                if (err) {
                    console.error(`❌ Failed to read directory ${dirPath}:`, err);
                    reject(err);
                    return;
                }
                const result = entries.map(entry => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' :
                          entry.isSymbolicLink() ? 'symlink' : 'file',
                    path: path.join(dirPath, entry.name)
                }));
                console.log(`✅ Found ${result.length} entries in ${dirPath}`);
                resolve(result);
            });
        });
    }

    async readFile(filePath: string): Promise<string> {
        console.log(`📖 Reading file: ${filePath}`);
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    console.error(`❌ Failed to read file ${filePath}:`, err);
                    reject(err);
                    return;
                }
                console.log(`✅ Read file ${filePath} (${data.length} characters)`);
                resolve(data);
            });
        });
    }

    async writeFile(filePath: string, content: string): Promise<boolean> {
        console.log(`✏️ Writing file: ${filePath} (${content.length} characters)`);
        return new Promise((resolve, reject) => {
            // Ensure directory exists
            const dir = path.dirname(filePath);
            fs.mkdir(dir, { recursive: true }, (mkdirErr) => {
                if (mkdirErr && mkdirErr.code !== 'EEXIST') {
                    console.error(`❌ Failed to create directory ${dir}:`, mkdirErr);
                    reject(mkdirErr);
                    return;
                }
                
                fs.writeFile(filePath, content, 'utf8', (err) => {
                    if (err) {
                        console.error(`❌ Failed to write file ${filePath}:`, err);
                        reject(err);
                        return;
                    }
                    console.log(`✅ Wrote file ${filePath}`);
                    resolve(true);
                });
            });
        });
    }

    async getStat(filePath: string): Promise<any> {
        return new Promise((resolve, reject) => {
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    // Don't log ENOENT errors as they're common when checking if files exist
                    if (err.code !== 'ENOENT') {
                        console.error(`❌ Failed to stat ${filePath}:`, err);
                    }
                    reject(err);
                    return;
                }
                const result = {
                    size: stats.size,
                    isFile: stats.isFile(),
                    isDirectory: stats.isDirectory(),
                    isSymbolicLink: stats.isSymbolicLink(),
                    modified: stats.mtime,
                    created: stats.birthtime,
                    mode: stats.mode
                };
                resolve(result);
            });
        });
    }

    // Simple command execution (for non-terminal commands)
    async executeCommand(command: string, cwd = process.cwd()): Promise<any> {
        console.log(`⚡ Executing command: ${command} in ${cwd}`);
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
                console.log(`✅ Command completed with exit code ${code}`);
                resolve({
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    command,
                    cwd
                });
            });

            child.on('error', (error) => {
                console.error(`❌ Command failed:`, error);
                reject(error);
            });
        });
    }

    getSystemInfo(): any {
        const info = {
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
            activeSessions: this.activeSessions.size,
            connectedClients: this.clientConnections.size,
            env: {
                USER: process.env.USER,
                HOME: process.env.HOME,
                SHELL: process.env.SHELL,
                PATH: process.env.PATH
            }
        };
        console.log(`ℹ️ System info requested`);
        return info;
    }
}

// Start the server
const server = new AIXRemoteServer(8080);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down AIX Remote Server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down AIX Remote Server...');
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit on unhandled rejections, just log them
});

export { AIXRemoteServer };