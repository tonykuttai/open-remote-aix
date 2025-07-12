import { Client as SSHClient } from 'ssh2';
import * as WebSocket from 'ws';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

interface SSHConfig {
    host: string;
    hostname?: string;
    user?: string;
    port?: number;
    identityFile?: string;
    [key: string]: any;
}

export class AIXRemoteManager {
    private sshClient: SSHClient | null = null;
    private wsClient: WebSocket | null = null;
    private connected: boolean = false;
    private host: string = '';
    private username: string = '';
    private requestId: number = 0;
    private pendingRequests: Map<string | number, { resolve: Function; reject: Function }> = new Map();
    private sshConfigs: Map<string, SSHConfig> = new Map();

    constructor() {
        this.loadSSHConfig();
    }

    async connect(connectionString: string, password?: string): Promise<void> {
        const { username, hostname } = this.parseConnectionString(connectionString);
        this.username = username;
        this.host = hostname;

        console.log(`Connecting to ${username}@${hostname}`);

        return new Promise((resolve, reject) => {
            this.sshClient = new SSHClient();
            
            this.sshClient.on('ready', async () => {
                console.log('SSH connection established');
                
                try {
                    // For now, let's skip auto-deployment and just try direct connection
                    console.log('Trying WebSocket connection...');
                    await this.connectWebSocket();
                    
                    this.connected = true;
                    resolve();
                } catch (error) {
                    console.error('WebSocket connection failed:', error);
                    reject(error);
                }
            });

            this.sshClient.on('error', (error: any) => {
                console.error('SSH connection error:', error);
                reject(error);
            });

            // Get SSH configuration
            try {
                const sshConfig = this.getSSHConfig(hostname, username);
                console.log('SSH config:', { ...sshConfig, privateKey: sshConfig.privateKey ? '[PRESENT]' : '[NOT_PRESENT]' });
                
                // Add password if provided
                if (password) {
                    sshConfig.password = password;
                }
                
                this.sshClient.connect(sshConfig);
            } catch (configError) {
                console.error('SSH config error:', configError);
                reject(configError);
            }
        });
    }

    private parseConnectionString(connectionString: string): { username: string; hostname: string } {
        // Support formats: username@hostname, hostname (use current user), or just hostname
        if (connectionString.includes('@')) {
            const [username, hostname] = connectionString.split('@');
            return { username: username.trim(), hostname: hostname.trim() };
        } else {
            // If no username provided, try to get from SSH config or use current user
            const hostname = connectionString.trim();
            const config = this.sshConfigs.get(hostname);
            const username = config?.user || os.userInfo().username;
            return { username, hostname };
        }
    }

    private loadSSHConfig(): void {
        try {
            const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
            if (fs.existsSync(sshConfigPath)) {
                const configContent = fs.readFileSync(sshConfigPath, 'utf8');
                this.parseSSHConfig(configContent);
            }
        } catch (error) {
            console.log('Could not load SSH config:', error);
        }
    }

    private parseSSHConfig(configContent: string): void {
        const lines = configContent.split('\n');
        let currentHost: string | null = null;
        let currentConfig: SSHConfig | null = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const [key, ...valueParts] = trimmed.split(/\s+/);
            const value = valueParts.join(' ');

            if (key.toLowerCase() === 'host') {
                if (currentHost && currentConfig) {
                    this.sshConfigs.set(currentHost, currentConfig);
                }
                currentHost = value;
                currentConfig = { host: value };
            } else if (currentConfig) {
                const lowerKey = key.toLowerCase();
                switch (lowerKey) {
                    case 'hostname':
                        currentConfig.hostname = value;
                        break;
                    case 'user':
                        currentConfig.user = value;
                        break;
                    case 'port':
                        currentConfig.port = parseInt(value);
                        break;
                    case 'identityfile':
                        currentConfig.identityFile = value.replace('~', os.homedir());
                        break;
                    default:
                        currentConfig[lowerKey] = value;
                }
            }
        }

