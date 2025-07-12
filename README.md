# AIX Remote Development Extension

A VS Code extension that enables seamless remote development on AIX machines with automatic server deployment and WebSocket-based file operations.

## ✨ Features

### 🔗 **Automatic Connection & Deployment**
- **One-click connection** to remote AIX machines via SSH
- **Automatic server deployment** using SCP for efficient file transfers
- **Smart server management** - reuses existing server if already running
- **SSH key authentication** support with automatic SSH config parsing

### 📁 **Remote File Operations**
- **Browse remote directories** in VS Code's Explorer panel
- **Read and edit files** directly on the remote machine
- **Real-time file operations** via WebSocket communication
- **Cross-platform compatibility** - works from any OS to AIX

### 🚀 **Intelligent Deployment**
- **Selective file copying** - only deploys compiled code and package.json
- **Remote dependency installation** - runs `npm install` on target machine
- **Process lifecycle management** - start, stop, and health monitoring
- **Automatic PATH configuration** for Node.js binaries

### 🛠 **Development Experience**
- **Integrated file explorer** for remote AIX filesystem
- **Direct file editing** with syntax highlighting
- **Command execution** on remote machine
- **Progress indicators** and detailed logging

## 🚀 Getting Started

### Prerequisites

- VS Code 1.60.0 or higher
- SSH access to AIX machine
- Node.js installed on AIX machine (typically at `/opt/nodejs/bin/`)
- SSH key authentication configured (recommended)

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the server:
   ```bash
   cd server
   npm install
   npm run build
   ```
4. Compile the extension:
   ```bash
   npm run compile
   ```

### Usage

1. **Open VS Code** and press `F5` to launch the Extension Development Host
2. **Connect to AIX machine**:
   - Open Command Palette (`Ctrl+Shift+P`)
   - Run "Connect to AIX Remote"
   - Enter connection string: `username@hostname` or just `hostname`
3. **Automatic deployment** will handle the rest:
   - Creates remote directory structure
   - Copies compiled server files via SCP
   - Installs dependencies remotely
   - Starts the WebSocket server
   - Establishes connection

4. **Browse and edit files** using the AIX Remote panel in the Explorer

## 🏗 Architecture

```
┌─────────────────┐    SSH + SCP     ┌─────────────────┐
│   VS Code       │ ──────────────► │   AIX Machine   │
│   Extension     │                 │                 │
│                 │    WebSocket     │   Node.js       │
│   - File Ops    │ ◄──────────────► │   Server        │
│   - UI          │     Port 8080    │   - File Ops    │
│   - SSH Client  │                 │   - Commands    │
└─────────────────┘                 └─────────────────┘
```

### Components

- **Extension Host**: VS Code extension with SSH client and UI components
- **Remote Server**: Node.js WebSocket server deployed automatically to AIX
- **Communication**: JSON-RPC over WebSocket for real-time operations
- **Deployment**: SCP for file transfer, SSH for command execution

## 📋 Supported Operations

### File System Operations
- `fs.readDir` - List directory contents
- `fs.readFile` - Read file contents
- `fs.writeFile` - Write file contents
- `fs.stat` - Get file/directory statistics

### System Operations
- `terminal.exec` - Execute shell commands
- `system.info` - Get system information

### Server Management
- Automatic health checks
- Process lifecycle management
- Graceful error handling and recovery

## 🔧 Configuration

### SSH Configuration

The extension reads your `~/.ssh/config` file automatically. Example:

```
Host aix-dev
    HostName cpap8104.rtp.raleigh.ibm.com
    User varghese
    IdentityFile ~/.ssh/id_rsa
    Port 22
```

### Supported Connection Formats

- `username@hostname` - Explicit username and hostname
- `hostname` - Uses SSH config or current user
- `aix-dev` - SSH config alias

## 🐛 Troubleshooting

### Common Issues

**Server deployment fails:**
- Ensure Node.js is installed at `/opt/nodejs/bin/` on AIX
- Verify SSH key authentication is working
- Check that `npm` and `node` are in PATH

**Connection timeout:**
- Verify network connectivity to AIX machine
- Check firewall rules for port 8080
- Ensure WebSocket traffic is allowed

**Permission errors:**
- Verify SSH user has write access to home directory
- Check file permissions on deployed server files

### Debug Commands

The extension provides debug commands:
- `AIX Remote: Debug Directory Read` - Test directory operations
- `AIX Remote: Test Connection` - Verify WebSocket connectivity

## 🔄 Development Phases

### ✅ Phase 1: Basic Connectivity
- SSH connection establishment
- Manual server deployment
- Basic WebSocket communication

### ✅ Phase 2: Auto-deployment (Current)
- Automatic server deployment via SCP
- Remote dependency installation
- Server lifecycle management
- Enhanced error handling

### 🔮 Phase 3: Advanced Features (Planned)
- File watching and sync
- Terminal integration
- Multi-machine management
- Performance optimizations

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
- Check the troubleshooting section above
- Review VS Code Developer Tools console logs
- Check remote server logs at `~/.aix-remote/server.log`

---

**Built with ❤️ for AIX remote development**