import * as vscode from 'vscode';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import { SSHHost } from '../models/SSHHost';
import { ConnectionStatus } from '../models/ConnectionState';
import { CredentialService } from '../services/CredentialService';

/**
 * Pseudoterminal implementation for SSH connections
 */
export class SSHPseudoTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number | void>();

  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  onDidClose?: vscode.Event<number | void> = this.closeEmitter.event;

  private client: Client | null = null;
  private stream: ClientChannel | null = null;
  private dimensions: vscode.TerminalDimensions | undefined;
  private statusCallback?: (status: ConnectionStatus, metadata?: any) => void;
  private streamClosedGracefully: boolean = false;

  constructor(
    private host: SSHHost,
    private credentialService: CredentialService,
    private terminalId: string,
    statusCallback?: (status: ConnectionStatus, metadata?: any) => void
  ) {
    this.statusCallback = statusCallback;
  }

  /**
   * Called when the terminal is opened
   */
  async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
    this.dimensions = initialDimensions;
    await this.connect();
  }

  /**
   * Called when the terminal is closed
   */
  close(): void {
    this.cleanup();
  }

  /**
   * Handle input from the user
   */
  handleInput(data: string): void {
    if (this.stream) {
      this.stream.write(data);
    }
  }

  /**
   * Handle terminal dimension changes
   */
  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.dimensions = dimensions;
    if (this.stream) {
      this.stream.setWindow(dimensions.rows, dimensions.columns, 0, 0);
    }
  }

  /**
   * Establish SSH connection
   */
  private async connect(): Promise<void> {
    try {
      this.writeEmitter.fire(`\r\n🔌 Connecting to ${this.host.config.host}...\r\n`);

      this.client = new Client();

      // Set up event handlers
      this.client.on('ready', () => this.onClientReady());
      this.client.on('error', (err) => this.handleError(err));
      this.client.on('close', () => this.onClientClose());

      // Build SSH config
      const config = await this.buildSSHConfig();

      // Connect
      this.client.connect(config);

    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Build SSH connection configuration
   */
  private async buildSSHConfig(): Promise<ConnectConfig> {
    const config: ConnectConfig = {
      host: this.host.config.host,
      port: this.host.config.port,
      username: this.host.config.username,
      keepaliveInterval: this.host.config.keepaliveInterval || 30000,
      keepaliveCountMax: this.host.config.keepaliveCountMax || 3,
      readyTimeout: 30000
    };

    // Handle authentication
    switch (this.host.config.authMethod) {
      case 'password':
        const password = await this.getPassword();
        if (password) {
          config.password = password;
        }
        break;

      case 'keyfile':
        if (this.host.config.privateKeyPath) {
          try {
            config.privateKey = fs.readFileSync(this.host.config.privateKeyPath);

            // Check if key has passphrase
            const passphrase = await this.credentialService.getPrivateKeyPassphrase(this.host.id);
            if (passphrase) {
              config.passphrase = passphrase;
            }
          } catch (error) {
            throw new Error(`Failed to read private key: ${error}`);
          }
        } else {
          throw new Error('Private key path not specified');
        }
        break;

      case 'agent':
        config.agent = process.env.SSH_AUTH_SOCK;
        if (!config.agent) {
          throw new Error('SSH agent not available (SSH_AUTH_SOCK not set)');
        }
        break;
    }

    return config;
  }

  /**
   * Get password from credential service or prompt user
   */
  private async getPassword(): Promise<string | undefined> {
    // Try to get stored password
    let password = await this.credentialService.getPassword(this.host.id);

    if (!password) {
      // Prompt user for password
      password = await vscode.window.showInputBox({
        prompt: `Enter password for ${this.host.config.username}@${this.host.config.host}`,
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'Enter your SSH password'
      });

      if (password) {
        // Ask if user wants to save password
        const save = await vscode.window.showQuickPick(['Yes', 'No'], {
          placeHolder: 'Save password securely?',
          ignoreFocusOut: true
        });

        if (save === 'Yes') {
          await this.credentialService.savePassword(this.host.id, password);
        }
      }
    }

    return password;
  }

  /**
   * Called when SSH client is ready
   */
  private onClientReady(): void {
    this.writeEmitter.fire(`✅ Connected!\r\n\r\n`);

    // Update status
    this.updateStatus(ConnectionStatus.CONNECTED);

    // Request shell
    this.client!.shell(
      {
        cols: this.dimensions?.columns || 80,
        rows: this.dimensions?.rows || 24,
        term: 'xterm-256color'
      },
      (err, stream) => {
        if (err) {
          this.handleError(err);
          return;
        }

        this.stream = stream;

        // Forward stream output to terminal
        stream.on('data', (data: Buffer) => {
          this.writeEmitter.fire(data.toString());
        });

        stream.on('close', (code?: number, signal?: string) => {
          this.onStreamClose(code, signal);
        });

        stream.stderr.on('data', (data: Buffer) => {
          this.writeEmitter.fire(data.toString());
        });
      }
    );
  }

  /**
   * Called when SSH stream closes
   */
  private onStreamClose(code?: number, signal?: string): void {
    this.streamClosedGracefully = true;

    // Exit code 0 or undefined means clean exit (user typed 'exit' or normal termination)
    if (code === 0 || code === undefined || code === null) {
      this.writeEmitter.fire(`\r\n\n✨ Connection closed\r\n`);
      this.updateStatus(ConnectionStatus.DISCONNECTED, { exitCode: 0 });
      this.closeEmitter.fire(0);
    } else {
      // Non-zero exit code means error
      this.writeEmitter.fire(`\r\n\n❌ Connection terminated (exit code: ${code})\r\n`);
      this.updateStatus(ConnectionStatus.ERROR, {
        exitCode: code,
        error: `Exit code: ${code}`
      });
      this.closeEmitter.fire(1);
    }

    this.cleanup();
  }

  /**
   * Called when SSH client closes
   */
  private onClientClose(): void {
    // If stream already closed gracefully, don't treat as error
    if (this.streamClosedGracefully) {
      return;
    }

    // Connection lost unexpectedly
    this.writeEmitter.fire(`\r\n\n⚠️  Connection lost\r\n`);
    this.updateStatus(ConnectionStatus.ERROR, { error: 'Connection lost' });
    this.closeEmitter.fire(1);
  }

  /**
   * Handle connection errors
   */
  private handleError(error: any): void {
    const errorMsg = error.message || error.toString();
    this.writeEmitter.fire(`\r\n\n❌ Error: ${errorMsg}\r\n`);

    this.updateStatus(ConnectionStatus.ERROR, { error: errorMsg });
    this.closeEmitter.fire(1);
    this.cleanup();
  }

  /**
   * Update connection status
   */
  private updateStatus(status: ConnectionStatus, metadata?: any): void {
    if (this.statusCallback) {
      this.statusCallback(status, metadata);
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }
}