        if (currentHost && currentConfig) {
            this.sshConfigs.set(currentHost, currentConfig);
        }
    }

    private getSSHConfig(hostname: string, username: string): any {
        const config: SSHConfig = this.sshConfigs.get(hostname) || { host: hostname };
        
        const sshConfig: any = {
            host: config.hostname || hostname,
            port: config.port || 22,
            username: config.user || username
        };

        // Add identity file if specified
        if (config.identityFile && fs.existsSync(config.identityFile)) {
            sshConfig.privateKey = fs.readFileSync(config.identityFile);
        }

        return sshConfig;
    }

    private async ensureServerRunning(): Promise<void> {
        if (!this.sshClient) {
            throw new Error('No SSH connection');
        }

        return new Promise((resolve, reject) => {
            // Check if server is already running
            this.sshClient!.exec('pgrep -f "node.*server.js" && echo "RUNNING" || echo "NOT_RUNNING"', (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let output = '';
                stream.on('data', (data: any) => {
                    output += data.toString();
                });

                stream.on('close', async () => {
                    if (output.includes('RUNNING')) {
                        console.log('Server already running');
                        // Check if server responds
                        try {
                            await this.testServerConnection();
                            resolve();
                        } catch (error) {
                            console.log('Server not responding, restarting...');
                            await this.deployAndStartServer();
                            resolve();
                        }
                    } else {
                        console.log('Server not running, deploying...');
                        await this.deployAndStartServer();
                        resolve();
                    }
                });
            });
        });
    }

    private async testServerConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            const testWs = new WebSocket(`ws://${this.host}:8080`);
            
            testWs.on('open', () => {
                testWs.close();
                resolve();
            });

            testWs.on('error', () => {
                reject(new Error('Server not responding'));
            });

            setTimeout(() => {
                testWs.close();
                reject(new Error('Connection timeout'));
            }, 3000);
        });
    }

    private async deployAndStartServer(): Promise<void> {
        if (!this.sshClient) {
            throw new Error('No SSH connection');
        }

        return new Promise((resolve, reject) => {
            // Create .aix-remote directory and check if server exists
            this.sshClient!.exec('mkdir -p ~/.aix-remote && cd ~/.aix-remote && ls -la', (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let output = '';
                stream.on('data', (data: any) => {
                    output += data.toString();
                });

                stream.on('close', async () => {
                    try {
                        if (!output.includes('dist') || !output.includes('package.json')) {
                            console.log('Deploying server files...');
                            await this.uploadServerFiles();
                        }
                        
                        console.log('Starting server...');
                        await this.startServer();
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        });
    }

    private async uploadServerFiles(): Promise<void> {
        if (!this.sshClient) {
            throw new Error('No SSH connection');
        }

        return new Promise((resolve, reject) => {
            // Get server files from local project
            const serverPath = path.join(__dirname, '..', 'server');
            const packageJsonPath = path.join(serverPath, 'package.json');
            const distPath = path.join(serverPath, 'dist');

            if (!fs.existsSync(packageJsonPath) || !fs.existsSync(distPath)) {
                reject(new Error('Server files not found. Run "cd server && npm run build" first.'));
                return;
            }

            // Upload package.json
            const packageJson = fs.readFileSync(packageJsonPath, 'utf8');
            this.sshClient!.exec(`cat > ~/.aix-remote/package.json << 'EOF'
${packageJson}
EOF`, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                stream.on('close', async () => {
                    try {
                        // Upload server.js
                        const serverJs = fs.readFileSync(path.join(distPath, 'server.js'), 'utf8');
                        await this.uploadFile('~/.aix-remote/dist/server.js', serverJs);
                        
                        // Install dependencies
                        await this.execCommand('cd ~/.aix-remote && npm install');
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        });
    }

    private async uploadFile(remotePath: string, content: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const dir = path.dirname(remotePath);
            this.sshClient!.exec(`mkdir -p ${dir} && cat > ${remotePath} << 'EOF'
${content}
EOF`, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }
                stream.on('close', () => resolve());
            });
        });
    }

    private async startServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Start server in background
            this.sshClient!.exec('cd ~/.aix-remote && nohup node dist/server.js > server.log 2>&1 & echo $!', (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let output = '';
                stream.on('data', (data: any) => {
                    output += data.toString();
                });

                stream.on('close', () => {
                    const pid = output.trim();
                    console.log(`Server started with PID: ${pid}`);
                    
                    // Wait a moment for server to start
                    setTimeout(() => resolve(), 2000);
                });
            });
        });
    }

    private async execCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.sshClient!.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let output = '';
                stream.on('data', (data: any) => {
                    output += data.toString();
                });

                stream.on('close', (code: number) => {
                    if (code === 0) {
                        resolve(output);
                    } else {
                        reject(new Error(`Command failed with code ${code}: ${output}`));
                    }
                });
            });
        });
    }

    private async connectWebSocket(): Promise<void> {
        // Try direct connection first, then SSH tunnel
        try {
            await this.connectWebSocketDirect();
        } catch (error) {
            console.log('Direct connection failed, trying SSH tunnel...');
            await this.connectWebSocketTunnel();
        }
    }

    private async connectWebSocketDirect(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`Trying direct WebSocket connection to ${this.host}:8080`);
            
            this.wsClient = new WebSocket(`ws://${this.host}:8080`);

            this.wsClient.on('open', () => {
                console.log('Direct WebSocket connection established');
                resolve();
            });

            this.wsClient.on('message', (data: WebSocket.Data) => {
                try {
                    const response: RPCResponse = JSON.parse(data.toString());
                    this.handleResponse(response);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            });

            this.wsClient.on('error', (error: any) => {
                reject(error);
            });

            this.wsClient.on('close', () => {
                console.log('WebSocket connection closed');
                this.connected = false;
            });

            setTimeout(() => {
                if (this.wsClient && this.wsClient.readyState !== WebSocket.OPEN) {
                    this.wsClient.close();
                    reject(new Error('Direct connection timeout'));
                }
            }, 5000);
        });
    }

    private async connectWebSocketTunnel(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.sshClient) {
                reject(new Error('No SSH connection'));
                return;
            }

            console.log('Creating SSH tunnel for WebSocket...');
            
            this.sshClient.forwardOut('127.0.0.1', 0, '127.0.0.1', 8080, (err: any, stream: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.wsClient = new WebSocket('ws://127.0.0.1:8080', {
                    createConnection: () => stream
                });

                this.wsClient.on('open', () => {
                    console.log('Tunneled WebSocket connection established');
                    resolve();
                });

                this.wsClient.on('message', (data: WebSocket.Data) => {
                    try {
                        const response: RPCResponse = JSON.parse(data.toString());
                        this.handleResponse(response);
                    } catch (error) {
                        console.error('Failed to parse WebSocket message:', error);
                    }
                });

                this.wsClient.on('error', (error: any) => {
                    reject(error);
                });

                this.wsClient.on('close', () => {
                    console.log('Tunneled WebSocket connection closed');
                    this.connected = false;
                });
            });
        });
    }

    private handleResponse(response: RPCResponse) {
        if (response.id === 'welcome') {
            console.log('Received welcome message:', response.result);
            return;
        }

        if (response.id === null) {
            return;
        }

        const pending = this.pendingRequests.get(response.id);
        if (pending) {
            this.pendingRequests.delete(response.id);
            
            if (response.error) {
                pending.reject(new Error(response.error.message));
            } else {
                pending.resolve(response.result);
            }
        }
    }

    private async sendRequest(method: string, params?: any): Promise<any> {
        if (!this.wsClient || !this.connected) {
            throw new Error('Not connected to AIX machine');
        }

        const id = ++this.requestId;
        const message: RPCMessage = {
            jsonrpc: '2.0',
            method,
            params,
            id
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            
            this.wsClient!.send(JSON.stringify(message));
            
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    // Public API methods
    async readDirectory(path: string): Promise<any[]> {
        return this.sendRequest('fs.readDir', { path });
    }

    async readFile(path: string): Promise<string> {
        return this.sendRequest('fs.readFile', { path });
    }

    async writeFile(path: string, content: string): Promise<boolean> {
        return this.sendRequest('fs.writeFile', { path, content });
    }

    async getStat(path: string): Promise<any> {
        return this.sendRequest('fs.stat', { path });
    }

    async executeCommand(command: string, cwd?: string): Promise<any> {
        return this.sendRequest('terminal.exec', { command, cwd });
    }

    async getSystemInfo(): Promise<any> {
        return this.sendRequest('system.info');
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        
        if (this.wsClient) {
            this.wsClient.close();
            this.wsClient = null;
        }
        
        if (this.sshClient) {
            this.sshClient.end();
            this.sshClient = null;
        }
        
        this.pendingRequests.clear();
    }

    isConnected(): boolean {
        return this.connected;
    }

    getHost(): string {
        return this.host;
    }

    getUsername(): string {
        return this.username;
    }

    getDefaultPath(): string {
        return `/home/${this.username}`;
    }
}