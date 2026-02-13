/**
 * Connection status for SSH hosts
 */
export enum ConnectionStatus {
  /** No active session or cleanly exited */
  DISCONNECTED = 'disconnected',

  /** Active SSH session */
  CONNECTED = 'connected',

  /** Session terminated unexpectedly */
  ERROR = 'error'
}

/**
 * Connection state tracking for a host
 */
export interface ConnectionState {
  /** Host ID this state belongs to */
  hostId: string;

  /** Current connection status */
  status: ConnectionStatus;

  /** Terminal ID if connected */
  terminalId: string | null;

  /** When the connection was established */
  connectedAt?: Date;

  /** When the connection was closed */
  disconnectedAt?: Date;

  /** Last error message if status is ERROR */
  lastError?: string;

  /** Exit code from the SSH session */
  exitCode?: number;
}

/**
 * Tracks connection states for all hosts
 */
export class ConnectionStateTracker {
  private states: Map<string, ConnectionState> = new Map();

  /**
   * Update the connection state for a host
   */
  updateState(
    hostId: string,
    status: ConnectionStatus,
    metadata?: {
      terminalId?: string | null;
      exitCode?: number;
      error?: string;
    }
  ): void {
    const existing = this.states.get(hostId);

    const state: ConnectionState = {
      hostId,
      status,
      terminalId: metadata?.terminalId !== undefined ? metadata.terminalId : (existing?.terminalId || null),
      connectedAt: status === ConnectionStatus.CONNECTED ? new Date() : existing?.connectedAt,
      disconnectedAt: status !== ConnectionStatus.CONNECTED ? new Date() : undefined,
      lastError: metadata?.error,
      exitCode: metadata?.exitCode
    };

    this.states.set(hostId, state);
  }

  /**
   * Get the connection state for a host
   */
  getState(hostId: string): ConnectionState | undefined {
    return this.states.get(hostId);
  }

  /**
   * Get all hosts with active connections
   */
  getAllActive(): ConnectionState[] {
    return Array.from(this.states.values()).filter(
      state => state.status === ConnectionStatus.CONNECTED
    );
  }

  /**
   * Clear the state for a host
   */
  clearState(hostId: string): void {
    this.states.delete(hostId);
  }

  /**
   * Clear all states
   */
  clearAll(): void {
    this.states.clear();
  }
}
