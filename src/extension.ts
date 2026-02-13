import * as vscode from 'vscode';
import { ConfigManager } from './managers/ConfigManager';
import { ConnectionManager } from './managers/ConnectionManager';
import { CredentialService } from './services/CredentialService';
import { SSHTreeDataProvider } from './providers/SSHTreeDataProvider';
import { registerHostCommands } from './commands/hostCommands';
import { registerFolderCommands } from './commands/folderCommands';

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
    credentialService,
    // Tree provider will be set later
    null as any
  );

  // Initialize tree data provider
  const treeDataProvider = new SSHTreeDataProvider(
    configManager,
    connectionManager.getStateTracker()
  );

  // Set tree provider in connection manager (circular dependency workaround)
  (connectionManager as any).treeProvider = treeDataProvider;

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
    treeDataProvider
  );

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.refresh', () => {
      treeDataProvider.refresh();
      vscode.window.showInformationMessage('TerminaX tree refreshed');
    })
  );

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
