/**
 * Sign-in codes and session tokens (spec §3.5), made and hashed with Web
 * Crypto. Plain functions with no imports, so the Worker, the command-line
 * script and the browser tests all make and hash them the same way.
 *
 * Only `hashSecret(...)` of a code or a token is ever stored.
 */

/**
 * The cookie that holds the session token. `__Host-`: browsers accept it only
 * with `Secure`, `Path=/` and no `Domain`, so no other site or subdomain can
 * plant it.
 */
export const SESSION_COOKIE = "__Host-gamo-session";

/** No I, L, O, 0 or 1: nothing that reads as something else when dictated. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** A new one-time sign-in code: 8 characters, uniformly random. */
export function newSignInCode(): string {
  // Bytes at or above the largest multiple of the alphabet's size are thrown
  // away, so that every character is equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (byte < limit && code.length < CODE_LENGTH) {
        code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      }
    }
  }
  return code;
}

/** A code as it is shown and read out: two groups of four. */
export function formatSignInCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

/** A typed code as it is compared: upper case, without spaces or dashes. */
export function normalizeSignInCode(typed: string): string {
  return typed.replace(/[\s-]/g, "").toUpperCase();
}

/** A new opaque session token: 256 random bits, base64url. */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** The SHA-256 of a code or a token, in hex: what the database stores. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
