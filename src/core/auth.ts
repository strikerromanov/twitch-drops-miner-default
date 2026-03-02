const TWITCH_OAUTH = 'https://id.twitch.tv/oauth2';

export interface TokenResponse {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;
  token_type:    string;
}

export interface DeviceCodeResponse {
  device_code:      string;
  user_code:        string;
  verification_uri: string;
  expires_in:       number;
  interval:         number;
}

export interface UserInfo {
  id:    string;
  login: string;
  display_name: string;
  profile_image_url?: string;
}

// ─── Device Code Flow ─────────────────────────────────────────────────────────

export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(`${TWITCH_OAUTH}/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scopes:    'channel:read:redemptions channel:read:predictions',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Device code request failed ${res.status}: ${body}`);
  }
  return res.json();
}

export async function pollForToken(
  clientId:   string,
  deviceCode: string,
  interval:   number = 5,
): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await fetch(`${TWITCH_OAUTH}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id:   clientId,
            device_code: deviceCode,
            grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        const data = await res.json();

        if (res.ok) { resolve(data); return; }

        if (data.message === 'authorization_pending') {
          setTimeout(poll, interval * 1000);
        } else {
          reject(new Error(data.message || `Poll failed ${res.status}`));
        }
      } catch (err) {
        reject(err);
      }
    };
    poll();
  });
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId:     string,
): Promise<TokenResponse> {
  const res = await fetch(`${TWITCH_OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getUserInfo(accessToken: string, clientId: string): Promise<UserInfo> {
  const res = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id':     clientId,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`getUserInfo failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  if (!data.data?.[0]) throw new Error('No user data returned from Twitch');
  return data.data[0];
}

export function shouldRefreshToken(expiresAt: number | null): boolean {
  if (expiresAt == null) return true;
  const sixtyMinutes = 60 * 60;
  return Math.floor(Date.now() / 1000) + sixtyMinutes >= expiresAt;
}
