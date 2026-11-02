// Reads a secret from Google Secret Manager at runtime, using the function's own identity.
//
// Secrets are NOT bound to the function at deploy time on purpose: a deploy then never
// depends on Secret Manager, the secret's existence or deployer permissions, so the
// site can always be updated. A feature turns on only when its secret is named in the
// environment (PAYSTACK_SECRET_NAME, TURNSTILE_SECRET_NAME) and can be read.

export type SecretSources = {
  metadataUrl: string;
  secretManagerUrl: string;
  fetchImpl?: typeof fetch;
};

export const GOOGLE_SECRET_SOURCES: SecretSources = {
  metadataUrl: "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
  secretManagerUrl: "https://secretmanager.googleapis.com/v1",
};

// Returns the latest version's value, or null if no secret is named. A named secret that
// cannot be read is logged loudly and also returns null, which keeps the shop running
// with that feature off rather than taking the whole site down; the admin overview and
// /api/v1/health report that payments are off.
export async function readSecret(name: string | null, project: string, sources: SecretSources = GOOGLE_SECRET_SOURCES): Promise<string | null> {
  if (!name) return null;
  const fetchImpl = sources.fetchImpl ?? fetch;
  try {
    const tokenResponse = await fetchImpl(sources.metadataUrl, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) });
    if (!tokenResponse.ok) throw new Error(`token request returned ${tokenResponse.status}`);
    const { access_token: token } = (await tokenResponse.json()) as { access_token?: string };
    if (!token) throw new Error("no access token");
    const response = await fetchImpl(`${sources.secretManagerUrl}/projects/${project}/secrets/${encodeURIComponent(name)}/versions/latest:access`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Secret Manager returned ${response.status}`);
    const data = ((await response.json()) as { payload?: { data?: string } }).payload?.data;
    if (!data) throw new Error("the secret has no value");
    return Buffer.from(data, "base64").toString("utf8").trim() || null;
  } catch (error) {
    console.error(`SECRET UNAVAILABLE: could not read "${name}". The feature that needs it is OFF.`, error);
    return null;
  }
}
