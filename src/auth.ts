import { EpfError } from "./errors.js";
import { logger } from "./logger.js";

export interface AuthState {
  jwt: string;
  logonkey: string;
  username: string;
  issuedAt: string;
  email?: string;
  roles?: ReadonlyArray<string>;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface LoginResult {
  jwt: string;
  logonkey: string;
  email?: string;
  roles?: ReadonlyArray<string>;
}

export type LoginFn = (username: string, password: string) => Promise<LoginResult>;

export class AuthStore {
  private state: AuthState | null = null;
  private credentials: Credentials | null = null;

  constructor(private readonly loginFn: LoginFn) {}

  current(): AuthState | null {
    return this.state;
  }

  isAuthenticated(): boolean {
    return this.state !== null;
  }

  hasStoredCredentials(): boolean {
    return this.credentials !== null;
  }

  async bootLogin(creds: Credentials): Promise<AuthState> {
    const result = await this.loginFn(creds.username, creds.password);
    this.state = {
      jwt: result.jwt,
      logonkey: result.logonkey,
      username: creds.username,
      email: result.email,
      roles: result.roles,
      issuedAt: new Date().toISOString(),
    };
    this.credentials = creds;
    logger.info("BOOT_OK", { username: creds.username });
    return this.state;
  }

  async loginAndStore(creds: Credentials): Promise<AuthState> {
    const result = await this.loginFn(creds.username, creds.password);
    this.state = {
      jwt: result.jwt,
      logonkey: result.logonkey,
      username: creds.username,
      email: result.email,
      roles: result.roles,
      issuedAt: new Date().toISOString(),
    };
    this.credentials = creds;
    logger.info("LOGIN_STORED", { username: creds.username });
    return this.state;
  }

  async reauth(endpoint: string): Promise<AuthState> {
    if (!this.credentials || !this.state) {
      throw new EpfError(401, endpoint, "no prior credentials to refresh with");
    }
    const creds = this.credentials;
    const priorIssuedAt = this.state.issuedAt;
    try {
      const result = await this.loginFn(creds.username, creds.password);
      this.state = {
        jwt: result.jwt,
        logonkey: result.logonkey,
        username: creds.username,
        email: result.email,
        roles: result.roles,
        issuedAt: new Date().toISOString(),
      };
      logger.info("REAUTH", { endpoint, priorIssuedAt });
      return this.state;
    } catch (err) {
      logger.info("REAUTH_FAILED", {
        endpoint,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new EpfError(
        401,
        endpoint,
        `reauth failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  clear(): void {
    this.state = null;
    this.credentials = null;
  }
}
