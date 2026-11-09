const $ = (id) => document.getElementById(id);
const out = (m) => ($('out').textContent = typeof m === 'string' ? m : JSON.stringify(m, null, 2));
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
async function inPage(msg) {
  const t = await tab();
  await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
  return new Promise((r) => chrome.tabs.sendMessage(t.id, msg, r));
}

async function init() {
  const { token, apiBase } = await chrome.storage.local.get(['token', 'apiBase']);
  $('apiBase').value = apiBase || 'http://localhost:3000';
  if (!token) return ($('setup').hidden = false);
  const s = await send({ type: 'STATUS' });
  if (!s.ok) {
    $('setup').hidden = false;
    return out(s.error);
  }
  $('who').textContent = s.data.user.email;
  $('main').hidden = false;
}

$('save').onclick = async () => {
  const apiBase = $('apiBase').value.trim().replace(/\/$/, '');
  const origin = new URL(apiBase).origin + '/*';
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) return out('Permission to contact AutoApply was not granted.');
  await chrome.storage.local.set({ apiBase, token: $('token').value.trim() });
  $('setup').hidden = true;
  init();
};
$('disconnect').onclick = async () => {
  await chrome.storage.local.remove('token');
  location.reload();
};
$('capture').onclick = async () => {
  const j = await inPage({ type: 'EXTRACT_JOB' });
  if (!j?.ok) return out(j?.error || 'Could not read this page');
  const r = await send({ type: 'CAPTURE', job: j.data });
  out(r.ok ? `Saved "${j.data.title}" — match ${r.data.match ? Math.round(r.data.match.score) : 'n/a'}` : r.error);
};
$('fill').onclick = async () => {
  const t = await tab();
  const p = await send({ type: 'PREPARED', url: t.url });
  if (!p.ok) return out(p.error);
  if (!p.data.application) return out('No prepared application for this page. Open the job in AutoApply and choose "Prepare answers" first.');
  const r = await inPage({ type: 'FILL', fields: p.data.fields });
  out(r?.ok ? { filled: r.data.filled.length, skipped: r.data.skipped, note: 'Review everything, tick consents yourself, then submit.' } : r?.error);
};
$('submitted').onclick = async () => {
  const t = await tab();
  const c = await inPage({ type: 'CONFIRMATION' });
  const j = await inPage({ type: 'EXTRACT_JOB' });
  if (!confirm(`Confirm you submitted this application?${c?.data ? `\n\nPage says: "${c.data}"` : ''}`)) return;
  const r = await send({ type: 'SUBMITTED', url: t.url, userConfirmed: true, confirmationText: c?.data || undefined, job: j?.ok ? j.data : undefined });
  out(r.ok ? 'Recorded as applied (user-confirmed).' : r.error);
};
$('session').onclick = async () => {
  const t = await tab();
  const r = await send({ type: 'PLATFORM_SESSION', url: t.url });
  out(r.ok ? `${r.data.platform} marked as signed in.` : r.error);
};
init();
