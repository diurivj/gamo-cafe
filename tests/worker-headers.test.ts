import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// workers/app.ts: what every answer of the app carries, whoever asks and
// whatever it answers — a page, a redirect to Entrar, a path the app does
// not have. The static files carry what public/_headers says instead.

describe("every answer of the app", () => {
  it("may not be framed by another page, keeps to its type, and names no screen to another site", async () => {
    for (const path of ["/entrar", "/inicio", "/healthz", "/no-existe"]) {
      const response = await exports.default.fetch(`https://gamo.test${path}`, { redirect: "manual" });

      expect(response.headers.get("Content-Security-Policy"), path).toBe("frame-ancestors 'none'");
      expect(response.headers.get("X-Frame-Options"), path).toBe("DENY");
      expect(response.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy"), path).toBe("same-origin");
      expect(response.headers.get("Cache-Control"), path).toBe("no-store");
    }
  });
});
