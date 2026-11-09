// Service worker: the only component that talks to the AutoApply API.
// Stores the API base URL and the personal extension token (scope "extension") in
// chrome.storage.local. It never receives AI keys, platform passwords or cookies.
const API_VERSION = 'v1';

async function config() {
  const { apiBase, token } = await chrome.storage.local.get(['apiBase', 'token']);
  return { apiBase: (apiBase || 'http://localhost:3000').replace(/\/$/, ''), token };
}

async function api(path, { method = 'GET', body } = {}) {
  const { apiBase, token } = await config();
  if (!token) throw new Error('Not connected. Paste your extension token in the popup.');
  const res = await fetch(`${apiBase}/api/${API_VERSION}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

const PLATFORM_HOSTS = [
  ['linkedin', /(^|\.)linkedin\.com$/],
  ['indeed', /(^|\.)indeed\./],
  ['naukri', /(^|\.)naukri\.com$/],
  ['greenhouse', /greenhouse\.io$/],
  ['lever', /lever\.co$/],
];
function platformOf(url) {
  try {
    const h = new URL(url).hostname;
    return PLATFORM_HOSTS.find(([, re]) => re.test(h))?.[0] ?? null;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case 'STATUS':
        return api('/extension/status');
      case 'CAPTURE':
        return api('/jobs/capture', { method: 'POST', body: { ...msg.job, platformHint: msg.job.platformHint ?? platformOf(msg.job.url) } });
      case 'PREPARED':
        return api(`/extension/prepared?url=${encodeURIComponent(msg.url)}`);
      case 'SUBMITTED':
        return api('/extension/events', { method: 'POST', body: { type: 'APPLICATION_SUBMITTED', url: msg.url, userConfirmed: !!msg.userConfirmed, confirmationText: msg.confirmationText, capturedJob: msg.job } });
      case 'PLATFORM_SESSION': {
        const platform = platformOf(msg.url);
        if (!platform) throw new Error('This site is not a supported job platform');
        await api('/extension/platform-session', { method: 'POST', body: { platform } });
        return { platform };
      }
      default:
        throw new Error(`Unknown message ${msg.type}`);
    }
  })()
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true;
});
