import { SSHHost } from '../models/SSHHost';

export function formatHostConnectionTarget(host: SSHHost): string {
  if (host.config.authMethod === 'openssh') {
    return `ssh ${host.config.host}`;
  }

  return `${host.config.username}@${host.config.host}:${host.config.port}`;
}

export function formatHostSummary(host: SSHHost): string {
  if (host.config.authMethod === 'openssh') {
    return `OpenSSH config (${host.config.host})`;
  }

  return `${host.config.username}@${host.config.host}`;
}
