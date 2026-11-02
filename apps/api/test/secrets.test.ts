import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { readSecret } from "../src/services/secrets.ts";

describe("Reading keys from Secret Manager at runtime", () => {
  let server: Server;
  let base = "";
  const seen: string[] = [];
  let secretValue = Buffer.from("sk_test_from_secret_manager\n").toString("base64");

  before(async () => {
    server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers["metadata-flavor"] ?? ""} ${req.headers.authorization ?? ""}`.trim());
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/token") return json(200, { access_token: "tok123" });
      if (req.url === "/v1/projects/p/secrets/paystack-key/versions/latest:access") {
        return req.headers.authorization === "Bearer tok123" ? json(200, { payload: { data: secretValue } }) : json(401, {});
      }
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => server.close());

  const sources = () => ({ metadataUrl: `${base}/token`, secretManagerUrl: `${base}/v1` });

  test("returns the trimmed latest value using the function's own token", async () => {
    assert.equal(await readSecret("paystack-key", "p", sources()), "sk_test_from_secret_manager");
    assert.ok(seen.some((line) => line.includes("/token Google")), "asks the metadata server with its required header");
    assert.ok(seen.some((line) => line.includes("latest:access") && line.includes("Bearer tok123")));
  });

  test("a feature with no secret named is simply off, with no network calls", async () => {
    seen.length = 0;
    assert.equal(await readSecret(null, "p", sources()), null);
    assert.equal(seen.length, 0);
  });

  test("a named secret that cannot be read turns the feature off instead of crashing", async () => {
    assert.equal(await readSecret("does-not-exist", "p", sources()), null);
    assert.equal(await readSecret("paystack-key", "p", { metadataUrl: `${base}/nope`, secretManagerUrl: `${base}/v1` }), null);
    secretValue = "";
    assert.equal(await readSecret("paystack-key", "p", sources()), null, "an empty secret is treated as missing");
  });
});
