import * as vscode from 'vscode';

/**
 * Manages secure storage of SSH credentials using VSCode's SecretStorage API
 */
export class CredentialService {
  private static readonly PASSWORD_PREFIX = 'terminax.password.';
  private static readonly PASSPHRASE_PREFIX = 'terminax.passphrase.';

  constructor(private secrets: vscode.SecretStorage) {}

  /**
   * Save a password for a host
   */
  async savePassword(hostId: string, password: string): Promise<void> {
    const key = this.getPasswordKey(hostId);
    await this.secrets.store(key, password);
  }

  /**
   * Get a password for a host
   */
  async getPassword(hostId: string): Promise<string | undefined> {
    const key = this.getPasswordKey(hostId);
    return await this.secrets.get(key);
  }

  /**
   * Delete a password for a host
   */
  async deletePassword(hostId: string): Promise<void> {
    const key = this.getPasswordKey(hostId);
    await this.secrets.delete(key);
  }

  /**
   * Save a private key passphrase for a host
   */
  async savePrivateKeyPassphrase(hostId: string, passphrase: string): Promise<void> {
    const key = this.getPassphraseKey(hostId);
    await this.secrets.store(key, passphrase);
  }

  /**
   * Get a private key passphrase for a host
   */
  async getPrivateKeyPassphrase(hostId: string): Promise<string | undefined> {
    const key = this.getPassphraseKey(hostId);
    return await this.secrets.get(key);
  }

  /**
   * Delete a private key passphrase for a host
   */
  async deletePrivateKeyPassphrase(hostId: string): Promise<void> {
    const key = this.getPassphraseKey(hostId);
    await this.secrets.delete(key);
  }

  /**
   * Delete all credentials for a host
   */
  async deleteAllCredentials(hostId: string): Promise<void> {
    await this.deletePassword(hostId);
    await this.deletePrivateKeyPassphrase(hostId);
  }

  /**
   * Check if a password exists for a host
   */
  async hasPassword(hostId: string): Promise<boolean> {
    const password = await this.getPassword(hostId);
    return password !== undefined;
  }

  /**
   * Check if a passphrase exists for a host
   */
  async hasPassphrase(hostId: string): Promise<boolean> {
    const passphrase = await this.getPrivateKeyPassphrase(hostId);
    return passphrase !== undefined;
  }

  /**
   * Get the secret storage key for a password
   */
  private getPasswordKey(hostId: string): string {
    return `${CredentialService.PASSWORD_PREFIX}${hostId}`;
  }

  /**
   * Get the secret storage key for a passphrase
   */
  private getPassphraseKey(hostId: string): string {
    return `${CredentialService.PASSPHRASE_PREFIX}${hostId}`;
  }
}
