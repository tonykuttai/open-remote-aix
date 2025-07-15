# AIX Remote Development Extension

A VS Code extension for remote development on AIX machines. Provides terminal access, file browsing, and automatic server deployment over SSH.

## Features

**Terminal Integration**
- Full terminal access to AIX machines directly in VS Code
- Support for interactive programs like vi, top, and htop
- Multiple terminal sessions
- Right-click folders to open terminal in specific directory

**File Operations**
- Browse remote directories in VS Code's Explorer panel
- Edit files directly on the remote machine
- Real-time file operations over WebSocket

**Automatic Setup**
- One-click connection to AIX machines
- Automatic server deployment using SSH and SCP
- Handles Node.js path configuration automatically
- Works with existing SSH configurations

## Requirements

- VS Code 1.74.0 or higher
- SSH access to AIX machine
- Node.js installed on AIX (typically `/opt/nodejs/bin/`)
- SSH key authentication recommended

For full terminal features, node-pty should be available on the AIX machine.

## Installation

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

## Usage

1. Open VS Code and press F5 to launch the Extension Development Host
2. Open Command Palette (Ctrl+Shift+P)
3. Run "AIX Remote: Connect to AIX Machine"
4. Enter connection: `username@hostname` or just `hostname`
5. Extension will automatically deploy and start the server

Once connected:
- Browse files using the AIX Remote panel in Explorer
- Open terminals with "AIX Remote: Open AIX Terminal"
- Right-click folders for context-specific terminals
- Edit files directly in VS Code

## How It Works

The extension uses SSH to connect to your AIX machine and automatically deploys a Node.js WebSocket server. This server handles file operations and terminal sessions, communicating with VS Code over WebSocket on port 8080.

For terminals, the extension uses node-pty when available for full terminal features, or falls back to basic command execution if not available.

## Configuration

The extension reads your SSH config file automatically. Example:

```
Host aix-dev
    HostName your-aix-machine.com
    User your-username
    IdentityFile ~/.ssh/id_rsa
```

You can connect using:
- `username@hostname` - Direct connection
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

## Terminal Features

**With node-pty (full terminal):**
- Interactive editors (vi, nano)
- System monitors (top, htop)
- Full color and cursor support
- Terminal resizing
- Proper signal handling

**Without node-pty (basic terminal):**
- Command execution
- Basic shell interaction
- Limited interactive program support

## Available Commands

- `AIX Remote: Connect to AIX Machine`
- `AIX Remote: Disconnect from AIX Machine`
- `AIX Remote: Open AIX Terminal`
- `AIX Remote: New AIX Terminal`

## Troubleshooting

**Connection issues:**
- Verify SSH access: `ssh username@hostname`
- Check Node.js installation on AIX
- Ensure port 8080 is accessible

**Terminal not working:**
- Check server logs: `tail -f ~/.aix-remote/server.log`
- Verify node-pty: `cd ~/utility/node-pty && node simple-test.js`
- Extension falls back to basic terminal if needed

**File operations failing:**
- Check permissions in `~/.aix-remote/`
- Verify server is running: `ps aux | grep server.js`

## Development

The extension consists of:
- VS Code extension (TypeScript)
- Node.js server deployed to AIX
- WebSocket communication layer
- SSH deployment system

Server logs are available at `~/.aix-remote/server.log` on the AIX machine.

## License

MIT License