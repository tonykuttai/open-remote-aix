"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const WebSocket = __importStar(require("ws"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
class AIXRemoteServer {
    wss;
    port;
    constructor(port = 8080) {
        this.port = port;
        this.wss = new WebSocket.Server({ port });
        this.setupServer();
    }
    setupServer() {
        console.log(`AIX Remote Server starting on port ${this.port}...`);
        this.wss.on('connection', (ws) => {
            console.log('Client connected');
            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const response = await this.handleMessage(message);
                    ws.send(JSON.stringify(response));
                }
                catch (error) {
                    const errorResponse = {
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
            const welcome = {
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
    async handleMessage(message) {
        const { method, params, id } = message;
        try {
            let result;
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
        }
        catch (error) {
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
    async readDirectory(dirPath) {
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
    async readFile(filePath) {
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
    async writeFile(filePath, content) {
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
    async getStat(filePath) {
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
    async executeCommand(command, cwd = process.cwd()) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('sh', ['-c', command], {
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
    getSystemInfo() {
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
//# sourceMappingURL=server.js.map