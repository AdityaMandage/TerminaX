# TerminaX Help

## Quick Actions
- `Connect`: Use the inline connect icon on a host row.
- `Connect Multiple Hosts`: Opens selected hosts directly in the custom `Terminal Workspace` split grid.
- `Start Broadcast`: Select target hosts, then send one command to all active terminals.
- `Search Hosts Tree`: Opens a top-center search picker for hosts/folders (name, IP/hostname, username, port, folder path).
- `Refresh`: Reloads tree state and triggers an immediate health probe for all configured hosts.
- `Open Terminal Workspace`: Opens a new split terminal workspace as an editor tab.

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
- `Ctrl+Alt+Shift+T` / `Cmd+Alt+Shift+T`: Open Terminal Workspace
- `Ctrl+Alt+Shift+/` / `Cmd+Alt+Shift+/`: Open Help

## Terminal Open Mode
TerminaX opens direct single-host connects in editor tabs by default. Multi-connect opens in `Terminal Workspace`.

## Workspace Tabs
- Each `Open Terminal Workspace` action creates a new workspace tab in the active editor group.
- Workspace broadcast is isolated per workspace tab.
- Workspace numbering reuses gaps (for example, if Workspace 2 is closed, the next new one becomes Workspace 2).

## Copy/Paste in Workspace
- `Ctrl+C` / `Cmd+C` copies selection when text is selected.
- `Ctrl+Shift+V`, `Ctrl+V`, `Shift+Insert`, and context-menu paste are supported.
- Multiline paste uses bracketed-paste wrapping to better preserve pasted blocks.

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
