import * as vscode from 'vscode';
import { SSHPseudoTerminal } from '../providers/SSHPseudoTerminal';

/**
 * Information about a tracked terminal
 */
export interface TerminalInfo {
  /** Unique terminal ID */
  terminalId: string;

  /** VSCode terminal instance */
  terminal: vscode.Terminal;

  /** Associated host ID */
  hostId: string;

  /** Pseudoterminal instance */
  pty: SSHPseudoTerminal;

  /** When the terminal was created */
  createdAt: Date;
}

/**
 * Manages all SSH terminal instances
 */
export class TerminalManager {
  private terminals: Map<string, TerminalInfo> = new Map();
  private terminalsByHost: Map<string, Set<string>> = new Map();

  /**
   * Add a terminal to tracking
   */
  addTerminal(
    terminalId: string,
    terminal: vscode.Terminal,
    hostId: string,
    pty: SSHPseudoTerminal
  ): void {
    const info: TerminalInfo = {
      terminalId,
      terminal,
      hostId,
      pty,
      createdAt: new Date()
    };

    this.terminals.set(terminalId, info);

    // Add to host mapping
    if (!this.terminalsByHost.has(hostId)) {
      this.terminalsByHost.set(hostId, new Set());
    }
    this.terminalsByHost.get(hostId)!.add(terminalId);
  }

  /**
   * Remove a terminal from tracking
   */
  removeTerminal(terminalId: string): void {
    const info = this.terminals.get(terminalId);
    if (info) {
      // Remove from host mapping
      const hostTerminals = this.terminalsByHost.get(info.hostId);
      if (hostTerminals) {
        hostTerminals.delete(terminalId);
        if (hostTerminals.size === 0) {
          this.terminalsByHost.delete(info.hostId);
        }
      }

      this.terminals.delete(terminalId);
    }
  }

  /**
   * Get all terminals for a specific host
   */
  getTerminalsByHost(hostId: string): vscode.Terminal[] {
    const terminalIds = this.terminalsByHost.get(hostId);
    if (!terminalIds) {
      return [];
    }

    return Array.from(terminalIds)
      .map(id => this.terminals.get(id))
      .filter((info): info is TerminalInfo => info !== undefined)
      .map(info => info.terminal);
  }

  /**
   * Get terminal IDs for a specific host
   */
  getTerminalIdsByHost(hostId: string): string[] {
    const terminalIds = this.terminalsByHost.get(hostId);
    return terminalIds ? Array.from(terminalIds) : [];
  }

  /**
   * Get full terminal info objects for a specific host
   */
  getTerminalInfosByHost(hostId: string): TerminalInfo[] {
    return this.getTerminalIdsByHost(hostId)
      .map(id => this.terminals.get(id))
      .filter((info): info is TerminalInfo => info !== undefined);
  }

  /**
   * Get the pseudoterminal instance for a terminal ID
   */
  getPseudoTerminal(terminalId: string): SSHPseudoTerminal | undefined {
    return this.terminals.get(terminalId)?.pty;
  }

  /**
   * Get terminal ID from a VSCode terminal instance
   */
  getTerminalId(terminal: vscode.Terminal): string | undefined {
    for (const [id, info] of this.terminals) {
      if (info.terminal === terminal) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Get terminal info by ID
   */
  getTerminalInfo(terminalId: string): TerminalInfo | undefined {
    return this.terminals.get(terminalId);
  }

  /**
   * Get all tracked terminals
   */
  getAllTerminals(): TerminalInfo[] {
    return Array.from(this.terminals.values());
  }

  /**
   * Check if a host has active terminals
   */
  hasActiveTerminals(hostId: string): boolean {
    const terminals = this.terminalsByHost.get(hostId);
    return terminals !== undefined && terminals.size > 0;
  }

  /**
   * Get the count of active terminals for a host
   */
  getTerminalCount(hostId: string): number {
    return this.terminalsByHost.get(hostId)?.size || 0;
  }

  /**
   * Dispose all terminals for a host
   */
  disposeHostTerminals(hostId: string): void {
    const terminals = this.getTerminalsByHost(hostId);
    terminals.forEach(terminal => terminal.dispose());
  }

  /**
   * Dispose all terminals
   */
  disposeAll(): void {
    this.terminals.forEach(info => info.terminal.dispose());
    this.terminals.clear();
    this.terminalsByHost.clear();
  }
}
