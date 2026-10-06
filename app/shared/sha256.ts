/**
 * The SHA-256 of a string, in hex. A plain function with no imports, so the
 * Worker, the command-line script and the browser tests all hash the same
 * way. Sign-in codes and session tokens hash their secret with it
 * (`~/shared/secret`), and a form's submission digest hashes what it carried
 * (`~/backend/submissions`).
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
