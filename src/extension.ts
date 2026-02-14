import * as vscode from 'vscode';
import { ConfigManager } from './managers/ConfigManager';
import { ConnectionManager } from './managers/ConnectionManager';
import { CredentialService } from './services/CredentialService';
import { SessionReader, SSHTreeDataProvider } from './providers/SSHTreeDataProvider';
import { HelpTreeDataProvider } from './providers/HelpTreeDataProvider';
import { registerHostCommands } from './commands/hostCommands';
import { registerFolderCommands } from './commands/folderCommands';
import { HealthCheckManager } from './managers/HealthCheckManager';
import { WorkspaceSessionManager } from './managers/WorkspaceSessionManager';
import { ConnectionStatus } from './models/ConnectionState';
import { SSHFolder } from './models/SSHFolder';
import { SSHHost } from './models/SSHHost';
import { TreeNode, TreeNodeType } from './models/TreeNode';
import { TerminalWorkspacePanel } from './providers/TerminalWorkspaceViewProvider';
import { getNodeLocationPath } from './utils/treeHelpers';
import { registerSafeCommand, runSafely } from './utils/commandHelpers';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('TerminaX is now active');

  // Initialize managers
  const configManager = new ConfigManager(context);
  const credentialService = new CredentialService(context.secrets);
  const healthCheckManager = new HealthCheckManager(configManager);
  const workspaceSessionManager = new WorkspaceSessionManager(credentialService);
  context.subscriptions.push(healthCheckManager);
  context.subscriptions.push(workspaceSessionManager);
  healthCheckManager.start();

  // Initialize connection manager (needs to be created before tree provider)
  const connectionManager = new ConnectionManager(
    context,
    credentialService
  );
  context.subscriptions.push(connectionManager);

  const terminalWorkspaceProvider = new TerminalWorkspacePanel(
    context.extensionUri,
    configManager,
    workspaceSessionManager
  );
  context.subscriptions.push(terminalWorkspaceProvider);

  const sessionReader: SessionReader = {
    getTerminalCount(hostId: string): number {
      return connectionManager.getTerminalCount(hostId) + workspaceSessionManager.getSessionCount(hostId);
    },
    getSessionInfos(hostId: string): Array<{
      terminalId: string;
      hostId: string;
      createdAt: Date;
      status: ConnectionStatus;
      lastError?: string;
    }> {
      const trackedTerminalSessions = connectionManager.getSessionInfos(hostId);
      const workspaceSessions = workspaceSessionManager.getSessionInfos(hostId).map((session) => ({
        terminalId: `workspace:${session.sessionId}`,
        hostId: session.hostId,
        createdAt: session.createdAt,
        status: session.status,
        lastError: session.lastError
      }));

      return [...trackedTerminalSessions, ...workspaceSessions]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
  };

  // Initialize tree data provider
  const treeDataProvider = new SSHTreeDataProvider(
    configManager,
    connectionManager.getStateTracker(),
    healthCheckManager,
    sessionReader
  );

  // Set tree provider in connection manager
  connectionManager.setTreeProvider(treeDataProvider);

  // Register tree view with drag-and-drop support
  const treeView = vscode.window.createTreeView('terminax-hosts', {
    treeDataProvider,
    dragAndDropController: treeDataProvider,
    showCollapseAll: true,
    canSelectMany: true
  });

  context.subscriptions.push(treeView);

  const helpTreeProvider = new HelpTreeDataProvider();
  const helpView = vscode.window.createTreeView('terminax-help', {
    treeDataProvider: helpTreeProvider,
    showCollapseAll: false
  });
  context.subscriptions.push(helpView);

  // Pause/resume health checks based on view visibility
  context.subscriptions.push(
    treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        healthCheckManager.resume();
      } else {
        healthCheckManager.pause();
      }
    })
  );

  // Resume health checks if view is initially visible
  if (treeView.visible) {
    healthCheckManager.resume();
  }

  context.subscriptions.push(
    workspaceSessionManager.onDidSessionEvent((event) => {
      if (event.type === 'added' || event.type === 'updated') {
        const node = configManager.getNode(event.session.hostId);
        treeDataProvider.refresh(node);
        return;
      }

      if (event.type === 'removed') {
        const node = configManager.getNode(event.hostId);
        treeDataProvider.refresh(node);
        return;
      }

      // No tree refresh needed for plain output chunks.
    })
  );

  context.subscriptions.push(
    healthCheckManager.onDidUpdateHealth((hostId) => {
      if (!hostId) {
        treeDataProvider.refresh();
        return;
      }

      const node = configManager.getNode(hostId);
      if (node) {
        treeDataProvider.refresh(node);
        return;
      }

      treeDataProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('terminax.healthChecks.enabled') ||
        event.affectsConfiguration('terminax.healthChecks.intervalMs') ||
        event.affectsConfiguration('terminax.healthChecks.timeoutMs')
      ) {
        healthCheckManager.restartScheduler();
        runSafely('refreshHealthChecks', async () => {
          await healthCheckManager.checkAllNow();
        });
      }
    })
  );

  // Register commands
  const handleConfigMutation = (): void => {
    runSafely('refreshHealthChecks', async () => {
      await healthCheckManager.checkAllNow();
    });
  };

  // Focus a terminal for a host/session (used by session sub-tree click)
  registerSafeCommand(context, 'terminax.focusSession', async (hostId: string, terminalId?: string) => {
    if (!hostId) {
      return;
    }

    if (terminalId) {
      if (terminalId.startsWith('workspace:')) {
        const workspaceSessionId = terminalId.slice('workspace:'.length);
        await terminalWorkspaceProvider.focusHostSession(hostId, workspaceSessionId);
        return;
      }

      connectionManager.focusTerminalById(terminalId);
      return;
    }

    if (connectionManager.focusHostTerminal(hostId)) {
      return;
    }

    await terminalWorkspaceProvider.focusHostSession(hostId);
  });

  registerHostCommands(
    context,
    configManager,
    connectionManager,
    credentialService,
    treeDataProvider,
    handleConfigMutation
  );

  registerFolderCommands(
    context,
    configManager,
    credentialService,
    treeDataProvider,
    handleConfigMutation
  );

  const getNodeLocation = (node: TreeNode): string => {
    return getNodeLocationPath(node, configManager);
  };

  const getTreeSelectionHostIds = (): Set<string> => {
    const selectedHostIds = new Set<string>();

    for (const selectedNode of treeView.selection) {
      if (selectedNode.type === TreeNodeType.HOST) {
        selectedHostIds.add(selectedNode.id);
        continue;
      }

      if (selectedNode.type === TreeNodeType.SESSION && selectedNode.parentId) {
        selectedHostIds.add(selectedNode.parentId);
        continue;
      }

      if (selectedNode.type === TreeNodeType.FOLDER) {
        const hostsInFolder = configManager.getAllHostsRecursive(selectedNode.id);
        for (const host of hostsInFolder) {
          selectedHostIds.add(host.id);
        }
      }
    }

    return selectedHostIds;
  };

  const connectHosts = async (hosts: SSHHost[]): Promise<void> => {
    if (hosts.length === 0) {
      return;
    }

    if (hosts.length > 1) {
      await terminalWorkspaceProvider.connectHosts(hosts);
      vscode.window.setStatusBarMessage(
        `TerminaX: opened ${hosts.length} workspace session(s)`,
        1300
      );
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Connecting ${hosts.length} host(s)`,
        cancellable: false
      },
      async (progress) => {
        for (let i = 0; i < hosts.length; i++) {
          const host = hosts[i];
          progress.report({
            message: `Connecting ${host.label} (${i + 1}/${hosts.length})`
          });

          await connectionManager.connect(
            host,
            false,
            undefined,
            'editor'
          );
        }
      }
    );

    const action = await vscode.window.showInformationMessage(
      `Opened ${hosts.length} terminal session(s)`,
      'Enable Broadcast'
    );

    if (action === 'Enable Broadcast') {
      connectionManager.startBroadcast(hosts.map((host) => host.id));
      await vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', true);
      vscode.window.showInformationMessage(
        `Broadcast mode enabled for ${hosts.length} host(s)`
      );
    }
  };

  const getAllVisibleNodes = (): TreeNode[] => {
    const nodes: TreeNode[] = [];
    const visit = (node: TreeNode): void => {
      nodes.push(node);
      if (node.type === TreeNodeType.FOLDER) {
        const children = configManager.getChildren(node.id);
        for (const child of children) {
          visit(child);
        }
      }
    };

    const rootNodes = configManager.getRootNodes();
    for (const rootNode of rootNodes) {
      visit(rootNode);
    }

    return nodes;
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
      allHosts.map((host) => ({
        label: host.label,
        description: `${host.config.username}@${host.config.host}:${host.config.port}`,
        detail: getNodeLocation(host),
        picked: preselectedHostIds.has(host.id),
        host
      })),
      {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    if (!picks) {
      return undefined;
    }

    return picks.map((pick) => pick.host);
  };

  registerSafeCommand(context, 'terminax.startBroadcast', async (folder?: SSHFolder) => {
    const selectedHostIds = getTreeSelectionHostIds();
    const preselectedIds = selectedHostIds.size > 0
      ? selectedHostIds
      : folder
        ? new Set(configManager.getAllHostsRecursive(folder.id).map((host) => host.id))
        : new Set<string>();

    const selectedHosts = await pickHosts(
      'Select hosts to include in broadcast mode',
      preselectedIds
    );

    if (!selectedHosts || selectedHosts.length === 0) {
      vscode.window.showWarningMessage('No hosts selected for broadcast mode');
      return;
    }

    const count = connectionManager.startBroadcast(selectedHosts.map((host) => host.id));
    await vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', true);

    vscode.window.showInformationMessage(
      `Broadcast mode enabled for ${count} host(s)`
    );
  });

  registerSafeCommand(context, 'terminax.stopBroadcast', async () => {
    connectionManager.stopBroadcast();
    await vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', false);
    vscode.window.showInformationMessage('Broadcast mode disabled');
  });

  registerSafeCommand(context, 'terminax.broadcastCommand', async () => {
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

    const integratedResult = connectionManager.broadcastCommand(command);
    const payload = command.endsWith('\r') ? command : `${command}\r`;
    const workspaceSent = workspaceSessionManager.sendInputToHosts(
      connectionManager.getBroadcastHostIds(),
      payload
    );
    const totalSent = integratedResult.sent + workspaceSent;

    if (totalSent === 0) {
      vscode.window.showWarningMessage(
        'No active terminals matched the current broadcast scope'
      );
      return;
    }

    vscode.window.showInformationMessage(
      `Broadcast command sent to ${totalSent} terminal(s)`
    );
  });

  registerSafeCommand(context, 'terminax.openWorkspace', async () => {
    await terminalWorkspaceProvider.openWorkspace();
  });

  registerSafeCommand(context, 'terminax.workspaceAddHosts', async () => {
    await terminalWorkspaceProvider.addHostsFromPicker();
  });

  registerSafeCommand(context, 'terminax.workspaceDisconnectAll', async () => {
    terminalWorkspaceProvider.disconnectAll();
  });

  registerSafeCommand(context, 'terminax.workspaceEnableBroadcast', async () => {
    if (!terminalWorkspaceProvider.hasActiveWorkspace()) {
      vscode.window.showWarningMessage('No active workspace panel to enable broadcast');
      return;
    }

    await terminalWorkspaceProvider.setBroadcastEnabled(true);
    vscode.window.setStatusBarMessage('TerminaX: workspace broadcast enabled', 1300);
  });

  registerSafeCommand(context, 'terminax.workspaceDisableBroadcast', async () => {
    if (!terminalWorkspaceProvider.hasActiveWorkspace()) {
      vscode.window.showWarningMessage('No active workspace panel to disable broadcast');
      return;
    }

    await terminalWorkspaceProvider.setBroadcastEnabled(false);
    vscode.window.setStatusBarMessage('TerminaX: workspace broadcast disabled', 1300);
  });

  registerSafeCommand(context, 'terminax.workspaceToggleBroadcast', async () => {
    if (!terminalWorkspaceProvider.hasActiveWorkspace()) {
      vscode.window.showWarningMessage('No active workspace panel to toggle broadcast');
      return;
    }

    const enabled = await terminalWorkspaceProvider.toggleBroadcast();
    vscode.window.setStatusBarMessage(
      enabled
        ? 'TerminaX: workspace broadcast enabled'
        : 'TerminaX: workspace broadcast disabled',
      1300
    );
  });

  // Connect to multiple hosts at once (supports hosts across different folders)
  registerSafeCommand(context, 'terminax.connectMultiple', async (folder?: SSHFolder) => {
    const selectedHostIds = getTreeSelectionHostIds();
    if (selectedHostIds.size > 0) {
      const selectedHosts = Array.from(selectedHostIds)
        .map((hostId) => configManager.getHost(hostId))
        .filter((host): host is SSHHost => host !== undefined);

      if (selectedHosts.length === 0) {
        vscode.window.showWarningMessage('No valid hosts selected to connect');
        return;
      }

      await connectHosts(selectedHosts);
      return;
    }

    const preselectedIds = folder
      ? new Set(configManager.getAllHostsRecursive(folder.id).map((host) => host.id))
      : new Set<string>();

    const selectedHosts = await pickHosts(
      'Select hosts to connect',
      preselectedIds
    );

    if (!selectedHosts || selectedHosts.length === 0) {
      return;
    }

    await connectHosts(selectedHosts);
  });

  // Search in tree (hosts + folders) and reveal selected item
  registerSafeCommand(context, 'terminax.searchTree', async () => {
    const nodes = getAllVisibleNodes();
    if (nodes.length === 0) {
      vscode.window.showWarningMessage('No hosts or folders to search');
      return;
    }

    const selection = await vscode.window.showQuickPick(
      nodes.map((node) => {
        if (node.type === TreeNodeType.HOST) {
          const host = node as SSHHost;
          return {
            label: host.label,
            description: `${host.config.username}@${host.config.host}:${host.config.port}`,
            detail: getNodeLocation(host),
            node
          };
        }

        const folderNode = node as SSHFolder;
        return {
          label: folderNode.label,
          description: `${configManager.getChildren(folderNode.id).length} item(s)`,
          detail: getNodeLocation(folderNode),
          node
        };
      }),
      {
        placeHolder: 'Search hosts or folders',
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    if (!selection) {
      return;
    }

    await treeView.reveal(selection.node, {
      select: true,
      focus: true,
      expand: true
    });
  });

  registerSafeCommand(context, 'terminax.openHelp', async () => {
    const helpUri = vscode.Uri.joinPath(context.extensionUri, 'docs', 'HELP.md');
    await vscode.commands.executeCommand('markdown.showPreview', helpUri);
  });

  registerSafeCommand(context, 'terminax.openReadme', async () => {
    const readmeUri = vscode.Uri.joinPath(context.extensionUri, 'README.md');
    await vscode.commands.executeCommand('markdown.showPreview', readmeUri);
  });

  registerSafeCommand(context, 'terminax.refresh', async () => {
    treeDataProvider.refresh();
    await healthCheckManager.checkAllNow();
  });

  runSafely('setBroadcastContext', async () => {
    await vscode.commands.executeCommand('setContext', 'terminax.broadcastActive', false);
  });
  runSafely('setWorkspaceBroadcastContext', async () => {
    await vscode.commands.executeCommand('setContext', 'terminax.workspaceBroadcastActive', false);
  });

  runSafely('openDefaultWorkspace', async () => {
    await terminalWorkspaceProvider.reveal(true);
  });

  registerSafeCommand(context, 'terminax.exportConfig', async () => {
    const config = configManager.exportConfig();

    const uri = await vscode.window.showSaveDialog({
      filters: { jsonFiles: ['json'] },
      defaultUri: vscode.Uri.file('terminax-config.json')
    });

    if (!uri) {
      return;
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(config, 'utf8'));
    vscode.window.showInformationMessage('Configuration exported successfully');
  });

  registerSafeCommand(context, 'terminax.importConfig', async () => {
    const uris = await vscode.window.showOpenDialog({
      filters: { jsonFiles: ['json'] },
      canSelectMany: false
    });

    if (!uris || !uris[0]) {
      return;
    }

    const content = await vscode.workspace.fs.readFile(uris[0]);
    const configJson = Buffer.from(content).toString('utf8');

    await configManager.importConfig(configJson);
    treeDataProvider.refresh();
    await healthCheckManager.checkAllNow();

    vscode.window.showInformationMessage('Configuration imported successfully');
  });

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get('terminax.hasShownWelcome', false);
  if (!hasShownWelcome) {
    void vscode.window.showInformationMessage(
      'Welcome to TerminaX! Add your first SSH host to get started.',
      'Add Host'
    ).then((selection) => {
      if (selection === 'Add Host') {
        runSafely('addHostFromWelcome', async () => {
          await vscode.commands.executeCommand('terminax.addHost');
        });
      }
    });

    runSafely('updateWelcomeState', async () => {
      await context.globalState.update('terminax.hasShownWelcome', true);
    });
  }
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log('TerminaX is now deactivated');
}
