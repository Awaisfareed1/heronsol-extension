(() => {
  if (window.__HERONSOL_PAGE_AGENT_V2__) return;
  window.__HERONSOL_PAGE_AGENT_V2__ = true;

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const fieldModel = window.__HERONSOL_FIELD_MODEL__ || {};
  const canonicalField = (element, label) => { try { return typeof fieldModel.canonicalField === 'function' ? fieldModel.canonicalField(element, label) : null; } catch { return null; } };

  function classifySite(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) return 'workday';
    if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (host.includes('icims.com')) return 'icims';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('jobvite.com')) return 'jobvite';
    return 'generic';
  }

  function visible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function labelOf(element) {
    const parts = [];
    ['aria-label', 'name', 'placeholder', 'data-testid', 'data-automation-id', 'data-qa', 'id', 'title'].forEach((attribute) => {
      const value = element.getAttribute?.(attribute);
      if (value) parts.push(value);
    });
    if (element.id) {
      try {
        document.querySelectorAll(`label[for="${CSS.escape(element.id)}"]`).forEach((label) => parts.push(label.innerText));
      } catch {}
    }
    const labelledBy = element.getAttribute?.('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const node = document.getElementById(id);
        if (node) parts.push(node.innerText);
      });
    }
    return clean(parts.filter(Boolean).join(' | '));
  }

  function detectPageType() {
    const body = normalize(document.body?.innerText?.slice(0, 14000) || '');
    const url = location.href.toLowerCase();
    const hasForm = !!document.querySelector('form, input, textarea, select, [contenteditable="true"], [role="combobox"]');
    const hasApplicationLanguage = /apply now|apply for|application|resume|cover letter|work authorization|equal opportunity|additional information|candidate information|employment history/.test(body);
    const hasJobLanguage = /job description|responsibilities|qualifications|required skills|preferred qualifications|about the role/.test(body);
    const isReview = /review your application|review application|check your application|ready to submit|submit application/.test(body);
    const isQuestionPage = /application questions|additional questions|candidate questions|supplemental questions|screening questions/.test(body);
    if (hasForm && isReview) return 'review';
    if (hasForm && isQuestionPage) return 'questions';
    if (hasForm && hasApplicationLanguage) return 'application';
    if (hasJobLanguage && !hasForm) return 'job';
    if (/\/apply(?:\/|\?|$)|\/application(?:\/|\?|$)|apply\?|application\?/.test(url) && hasForm) return 'application';
    return hasForm ? 'form' : 'other';
  }

  function detectApplicationStage(pageType) {
    if (!['application','questions','review','form'].includes(pageType)) return null;
    const body = normalize(document.body?.innerText?.slice(0, 10000) || '');
    if (pageType === 'review') return 'review';
    if (pageType === 'questions') return 'questions';
    if (/experience|employment history|work history/.test(body)) return 'experience';
    if (/education|school|degree/.test(body)) return 'education';
    if (/personal information|contact information|first name|last name/.test(body)) return 'profile';
    return 'application';
  }

  function detectFields() {
    const selectors = 'input,select,textarea,[role="combobox"],[role="radio"],[role="checkbox"],[contenteditable="true"],button[aria-haspopup="listbox"]';
    return Array.from(document.querySelectorAll(selectors))
      .filter(visible)
      .slice(0, 250)
      .map((element, index) => ({
        index,
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || null,
        role: element.getAttribute('role') || null,
        label: labelOf(element),
        name: element.getAttribute('name') || null,
        required: !!element.required || element.getAttribute('aria-required') === 'true',
        canonicalField: canonicalField(element, labelOf(element)),
        site: classifySite(location.hostname),
      }))
      .filter((field) => field.label || field.name || field.type === 'file');
  }

  function snapshot(reason = 'navigation') {
    const pageType = detectPageType();
    return {
      version: 1,
      reason,
      url: location.href,
      origin: location.origin,
      hostname: location.hostname,
      title: clean(document.title),
      site: classifySite(location.hostname),
      pageType,
      applicationStage: detectApplicationStage(pageType),
      fields: ['application','questions','review','form'].includes(pageType) ? detectFields() : [],
      timestamp: Date.now(),
    };
  }

  let lastUrl = location.href;
  let lastSent = '';
  let timer = null;

  function send(reason) {
    const data = snapshot(reason);
    const signature = JSON.stringify({ url: data.url, pageType: data.pageType, site: data.site, fieldCount: data.fields.length });
    if (signature === lastSent && reason !== 'ready') return;
    lastSent = signature;
    chrome.runtime.sendMessage({ type: 'PAGE_AGENT_SNAPSHOT', snapshot: data }).catch(() => {});
  }

  function schedule(reason) {
    clearTimeout(timer);
    timer = setTimeout(() => send(reason), 250);
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    schedule('history_push');
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    schedule('history_replace');
    return result;
  };

  window.addEventListener('popstate', () => schedule('history_pop'));
  window.addEventListener('hashchange', () => schedule('hash_change'));

  const observer = new MutationObserver(() => schedule('dom_changed'));
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      schedule('url_changed');
    }
  }, 1000);

  chrome.runtime.sendMessage({ type: 'PAGE_AGENT_READY', snapshot: snapshot('ready') }).catch(() => {});
})();
