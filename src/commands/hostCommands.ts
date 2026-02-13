import * as vscode from 'vscode';
import { SSHHost, createSSHHost, AuthMethod } from '../models/SSHHost';
import { SSHFolder } from '../models/SSHFolder';
import { ConfigManager } from '../managers/ConfigManager';
import { ConnectionManager } from '../managers/ConnectionManager';
import { CredentialService } from '../services/CredentialService';
import { SSHTreeDataProvider } from '../providers/SSHTreeDataProvider';
import { generateUUID, isValidHostname, isValidPort } from '../utils/common';

/**
 * Register all host-related commands
 */
export function registerHostCommands(
  context: vscode.ExtensionContext,
  configManager: ConfigManager,
  connectionManager: ConnectionManager,
  credentialService: CredentialService,
  treeProvider: SSHTreeDataProvider
): void {

  // Add new host
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.addHost', async () => {
      const host = await promptForHostConfig();
      if (!host) {
        return;
      }

      await configManager.addNode(host);
      treeProvider.refresh();

      vscode.window.showInformationMessage(`Host "${host.label}" added successfully`);
    })
  );

  // Add new host to a specific folder
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.addHostInFolder', async (folder?: SSHFolder) => {
      const host = await promptForHostConfig();
      if (!host) {
        return;
      }

      if (folder) {
        host.parentId = folder.id;
      }

      await configManager.addNode(host);
      treeProvider.refresh();

      vscode.window.showInformationMessage(`Host "${host.label}" added successfully`);
    })
  );

  // Edit host
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.editHost', async (host: SSHHost) => {
      const updated = await promptForHostConfig(host);
      if (!updated) {
        return;
      }

      await configManager.updateNode(host.id, updated);
      treeProvider.refresh();

      vscode.window.showInformationMessage(`Host "${updated.label}" updated successfully`);
    })
  );

  // Delete host
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.deleteHost', async (host: SSHHost) => {
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete "${host.label}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        await configManager.deleteNode(host.id);
        await credentialService.deleteAllCredentials(host.id);
        treeProvider.refresh();

        vscode.window.showInformationMessage(`Host "${host.label}" deleted`);
      }
    })
  );

  // Connect to host
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.connect', async (host: SSHHost) => {
      await connectionManager.connect(host);
    })
  );

  // Connect in split terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.connectSplit', async (host: SSHHost) => {
      await connectionManager.connect(host, true);
    })
  );

  // Disconnect from host
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.disconnect', async (host: SSHHost) => {
      connectionManager.disconnect(host.id);
      vscode.window.showInformationMessage(`Disconnected from "${host.label}"`);
    })
  );
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
      if (!value) {
        return 'Host name is required';
      }
      return undefined;
    }
  });

  if (!label) {
    return undefined;
  }

  // Step 2: Hostname
  const hostname = await vscode.window.showInputBox({
    prompt: 'Enter hostname or IP address',
    placeHolder: '192.168.1.100 or example.com',
    value: existing?.config.host,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value) {
        return 'Hostname is required';
      }
      if (!isValidHostname(value)) {
        return 'Invalid hostname or IP address';
      }
      return undefined;
    }
  });

  if (!hostname) {
    return undefined;
  }

  // Step 3: Username (optional, defaults to current OS user)
  const username = await vscode.window.showInputBox({
    prompt: 'Enter username (leave empty for current user)',
    placeHolder: process.env.USER || process.env.USERNAME || 'ubuntu',
    value: existing?.config.username,
    ignoreFocusOut: true
  });

  // Use current OS username if not provided
  const finalUsername = username || process.env.USER || process.env.USERNAME || 'root';

  // Step 4: Port
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

  const port = parseInt(portInput);

  // Step 5: Auth method
  const authMethodPick = await vscode.window.showQuickPick(
    [
      { label: 'Password', value: 'password' as AuthMethod },
      { label: 'SSH Key', value: 'keyfile' as AuthMethod },
      { label: 'SSH Agent', value: 'agent' as AuthMethod }
    ],
    {
      placeHolder: 'Select authentication method'
    }
  );

  if (!authMethodPick) {
    return undefined;
  }

  const authMethod = authMethodPick.value;
  let privateKeyPath: string | undefined;

  // Step 6: Get key path if using keyfile auth
  if (authMethod === 'keyfile') {
    const fileUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select SSH Private Key',
      filters: {
        'SSH Keys': ['pem', 'key', 'ppk'],
        'All Files': ['*']
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
      label,
      config: {
        ...existing.config,
        host: hostname,
        username: finalUsername,
        port,
        authMethod,
        privateKeyPath,
        keepaliveInterval: existing.config.keepaliveInterval ?? defaultKeepaliveInterval,
        keepaliveCountMax: existing.config.keepaliveCountMax ?? defaultKeepaliveCountMax
      }
    };
  } else {
    const host = createSSHHost(
      generateUUID(),
      label,
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
