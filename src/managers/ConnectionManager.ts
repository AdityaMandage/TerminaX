import * as vscode from 'vscode';
import { SSHHost } from '../models/SSHHost';
import { ConnectionStatus, ConnectionStateTracker } from '../models/ConnectionState';
import { SSHPseudoTerminal } from '../providers/SSHPseudoTerminal';
import { TerminalManager } from './TerminalManager';
import { CredentialService } from '../services/CredentialService';
import { SSHTreeDataProvider } from '../providers/SSHTreeDataProvider';

/**
 * Manages SSH connections and their lifecycle
 */
export class ConnectionManager {
  public terminalManager: TerminalManager;
  private stateTracker: ConnectionStateTracker;

  constructor(
    private context: vscode.ExtensionContext,
    private credentialService: CredentialService,
    private treeProvider: SSHTreeDataProvider
  ) {
    this.terminalManager = new TerminalManager();
    this.stateTracker = new ConnectionStateTracker();

    // Listen to terminal lifecycle events
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal(terminal => {
        this.handleTerminalClose(terminal);
      })
    );
  }

  /**
   * Connect to an SSH host
   */
  async connect(host: SSHHost, splitTerminal: boolean = false): Promise<void> {
    try {
      // Generate unique terminal ID
      const terminalId = `terminax-${host.id}-${Date.now()}`;

      // Create pseudoterminal with status callback
      const pty = new SSHPseudoTerminal(
        host,
        this.credentialService,
        terminalId,
        (status, metadata) => {
          this.handleStatusUpdate(host.id, terminalId, status, metadata);
        }
      );

      // Create VSCode terminal with optional split location
      const terminalOptions: vscode.ExtensionTerminalOptions = {
        name: `SSH: ${host.label}`,
        pty,
        iconPath: new vscode.ThemeIcon('server')
      };

      // If split terminal, create it beside the active terminal
      if (splitTerminal && vscode.window.activeTerminal) {
        terminalOptions.location = {
          parentTerminal: vscode.window.activeTerminal
        };
      }

      const terminal = vscode.window.createTerminal(terminalOptions);

      // Register with terminal manager
      this.terminalManager.addTerminal(terminalId, terminal, host.id, pty);

      // Show terminal and bring to focus
      terminal.show(true); // true = preserve focus, but we want to take focus

      // For non-split, try to maximize the terminal panel
      if (!splitTerminal) {
        // Send command to show terminal in fullscreen
        await vscode.commands.executeCommand('workbench.action.terminal.focus');
      }

    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to connect to ${host.label}: ${error}`
      );
    }
  }

  /**
   * Disconnect from a host (closes all terminals for that host)
   */
  disconnect(hostId: string): void {
    this.terminalManager.disposeHostTerminals(hostId);
  }

  /**
   * Handle status updates from pseudoterminal
   */
  private handleStatusUpdate(
    hostId: string,
    terminalId: string,
    status: ConnectionStatus,
    metadata?: any
  ): void {
    // Update state tracker
    this.stateTracker.updateState(hostId, status, {
      terminalId,
      ...metadata
    });

    // Refresh tree view to update icon
    this.treeProvider.refresh();
  }

  /**
   * Handle terminal close event
   */
  private handleTerminalClose(terminal: vscode.Terminal): void {
    const terminalId = this.terminalManager.getTerminalId(terminal);
    if (terminalId) {
      const info = this.terminalManager.getTerminalInfo(terminalId);
      if (info) {
        // If no more terminals for this host, mark as disconnected
        this.terminalManager.removeTerminal(terminalId);

        if (!this.terminalManager.hasActiveTerminals(info.hostId)) {
          this.stateTracker.updateState(info.hostId, ConnectionStatus.DISCONNECTED);
          this.treeProvider.refresh();
        }
      }
    }
  }

  /**
   * Get connection state for a host
   */
  getConnectionState(hostId: string) {
    return this.stateTracker.getState(hostId);
  }

  /**
   * Get all active connections
   */
  getAllActiveConnections() {
    return this.stateTracker.getAllActive();
  }

  /**
   * Get the state tracker (for tree provider)
   */
  getStateTracker(): ConnectionStateTracker {
    return this.stateTracker;
  }
}
