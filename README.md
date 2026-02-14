# TerminaX

Advanced SSH connection management for VSCode with MobaXterm-like features.

## Features

🌳 **Hierarchical Organization** - Organize your SSH hosts into folders and subfolders
🎯 **Visual Connection Status** - Green (connected), grey (disconnected), red (error) indicators
🔀 **Drag & Drop** - Easily reorganize hosts between folders
🖥️ **Multiple Sessions** - Connect to the same host multiple times
🔐 **Secure Storage** - Passwords stored securely in your OS keychain
⚡ **Quick Connect** - Click to connect, right-click for more options

## Getting Started

### Installation

1. Open VSCode
2. Press `F5` to open Extension Development Host
3. The TerminaX icon will appear in the Activity Bar

### Adding Your First Host

1. Click the TerminaX icon in the Activity Bar
2. Click the `+` button in the tree view
3. Enter the host details:
   - **Host Name**: A friendly name (e.g., "Production Server")
   - **Hostname/IP**: The server address (e.g., "192.168.1.100")
   - **Username**: Your SSH username
   - **Port**: SSH port (default: 22)
   - **Auth Method**: Password, SSH Key, or SSH Agent

### Connecting to a Host

**Method 1**: Click on the host in the tree view
**Method 2**: Right-click → "Connect"
**Method 3**: Right-click → "Connect in Split Terminal" for side-by-side sessions

### Organizing Hosts

**Create a Folder**:
- Click the folder icon `📁` in the tree view
- Enter a folder name (e.g., "Production", "Development")

**Move Hosts**:
- Drag a host and drop it onto a folder
- Drag to reorder items within the same folder

**Nested Folders**:
- Right-click a folder → "Add Folder" to create subfolders

### Connection Status

- 🟢 **Green circle**: Active SSH session
- ⚪ **Grey circle**: No session or cleanly exited (typed `exit`)
- 🔴 **Red circle**: Connection lost or error

## Commands

All commands are available in the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- `TerminaX: Add SSH Host` - Add a new SSH host
- `TerminaX: Add Folder` - Create a new folder
- `TerminaX: Refresh` - Refresh the tree view
- `TerminaX: Export Configuration` - Export hosts to JSON file
- `TerminaX: Import Configuration` - Import hosts from JSON file

## Context Menu Options

**Host Context Menu** (right-click on host):
- Connect
- Connect in Split Terminal
- Disconnect
- Edit Host
- Delete Host

**Folder Context Menu** (right-click on folder):
- Add SSH Host
- Add Folder
- Delete Folder

## Configuration

Settings are available under `File > Preferences > Settings > Extensions > TerminaX`:

- `terminax.keepaliveInterval`: SSH keepalive interval in milliseconds (default: 30000)
- `terminax.keepaliveCountMax`: Maximum keepalive attempts (default: 3)
- `terminax.terminalScrollback`: Terminal scrollback buffer size (default: 1000)

## Security

- **Passwords** are stored securely using VSCode's SecretStorage API (OS keychain)
- **SSH Keys** - Only the file path is stored, not the key content
- **Credentials** are automatically deleted when you delete a host

## Keyboard Shortcuts

While the tree view is focused:
- `Enter` - Connect to selected host
- `Delete` - Delete selected item (with confirmation)

## Tips

1. **Multiple Sessions**: You can connect to the same host multiple times. The tooltip shows the number of active sessions.

2. **Quick Reconnect**: If a connection fails with a red indicator, just click the host again to reconnect.

3. **Password Caching**: Choose "Yes" when prompted to save passwords for faster reconnection.

4. **SSH Agent**: For keyless authentication, use "SSH Agent" authentication method if you have an SSH agent running.

5. **Import/Export**: Backup your host configurations using Export Configuration, and share with team members (credentials are not exported for security).

## Upcoming Features

- 📡 **Broadcast Mode** - Send commands to multiple terminals simultaneously (ClusterSSH-style)
- 🚀 **SFTP Browser** - Browse remote files directly in VSCode
- 🔀 **Port Forwarding** - GUI for managing port forwards
- 🪜 **Jump Hosts** - Connect through bastion servers
- ☁️ **Cloud Integration** - Import hosts from AWS, Azure, GCP

## Troubleshooting

**Extension doesn't activate**:
- Check the Output panel (View → Output → TerminaX)
- Ensure VSCode is version 1.85.0 or higher

**Can't connect to host**:
- Verify the hostname/IP is correct
- Check that the SSH port is accessible
- Try connecting with a regular SSH client first to verify credentials

**Password not saving**:
- VSCode's SecretStorage uses your OS keychain
- On Linux, ensure `libsecret` is installed

**Drag & drop not working**:
- Ensure you're using VSCode 1.85.0 or higher
- Try refreshing the tree view

## Development

To work on this extension:

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run extension
# Press F5 in VSCode
```

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

Made with ❤️ for efficient SSH management
