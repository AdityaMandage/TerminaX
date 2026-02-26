import * as vscode from 'vscode';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import * as fs from 'fs/promises';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { SSHHost } from '../models/SSHHost';
import { ConnectionMetadata, ConnectionStatus } from '../models/ConnectionState';
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
  private nativeProcess: ChildProcessWithoutNullStreams | null = null;
  private dimensions: vscode.TerminalDimensions | undefined;
  private statusCallback?: (status: ConnectionStatus, metadata?: ConnectionMetadata) => void;
  private streamClosedGracefully: boolean = false;
  private isCleanedUp: boolean = false;
  private hasRetriedAuthentication: boolean = false;
  private passwordOverride?: string;
  private hasEverConnected: boolean = false;
  private hasShownErrorNotification: boolean = false;
  private streamStdoutDecoder: StringDecoder = new StringDecoder('utf8');
  private streamStderrDecoder: StringDecoder = new StringDecoder('utf8');
  private nativeStdoutDecoder: StringDecoder = new StringDecoder('utf8');
  private nativeStderrDecoder: StringDecoder = new StringDecoder('utf8');
  private openSshMarkedConnected: boolean = false;
  private openSshConnectedTimer: NodeJS.Timeout | null = null;

  constructor(
    private host: SSHHost,
    private credentialService: CredentialService,
    private terminalId: string,
    statusCallback?: (status: ConnectionStatus, metadata?: ConnectionMetadata) => void
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
      return;
    }

    if (this.nativeProcess?.stdin.writable) {
      this.nativeProcess.stdin.write(data);
    }
  }

  /**
   * Whether the SSH stream is currently active and can receive input
   */
  isStreamActive(): boolean {
    if (this.stream && !this.isCleanedUp) {
      return true;
    }

    return this.nativeProcess !== null &&
      this.nativeProcess.exitCode === null &&
      !this.isCleanedUp;
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
      this.streamClosedGracefully = false;
      this.openSshMarkedConnected = false;
      this.resetDecoders();

      if (this.host.config.authMethod === 'openssh') {
        this.connectViaOpenSshConfig();
        return;
      }

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

  private connectViaOpenSshConfig(): void {
    const extensionConfig = vscode.workspace.getConfiguration('terminax');
    const keepaliveIntervalMs =
      this.host.config.keepaliveInterval ??
      extensionConfig.get<number>('keepaliveInterval', 30000);
    const keepaliveCountMax =
      this.host.config.keepaliveCountMax ??
      extensionConfig.get<number>('keepaliveCountMax', 3);
    const keepaliveIntervalSeconds = Math.max(1, Math.round(keepaliveIntervalMs / 1000));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: this.resolveTerminalType(process.env.TERM),
      COLORTERM: process.env.COLORTERM || 'truecolor'
    };
    if (!env.LANG && process.platform !== 'win32') {
      env.LANG = 'en_US.UTF-8';
    }

    const args = [
      '-tt',
      '-o',
      'LogLevel=ERROR',
      '-o',
      `ServerAliveInterval=${keepaliveIntervalSeconds}`,
      '-o',
      `ServerAliveCountMax=${keepaliveCountMax}`,
      this.host.config.host
    ];

    const sshProcess = spawn(
      'ssh',
      args,
      {
        env,
        stdio: 'pipe'
      }
    );

    this.nativeProcess = sshProcess;

    sshProcess.on('spawn', () => {
      this.openSshConnectedTimer = setTimeout(() => {
        this.markOpenSshConnected();
      }, 600);
    });

    sshProcess.stdout.on('data', (data: Buffer) => {
      this.markOpenSshConnected();
      this.emitDecodedChunk(data, this.nativeStdoutDecoder);
    });

    sshProcess.stderr.on('data', (data: Buffer) => {
      this.markOpenSshConnected();
      this.emitDecodedChunk(data, this.nativeStderrDecoder);
    });

    sshProcess.on('error', (err: Error) => {
      this.clearOpenSshConnectedTimer();
      this.handleError(err);
    });

    sshProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      this.clearOpenSshConnectedTimer();
      this.onOpenSshProcessClose(code, signal);
    });
  }

  /**
   * Build SSH connection configuration
   */
  private async buildSSHConfig(): Promise<ConnectConfig> {
    const extensionConfig = vscode.workspace.getConfiguration('terminax');

    const config: ConnectConfig = {
      host: this.host.config.host,
      port: this.host.config.port,
      username: this.host.config.username,
      keepaliveInterval:
        this.host.config.keepaliveInterval ??
        extensionConfig.get<number>('keepaliveInterval', 30000),
      keepaliveCountMax:
        this.host.config.keepaliveCountMax ??
        extensionConfig.get<number>('keepaliveCountMax', 3),
      readyTimeout: 30000
    };

    // Handle authentication
    switch (this.host.config.authMethod) {
      case 'password': {
        const password = this.passwordOverride || await this.getPassword();
        this.passwordOverride = undefined;
        if (password) {
          config.password = password;
        } else {
          throw new Error('Password entry cancelled');
        }
        break;
      }

      case 'keyfile': {
        if (this.host.config.privateKeyPath) {
          try {
            const privateKey = await fs.readFile(this.host.config.privateKeyPath);
            config.privateKey = privateKey;

            // Use stored passphrase if available; prompt only when key appears encrypted.
            let passphrase = await this.credentialService.getPrivateKeyPassphrase(this.host.id);
            if (!passphrase && this.isLikelyEncryptedPrivateKey(privateKey)) {
              passphrase = await this.promptForPrivateKeyPassphrase();
            }
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
      }

      case 'agent':
        config.agent = process.env.SSH_AUTH_SOCK;
        if (!config.agent) {
          throw new Error('SSH agent not available (SSH_AUTH_SOCK not set)');
        }
        break;

      case 'openssh':
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
    this.hasEverConnected = true;

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
          this.emitDecodedChunk(data, this.streamStdoutDecoder);
        });

        stream.on('close', (code?: number) => {
          this.onStreamClose(code);
        });

        stream.stderr.on('data', (data: Buffer) => {
          this.emitDecodedChunk(data, this.streamStderrDecoder);
        });
      }
    );
  }

  /**
   * Called when SSH stream closes
   */
  private onStreamClose(code?: number): void {
    this.streamClosedGracefully = true;
    this.flushStreamDecoders();

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
    if (this.isCleanedUp) {
      return;
    }

    // If stream already closed gracefully, don't treat as error
    if (this.streamClosedGracefully) {
      return;
    }

    // Connection lost unexpectedly — keep terminal open for reconnect
    this.writeEmitter.fire(`\r\n\n⚠️  Connection lost — network or VPN issue detected\r\n`);
    this.updateStatus(ConnectionStatus.ERROR, { error: 'Connection lost' });
    this.cleanupConnection();
    void this.promptReconnect();
  }

  private onOpenSshProcessClose(
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.isCleanedUp) {
      return;
    }

    this.streamClosedGracefully = true;
    this.nativeProcess = null;
    this.flushNativeDecoders();

    if (code === 0) {
      this.writeEmitter.fire('\r\n\n✨ Connection closed\r\n');
      this.updateStatus(ConnectionStatus.DISCONNECTED, { exitCode: 0 });
      this.closeEmitter.fire(0);
      this.cleanup();
      return;
    }

    const details = signal ? `signal: ${signal}` : `exit code: ${code ?? 1}`;
    this.writeEmitter.fire(`\r\n\n❌ Connection terminated (${details})\r\n`);
    this.updateStatus(ConnectionStatus.ERROR, { error: details, exitCode: code ?? 1 });
    this.closeEmitter.fire(1);
    this.cleanup();
  }

  /**
   * Handle connection errors
   */
  private handleError(error: unknown): void {
    void this.handleErrorAsync(error);
  }

  private async handleErrorAsync(error: unknown): Promise<void> {
    if (this.isCleanedUp) {
      return;
    }

    const errorMsg = error instanceof Error ? error.message : String(error);

    const interpretedError = this.interpretConnectionError(errorMsg);

    if (this.shouldRetryAuthentication(interpretedError.kind)) {
      this.hasRetriedAuthentication = true;
      this.writeEmitter.fire(`\r\n\n❌ ${interpretedError.friendly}\r\n`);
      this.writeEmitter.fire(`\r\n🔐 Authentication failed. Re-enter password to retry...\r\n`);

      await this.credentialService.deletePassword(this.host.id);
      this.teardownConnection();
      this.streamClosedGracefully = false;

      const replacementPassword = await this.getPassword();
      if (!replacementPassword) {
        this.updateStatus(ConnectionStatus.ERROR, { error: errorMsg });
        this.closeEmitter.fire(1);
        this.cleanup();
        return;
      }

      this.passwordOverride = replacementPassword;
      await this.connect();
      return;
    }

    // For known network errors on established connections, offer reconnect
    const isNetworkError = /ETIMEDOUT|ECONNRESET|EPIPE|EHOSTUNREACH|ENETUNREACH|socket hang up/i.test(errorMsg);
    if (this.hasEverConnected && isNetworkError) {
      this.writeEmitter.fire(`\r\n\n⚠️  ${interpretedError.friendly}\r\n`);
      this.updateStatus(ConnectionStatus.ERROR, { error: interpretedError.friendly });
      this.cleanupConnection();
      void this.promptReconnect();
      return;
    }

    this.writeEmitter.fire(`\r\n\n❌ ${interpretedError.friendly}\r\n`);
    if (interpretedError.showRaw) {
      this.writeEmitter.fire(`ℹ️  ${errorMsg}\r\n`);
    }

    if (!this.hasEverConnected && !this.hasShownErrorNotification) {
      this.hasShownErrorNotification = true;
      void vscode.window.showErrorMessage(
        `${this.host.label}: ${interpretedError.friendly}`
      );
    }

    this.updateStatus(ConnectionStatus.ERROR, { error: interpretedError.friendly });
    this.closeEmitter.fire(1);
    this.cleanup();
  }

  /**
   * Update connection status
   */
  private updateStatus(status: ConnectionStatus, metadata?: ConnectionMetadata): void {
    if (this.statusCallback) {
      this.statusCallback(status, metadata);
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.isCleanedUp) {
      return;
    }
    this.isCleanedUp = true;
    this.teardownConnection();
  }

  private teardownConnection(): void {
    this.clearOpenSshConnectedTimer();

    if (this.stream) {
      this.stream.removeAllListeners();
      this.stream.stderr?.removeAllListeners();
      try {
        this.stream.close();
      } catch {
        // Stream may already be closed; safe to ignore during cleanup.
      }
      this.stream = null;
    }
    if (this.client) {
      this.client.removeAllListeners();
      this.client.end();
      this.client = null;
    }

    if (this.nativeProcess) {
      this.nativeProcess.removeAllListeners();
      this.nativeProcess.stdout?.removeAllListeners();
      this.nativeProcess.stderr?.removeAllListeners();
      this.nativeProcess.stdin?.removeAllListeners();
      if (!this.nativeProcess.killed && this.nativeProcess.exitCode === null) {
        this.nativeProcess.kill();
      }
      this.nativeProcess = null;
    }
  }

  /**
   * Clear SSH connection state but keep the terminal open (for reconnect)
   */
  private cleanupConnection(): void {
    this.teardownConnection();
    this.streamClosedGracefully = false;
    this.openSshMarkedConnected = false;
  }

  /**
   * Prompt user to reconnect or close after unexpected disconnect
   */
  private async promptReconnect(): Promise<void> {
    this.writeEmitter.fire(`\r\n🔄 Press any key or use the prompt to reconnect...\r\n`);

    const action = await vscode.window.showWarningMessage(
      `${this.host.label}: Connection lost`,
      'Reconnect',
      'Close Terminal'
    );

    if (action === 'Reconnect') {
      this.writeEmitter.fire(`\r\n🔌 Reconnecting to ${this.host.config.host}...\r\n`);
      this.hasRetriedAuthentication = false;
      this.hasShownErrorNotification = false;
      await this.connect();
    } else {
      this.closeEmitter.fire(1);
      this.cleanup();
    }
  }

  private shouldRetryAuthentication(errorKind: string): boolean {
    if (this.host.config.authMethod !== 'password' || this.hasRetriedAuthentication) {
      return false;
    }

    return errorKind === 'auth';
  }

  private interpretConnectionError(errorMsg: string): {
    kind: string;
    friendly: string;
    showRaw: boolean;
  } {
    if (/all configured authentication methods failed|permission denied|authentication failed/i.test(errorMsg)) {
      return {
        kind: 'auth',
        friendly: 'Authentication failed (invalid username/password or key permissions)',
        showRaw: false
      };
    }

    if (/ECONNREFUSED|connection refused/i.test(errorMsg)) {
      return {
        kind: 'refused',
        friendly: `Connection refused by ${this.host.config.host}:${this.host.config.port}. Check host/port and SSH service.`,
        showRaw: false
      };
    }

    if (/ETIMEDOUT|timed out|timeout/i.test(errorMsg)) {
      return {
        kind: 'timeout',
        friendly: `Connection timed out while reaching ${this.host.config.host}:${this.host.config.port}`,
        showRaw: false
      };
    }

    if (/ENOTFOUND|getaddrinfo/i.test(errorMsg)) {
      return {
        kind: 'dns',
        friendly: `Hostname not found: ${this.host.config.host}`,
        showRaw: false
      };
    }

    if (/EHOSTUNREACH|ENETUNREACH|host is unreachable|network is unreachable/i.test(errorMsg)) {
      return {
        kind: 'network',
        friendly: `Host/network unreachable for ${this.host.config.host}`,
        showRaw: false
      };
    }

    return {
      kind: 'generic',
      friendly: 'SSH connection failed',
      showRaw: true
    };
  }

  private isLikelyEncryptedPrivateKey(privateKey: Buffer): boolean {
    const keyContent = privateKey.toString('utf8');
    return keyContent.includes('ENCRYPTED');
  }

  private async promptForPrivateKeyPassphrase(): Promise<string | undefined> {
    const passphrase = await vscode.window.showInputBox({
      prompt: `Enter passphrase for key used by ${this.host.config.username}@${this.host.config.host}`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Private key passphrase'
    });

    if (!passphrase) {
      return undefined;
    }

    const save = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: 'Save passphrase securely?',
      ignoreFocusOut: true
    });

    if (save === 'Yes') {
      await this.credentialService.savePrivateKeyPassphrase(this.host.id, passphrase);
    }

    return passphrase;
  }

  private markOpenSshConnected(): void {
    if (this.openSshMarkedConnected || this.isCleanedUp) {
      return;
    }

    this.openSshMarkedConnected = true;
    this.hasEverConnected = true;
    this.writeEmitter.fire('✅ Connected via OpenSSH config\r\n\r\n');
    this.updateStatus(ConnectionStatus.CONNECTED);
  }

  private clearOpenSshConnectedTimer(): void {
    if (!this.openSshConnectedTimer) {
      return;
    }
    clearTimeout(this.openSshConnectedTimer);
    this.openSshConnectedTimer = null;
  }

  private resolveTerminalType(term: string | undefined): string {
    if (!term || term === 'dumb') {
      return 'xterm-256color';
    }

    return term;
  }

  private resetDecoders(): void {
    this.streamStdoutDecoder = new StringDecoder('utf8');
    this.streamStderrDecoder = new StringDecoder('utf8');
    this.nativeStdoutDecoder = new StringDecoder('utf8');
    this.nativeStderrDecoder = new StringDecoder('utf8');
  }

  private emitDecodedChunk(data: Buffer, decoder: StringDecoder): void {
    const chunk = decoder.write(data);
    if (chunk.length > 0) {
      this.writeEmitter.fire(chunk);
    }
  }

  private flushStreamDecoders(): void {
    this.flushDecoder(this.streamStdoutDecoder);
    this.flushDecoder(this.streamStderrDecoder);
  }

  private flushNativeDecoders(): void {
    this.flushDecoder(this.nativeStdoutDecoder);
    this.flushDecoder(this.nativeStderrDecoder);
  }

  private flushDecoder(decoder: StringDecoder): void {
    const chunk = decoder.end();
    if (chunk.length > 0) {
      this.writeEmitter.fire(chunk);
    }
  }
}
