import * as vscode from 'vscode';
import { SSHHost, createSSHHost, AuthMethod } from '../models/SSHHost';
import { SSHFolder } from '../models/SSHFolder';
import { ConfigManager } from '../managers/ConfigManager';
import { ConnectionManager } from '../managers/ConnectionManager';
import { CredentialService } from '../services/CredentialService';
import { SSHTreeDataProvider } from '../providers/SSHTreeDataProvider';
import { registerSafeCommand } from '../utils/commandHelpers';
import { generateUUID, isValidHostname, isValidPort } from '../utils/common';

/**
 * Register all host-related commands
 */
export function registerHostCommands(
  context: vscode.ExtensionContext,
  configManager: ConfigManager,
  connectionManager: ConnectionManager,
  credentialService: CredentialService,
  treeProvider: SSHTreeDataProvider,
  onConfigChanged?: () => void
): void {

  // Add new host
  registerSafeCommand(context, 'terminax.addHost', async () => {
    const host = await promptForHostConfig();
    if (!host) {
      return;
    }

    await configManager.addNode(host);
    treeProvider.refresh();
    onConfigChanged?.();

    vscode.window.showInformationMessage(`Host "${host.label}" added successfully`);
  });

  // Add new host to a specific folder
  registerSafeCommand(context, 'terminax.addHostInFolder', async (folder?: SSHFolder) => {
    const host = await promptForHostConfig();
    if (!host) {
      return;
    }

    if (folder) {
      host.parentId = folder.id;
    }

    await configManager.addNode(host);
    treeProvider.refresh();
    onConfigChanged?.();

    vscode.window.showInformationMessage(`Host "${host.label}" added successfully`);
  });

  // Edit host
  registerSafeCommand(context, 'terminax.editHost', async (host: SSHHost) => {
    const updated = await promptForHostConfig(host);
    if (!updated) {
      return;
    }

    await configManager.updateNode(host.id, updated);
    treeProvider.refresh();
    onConfigChanged?.();

    vscode.window.showInformationMessage(`Host "${updated.label}" updated successfully`);
  });

  // Delete host
  registerSafeCommand(context, 'terminax.deleteHost', async (host: SSHHost) => {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete "${host.label}"?`,
      { modal: true },
      'Delete'
    );

    if (confirm === 'Delete') {
      await configManager.deleteNode(host.id);
      await credentialService.deleteAllCredentials(host.id);
      treeProvider.refresh();
      onConfigChanged?.();

      vscode.window.showInformationMessage(`Host "${host.label}" deleted`);
    }
  });

  // Connect to host
  registerSafeCommand(context, 'terminax.connect', async (host: SSHHost) => {
    await connectionManager.connect(host);
  });

  // Disconnect from host
  registerSafeCommand(context, 'terminax.disconnect', async (host: SSHHost) => {
    connectionManager.disconnect(host.id);
    vscode.window.showInformationMessage(`Disconnected from "${host.label}"`);
  });
}

/**
 * Prompt user for host configuration (multi-step input)
 */
async function promptForHostConfig(existing?: SSHHost): Promise<SSHHost | undefined> {
  const terminaxConfig = vscode.workspace.getConfiguration('terminax');
  const defaultKeepaliveInterval = terminaxConfig.get<number>('keepaliveInterval', 30000);
  const defaultKeepaliveCountMax = terminaxConfig.get<number>('keepaliveCountMax', 3);

  // Step 1: Label
  const label = await vscode.window.showInputBox({
    prompt: 'Enter host name',
    placeHolder: 'Production Server',
    value: existing?.label,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Host name is required';
      }
      return undefined;
    }
  });

  if (!label) {
    return undefined;
  }

  // Step 2: Hostname
  const hostnameInput = await vscode.window.showInputBox({
    prompt: 'Enter hostname, IP address, or SSH config host alias',
    placeHolder: '192.168.1.100, example.com, or my-prod-host',
    value: existing?.config.host,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Hostname is required';
      }
      const normalized = value.trim();
      const isAlias = /^[a-zA-Z0-9._-]+$/.test(normalized);
      if (!isValidHostname(normalized) && !isAlias) {
        return 'Invalid hostname/IP or SSH config host alias';
      }
      return undefined;
    }
  });

  if (!hostnameInput) {
    return undefined;
  }
  const hostname = hostnameInput.trim();

  // Step 3: Auth method
  const authMethodPick = await vscode.window.showQuickPick(
    [
      { label: 'Password', value: 'password' as AuthMethod },
      { label: 'SSH Key', value: 'keyfile' as AuthMethod },
      { label: 'SSH Agent', value: 'agent' as AuthMethod },
      {
        label: 'OpenSSH Config (ssh <host>)',
        value: 'openssh' as AuthMethod,
        description: 'Use local ~/.ssh/config settings like IdentityFile/CertificateFile'
      }
    ],
    {
      placeHolder: 'Select authentication method'
    }
  );

  if (!authMethodPick) {
    return undefined;
  }

  const authMethod = authMethodPick.value;
  let finalUsername = existing?.config.username || process.env.USER || process.env.USERNAME || 'root';
  let port = existing?.config.port || 22;
  let privateKeyPath: string | undefined;

  if (authMethod !== 'openssh') {
    // Step 4: Username (optional, defaults to current OS user)
    const username = await vscode.window.showInputBox({
      prompt: 'Enter username (leave empty for current user)',
      placeHolder: process.env.USER || process.env.USERNAME || 'ubuntu',
      value: existing?.config.username,
      ignoreFocusOut: true
    });

    if (username === undefined) {
      return undefined;
    }

    finalUsername = username.trim() || process.env.USER || process.env.USERNAME || 'root';

    // Step 5: Port
    const portInput = await vscode.window.showInputBox({
      prompt: 'Enter SSH port',
      placeHolder: '22',
      value: existing?.config.port.toString() || '22',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!isValidPort(value)) {
          return 'Port must be between 1 and 65535';
        }
        return undefined;
      }
    });

    if (!portInput) {
      return undefined;
    }

    port = parseInt(portInput, 10);
  } else {
    finalUsername = existing?.config.username || 'ssh-config';
    port = existing?.config.port || 22;
  }

  // Step 6: Get key path if using keyfile auth
  if (authMethod === 'keyfile') {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select SSH Private Key',
      filters: {
        sshKeys: ['pem', 'key', 'ppk'],
        allFiles: ['*']
      }
    });

    if (!fileUris || fileUris.length === 0) {
      return undefined;
    }

    privateKeyPath = fileUris[0].fsPath;
  }

  // Create or update host
  if (existing) {
    return {
      ...existing,
      label: label.trim(),
      config: {
        ...existing.config,
        host: hostname,
        username: finalUsername,
        port,
        authMethod,
        privateKeyPath: authMethod === 'keyfile' ? privateKeyPath : undefined,
        keepaliveInterval: existing.config.keepaliveInterval ?? defaultKeepaliveInterval,
        keepaliveCountMax: existing.config.keepaliveCountMax ?? defaultKeepaliveCountMax
      }
    };
  } else {
    const host = createSSHHost(
      generateUUID(),
      label.trim(),
      hostname,
      finalUsername,
      null,
      port,
      authMethod
    );
    if (privateKeyPath) {
      host.config.privateKeyPath = privateKeyPath;
    }
    host.config.keepaliveInterval = defaultKeepaliveInterval;
    host.config.keepaliveCountMax = defaultKeepaliveCountMax;
    return host;
  }
}
