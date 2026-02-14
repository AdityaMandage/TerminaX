import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a UUID
 */
export function generateUUID(): string {
  return uuidv4();
}

/**
 * Validate hostname or IP address
 */
export function isValidHostname(hostname: string): boolean {
  if (!hostname) {
    return false;
  }

  // Strip surrounding brackets for IPv6 like [::1]
  let normalized = hostname;
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }

  // Check if it's an IPv4 address
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(normalized)) {
    const parts = normalized.split('.');
    return parts.every(part => parseInt(part) >= 0 && parseInt(part) <= 255);
  }

  // Check if it's an IPv6 address (simplified check)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$|^::([0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{1,4}:){1,6}:$|^::$/;
  if (ipv6Pattern.test(normalized)) {
    return true;
  }

  // Check if it's a valid hostname
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return hostnamePattern.test(normalized);
}

/**
 * Validate port number
 */
export function isValidPort(port: string | number): boolean {
  const portNum = typeof port === 'string' ? parseInt(port) : port;
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}
