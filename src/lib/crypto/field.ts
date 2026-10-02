import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Field-level encryption for TPN and bank account numbers (CLAUDE.md hard rule 8).
// AES-256-GCM, random 12-byte IV, stored as "v1:" + base64(iv | tag | ciphertext).
// The person and field are bound in as associated data, so a ciphertext cannot be moved
// to another person or another field. Errors never include the value or the ciphertext.

export type EncryptedField = "tpn" | "bank_account";
type FieldContext = { personId: string; field: EncryptedField };

const VERSION = "v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function parseFieldKey(base64: string | undefined): Buffer {
  const key = base64 ? Buffer.from(base64, "base64") : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) {
    throw new Error("FIELD_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32).");
  }
  return key;
}

let cachedKey: Buffer | undefined;
function currentKey(): Buffer {
  cachedKey ??= parseFieldKey(process.env.FIELD_ENCRYPTION_KEY);
  return cachedKey;
}

const associatedData = ({ personId, field }: FieldContext) => Buffer.from(`dashteam:${field}:${personId}`, "utf8");

export function encryptField(plaintext: string, context: FieldContext, key: Buffer = currentKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptField(stored: string, context: FieldContext, key: Buffer = currentKey()): string {
  try {
    if (!stored.startsWith(VERSION)) throw new Error("unknown format");
    const bytes = Buffer.from(stored.slice(VERSION.length), "base64");
    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately vague: never echo the input, the ciphertext or the underlying error.
    throw new Error(`Could not decrypt the ${context.field === "tpn" ? "TPN" : "bank account"}.`);
  }
}

export function lastFour(value: string): string {
  return value.slice(-4);
}
