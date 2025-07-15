import { Client as SSHClient } from 'ssh2';
import WebSocket from 'ws';
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
    error?: { code: number | string; message: string; data?: any };
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

interface PendingRequest {
    resolve: Function;
    reject: Function;
    streamHandler?: (response: RPCResponse) => void;
}

export interface TerminalSession {
    onData: (callback: (data: string) => void) => void;
    onExit: (callback: (exitCode: number, signal?: number) => void) => void;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (signal?: string) => void;
    isReady: () => boolean;
}

export interface StreamingCommandResult {
    onData: (callback: (data: string) => void) => void;
    onError: (callback: (data: string) => void) => void;
    onExit: (callback: (code: number) => void) => void;
    write: (data: string) => void;
    kill: (signal?: string) => void;
}

export class AIXRemoteManager {
    private sshClient: SSHClient | null = null;
    private wsClient: WebSocket | null = null;
    private connected: boolean = false;
    private host: string = '';
    private username: string = '';
    private requestId: number = 0;
    private pendingRequests: Map<string | number, PendingRequest> = new Map();
    private sshConfigs: Map<string, SSHConfig> = new Map();
    private serverSupportsPTY: boolean = false;
    
    // Add debug flag for cleaner logging
    private debugMode: boolean = false;

    constructor(debugMode: boolean = false) {
        this.debugMode = debugMode;
        this.loadSSHConfig();
    }

    // Debug logging methods
    private debugLog(message: string, ...args: any[]): void {
        if (this.debugMode) {
            console.log(`[AIX-DEBUG] ${message}`, ...args);
        }
    }

    private debugError(message: string, ...args: any[]): void {
        if (this.debugMode) {
            console.error(`[AIX-DEBUG-ERROR] ${message}`, ...args);
        }
    }

    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
        this.debugLog(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
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
                this.debugLog('SSH config:', { ...sshConfig, privateKey: sshConfig.privateKey ? '[PRESENT]' : '[NOT_PRESENT]' });
                
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
            this.debugLog('Could not load SSH config:', error);
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

        this.debugLog('=== Ensuring server is running ===');
        
        // Step 1: Check if server is already running
        try {
            this.debugLog('Step 1: Testing if server is already running...');
            await this.testServerConnection();
            this.debugLog('✅ Server already running and responding');
            return;
        } catch (error) {
            this.debugLog('❌ Server not running, proceeding with deployment...');
        }

        // Step 2: Deploy server files
        this.debugLog('Step 2: Deploying server files...');
        await this.deployServerFiles();

        // Step 3: Start server
        this.debugLog('Step 3: Starting server...');
        await this.startRemoteServer();

        // Step 4: Wait for server to be ready
        this.debugLog('Step 4: Waiting for server to be ready...');
        await this.waitForServerReady();

        this.debugLog('✅ Server is running and ready!');
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
            this.debugLog('Creating remote directory structure...');
            await this.execCommand('mkdir -p ~/.aix-remote');

            // Get local server paths
            const serverDistPath = path.join(__dirname, '../server/dist');
            const packageJsonPath = path.join(__dirname, '../server/package.json');
            const setupScriptPath = path.join(__dirname, '../server/setup-nodepty.js');

            // Check if local files exist
            if (!fs.existsSync(serverDistPath)) {
                throw new Error(`Server dist not found at: ${serverDistPath}. Run 'npm run build' in server directory first.`);
            }

            if (!fs.existsSync(packageJsonPath)) {
                throw new Error(`Server package.json not found at: ${packageJsonPath}.`);
            }

            // Use SCP to copy files
            this.debugLog('Copying dist folder via SCP...');
            await this.scpCopy(serverDistPath, `${this.username}@${this.host}:~/.aix-remote/`);

            this.debugLog('Copying package.json via SCP...');
            await this.scpCopy(packageJsonPath, `${this.username}@${this.host}:~/.aix-remote/`);

            if (fs.existsSync(setupScriptPath)) {
                this.debugLog('Copying setup script via SCP...');
                await this.scpCopy(setupScriptPath, `${this.username}@${this.host}:~/.aix-remote/`);
            }

            // Install dependencies remotely
            this.debugLog('Installing dependencies on remote machine...');
            await this.execCommandWithTimeout('cd ~/.aix-remote && export PATH="/opt/nodejs/bin:$PATH" && npm install --production', 120000);

            // Install the code command
            this.debugLog('Setting up code command...');
            await this.setupCodeCommand();

            this.debugLog('✅ Server files deployed successfully');

        } catch (error) {
            console.error('❌ Server deployment failed:', error);
            throw error;
        }
    }

