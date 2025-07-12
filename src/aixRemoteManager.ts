import { Client as SSHClient } from 'ssh2';
import * as WebSocket from 'ws';

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

export class AIXRemoteManager {
    private sshClient: SSHClient | null = null;
    private wsClient: WebSocket | null = null;
    private connected: boolean = false;
    private host: string = '';
    private requestId: number = 0;
    private pendingRequests: Map<string | number, { resolve: Function; reject: Function }> = new Map();

    async connect(host: string, username: string, password?: string): Promise<void> {
        this.host = host;
        
        return new Promise((resolve, reject) => {
            this.sshClient = new SSHClient();
            
            this.sshClient.on('ready', async () => {
                console.log('SSH connection established');
                
                try {
                    // Try direct WebSocket connection first (for testing)
                    await this.connectWebSocketDirect();
                    
                    this.connected = true;
                    resolve();
                } catch (error) {
                    console.log('Direct connection failed, trying SSH tunnel...');
                    try {
                        await this.connectWebSocketTunnel();
                        this.connected = true;
                        resolve();
                    } catch (tunnelError) {
                        reject(tunnelError);
                    }
                }
            });

            this.sshClient.on('error', (error: any) => {
                console.error('SSH connection error:', error);
                reject(error);
            });

            // Connect to SSH
            const connectionConfig: any = {
                host,
                port: 22,
                username
            };

            if (password) {
                connectionConfig.password = password;
            }

            this.sshClient.connect(connectionConfig);
        });
    }

    private async connectWebSocketDirect(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`Trying direct WebSocket connection to ${this.host}:8080`);
            
            // Try direct connection to AIX server
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
                console.error('Direct WebSocket error:', error);
                reject(error);
            });

            this.wsClient.on('close', () => {
                console.log('WebSocket connection closed');
                this.connected = false;
            });

            // Set timeout for direct connection
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
            
            // Create SSH tunnel for WebSocket connection
            this.sshClient.forwardOut('127.0.0.1', 0, '127.0.0.1', 8080, (err: any, stream: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Create WebSocket connection through the tunnel
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
                    console.error('Tunneled WebSocket error:', error);
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
            
            // Set timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000); // 30 second timeout
        });
    }

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
}