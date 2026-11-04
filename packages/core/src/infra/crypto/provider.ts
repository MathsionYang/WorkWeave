import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { WorkWeaveError } from "../../domain/errors.js";

export type CryptoMode = "personal" | "team" | "enterprise";

export interface CryptoProviderOptions {
  readonly mode: CryptoMode;
  readonly available: boolean;
  readonly secret: string;
}

export interface CryptoProbeResult {
  readonly available: boolean;
  readonly degraded: boolean;
}

export class CryptoProvider {
  private readonly key: Buffer;

  constructor(private readonly options: CryptoProviderOptions) {
    this.key = createHash("sha256").update(options.secret).digest();
  }

  probe(): CryptoProbeResult {
    if (this.options.available) {
      return { available: true, degraded: false };
    }
    if (this.options.mode === "personal") {
      return { available: false, degraded: true };
    }
    throw new WorkWeaveError("E-SEC-001", "local encryption is unavailable; team/enterprise startup blocked");
  }

  seal(plain: string): string {
    if (!this.options.available) {
      throw new WorkWeaveError("E-SEC-001", "local encryption is unavailable");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString("base64");
  }

  open(sealed: string): string {
    if (!this.options.available) {
      throw new WorkWeaveError("E-SEC-001", "local encryption is unavailable");
    }
    const buffer = Buffer.from(sealed, "base64");
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}