import * as vscode from 'vscode';
import { SSHHost } from '../models/SSHHost';
import {
  ConnectionMetadata,
  ConnectionStatus,
  ConnectionStateTracker
} from '../models/ConnectionState';
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
  private treeProvider?: SSHTreeDataProvider;
  private terminalStatuses: Map<string, ConnectionStatus> = new Map();
  private hostLastError: Map<string, string> = new Map();
  private broadcastHostIds: Set<string> = new Set();
  private broadcastActive: boolean = false;

  constructor(
    private context: vscode.ExtensionContext,
    private credentialService: CredentialService,
    treeProvider?: SSHTreeDataProvider
  ) {
    this.terminalManager = new TerminalManager();
    this.stateTracker = new ConnectionStateTracker();
    this.treeProvider = treeProvider;

    // Listen to terminal lifecycle events
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal(terminal => {
        this.handleTerminalClose(terminal);
      })
    );
  }

  /**
   * Set tree provider after construction (avoids circular dependency hacks)
   */
  setTreeProvider(treeProvider: SSHTreeDataProvider): void {
    this.treeProvider = treeProvider;
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
        iconPath: new vscode.ThemeIcon('server'),
        location: vscode.TerminalLocation.Panel
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
      this.terminalStatuses.set(terminalId, ConnectionStatus.DISCONNECTED);

      // Show terminal and bring to focus
      terminal.show(false);

      // For non-split, bring panel to focus and maximize workspace area
      if (!splitTerminal) {
        await this.focusAndMaximizeTerminalPanel();
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
    metadata?: ConnectionMetadata
  ): void {
    this.terminalStatuses.set(terminalId, status);

    if (metadata?.error) {
      this.hostLastError.set(hostId, metadata.error);
    }

    this.recomputeHostState(hostId);
  }

  /**
   * Handle terminal close event
   */
  private handleTerminalClose(terminal: vscode.Terminal): void {
    const terminalId = this.terminalManager.getTerminalId(terminal);
    if (terminalId) {
      const info = this.terminalManager.getTerminalInfo(terminalId);
      if (info) {
        this.terminalStatuses.delete(terminalId);
        this.terminalManager.removeTerminal(terminalId);
        this.recomputeHostState(info.hostId);
      }
    }
  }

  /**
   * Recompute host-level state from all active terminal sessions
   */
  private recomputeHostState(hostId: string): void {
    const terminalIds = this.terminalManager.getTerminalIdsByHost(hostId);

    if (terminalIds.length === 0) {
      this.stateTracker.updateState(hostId, ConnectionStatus.DISCONNECTED, {
        terminalId: null
      });
      this.hostLastError.delete(hostId);
      this.refreshTree();
      return;
    }

    const statuses = terminalIds.map(
      terminalId => this.terminalStatuses.get(terminalId) || ConnectionStatus.DISCONNECTED
    );

    const connectedTerminalId = terminalIds.find(
      terminalId => this.terminalStatuses.get(terminalId) === ConnectionStatus.CONNECTED
    );

    if (connectedTerminalId) {
      this.stateTracker.updateState(hostId, ConnectionStatus.CONNECTED, {
        terminalId: connectedTerminalId
      });
      this.refreshTree();
      return;
    }

    if (statuses.includes(ConnectionStatus.ERROR)) {
      this.stateTracker.updateState(hostId, ConnectionStatus.ERROR, {
        terminalId: terminalIds[0],
        error: this.hostLastError.get(hostId) || 'Connection error'
      });
      this.refreshTree();
      return;
    }

    this.stateTracker.updateState(hostId, ConnectionStatus.DISCONNECTED, {
      terminalId: terminalIds[0]
    });
    this.refreshTree();
  }

  /**
   * Focus and maximize terminal panel for better default visibility
   */
  private async focusAndMaximizeTerminalPanel(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    } catch {
      // Keep going if panel positioning command is unavailable.
    }
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.focus');
    } catch {
      // Focus command should be present, but avoid failing connection setup on command errors.
    }

    // Prefer non-toggle maximize command so behavior is deterministic per connect.
    try {
      await vscode.commands.executeCommand('workbench.action.maximizePanel');
    } catch {
      // Fallback for VSCode builds that only expose toggle.
      try {
        await vscode.commands.executeCommand('workbench.action.toggleMaximizedPanel');
      } catch {
        // Keep focus behavior only if maximize command is unavailable.
      }
    }
  }

  private refreshTree(): void {
    this.treeProvider?.refresh();
  }

  /**
   * Enable broadcast mode for a set of hosts
   */
  startBroadcast(hostIds: string[]): number {
    this.broadcastHostIds = new Set(hostIds);
    this.broadcastActive = this.broadcastHostIds.size > 0;
    return this.broadcastHostIds.size;
  }

  /**
   * Disable broadcast mode
   */
  stopBroadcast(): void {
    this.broadcastHostIds.clear();
    this.broadcastActive = false;
  }

  /**
   * Check whether broadcast mode is active
   */
  isBroadcastActive(): boolean {
    return this.broadcastActive;
  }

  /**
   * Send a command to all active terminals in broadcast scope
   */
  broadcastCommand(command: string): { sent: number } {
    if (!this.broadcastActive || this.broadcastHostIds.size === 0) {
      return { sent: 0 };
    }

    const payload = command.endsWith('\n') ? command : `${command}\n`;
    let sent = 0;

    for (const hostId of this.broadcastHostIds) {
      const terminals = this.terminalManager.getTerminalInfosByHost(hostId);
      for (const terminalInfo of terminals) {
        terminalInfo.pty.handleInput(payload);
        sent += 1;
      }
    }

    return { sent };
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
