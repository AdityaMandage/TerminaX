import * as net from 'net';
import * as vscode from 'vscode';
import { SSHHost } from '../models/SSHHost';
import { HostHealthState, HostHealthStatus } from '../models/HealthState';
import { ConfigManager } from './ConfigManager';

/**
 * Periodic backend health checks for hosts (TCP probe to SSH port)
 */
export class HealthCheckManager implements vscode.Disposable {
  private states: Map<string, HostHealthState> = new Map();
  private activeChecks: Set<string> = new Set();
  private intervalHandle: NodeJS.Timeout | undefined;
  private runningCheckAll = false;
  private disposed = false;

  private readonly onDidUpdateHealthEmitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidUpdateHealth = this.onDidUpdateHealthEmitter.event;

  constructor(private configManager: ConfigManager) { }

  start(): void {
    this.restartScheduler();
    void this.checkAllNow();
  }

  dispose(): void {
    this.disposed = true;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.onDidUpdateHealthEmitter.dispose();
  }

  restartScheduler(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }

    if (!this.isHealthCheckEnabled()) {
      if (this.states.size > 0) {
        this.states.clear();
        this.onDidUpdateHealthEmitter.fire(undefined);
      }
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.intervalHandle = setInterval(() => {
      void this.checkAllNow();
    }, intervalMs);
  }

  getHostHealth(hostId: string): HostHealthState | undefined {
    return this.states.get(hostId);
  }

  getAllHostHealth(): HostHealthState[] {
    return Array.from(this.states.values());
  }

  async checkHostNow(hostId: string): Promise<void> {
    const host = this.configManager.getHost(hostId);
    if (!host) {
      return;
    }

    await this.checkHost(host);
  }

  async checkAllNow(): Promise<void> {
    if (this.runningCheckAll || this.disposed || !this.isHealthCheckEnabled()) {
      return;
    }

    this.runningCheckAll = true;
    try {
      const hosts = this.configManager.getAllVisibleHosts();
      const activeIds = new Set(hosts.map(host => host.id));

      // Remove stale entries for hosts that no longer exist.
      for (const hostId of this.states.keys()) {
        if (!activeIds.has(hostId)) {
          this.states.delete(hostId);
        }
      }

      await Promise.allSettled(hosts.map(host => this.checkHost(host)));
      this.onDidUpdateHealthEmitter.fire(undefined);
    } finally {
      this.runningCheckAll = false;
    }
  }

  private async checkHost(host: SSHHost): Promise<void> {
    if (this.activeChecks.has(host.id) || this.disposed) {
      return;
    }

    this.activeChecks.add(host.id);

    const previous = this.states.get(host.id);
    this.states.set(host.id, {
      hostId: host.id,
      status: HostHealthStatus.CHECKING,
      checkedAt: previous?.checkedAt,
      latencyMs: previous?.latencyMs,
      error: previous?.error,
      consecutiveFailures: previous?.consecutiveFailures ?? 0
    });
    this.onDidUpdateHealthEmitter.fire(host.id);

    try {
      const latencyMs = await this.probeTcp(host.config.host, host.config.port, this.getTimeoutMs());
      this.states.set(host.id, {
        hostId: host.id,
        status: HostHealthStatus.HEALTHY,
        checkedAt: new Date(),
        latencyMs,
        consecutiveFailures: 0
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const previousFailures = previous?.consecutiveFailures ?? 0;

      this.states.set(host.id, {
        hostId: host.id,
        status: HostHealthStatus.UNHEALTHY,
        checkedAt: new Date(),
        error: this.normalizeHealthError(errorMsg, host),
        consecutiveFailures: previousFailures + 1
      });
    } finally {
      this.activeChecks.delete(host.id);
      this.onDidUpdateHealthEmitter.fire(host.id);
    }
  }

  private probeTcp(hostname: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finalize = (handler: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        handler();
      };

      socket.setTimeout(timeoutMs);

      socket.once('connect', () => {
        const latencyMs = Date.now() - started;
        finalize(() => resolve(latencyMs));
      });

      socket.once('timeout', () => {
        finalize(() => reject(new Error('timeout')));
      });

      socket.once('error', err => {
        finalize(() => reject(err));
      });

      socket.connect(port, hostname);
    });
  }

  private normalizeHealthError(errorMsg: string, host: SSHHost): string {
    if (/ENOTFOUND|getaddrinfo/i.test(errorMsg)) {
      return `DNS lookup failed for ${host.config.host}`;
    }

    if (/timeout|ETIMEDOUT/i.test(errorMsg)) {
      return `Health check timed out (${host.config.host}:${host.config.port})`;
    }

    if (/ECONNREFUSED|connection refused/i.test(errorMsg)) {
      return `SSH port closed/refused (${host.config.host}:${host.config.port})`;
    }

    if (/EHOSTUNREACH|ENETUNREACH|unreachable/i.test(errorMsg)) {
      return `Host/network unreachable (${host.config.host})`;
    }

    return `Unhealthy: ${errorMsg}`;
  }

  private isHealthCheckEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('terminax')
      .get<boolean>('healthChecks.enabled', true);
  }

  private getIntervalMs(): number {
    const configured = vscode.workspace
      .getConfiguration('terminax')
      .get<number>('healthChecks.intervalMs', 60000);

    return Math.max(5000, configured);
  }

  private getTimeoutMs(): number {
    const configured = vscode.workspace
      .getConfiguration('terminax')
      .get<number>('healthChecks.timeoutMs', 5000);

    return Math.max(1000, configured);
  }
}
