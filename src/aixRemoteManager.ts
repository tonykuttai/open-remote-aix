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
                    // Ensure server is running with auto-deployment
                    console.log('Ensuring server is running...');
                    await this.ensureServerRunning();
                    
                    // Then connect via WebSocket
                    console.log('Connecting to WebSocket...');
                    await this.connectWebSocket();
                    
                    this.connected = true;
                    resolve();
                } catch (error) {
                    console.error('Connection failed:', error);
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

        console.log('=== Ensuring server is running ===');
        
        // Step 1: Check if server is already running
        try {
            console.log('Step 1: Testing if server is already running...');
            await this.testServerConnection();
            console.log('✅ Server already running and responding');
            return;
        } catch (error) {
            console.log('❌ Server not running, proceeding with deployment...');
        }

        // Step 2: Deploy server files
        console.log('Step 2: Deploying server files...');
        await this.deployServerFiles();

        // Step 3: Start server
        console.log('Step 3: Starting server...');
        await this.startRemoteServer();

        // Step 4: Wait for server to be ready
        console.log('Step 4: Waiting for server to be ready...');
        await this.waitForServerReady();

        console.log('✅ Server is running and ready!');
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
            }, 5000);
        });
    }

    private async deployServerFiles(): Promise<void> {
        try {
            // Create remote directory structure first via SSH
            console.log('Creating remote directory structure...');
            await this.execCommand('mkdir -p ~/.aix-remote');

            // Get local server paths
            const serverDistPath = path.join(__dirname, '../server/dist');
            const packageJsonPath = path.join(__dirname, '../server/package.json');

            // Check if local files exist
            if (!fs.existsSync(serverDistPath)) {
                throw new Error(`Server dist not found at: ${serverDistPath}. Run 'npm run build' in server directory first.`);
            }

            if (!fs.existsSync(packageJsonPath)) {
                throw new Error(`Server package.json not found at: ${packageJsonPath}.`);
            }

            // Use SCP to copy files (skip node_modules - we'll install remotely)
            console.log('Copying dist folder via SCP...');
            await this.scpCopy(serverDistPath, `${this.username}@${this.host}:~/.aix-remote/`);

            console.log('Copying package.json via SCP...');
            await this.scpCopy(packageJsonPath, `${this.username}@${this.host}:~/.aix-remote/`);

            // Install dependencies remotely (much faster than copying)
            console.log('Installing dependencies on remote machine...');
            await this.execCommandWithTimeout('cd ~/.aix-remote && export PATH="/opt/nodejs/bin:$PATH" && npm install --production', 120000); // 2 minute timeout

            console.log('✅ Server files deployed successfully');

        } catch (error) {
            console.error('❌ Server deployment failed:', error);
            throw error;
        }
    }

    private async scpCopy(localPath: string, remotePath: string): Promise<void> {
        const { spawn } = require('child_process');
        
        return new Promise((resolve, reject) => {
            // Build SCP command
            const scpArgs = ['-r', '-o', 'StrictHostKeyChecking=no', localPath, remotePath];
            
            console.log(`Running: scp ${scpArgs.join(' ')}`);
            
            const child = spawn('scp', scpArgs, { stdio: 'pipe' });
            
            let output = '';
            let errorOutput = '';
            
            child.stdout?.on('data', (data: any) => { 
                output += data.toString(); 
            });
            
            child.stderr?.on('data', (data: any) => { 
                errorOutput += data.toString(); 
            });
            
            child.on('close', (code: any) => {
                if (code === 0) {
                    console.log(`SCP completed successfully for ${localPath}`);
                    resolve();
                } else {
                    const error = `SCP failed with code ${code}. Error: ${errorOutput}`;
                    console.error(error);
                    reject(new Error(error));
                }
            });
            
            child.on('error', (error: any) => { 
                console.error('SCP process error:', error);
                reject(error); 
            });
        });
    }

    private async startRemoteServer(): Promise<void> {
        try {
            // Kill any existing server processes
            console.log('Stopping any existing server processes...');
            await this.execCommand('export PATH="/opt/nodejs/bin:$PATH" && pkill -f "node.*server.js" 2>/dev/null || true');
            
            // Wait a moment for processes to die
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Start server
            console.log('Starting AIX remote server...');
            const startCmd = 'cd ~/.aix-remote && export PATH="/opt/nodejs/bin:$PATH" && nohup node dist/server.js > server.log 2>&1 < /dev/null & echo "Server started with PID: $!"';
            const result = await this.execCommand(startCmd);
            console.log('Server start result:', result);
            
            // Give server time to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            
        } catch (error) {
            console.error('❌ Server start failed:', error);
            throw error;
        }
    }

    private async waitForServerReady(): Promise<void> {
        console.log('Waiting for server to respond...');
        
        for (let i = 0; i < 15; i++) {
            try {
                console.log(`Testing connection attempt ${i + 1}/15...`);
                await this.testServerConnection();
                console.log('🎉 Server is responding!');
                return;
            } catch (error) {
                console.log(`Attempt ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
                
                // Show server status after a few attempts
                if (i === 7) {
                    try {
                        const processCheck = await this.execCommand('ps aux | grep "node.*server.js" | grep -v grep || echo "No server process found"');
                        console.log('Server process check:', processCheck);
                        
                        const logContent = await this.execCommand('tail -5 ~/.aix-remote/server.log 2>/dev/null || echo "No log file"');
                        console.log('Server log:', logContent);
                    } catch (statusError) {
                        console.log('Could not check server status');
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        throw new Error('Server failed to respond after 15 attempts');
    }

    private async execCommand(command: string): Promise<string> {
        return this.execCommandWithTimeout(command, 30000); // Default 30s timeout
    }

    private async execCommandWithTimeout(command: string, timeoutMs: number): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.sshClient) {
                reject(new Error('No SSH connection'));
                return;
            }

            console.log(`Executing: ${command.substring(0, 50)}... (timeout: ${timeoutMs/1000}s)`);
            
            this.sshClient.exec(command, { pty: false }, (err, stream) => {
                if (err) {
                    console.error('Exec error:', err);
                    reject(err);
                    return;
                }

                let output = '';
                let errorOutput = '';
                
                stream.on('data', (data: any) => {
                    const text = data.toString();
                    output += text;
                    // Show progress for long-running commands
                    if (text.length > 0) {
                        console.log('Command output:', text.trim());
                    }
                });
                
                if (stream.stderr) {
                    stream.stderr.on('data', (data: any) => {
                        const text = data.toString();
                        errorOutput += text;
                        console.log('Command stderr:', text.trim());
                    });
                }

                stream.on('close', (code: any) => {
                    console.log(`Command finished with exit code: ${code}`);
                    
                    if (code === 0) {
                        resolve(output.trim());
                    } else {
                        const errorMsg = `Command failed with exit code ${code}. Output: ${output}, Error: ${errorOutput}`;
                        console.error(errorMsg);
                        reject(new Error(errorMsg));
                    }
                });

                stream.on('error', (streamError: any) => {
                    console.error('Stream error:', streamError);
                    reject(streamError);
                });
                
                // Custom timeout
                setTimeout(() => {
                    console.error(`Command timeout (${timeoutMs/1000}s)`);
                    reject(new Error('Command execution timeout'));
                }, timeoutMs);
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