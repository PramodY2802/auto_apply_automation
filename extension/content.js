// Injected on demand (activeTab + scripting) into the page the user is viewing.
// Reads job details (schema.org JSON-LD first, visible DOM as fallback) and fills
// approved answers into form fields. It NEVER clicks submit and never touches CAPTCHAs.
(() => {
  if (window.__autoapplyInjected) return;
  window.__autoapplyInjected = true;

  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  function findJobPosting() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
        const jp = items.find((i) => i && (i['@type'] === 'JobPosting' || (Array.isArray(i['@type']) && i['@type'].includes('JobPosting'))));
        if (jp) return jp;
      } catch {
        /* ignore malformed blocks */
      }
    }
    return null;
  }

  function extractJob() {
    const ld = findJobPosting();
    const url = location.href.split('#')[0];
    if (ld) {
      const org = typeof ld.hiringOrganization === 'string' ? ld.hiringOrganization : ld.hiringOrganization?.name;
      const addr = Array.isArray(ld.jobLocation) ? ld.jobLocation[0]?.address : ld.jobLocation?.address;
      const div = document.createElement('div');
      div.innerHTML = ld.description || '';
      return {
        url,
        title: ld.title,
        company: org || 'Unknown company',
        description: text(div).slice(0, 100000),
        location: [addr?.addressLocality, addr?.addressRegion, typeof addr?.addressCountry === 'string' ? addr.addressCountry : addr?.addressCountry?.name].filter(Boolean).join(', ') || null,
        employmentType: Array.isArray(ld.employmentType) ? ld.employmentType[0] : ld.employmentType || null,
        postedAt: ld.datePosted || null,
        externalId: ld.identifier?.value ? String(ld.identifier.value) : null,
      };
    }
    const h1 = document.querySelector('h1');
    const main = document.querySelector('main, [role=main], article') || document.body;
    return {
      url,
      title: text(h1) || document.title,
      company: document.querySelector('meta[property="og:site_name"]')?.content || location.hostname,
      description: text(main).slice(0, 50000),
      location: null,
    };
  }

  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fill(fields) {
    const result = { filled: [], skipped: [] };
    for (const f of fields) {
      if (f.value == null || f.value === '') {
        result.skipped.push({ key: f.key, reason: f.needsReview ? 'needs your review in AutoApply' : 'no approved answer' });
        continue;
      }
      const els = document.querySelectorAll(`[name="${CSS.escape(f.key)}"]`);
      if (!els.length) {
        result.skipped.push({ key: f.key, reason: 'field not on this page' });
        continue;
      }
      const el = els[0];
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'file') {
        result.skipped.push({ key: f.key, reason: 'attach your resume manually' });
      } else if (type === 'radio') {
        const r = [...els].find((x) => x.value === f.value);
        if (r) { r.click(); result.filled.push(f.key); } else result.skipped.push({ key: f.key, reason: 'option not found' });
      } else if (type === 'checkbox') {
        // Consents/declarations are left for the user to tick themselves.
        result.skipped.push({ key: f.key, reason: 'tick this yourself' });
      } else {
        setValue(el, f.value);
        el.style.outline = '2px solid #6366f1';
        result.filled.push(f.key);
      }
    }
    return result;
  }

  function confirmationText() {
    const t = text(document.body);
    const m = /(application (has been )?(submitted|received)|thank you for (applying|your application))[^.]{0,160}/i.exec(t);
    return m ? m[0] : null;
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    try {
      if (msg.type === 'EXTRACT_JOB') reply({ ok: true, data: extractJob() });
      else if (msg.type === 'FILL') reply({ ok: true, data: fill(msg.fields) });
      else if (msg.type === 'CONFIRMATION') reply({ ok: true, data: confirmationText() });
    } catch (e) {
      reply({ ok: false, error: e.message });
    }
    return true;
  });
})();
