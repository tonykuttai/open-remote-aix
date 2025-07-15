# AIX Remote Development Extension

A VS Code extension that enables seamless remote development on AIX machines with **full terminal integration**, automatic server deployment, and WebSocket-based file operations.

## ✨ Features

### 🔗 **Automatic Connection & Deployment**
- **One-click connection** to remote AIX machines via SSH
- **Automatic server deployment** using SCP for efficient file transfers
- **Smart server management** - reuses existing server if already running
- **SSH key authentication** support with automatic SSH config parsing

### 💻 **Full Terminal Integration**
- **Native AIX terminal** directly in VS Code with full PTY support
- **Interactive programs** - vi, nano, top, htop work perfectly
- **Multiple terminal sessions** - create named terminals for different tasks
- **Context-aware terminals** - right-click folders to open terminal in specific directory
- **Terminal resizing** and proper ANSI color support
- **Command history** and tab completion

### 📁 **Remote File Operations**
- **Browse remote directories** in VS Code's Explorer panel
- **Read and edit files** directly on the remote machine
- **Real-time file operations** via WebSocket communication
- **Enhanced file icons** based on file types
- **Sorted directory listings** (directories first, then alphabetical)

### 🚀 **Intelligent Deployment**
- **node-pty integration** - automatically uses existing node-pty installation on AIX
- **Graceful fallback** - works with basic terminal if node-pty unavailable
- **Selective file copying** - only deploys compiled code and package.json
- **Remote dependency installation** - runs `npm install` on target machine
- **Process lifecycle management** - start, stop, and health monitoring
- **Automatic PATH configuration** for Node.js binaries

### 🛠 **Development Experience**
- **Integrated file explorer** for remote AIX filesystem
- **Direct file editing** with syntax highlighting
- **Multiple terminal management** with proper cleanup
- **Progress indicators** and detailed logging
- **Command execution** on remote machine

## 🚀 Getting Started

### Prerequisites

- VS Code 1.74.0 or higher
- SSH access to AIX machine
- Node.js installed on AIX machine (typically at `/opt/nodejs/bin/`)
- SSH key authentication configured (recommended)
- **Optional**: node-pty installed on AIX for full terminal features

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
   - Run "AIX Remote: Connect to AIX Machine"
   - Enter connection string: `username@hostname` or just `hostname`
3. **Automatic deployment** will handle the rest:
   - Creates remote directory structure
   - Copies compiled server files via SCP
   - Sets up node-pty if available
   - Installs dependencies remotely
   - Starts the WebSocket server
   - Establishes connection

4. **Use terminal and file operations**:
   - Browse files using the AIX Remote panel
   - Open terminals with "AIX Remote: Open AIX Terminal"
   - Right-click folders for context-specific terminals
   - Edit files directly in VS Code

## 🏗 Architecture

```
┌─────────────────┐    SSH + SCP     ┌─────────────────┐
│   VS Code       │ ──────────────► │   AIX Machine   │
│   Extension     │                 │                 │
│                 │    WebSocket     │   Node.js       │
│   - File Ops    │ ◄──────────────► │   Server        │
│   - Terminal    │     Port 8080    │   - File Ops    │
│   - UI          │                 │   - PTY/Terminal │
│   - SSH Client  │                 │   - Commands     │
└─────────────────┘                 └─────────────────┘
```

### Components

- **Extension Host**: VS Code extension with SSH client, terminal provider, and UI components
- **Remote Server**: Node.js WebSocket server with node-pty integration deployed automatically to AIX
- **Communication**: JSON-RPC over WebSocket for real-time operations
- **Terminal Provider**: Full pseudoterminal implementation with PTY support
- **Deployment**: SCP for file transfer, SSH for command execution

## 📋 Supported Operations

### File System Operations
- `fs.readDir` - List directory contents with enhanced metadata
- `fs.readFile` - Read file contents
- `fs.writeFile` - Write file contents
- `fs.stat` - Get file/directory statistics