private async setupCodeCommand(): Promise<void> {
        const codeScript = `#!/usr/bin/env node

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: code <file|directory> [file2] ...');
    console.log('Opens files or directories in VS Code editor');
    console.log('  code file.txt     - Opens file in current window');
    console.log('  code .            - Opens current directory as workspace');
    console.log('  code /path/dir    - Opens directory as workspace');
    console.log('  code -n file.txt  - Opens file in new window');
    process.exit(args[0] === '--help' ? 0 : 1);
}

// Parse command line options
let newWindow = false;
let targetArgs = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--new-window') {
        newWindow = true;
    } else if (args[i] === '-r' || args[i] === '--reuse-window') {
        newWindow = false;
    } else {
        targetArgs.push(args[i]);
    }
}

if (targetArgs.length === 0) {
    console.log('No files or directories specified');
    process.exit(1);
}

const ws = new WebSocket('ws://localhost:8080');

// Force exit after 3 seconds regardless of what happens
setTimeout(() => {
    ws.close();
    process.exit(0);
}, 3000);

ws.on('open', () => {
    try {
        for (let i = 0; i < targetArgs.length; i++) {
            const target = targetArgs[i];
            const targetPath = path.resolve(target);
            
            // Check if target is a directory or file
            let isDirectory = false;
            try {
                const stats = fs.statSync(targetPath);
                isDirectory = stats.isDirectory();
            } catch (error) {
                // If stat fails, treat as file (might not exist yet)
                isDirectory = false;
            }
            
            const message = {
                jsonrpc: '2.0',
                method: isDirectory ? 'vscode.openWorkspace' : 'vscode.openFile',
                params: { 
                    filePath: targetPath,
                    isDirectory: isDirectory,
                    newWindow: newWindow || isDirectory, // Always open directories in new window
                    options: {
                        newWindow: newWindow || isDirectory,
                        wait: false
                    }
                },
                id: \`code_\${Date.now()}_\${i}\`
            };
            
            ws.send(JSON.stringify(message));
        }
        
        // Give a brief moment for messages to be sent, then exit
        setTimeout(() => {
            ws.close();
            process.exit(0);
        }, 500);
        
    } catch (error) {
        ws.close();
        process.exit(0);
    }
});

ws.on('error', () => {
    process.exit(0);
});

ws.on('close', () => {
    process.exit(0);
});`;

        try {
            // Ensure the directory exists first
            await this.execCommand('mkdir -p ~/.aix-remote');
            
            // Remove old script if it exists to avoid conflicts
            await this.execCommand('rm -f ~/.aix-remote/code');
            
            // Create the code command script using a more reliable method
            const tempFile = `/tmp/code_script_${Date.now()}`;
            
            // Write the script to a temporary location
            await this.execCommand(`cat > ${tempFile} << 'SCRIPT_EOF'
${codeScript}
SCRIPT_EOF`);
            
            // Move it to the final location and make it executable
            await this.execCommand(`mv ${tempFile} ~/.aix-remote/code`);
            await this.execCommand('chmod +x ~/.aix-remote/code');
            
            // Verify the file was created
            const verifyResult = await this.execCommand('ls -la ~/.aix-remote/code');
            this.debugLog('Code script verification:', verifyResult);
            
            // Test that it's executable (but don't wait for response)
            try {
                const testResult = await this.execCommand('timeout 3 ~/.aix-remote/code --help || true');
                this.debugLog('Code script test:', testResult);
            } catch (testError) {
                this.debugLog('Code script test completed');
            }
            
            // Create additional PATH setup
            await this.execCommand('mkdir -p ~/bin');
            await this.execCommand('ln -sf ~/.aix-remote/code ~/bin/code 2>/dev/null || true');

            // Add to PATH in multiple shell configs (only if not already present)
            const pathSetup = `
# AIX Remote Code Command Setup
if [[ ":$PATH:" != *":$HOME/.aix-remote:"* ]]; then
    export PATH="$HOME/.aix-remote:$PATH"
fi
if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
    export PATH="$HOME/bin:$PATH"
fi
`;

            // Check if already added to avoid duplicates
            await this.execCommand(`grep -q "AIX Remote Code Command Setup" ~/.bashrc || echo '${pathSetup}' >> ~/.bashrc`);
            await this.execCommand(`grep -q "AIX Remote Code Command Setup" ~/.profile || echo '${pathSetup}' >> ~/.profile`);
            await this.execCommand(`grep -q "AIX Remote Code Command Setup" ~/.bash_profile 2>/dev/null || echo '${pathSetup}' >> ~/.bash_profile || true`);
            
            // Create alias as backup (only if not already present)
            await this.execCommand(`grep -q "alias code=" ~/.bashrc || echo "alias code='~/.aix-remote/code'" >> ~/.bashrc`);
            
            this.debugLog('✅ Code command setup completed');

        } catch (error) {
            console.error('❌ Failed to setup code command:', error);
            throw error;
        }
    }

    private async scpCopy(localPath: string, remotePath: string): Promise<void> {
        const { spawn } = require('child_process');
        
        return new Promise((resolve, reject) => {
            // Build SCP command
            const scpArgs = ['-r', '-o', 'StrictHostKeyChecking=no', localPath, remotePath];
            
            this.debugLog(`Running: scp ${scpArgs.join(' ')}`);
            
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
                    this.debugLog(`SCP completed successfully for ${localPath}`);
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
            this.debugLog('Stopping any existing server processes...');
            await this.execCommand('export PATH="/opt/nodejs/bin:$PATH" && pkill -f "node.*server.js" 2>/dev/null || true');
            
            // Wait a moment for processes to die
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Setup node-pty if available
            this.debugLog('Setting up node-pty...');
            await this.execCommand('cd ~/.aix-remote && export PATH="/opt/nodejs/bin:$PATH" && node setup-nodepty.js || echo "node-pty setup skipped"');
            
            // Start server
            this.debugLog('Starting AIX remote server...');
            const startCmd = 'cd ~/.aix-remote && export PATH="/opt/nodejs/bin:$PATH" && nohup node dist/server.js > server.log 2>&1 < /dev/null & echo "Server started with PID: $!"';
            const result = await this.execCommand(startCmd);
            this.debugLog('Server start result:', result);
            
            // Give server time to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            
        } catch (error) {
            console.error('❌ Server start failed:', error);
            throw error;
        }
    }

    private async waitForServerReady(): Promise<void> {
        this.debugLog('Waiting for server to respond...');
        
        for (let i = 0; i < 15; i++) {
            try {
                this.debugLog(`Testing connection attempt ${i + 1}/15...`);
                await this.testServerConnection();
                this.debugLog('🎉 Server is responding!');
                return;
            } catch (error) {
                this.debugLog(`Attempt ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
                
                // Show server status after a few attempts
                if (i === 7) {
                    try {
                        const processCheck = await this.execCommand('ps aux | grep "node.*server.js" | grep -v grep || echo "No server process found"');
                        this.debugLog('Server process check:', processCheck);
                        
                        const logContent = await this.execCommand('tail -5 ~/.aix-remote/server.log 2>/dev/null || echo "No log file"');
                        this.debugLog('Server log:', logContent);
                    } catch (statusError) {
                        this.debugLog('Could not check server status');
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

            this.debugLog(`Executing: ${command.substring(0, 50)}... (timeout: ${timeoutMs/1000}s)`);
            
            this.sshClient.exec(command, { pty: false }, (err, stream) => {
                if (err) {
                    this.debugError('Exec error:', err);
                    reject(err);
                    return;
                }

                let output = '';
                let errorOutput = '';
                
                stream.on('data', (data: any) => {
                    const text = data.toString();
                    output += text;
                    // Show progress for long-running commands (only in debug mode)
                    if (text.length > 0 && this.debugMode) {
                        this.debugLog('Command output:', text.trim());
                    }
                });
                
                if (stream.stderr) {
                    stream.stderr.on('data', (data: any) => {
                        const text = data.toString();
                        errorOutput += text;
                        if (this.debugMode) {
                            this.debugLog('Command stderr:', text.trim());
                        }
                    });
                }

                stream.on('close', (code: any) => {
                    this.debugLog(`Command finished with exit code: ${code}`);
                    
                    if (code === 0) {
                        resolve(output.trim());
                    } else {
                        const errorMsg = `Command failed with exit code ${code}. Output: ${output}, Error: ${errorOutput}`;
                        this.debugError(errorMsg);
                        reject(new Error(errorMsg));
                    }
                });

                stream.on('error', (streamError: any) => {
                    this.debugError('Stream error:', streamError);
                    reject(streamError);
                });
                
                // Custom timeout
                setTimeout(() => {
                    this.debugError(`Command timeout (${timeoutMs/1000}s)`);
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
            this.debugLog('Direct connection failed, trying SSH tunnel...');
            await this.connectWebSocketTunnel();
        }
    }

    private async connectWebSocketDirect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.debugLog(`Trying direct WebSocket connection to ${this.host}:8080`);
            
            this.wsClient = new WebSocket(`ws://${this.host}:8080`);

            this.wsClient.on('open', () => {
                this.debugLog('Direct WebSocket connection established');
                resolve();
            });

            this.wsClient.on('message', (data: WebSocket.Data) => {
                try {
                    const response: RPCResponse = JSON.parse(data.toString());
                    this.handleResponse(response);
                } catch (error) {
                    this.debugError('Failed to parse WebSocket message:', error);
                }
            });

            this.wsClient.on('error', (error: any) => {
                reject(error);
            });

            this.wsClient.on('close', () => {
                this.debugLog('WebSocket connection closed');
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

            this.debugLog('Creating SSH tunnel for WebSocket...');
            
            this.sshClient.forwardOut('127.0.0.1', 0, '127.0.0.1', 8080, (err: any, stream: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.wsClient = new WebSocket('ws://127.0.0.1:8080', {
                    createConnection: () => stream
                });

                this.wsClient.on('open', () => {
                    this.debugLog('Tunneled WebSocket connection established');
                    resolve();
                });

                this.wsClient.on('message', (data: WebSocket.Data) => {
                    try {
                        const response: RPCResponse = JSON.parse(data.toString());
                        this.handleResponse(response);
                    } catch (error) {
                        this.debugError('Failed to parse WebSocket message:', error);
                    }
                });

                this.wsClient.on('error', (error: any) => {
                    reject(error);
                });

                this.wsClient.on('close', () => {
                    this.debugLog('Tunneled WebSocket connection closed');
                    this.connected = false;
                });
            });
        });
    }

    private handleResponse(response: RPCResponse) {
        if (response.id === 'welcome') {
            this.debugLog('Received welcome message:', response.result);
            if (response.result && response.result.ptySupported !== undefined) {
                this.serverSupportsPTY = response.result.ptySupported;
                this.debugLog(`Server PTY support: ${this.serverSupportsPTY ? 'Yes' : 'No'}`);
            }
            return;
        }

        // Handle file opening requests from terminal
        if ((response as any).method === 'vscode.openFile') {
            this.handleFileOpenRequest(response as any);
            return;
        }

        if (response.id === null) {
            return;
        }

        const pending = this.pendingRequests.get(response.id);
        if (pending) {
            if (pending.streamHandler) {
                pending.streamHandler(response);
                if (response.result && (response.result.type === 'exit' || response.error)) {
                    this.pendingRequests.delete(response.id);
                }
            } else {
                this.pendingRequests.delete(response.id);

                if (response.error) {
                    // Create a more specific error with the original error details
                    let errorMessage = response.error.message || 'Unknown server error';

                    // Log the full error for debugging
                    this.debugError('Server error response:', response.error);

                    // Create appropriate error based on the error code/message
                    const error = new Error(errorMessage);
                    (error as any).code = response.error.code;
                    (error as any).data = response.error.data;

                    // Map common server errors to more specific client errors
                    if (response.error.code === 'ENOENT' || errorMessage.includes('ENOENT') ||
                        errorMessage.includes('not found') || errorMessage.includes('No such file')) {
                        const notFoundError = new Error(`File not found: ${errorMessage}`);
                        (notFoundError as any).code = 'ENOENT';
                        pending.reject(notFoundError);
                    } else {
                        pending.reject(error);
                    }
                } else {
                    pending.resolve(response.result);
                }
            }
        } else {
            // Log unhandled responses for debugging
            this.debugLog('Received response for unknown request ID:', response.id, response);
        }
    }

    private async handleFileOpenRequest(request: any): Promise<void> {
        try {
            const { filePath, options, isDirectory } = request.params || {};
            if (!filePath) {
                console.error('File open request missing filePath');
                return;
            }

            this.debugLog(`Attempting to open ${isDirectory ? 'workspace' : 'file'}: ${filePath}`);

            // Import vscode dynamically to avoid circular dependencies
            const vscode = await import('vscode');
            
            if (isDirectory) {
                // Handle directory/workspace opening
                await this.handleWorkspaceOpen(filePath, options, vscode);
            } else {
                // Handle file opening
                await this.handleFileOpen(filePath, options, vscode);
            }
            
        } catch (error) {
            console.error('Failed to open in VS Code:', error);
            
            // Send error response back if this was a request with an ID
            if (request.id) {
                const errorResponse = {
                    jsonrpc: '2.0',
                    error: { code: -1, message: error instanceof Error ? error.message : 'Unknown error' },
                    id: request.id
                };
                
                if (this.wsClient) {
                    this.wsClient.send(JSON.stringify(errorResponse));
                }
            }
        }
    }

    private async handleWorkspaceOpen(workspacePath: string, options: any, vscode: any): Promise<void> {
        try {
            // Verify the directory exists
            const stat = await this.getStat(workspacePath);
            if (!stat.isDirectory) {
                throw new Error(`${workspacePath} is not a directory`);
            }

            // Create workspace URI
            const workspaceUri = vscode.Uri.parse(`aixremote:${workspacePath}`);
            
            this.debugLog(`Opening workspace: ${workspacePath}`);

            // Open workspace in new window
            await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, {
                forceNewWindow: options?.newWindow !== false // Default to new window for workspaces
            });

            console.log(`✅ Opened workspace in VS Code: ${workspacePath}`);

        } catch (error) {
            console.error(`Failed to open workspace ${workspacePath}:`, error);
            throw error;
        }
    }

    private async handleFileOpen(filePath: string, options: any, vscode: any): Promise<void> {
        try {
            // Create URI for the remote file
            const uri = vscode.Uri.parse(`aixremote:${filePath}`);
            
            // Check if file exists on remote, if not create it
            try {
                await this.getStat(filePath);
                this.debugLog(`File ${filePath} exists on remote`);
            } catch (error) {
                this.debugLog(`File ${filePath} doesn't exist, creating it...`);
                try {
                    // Create empty file on remote
                    await this.writeFile(filePath, '');
                    this.debugLog(`Created empty file: ${filePath}`);
                } catch (createError) {
                    console.error(`Failed to create file ${filePath}:`, createError);
                    // Continue anyway, let VS Code handle it
                }
            }
            
            // Open the file in VS Code
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, {
                preview: !options?.wait,
                viewColumn: options?.newWindow ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active
            });
            
            console.log(`✅ Opened file in VS Code: ${filePath}`);

        } catch (error) {
            console.error(`Failed to open file ${filePath}:`, error);
            throw error;
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

    /**
     * Create a new terminal session with PTY support
     */
    async createTerminalSession(cwd?: string, cols: number = 80, rows: number = 24): Promise<TerminalSession> {
        if (!this.wsClient || !this.connected) {
            throw new Error('Not connected to AIX machine');
        }

        const id = ++this.requestId;
        const message: RPCMessage = {
            jsonrpc: '2.0',
            method: 'terminal.create',
            params: { cwd: cwd || this.getDefaultPath(), cols, rows },
            id
        };

        const callbacks = {
            onData: [] as ((data: string) => void)[],
            onExit: [] as ((exitCode: number, signal?: number) => void)[]
        };

        let ready = false;

        // Set up streaming response handler
        const streamHandler = (response: RPCResponse) => {
            if (response.result) {
                const { type, data, exitCode, signal } = response.result;
                switch (type) {
                    case 'ready':
                        ready = true;
                        break;
                    case 'data':
                        callbacks.onData.forEach(cb => cb(data));
                        break;
                    case 'exit':
                        callbacks.onExit.forEach(cb => cb(exitCode, signal));
                        break;
                }
            }
        };

        // Store stream handler
        this.pendingRequests.set(id, { 
            resolve: () => {}, 
            reject: () => {},
            streamHandler 
        });

        // Send terminal creation request
        this.wsClient.send(JSON.stringify(message));

        return {
            onData: (callback: (data: string) => void) => {
                callbacks.onData.push(callback);
            },
            onExit: (callback: (exitCode: number, signal?: number) => void) => {
                callbacks.onExit.push(callback);
            },
            write: (data: string) => {
                const inputMessage: RPCMessage = {
                    jsonrpc: '2.0',
                    method: 'terminal.input',
                    params: { sessionId: id, data },
                    id: `${id}_input`
                };
                this.wsClient!.send(JSON.stringify(inputMessage));
            },
            resize: (cols: number, rows: number) => {
                const resizeMessage: RPCMessage = {
                    jsonrpc: '2.0',
                    method: 'terminal.resize',
                    params: { sessionId: id, cols, rows },
                    id: `${id}_resize`
                };
                this.wsClient!.send(JSON.stringify(resizeMessage));
            },
            kill: (signal: string = 'SIGTERM') => {
                const killMessage: RPCMessage = {
                    jsonrpc: '2.0',
                    method: 'terminal.kill',
                    params: { sessionId: id, signal },
                    id: `${id}_kill`
                };
                this.wsClient!.send(JSON.stringify(killMessage));
            },
            isReady: () => ready
        };
    }

    /**
     * Execute a command with streaming output for terminal use (legacy support)
     */
    async executeCommandStreaming(command: string, cwd?: string): Promise<StreamingCommandResult> {
        // For backward compatibility, we'll create a terminal session and run the command
        const terminal = await this.createTerminalSession(cwd);
        
        const callbacks = {
            onData: [] as ((data: string) => void)[],
            onError: [] as ((data: string) => void)[],
            onExit: [] as ((code: number) => void)[]
        };

        terminal.onData((data) => {
            callbacks.onData.forEach(cb => cb(data));
        });

        terminal.onExit((exitCode) => {
            callbacks.onExit.forEach(cb => cb(exitCode));
        });

        // Execute the command
        setTimeout(() => {
            terminal.write(command + '\n');
        }, 100);

        return {
            onData: (callback: (data: string) => void) => {
                callbacks.onData.push(callback);
            },
            onError: (callback: (data: string) => void) => {
                callbacks.onError.push(callback);
            },
            onExit: (callback: (code: number) => void) => {
                callbacks.onExit.push(callback);
            },
            write: (data: string) => {
                terminal.write(data);
            },
            kill: (signal: string = 'SIGTERM') => {
                terminal.kill(signal);
            }
        };
    }

    async openFileInVSCode(filePath: string, options?: any): Promise<boolean> {
        try {
            // Send request to remote server to ensure file exists/create it
            let fileExists = true;
            try {
                await this.getStat(filePath);
            } catch (statError) {
                // File doesn't exist on remote, create it
                fileExists = false;
                await this.writeFile(filePath, ''); // Create empty file on remote
            }

            // Now request the server to tell VS Code to open the file
            const result = await this.sendRequest('vscode.openFile', { filePath, options });
            
            if (!result || !result.success) {
                throw new Error(result?.error || 'Unknown error opening file');
            }
            
            return true;
        } catch (error) {
            console.error('Failed to open file in VS Code:', error);
            if (error instanceof Error) {
                const vscode = await import('vscode');
                vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
            }
            return false;
        }
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
        this.debugLog(`Getting stat for: ${path}`);
        try {
            const result = await this.sendRequest('fs.stat', { path });
            this.debugLog(`✅ Stat result for ${path}:`, result);
            return result;
        } catch (error) {
            this.debugError(`❌ Stat error for ${path}:`, error);
            
            // Re-throw with more specific error information
            if (error instanceof Error) {
                if (error.message.includes('ENOENT') || error.message.includes('not found')) {
                    const notFoundError = new Error(`File not found: ${path}`);
                    (notFoundError as any).code = 'ENOENT';
                    throw notFoundError;
                }
            }
            
            throw error;
        }
    }

    async executeCommand(command: string, cwd?: string): Promise<any> {
        return this.sendRequest('terminal.exec', { command, cwd });
    }

    async getSystemInfo(): Promise<any> {
        return this.sendRequest('system.info');
    }

    /**
     * Debug: Check what's happening on the server
     */
    async debugServerStatus(): Promise<void> {
        if (!this.sshClient) {
            throw new Error('No SSH connection');
        }

        try {
            console.log('=== Server Debug Information ===');
            
            // Check server process
            const processInfo = await this.execCommand('ps aux | grep "node.*server.js" | grep -v grep || echo "No server process"');
            console.log('Server process:', processInfo);
            
            // Check port status
            const portInfo = await this.execCommand('netstat -an | grep 8080 || echo "Port 8080 not found"');
            console.log('Port 8080 status:', portInfo);
            
            // Check server logs (last 20 lines)
            const logs = await this.execCommand('tail -20 ~/.aix-remote/server.log 2>/dev/null || echo "No server logs"');
            console.log('Recent server logs:', logs);
            
            // Check if server is responsive
            try {
                await this.testServerConnection();
                console.log('✅ Server is responsive');
            } catch (error) {
                console.log('❌ Server is not responsive:', error);
            }
            
            // Check WebSocket connection status
            console.log('WebSocket connection status:', this.wsClient?.readyState);
            console.log('Connected status:', this.connected);
            
            // Check pending requests
            console.log('Pending requests count:', this.pendingRequests.size);
            if (this.pendingRequests.size > 0) {
                console.log('Pending request IDs:', Array.from(this.pendingRequests.keys()));
            }
            
        } catch (error) {
            console.error('Debug failed:', error);
        }
    }

    /**
     * Force kill and restart server completely
     */
    async forceKillAndRestartServer(): Promise<void> {
        if (!this.sshClient) {
            throw new Error('No SSH connection');
        }

        console.log('=== Force Kill and Restart Server ===');
        
        try {
            // Disconnect WebSocket first
            if (this.wsClient) {
                this.wsClient.close();
                this.wsClient = null;
            }
            this.connected = false;
            
            // Clear pending requests
            this.pendingRequests.clear();
            
            // Force kill everything
            console.log('Force killing all server processes...');
            await this.execCommand('pkill -9 -f "node.*server.js" || true');
            await this.execCommand('fuser -k 8080/tcp 2>/dev/null || true');
            
            // Wait for processes to die
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check if anything is still running
            const remaining = await this.execCommand('ps aux | grep "node.*server.js" | grep -v grep || echo "No processes"');
            console.log('Remaining processes:', remaining);
            
            // Start fresh server
            console.log('Starting fresh server...');
            await this.startRemoteServer();
            
            // Wait for server to be ready
            await this.waitForServerReady();
            
            // Reconnect WebSocket
            await this.connectWebSocket();
            this.connected = true;
            
            console.log('✅ Server force restarted successfully');
            
        } catch (error) {
            console.error('❌ Force restart failed:', error);
            throw error;
        }
    }

    /**
     * Redeploy and restart server (for code updates)
     */
    async redeployServer(): Promise<void> {
        if (!this.sshClient) {
            throw new Error('No SSH connection');
        }

        console.log('=== Redeploying Server ===');
        
        // Disconnect WebSocket first
        if (this.wsClient) {
            this.wsClient.close();
            this.wsClient = null;
        }
        
        this.connected = false;
        
        try {
            // Force stop server
            await this.execCommand('pkill -9 -f "node.*server.js" || true');
            
            // Deploy new files
            await this.deployServerFiles();
            
            // Start server
            await this.startRemoteServer();
            
            // Wait for ready
            await this.waitForServerReady();
            
            // Reconnect WebSocket
            await this.connectWebSocket();
            
            this.connected = true;
            
            console.log('✅ Server redeployed successfully');
            
        } catch (error) {
            console.error('❌ Server redeploy failed:', error);
            throw error;
        }
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

    supportsFullTerminal(): boolean {
        return this.serverSupportsPTY;
    }
}