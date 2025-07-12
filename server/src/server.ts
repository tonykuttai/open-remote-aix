import * as WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

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

class AIXRemoteServer {
    private wss: WebSocket.Server;
    private port: number;

    constructor(port: number = 8080) {
        this.port = port;
        this.wss = new WebSocket.Server({ port });
        this.setupServer();
    }

    private setupServer() {
        console.log(`AIX Remote Server starting on port ${this.port}...`);
        
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('Client connected');
            
            ws.on('message', async (data: WebSocket.Data) => {
                try {
                    const message: RPCMessage = JSON.parse(data.toString());
                    const response = await this.handleMessage(message);
                    ws.send(JSON.stringify(response));
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
            });

            // Send welcome message
            const welcome: RPCResponse = {
                jsonrpc: '2.0',
                result: {
                    message: 'Connected to AIX Remote Server',
                    platform: os.platform(),
                    arch: os.arch(),
                    hostname: os.hostname()
                },
                id: 'welcome'
            };
            ws.send(JSON.stringify(welcome));
        });

        console.log(`AIX Remote Server listening on port ${this.port}`);
    }

    private async handleMessage(message: RPCMessage): Promise<RPCResponse> {
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

    private async readDirectory(dirPath: string): Promise<any[]> {
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

    private async readFile(filePath: string): Promise<string> {
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

    private async writeFile(filePath: string, content: string): Promise<boolean> {
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

    private async getStat(filePath: string): Promise<any> {
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

    private async executeCommand(command: string, cwd: string = process.cwd()): Promise<any> {
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

    private getSystemInfo(): any {
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