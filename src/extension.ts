import * as vscode from 'vscode';
import { ConfigManager } from './managers/ConfigManager';
import { ConnectionManager } from './managers/ConnectionManager';
import { CredentialService } from './services/CredentialService';
import { SSHTreeDataProvider } from './providers/SSHTreeDataProvider';
import { registerHostCommands } from './commands/hostCommands';
import { registerFolderCommands } from './commands/folderCommands';
import { SSHFolder } from './models/SSHFolder';
import { SSHHost } from './models/SSHHost';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('TerminaX is now active');

  // Initialize managers
  const configManager = new ConfigManager(context);
  const credentialService = new CredentialService(context.secrets);

  // Initialize connection manager (needs to be created before tree provider)
  const connectionManager = new ConnectionManager(
    context,
    credentialService
  );

  // Initialize tree data provider
  const treeDataProvider = new SSHTreeDataProvider(
    configManager,
    connectionManager.getStateTracker()
  );

  // Set tree provider in connection manager
  connectionManager.setTreeProvider(treeDataProvider);

  // Register tree view with drag-and-drop support
  const treeView = vscode.window.createTreeView('terminax-hosts', {
    treeDataProvider: treeDataProvider,
    dragAndDropController: treeDataProvider,
    showCollapseAll: true,
    canSelectMany: true
  });

  context.subscriptions.push(treeView);

  // Register commands
  registerHostCommands(
    context,
    configManager,
    connectionManager,
    credentialService,
    treeDataProvider
  );

  registerFolderCommands(
    context,
    configManager,
    credentialService,
    treeDataProvider
  );

  const getHostLocationPath = (host: SSHHost): string => {
    const pathParts: string[] = [];
    let currentParentId = host.parentId;

    while (currentParentId) {
      const parent = configManager.getNode(currentParentId);
      if (!parent) {
        break;
      }
      pathParts.unshift(parent.label);
      currentParentId = parent.parentId;
    }

    return pathParts.length > 0 ? pathParts.join(' / ') : 'Root';
  };

  const pickHosts = async (
    placeHolder: string,
    preselectedHostIds: Set<string> = new Set()
  ): Promise<SSHHost[] | undefined> => {
    const allHosts = configManager.getAllVisibleHosts();
    if (allHosts.length === 0) {
      vscode.window.showWarningMessage('No hosts configured');
      return undefined;
    }

    const picks = await vscode.window.showQuickPick(
      allHosts.map(host => ({
        label: host.label,
        description: `${host.config.username}@${host.config.host}:${host.config.port}`,
        detail: getHostLocationPath(host),
        picked: preselectedHostIds.has(host.id),
        host
      })),
      {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder
      }
    );

    if (!picks) {
      return undefined;
    }

    return picks.map(pick => pick.host);
  };

  // Broadcast commands
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.startBroadcast', async (folder?: SSHFolder) => {
      const preselectedIds = folder
        ? new Set(configManager.getAllHostsRecursive(folder.id).map(host => host.id))
        : new Set<string>();

      const selectedHosts = await pickHosts(
        'Select hosts to include in broadcast mode',
        preselectedIds
      );

      if (!selectedHosts || selectedHosts.length === 0) {
        vscode.window.showWarningMessage('No hosts selected for broadcast mode');
        return;
      }

      const count = connectionManager.startBroadcast(selectedHosts.map(host => host.id));
      await vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', true);

      vscode.window.showInformationMessage(
        `Broadcast mode enabled for ${count} host(s)`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.stopBroadcast', async () => {
      connectionManager.stopBroadcast();
      await vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', false);
      vscode.window.showInformationMessage('Broadcast mode disabled');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.broadcastCommand', async () => {
      if (!connectionManager.isBroadcastActive()) {
        vscode.window.showWarningMessage('Broadcast mode is not active');
        return;
      }

      const command = await vscode.window.showInputBox({
        prompt: 'Enter command to broadcast to active terminals',
        placeHolder: 'uptime',
        ignoreFocusOut: true
      });

      if (!command) {
        return;
      }

      const result = connectionManager.broadcastCommand(command);
      if (result.sent === 0) {
        vscode.window.showWarningMessage(
          'No active terminals matched the current broadcast scope'
        );
        return;
      }

      vscode.window.showInformationMessage(
        `Broadcast command sent to ${result.sent} terminal(s)`
      );
    })
  );

  // Connect to multiple hosts at once (supports hosts across different folders)
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.connectMultiple', async (folder?: SSHFolder) => {
      const preselectedIds = folder
        ? new Set(configManager.getAllHostsRecursive(folder.id).map(host => host.id))
        : new Set<string>();

      const selectedHosts = await pickHosts(
        'Select hosts to connect',
        preselectedIds
      );

      if (!selectedHosts || selectedHosts.length === 0) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting ${selectedHosts.length} host(s)`,
          cancellable: false
        },
        async (progress) => {
          for (let i = 0; i < selectedHosts.length; i++) {
            const host = selectedHosts[i];
            progress.report({
              message: `Connecting ${host.label} (${i + 1}/${selectedHosts.length})`
            });
            await connectionManager.connect(host, i > 0);
          }
        }
      );

      const action = await vscode.window.showInformationMessage(
        `Opened ${selectedHosts.length} terminal session(s)`,
        'Enable Broadcast'
      );

      if (action === 'Enable Broadcast') {
        connectionManager.startBroadcast(selectedHosts.map(host => host.id));
        await vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', true);
        vscode.window.showInformationMessage(
          `Broadcast mode enabled for ${selectedHosts.length} host(s)`
        );
      }
    })
  );

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.refresh', () => {
      treeDataProvider.refresh();
      vscode.window.showInformationMessage('TerminaX tree refreshed');
    })
  );

  // Initialize context keys
  vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', false);

  // Register export/import commands
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.exportConfig', async () => {
      const config = configManager.exportConfig();

      const uri = await vscode.window.showSaveDialog({
        filters: { 'JSON': ['json'] },
        defaultUri: vscode.Uri.file('terminax-config.json')
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(config, 'utf8'));
        vscode.window.showInformationMessage('Configuration exported successfully');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.importConfig', async () => {
      const uris = await vscode.window.showOpenDialog({
        filters: { 'JSON': ['json'] },
        canSelectMany: false
      });

      if (uris && uris[0]) {
        const content = await vscode.workspace.fs.readFile(uris[0]);
        const configJson = Buffer.from(content).toString('utf8');

        await configManager.importConfig(configJson);
        treeDataProvider.refresh();

        vscode.window.showInformationMessage('Configuration imported successfully');
      }
    })
  );

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get('terminax.hasShownWelcome', false);
  if (!hasShownWelcome) {
    vscode.window.showInformationMessage(
      'Welcome to TerminaX! Add your first SSH host to get started.',
      'Add Host'
    ).then(selection => {
      if (selection === 'Add Host') {
        vscode.commands.executeCommand('terminax.addHost');
      }
    });
    context.globalState.update('terminax.hasShownWelcome', true);
  }
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log('TerminaX is now deactivated');
}
