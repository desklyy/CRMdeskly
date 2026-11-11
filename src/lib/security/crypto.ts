import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Falta OAUTH_TOKEN_ENCRYPTION_KEY en las variables de entorno.");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  return crypto.createHash("sha256").update(raw).digest();
}

function getSigningSecret(): Buffer {
  return crypto
    .createHmac("sha256", getEncryptionKey())
    .update("deskly-oauth-state-signing-v1")
    .digest();
}

/**
 * Cifra un token OAuth con AES-256-GCM antes de guardarlo en `oauth_connections`.
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/**
 * Descifra un token almacenado con `encryptToken`.
 */
export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Formato de token cifrado inválido.");
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Genera un `state` firmado HMAC para proteger el flujo OAuth2 contra CSRF.
 */
export function signOAuthState(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid: userId,
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now(),
    })
  ).toString("base64url");

  const sig = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");

  return `${payload}.${sig}`;
}

/**
 * Verifica la firma HMAC y caducidad (15 min) del parámetro `state` OAuth2.
 */
export function verifyOAuthState(state: string): { uid: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid?: string;
      ts?: number;
    };
    if (!parsed.uid || !parsed.ts) return null;
    if (Date.now() - parsed.ts > 15 * 60 * 1000) return null;
    return { uid: parsed.uid };
  } catch {
    return null;
  }
}

