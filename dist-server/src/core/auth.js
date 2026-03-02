const TWITCH_OAUTH = 'https://id.twitch.tv/oauth2';
// ─── Device Code Flow ─────────────────────────────────────────────────────────
export async function requestDeviceCode(clientId) {
    const res = await fetch(`${TWITCH_OAUTH}/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            scopes: 'channel:read:redemptions channel:read:predictions',
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Device code request failed ${res.status}: ${body}`);
    }
    return res.json();
}
export async function pollForToken(clientId, deviceCode, interval = 5) {
    return new Promise((resolve, reject) => {
        const poll = async () => {
            try {
                const res = await fetch(`${TWITCH_OAUTH}/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: clientId,
                        device_code: deviceCode,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    }),
                });
                const data = await res.json();
                if (res.ok) {
                    resolve(data);
                    return;
                }
                if (data.message === 'authorization_pending') {
                    setTimeout(poll, interval * 1000);
                }
                else {
                    reject(new Error(data.message || `Poll failed ${res.status}`));
                }
            }
            catch (err) {
                reject(err);
            }
        };
        poll();
    });
}
export async function refreshAccessToken(refreshToken, clientId) {
    const res = await fetch(`${TWITCH_OAUTH}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Token refresh failed ${res.status}: ${body}`);
    }
    return res.json();
}
export async function getUserInfo(accessToken, clientId) {
    const res = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Client-Id': clientId,
        },
    });
    if (!res.ok)
        throw new Error(`getUserInfo failed ${res.status}`);
    const data = await res.json();
    if (!data.data?.[0])
        throw new Error('No user data returned from Twitch');
    return data.data[0];
}
export function shouldRefreshToken(expiresAt) {
    if (expiresAt == null)
        return true;
    const sixtyMinutes = 60 * 60;
    return Math.floor(Date.now() / 1000) + sixtyMinutes >= expiresAt;
}
