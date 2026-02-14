# TerminaX

Advanced SSH connection management for Visual Studio Code with enterprise-grade features.

## Overview

TerminaX provides comprehensive SSH session management directly within VS Code, featuring hierarchical host organization, secure credential storage, multi-session terminals, and broadcast command execution across multiple hosts simultaneously.

## Download

Download the latest packaged extension (VSIX) from GitHub Releases:
[terminax-1.0.0.vsix](https://github.com/AdityaMandage/TerminaX/releases/latest/download/terminax-1.0.0.vsix)

To install, open VS Code, run the command palette `Extensions: Install from VSIX...`, and select the downloaded file.

## Features

### Core Functionality

- **Hierarchical Host Organization** - Organize SSH hosts into folders and nested subfolders for logical grouping
- **Visual Connection Status** - Real-time indicators showing connection state (connected, disconnected, error)
- **Multiple Concurrent Sessions** - Connect to the same host multiple times with independent terminal sessions
- **Secure Credential Storage** - Passwords and passphrases stored securely using OS-native keychain integration

### Advanced Features

#### Terminal Workspace
Multi-pane terminal workspace with split-screen layout for managing multiple SSH sessions simultaneously:
- Automatic grid layout (1-3 columns based on session count)
- Independent terminal panes with xterm.js rendering
- Per-workspace broadcast mode
- Copy/paste support with bracketed-paste for multi-line content
- Real-time status indicators per session

#### Broadcast Mode
ClusterSSH-style command broadcasting for executing commands across multiple terminals:
- Send commands to selected hosts simultaneously
- Works with both integrated terminals and workspace sessions
- Scope selection via host picker or folder selection
- Independent broadcast control per workspace

#### Health Monitoring
Background TCP health checks for all configured hosts:
- Non-intrusive port accessibility probes
- Configurable check interval and timeout
- Visual health indicators in tree view
- No impact on active terminal sessions

### Authentication Methods

- **Password Authentication** - Standard SSH password with optional secure storage
- **SSH Key Authentication** - Private key file support with optional passphrase
- **SSH Agent** - Integration with running SSH agent via `SSH_AUTH_SOCK`

## Installation

### From Source

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Press `F5` in VS Code to launch Extension Development Host

## Usage

### Adding Hosts

1. Click the TerminaX icon in the Activity Bar
2. Click the **+** button or use `Ctrl+Alt+Shift+H` / `Cmd+Alt+Shift+H`
3. Provide the following information:
   - **Host Name**: Friendly identifier (e.g., "Production Server")
   - **Hostname/IP**: Server address (supports IPv4, IPv6, and DNS names)
   - **Username**: SSH username
   - **Port**: SSH port (default: 22)
   - **Authentication Method**: Password, SSH Key, or SSH Agent

### Connecting to Hosts

**Single Connection:**
- Click on a host in the tree view
- Or right-click and select "Connect"

**Multiple Connections:**
- Select multiple hosts using `Ctrl+Click` / `Cmd+Click`
- Click "Connect Multiple Hosts" or use `Ctrl+Alt+Shift+C` / `Cmd+Alt+Shift+C`
- Hosts open in the Terminal Workspace with split-screen layout

### Using Broadcast Mode

1. Select target hosts or folder
2. Execute `TerminaX: Start Broadcast` or use `Ctrl+Alt+Shift+B` / `Cmd+Alt+Shift+B`
3. Enter command when prompted
4. Command executes on all active terminals in broadcast scope
5. Use `Ctrl+Alt+Shift+X` / `Cmd+Alt+Shift+X` to stop broadcast

### Organizing Hosts

**Create Folders:**
- Click the folder icon or use `Ctrl+Alt+Shift+N` / `Cmd+Alt+Shift+N`
- Folders can be nested for hierarchical organization

**Reorganize:**
- Drag hosts or folders to move them
- Drop on folders to nest items
- Drag within the same level to reorder

**Folder Operations:**
- Right-click folder for context menu
- "Connect Multiple Hosts" to open all hosts in folder
- "Start Broadcast" to broadcast to folder's hosts

### Configuration Import/Export

**Export Configuration:**
- Execute `TerminaX: Export Configuration`
- Saves host configurations to JSON file
- Credentials are excluded for security

**Import Configuration:**
- Execute `TerminaX: Import Configuration`
- Select JSON file to import
- Creates backup of existing configuration before import

## Configuration

Settings are available under `File > Preferences > Settings > Extensions > TerminaX`:

### Connection Settings

- `terminax.keepaliveInterval` (default: `30000`)
  - SSH keepalive interval in milliseconds
  - Prevents idle connection timeouts

- `terminax.keepaliveCountMax` (default: `3`)
  - Maximum keepalive attempts before considering connection dead

- `terminax.terminalScrollback` (default: `1000`)
  - Terminal scrollback buffer size

### Health Check Settings

- `terminax.healthChecks.enabled` (default: `true`)
  - Enable background health monitoring

- `terminax.healthChecks.intervalMs` (default: `60000`)
  - Interval between health checks in milliseconds

- `terminax.healthChecks.timeoutMs` (default: `5000`)
  - Timeout for each health probe in milliseconds

## Keyboard Shortcuts

All shortcuts are scoped to the TerminaX hosts view:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+Shift+C` / `Cmd+Alt+Shift+C` | Connect Multiple Hosts |
| `Ctrl+Alt+Shift+F` / `Cmd+Alt+Shift+F` | Search Hosts Tree |
| `Ctrl+Alt+Shift+H` / `Cmd+Alt+Shift+H` | Add Host |
| `Ctrl+Alt+Shift+N` / `Cmd+Alt+Shift+N` | Add Folder |
| `Ctrl+Alt+Shift+B` / `Cmd+Alt+Shift+B` | Start Broadcast |
| `Ctrl+Alt+Shift+X` / `Cmd+Alt+Shift+X` | Stop Broadcast |
| `Ctrl+Alt+Shift+T` / `Cmd+Alt+Shift+T` | Open Terminal Workspace |
| `Ctrl+Alt+Shift+/` / `Cmd+Alt+Shift+/` | Open Help |

## Commands

Available via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `TerminaX: Add SSH Host` - Add new SSH host
- `TerminaX: Add Folder` - Create new folder
- `TerminaX: Edit Host` - Modify host configuration
- `TerminaX: Delete Host` - Remove host
- `TerminaX: Connect` - Connect to host
- `TerminaX: Connect Multiple Hosts` - Multi-host connection
- `TerminaX: Disconnect` - Close host connections
- `TerminaX: Start Broadcast` - Enable broadcast mode
- `TerminaX: Stop Broadcast` - Disable broadcast mode
- `TerminaX: Send Broadcast Command` - Execute broadcast command
- `TerminaX: Open Terminal Workspace` - Open workspace panel
- `TerminaX: Search Hosts Tree` - Search hosts and folders
- `TerminaX: Refresh` - Refresh tree and run health checks
- `TerminaX: Export Configuration` - Export to JSON
- `TerminaX: Import Configuration` - Import from JSON
- `TerminaX: Open Help` - Show help documentation

## Security

### Credential Storage

- Passwords and passphrases are stored using VS Code's `SecretStorage` API
- Storage backends:
  - **macOS**: Keychain
  - **Windows**: Credential Store
  - **Linux**: libsecret (requires `libsecret-1-dev` package)
- Credentials are automatically deleted when hosts are removed
- Export operations exclude all credentials

### SSH Key Security

- Only the file path to private keys is stored
- Key content is read at connection time and never persisted
- Encrypted keys prompt for passphrase with optional secure storage

### Network Security

- Health checks use TCP probes only (no authentication)
- All SSH connections use standard SSH2 protocol
- No credential transmission outside SSH protocol

## Terminal Workspace

The Terminal Workspace provides a dedicated webview panel for managing multiple SSH sessions:

### Layout

- Automatic grid arrangement (1, 2, or 3 columns)
- Dynamic resizing based on session count
- Individual terminal panes with independent scrollback
- Per-session status indicators and controls

### Controls

- **Session Header**: Shows hostname, status, and disconnect button
- **Terminal Pane**: Full xterm.js terminal with mouse support
- **Broadcast Toggle**: Enable/disable workspace-wide broadcast
- **Add Hosts**: Add additional sessions to workspace
- **Disconnect All**: Close all workspace sessions

### Copy/Paste

- `Ctrl+C` / `Cmd+C`: Copy selected text
- `Ctrl+Shift+V` / `Ctrl+V`: Paste
- `Shift+Insert`: Paste (Linux/Windows)
- Right-click: Copy selection or paste
- Multi-line paste uses bracketed-paste mode

## Connection Status Indicators

- **Green Circle**: Active SSH session
- **Grey Circle**: No active session
- **Red Circle**: Connection error or failure

Status is updated in real-time based on connection events and background health checks.

## Troubleshooting

### Extension Not Activating

- Check Output panel: `View > Output > TerminaX`
- Verify VS Code version is 1.85.0 or higher
- Check extension host logs for errors

### Connection Failures

**Authentication Failed:**
- Verify username and credentials
- For key-based auth, check file permissions (should be 600)
- Ensure SSH service is running on target host

**Connection Refused:**
- Verify hostname/IP is correct
- Check SSH port (default: 22)
- Verify firewall rules allow SSH connections

**Connection Timeout:**
- Check network connectivity
- Verify host is reachable (`ping` test)
- May indicate firewall blocking SSH port

**DNS Resolution Failed:**
- Verify hostname is correct
- Check DNS configuration
- Try using IP address instead

### Password Storage Issues

**Linux:**
- Install libsecret: `sudo apt-get install libsecret-1-dev`
- Or on Fedora/RHEL: `sudo dnf install libsecret-devel`

**macOS/Windows:**
- Native keychain support, no additional setup required

### Drag-and-Drop Not Working

- Requires VS Code 1.85.0 or higher
- Try refreshing the tree view
- Check for conflicting extensions

## Platform Requirements

### Minimum Requirements

- **VS Code**: 1.85.0 or higher
- **Node.js**: 20.x or higher (for development)
- **Operating System**: Windows, macOS, or Linux

### Linux-Specific Requirements

For credential storage:
```bash
# Debian/Ubuntu
sudo apt-get install libsecret-1-dev

# Fedora/RHEL
sudo dnf install libsecret-devel

# Arch Linux
sudo pacman -S libsecret
```

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Run linter
npm run lint

# Run extension in debug mode
# Press F5 in VS Code
```

### Project Structure

```
terminax/
├── src/
│   ├── commands/        # Command implementations
│   ├── managers/        # Core logic managers
│   ├── models/          # Data models and interfaces
│   ├── providers/       # Tree and webview providers
│   ├── services/        # Credential and utility services
│   ├── utils/           # Helper functions
│   └── extension.ts     # Extension entry point
├── resources/           # Icons and static assets
├── docs/               # Documentation
└── package.json        # Extension manifest
```

## Upcoming Features

- **SFTP Browser** - Browse and transfer files directly within VS Code
- **Port Forwarding Management** - GUI for managing local and remote port forwards
- **Jump Host Support** - Connect through bastion/jump servers
- **Cloud Integration** - Import hosts from AWS, Azure, GCP
- **Session Recording** - Record and replay terminal sessions
- **Saved Command Snippets** - Store and execute frequently used commands

## License

ISC

## Contributing

Contributions are welcome. Please submit issues and pull requests via the project repository.

## Support

For issues, feature requests, or questions:
- Check the troubleshooting section above
- Review existing issues in the repository
- Submit new issues with detailed reproduction steps

---

**TerminaX** - Professional SSH management for Visual Studio Code