### Terminal Operations
- `terminal.create` - Create new PTY-based terminal session
- `terminal.input` - Send input to terminal
- `terminal.resize` - Resize terminal dimensions
- `terminal.kill` - Terminate terminal session

### System Operations
- `terminal.exec` - Execute shell commands (legacy)
- `system.info` - Get system information including PTY support

### Server Management
- Automatic health checks
- Process lifecycle management
- Graceful error handling and recovery
- node-pty auto-detection and setup

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

### node-pty Setup

The extension automatically detects and uses node-pty installations:

1. **Preferred**: `~/utility/node-pty` (custom installation)
2. **Standard**: `node_modules/node-pty` (npm installation)
3. **Fallback**: Basic terminal without PTY features

## 🔌 Commands

### Available Commands
- `AIX Remote: Connect to AIX Machine` - Establish connection
- `AIX Remote: Disconnect from AIX Machine` - Close connection
- `AIX Remote: Open AIX Terminal` - Create new terminal
- `AIX Remote: New AIX Terminal` - Create named terminal
- `AIX Remote: Refresh` - Refresh file explorer

### Context Menu
- **Right-click folders**: "Open Terminal Here"
- **File operations**: Direct file opening from explorer

## 🐛 Troubleshooting

### Common Issues

**Server deployment fails:**
- Ensure Node.js is installed at `/opt/nodejs/bin/` on AIX
- Verify SSH key authentication is working
- Check that `npm` and `node` are in PATH

**Terminal doesn't work:**
- Check server logs: `tail -f ~/.aix-remote/server.log`
- Verify node-pty installation: `cd ~/utility/node-pty && node simple-test.js`
- Falls back to basic terminal if PTY unavailable

**Connection timeout:**
- Verify network connectivity to AIX machine
- Check firewall rules for port 8080
- Ensure WebSocket traffic is allowed

**Permission errors:**
- Verify SSH user has write access to home directory
- Check file permissions on deployed server files

### Debug Information

Check these logs for troubleshooting:
- **VS Code**: Developer Tools Console
- **AIX Server**: `~/.aix-remote/server.log`
- **Terminal Type**: Shows in terminal header (Full PTY vs Basic)

## 🔄 Development Phases

### ✅ Phase 1: Basic Connectivity
- SSH connection establishment
- Manual server deployment
- Basic WebSocket communication

### ✅ Phase 2: Auto-deployment
- Automatic server deployment via SCP
- Remote dependency installation
- Server lifecycle management
- Enhanced error handling

### ✅ Phase 3: Full Terminal Integration (Current)
- **Complete PTY support** with node-pty
- **Interactive terminal programs** (vi, top, etc.)
- **Multiple terminal management**
- **Context-aware terminal creation**
- **Terminal resizing and proper ANSI support**
- **Graceful fallback** for basic terminal functionality

### 🔮 Phase 4: Advanced Features (Planned)
- File watching and sync
- Debugging integration
- Multi-machine management
- Performance optimizations
- Terminal session persistence

## 🎯 Terminal Features

### Full PTY Mode (with node-pty)
- ✅ Interactive editors (vi, nano, emacs)
- ✅ System monitors (top, htop, iostat)
- ✅ Terminal applications (tmux, screen)
- ✅ Full ANSI color support
- ✅ Proper cursor positioning
- ✅ Terminal resizing
- ✅ Signal handling (Ctrl+C, Ctrl+Z)

### Basic Mode (fallback)
- ✅ Command execution
- ✅ Basic shell interaction
- ✅ File operations
- ❌ Limited interactive program support

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
- Verify terminal type in terminal header

---


### Recent Updates
- **v0.3.0**: Full terminal integration with node-pty support
- **v0.2.0**: Automatic server deployment and enhanced file operations
- **v0.1.0**: Basic connectivity and file browsing