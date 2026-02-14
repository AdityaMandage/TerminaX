# TerminaX Help

## Quick Actions
- `Connect`: Use the inline connect icon on a host row.
- `Connect Multiple Hosts`: Use the toolbar button or command palette while the TerminaX view is focused.
- `Start Broadcast`: Select target hosts, then send one command to all active terminals.
- `Search Hosts Tree`: Opens a top-center search picker for hosts/folders (name, IP/hostname, username, port, folder path).
- `Refresh`: Reloads tree state and triggers an immediate health probe for all configured hosts.

## Multi-Select Connect
- In the TerminaX tree, hold `Ctrl` (Windows/Linux) or `Cmd` (macOS) and select multiple hosts/folders.
- Click `Connect Multiple Hosts`.
- Selected folders include all hosts under them recursively.

## Keyboard Shortcuts
Shortcuts are scoped to the TerminaX hosts view (`focusedView == terminax-hosts`).

- `Ctrl+Alt+Shift+C` / `Cmd+Alt+Shift+C`: Connect Multiple Hosts
- `Ctrl+Alt+Shift+F` / `Cmd+Alt+Shift+F`: Search Hosts Tree
- `Ctrl+Alt+Shift+H` / `Cmd+Alt+Shift+H`: Add Host
- `Ctrl+Alt+Shift+N` / `Cmd+Alt+Shift+N`: Add Folder
- `Ctrl+Alt+Shift+B` / `Cmd+Alt+Shift+B`: Start Broadcast
- `Ctrl+Alt+Shift+X` / `Cmd+Alt+Shift+X`: Stop Broadcast
- `Ctrl+Alt+Shift+/` / `Cmd+Alt+Shift+/`: Open Help

## Terminal Open Mode
Set `terminax.terminalOpenMode`:
- `panel`: opens in panel and maximizes panel for non-split connects.
- `editor`: opens in editor area tabs.

Use command `TerminaX: Set Terminal Open Mode` to switch quickly.

## Auto Layouts (Multi-Connect)
Set `terminax.multiConnectLayout`:
- `balanced`: balanced split tree for grid-like panel layout.
- `single-parent`: split all sessions from the first terminal.
- `tabs`: open as panel tabs without split panes.

Use command `TerminaX: Set Multi-Connect Layout` to change this quickly.

## Host Health Checks
TerminaX runs backend TCP checks to each host/port and updates host indicators without printing anything in terminals.

Settings:
- `terminax.healthChecks.enabled`
- `terminax.healthChecks.intervalMs`
- `terminax.healthChecks.timeoutMs`

Use `TerminaX: Refresh` for an immediate refresh.

## Connection Error Messages
TerminaX shows specific messages for common failures:
- Authentication failed
- Connection refused
- Connection timed out
- Hostname not found (DNS)
- Host/network unreachable
