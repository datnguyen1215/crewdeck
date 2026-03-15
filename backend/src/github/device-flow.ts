/** GitHub Device Flow OAuth client using native fetch (Node 18+). */

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface DeviceFlowError {
  error: string;
  error_description: string;
}

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Initiate Device Flow — returns device_code, user_code, verification_uri.
 * The client_id should come from a registered GitHub OAuth App.
 */
export const requestDeviceCode = async (
  clientId: string,
): Promise<DeviceCodeResponse> => {
  const res = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: clientId, scope: "repo" }),
  });

  if (!res.ok)
    throw new Error(`GitHub Device Flow initiation failed: ${res.status}`);

  return res.json() as Promise<DeviceCodeResponse>;
};

/**
 * Poll for token completion. Returns the token response if authorized,
 * or an error object if still pending/expired.
 */
export const pollForToken = async (
  clientId: string,
  deviceCode: string,
): Promise<TokenResponse | DeviceFlowError> => {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  if (!res.ok) throw new Error(`GitHub token poll failed: ${res.status}`);

  return res.json() as Promise<TokenResponse | DeviceFlowError>;
};

/** Fetch the authenticated user's GitHub username using the token. */
export const getGitHubUsername = async (token: string): Promise<string> => {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch GitHub user: ${res.status}`);

  const data = (await res.json()) as { login: string };
  return data.login;
};

/** Revoke an OAuth token (best-effort, tolerates already-revoked tokens). */
export const revokeToken = async (
  clientId: string,
  token: string,
): Promise<void> => {
  const res = await fetch(
    `https://api.github.com/applications/${clientId}/token`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${Buffer.from(`${clientId}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: token }),
    },
  );

  // 204 = success, 422 = token already revoked — both are fine
  if (!res.ok && res.status !== 422)
    throw new Error(`Failed to revoke token: ${res.status}`);
};
