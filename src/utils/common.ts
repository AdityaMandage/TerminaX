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

  // Check if it's an IP address
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipPattern.test(hostname)) {
    const parts = hostname.split('.');
    return parts.every(part => parseInt(part) >= 0 && parseInt(part) <= 255);
  }

  // Check if it's a valid hostname
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return hostnamePattern.test(hostname);
}

/**
 * Validate port number
 */
export function isValidPort(port: string | number): boolean {
  const portNum = typeof port === 'string' ? parseInt(port) : port;
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}
