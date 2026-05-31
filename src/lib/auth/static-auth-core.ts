export const staticAuthCookieName = "compliagent_session";

export const staticAuthSessionMaxAgeSeconds = 60 * 60 * 24 * 7;

type StaticAuthConfig = {
  username: string;
  password: string;
  sessionSecret: string;
  displayName: string;
};

export type StaticAuthSession = {
  username: string;
  displayName: string;
  expiresAt: number;
};

function readStaticAuthConfig(): StaticAuthConfig | null {
  const username = process.env.APP_LOGIN_USERNAME?.trim();
  const password = process.env.APP_LOGIN_PASSWORD;
  const sessionSecret = process.env.APP_SESSION_SECRET;

  if (!username || !password || !sessionSecret) {
    return null;
  }

  return {
    username,
    password,
    sessionSecret,
    displayName: process.env.APP_LOGIN_NAME?.trim() || username
  };
}

export function staticAuthMissingEnvMessage() {
  const missing = ["APP_LOGIN_USERNAME", "APP_LOGIN_PASSWORD", "APP_SESSION_SECRET"].filter(
    (name) => !process.env[name]?.trim()
  );

  if (missing.length === 0) {
    return null;
  }

  return `Missing static login environment value${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`;
}

export function isStaticAuthConfigured() {
  return readStaticAuthConfig() !== null;
}

export function getStaticLoginUsername() {
  return process.env.APP_LOGIN_USERNAME?.trim() || "";
}

export function staticLoginEmail(username = getStaticLoginUsername()) {
  return username.includes("@") ? username : `${username}@compliagent.local`;
}

export async function createStaticSessionToken(): Promise<string> {
  const config = readStaticAuthConfig();

  if (!config) {
    throw new Error(staticAuthMissingEnvMessage() ?? "Static login is not configured.");
  }

  const payload = {
    username: config.username,
    displayName: config.displayName,
    expiresAt: Math.floor(Date.now() / 1000) + staticAuthSessionMaxAgeSeconds
  };
  const encodedPayload = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await signPayload(encodedPayload, config.sessionSecret);

  return `${encodedPayload}.${signature}`;
}

export async function verifyStaticSessionToken(token: string | undefined): Promise<StaticAuthSession | null> {
  const config = readStaticAuthConfig();

  if (!config || !token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const validSignature = await verifyPayloadSignature(encodedPayload, signature, config.sessionSecret);
  if (!validSignature) {
    return null;
  }

  const payload = JSON.parse(base64UrlDecodeText(encodedPayload)) as StaticAuthSession;
  if (payload.username !== config.username || payload.expiresAt < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

export function validateStaticCredentials(input: { username: string; password: string }) {
  const config = readStaticAuthConfig();

  if (!config) {
    return false;
  }

  return input.username.trim() === config.username && input.password === config.password;
}

async function signPayload(payload: string, secret: string) {
  const key = await importHmacKey(secret);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function verifyPayloadSignature(payload: string, signature: string, secret: string) {
  const key = await importHmacKey(secret);
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecodeBytes(signature),
    new TextEncoder().encode(payload)
  );
}

function importHmacKey(secret: string) {
  return globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function base64UrlEncodeText(value: string) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlDecodeText(value: string) {
  return new TextDecoder().decode(base64UrlDecodeBytes(value));
}

function base64UrlEncodeBytes(value: Uint8Array) {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecodeBytes(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
