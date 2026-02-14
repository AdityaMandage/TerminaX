/**
 * Backend health status for a host (independent of active SSH session status)
 */
export enum HostHealthStatus {
  UNKNOWN = 'unknown',
  CHECKING = 'checking',
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy'
}

/**
 * Health state snapshot for a host
 */
export interface HostHealthState {
  hostId: string;
  status: HostHealthStatus;
  checkedAt?: Date;
  latencyMs?: number;
  error?: string;
  consecutiveFailures: number;
}
