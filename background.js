const JOB_PREFIX = "jobState:";
let refreshInFlight = null;
const activeGenerations = new Map();

function normalizeJobUrl(value) {
  return String(value || "").trim().toLowerCase().replace(/#.*$/, "").replace(/\?$/, "").replace(/\/$/, "");
}

function jobIdentity(job) {
  const url = String(job?.jobUrl || "").trim().toLowerCase().replace(/[?#&]jr_id=[^&#]*/g, "").replace(/\/$/, "");
  return `${job?.profileId || ""}|${url || `${String(job?.companyName || "").trim().toLowerCase()}|${String(job?.jobTitle || "").trim().toLowerCase()}`}`;
}

function newJobContextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

async function baseUrl() {
  const data = await chrome.storage.local.get("heronsolBaseUrl");
  return (data.heronsolBaseUrl || "https://platform.totalynx.com/").replace(/\/+$/, "");
}

async function getSession() {
  return chrome.storage.local.get(["accessToken", "refreshToken", "expiresAt"]);
}

async function saveSession(session) {
  await chrome.storage.local.set(session);
}

async function refreshSession(force = false) {
  const current = await getSession();
  if (!current.refreshToken) throw new Error("Please sign in to HeronSol in the extension first.");

  const now = Math.floor(Date.now() / 1000);
  if (!force && current.accessToken && current.expiresAt && current.expiresAt > now + 90) {
    return current;
  }

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const response = await fetch(`${await baseUrl()}/api/extension/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh", refreshToken: current.refreshToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.session) {
      throw new Error(data.error || "Your HeronSol session expired. Please sign in again.");
    }
    await saveSession({
      accessToken: data.session.accessToken,
      refreshToken: data.session.refreshToken,
      expiresAt: data.session.expiresAt
    });
    return getSession();
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function isCloudflareTimeout(response) {
  if (response.status !== 500 && response.status !== 502 && response.status !== 503 && response.status !== 504) return false;
  const type = response.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) {
    const text = await response.clone().text().catch(() => "");
    return /error code 522|connection timed out|cloudflare/i.test(text);
  }
  return false;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function apiFetch(path, options = {}) {
  let session = await refreshSession(false);
  const url = await baseUrl();
  const makeRequest = () => fetch(`${url}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${session.accessToken}`
    }
  });

  let response = await makeRequest();
  if (response.status === 401) {
    session = await refreshSession(true);
    response = await makeRequest();
  }

  // Supabase/Cloudflare 522s are transient upstream failures. Retry only when
  // the response is actually the Cloudflare timeout page; never retry normal
  // application 500s such as AI-generation validation failures.
  if (await isCloudflareTimeout(response)) {
    for (const delay of [700, 1500]) {
      await wait(delay);
      response = await makeRequest();
      if (!(await isCloudflareTimeout(response))) break;
    }
  }
  return response;
}

async function getJobState(tabId, expectedUrl = null) {
  const key = `${JOB_PREFIX}${tabId}`;
  const data = await chrome.storage.session.get(key);
  const state = data[key] || null;
  if (!state) return null;
  if (expectedUrl && state.jobUrl && normalizeJobUrl(expectedUrl) !== normalizeJobUrl(state.jobUrl)) return null;
  return state;
}

async function setJobState(tabId, patch) {
  const key = `${JOB_PREFIX}${tabId}`;
  const current = (await chrome.storage.session.get(key))[key] || { tabId };
  const next = { ...current, ...patch, tabId, updatedAt: Date.now() };
  await chrome.storage.session.set({ [key]: next });
  return next;
}

function sanitizePathPart(value, fallback = "Item") {
  return String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/^[. ]+/g, "") || fallback;
}

function localDateParts(date = new Date()) {
  return {
    month: date.getMonth() + 1,
    day: date.getDate(),
    year: date.getFullYear(),
    stamp: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    display: `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`,
  };
}

function localDateFolder(profileName, date = new Date()) {
  const parts = localDateParts(date);
  return `${sanitizePathPart(profileName, "Resume")}-(${parts.display})`;
}

function applicationFolder(profileName, companyName, existingFolder = "") {
  if (existingFolder) return existingFolder;
  const safeProfile = sanitizePathPart(profileName, "Profile");
  const safeCompany = sanitizePathPart(companyName, "Company");
  return `${safeProfile}/${safeCompany}`;
}

function screenshotFilename(profileName, companyName, existingFolder = "") {
  return `${applicationFolder(profileName, companyName, existingFolder)}/Screenshot.png`;
}

function getApplicationFolder(job) {
  return applicationFolder(job?.profileName, job?.companyName, job?.downloadFolder || "");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(data);
    const local = concatBytes(
      new Uint8Array([0x50,0x4b,0x03,0x04]), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
    );
    const central = concatBytes(
      new Uint8Array([0x50,0x4b,0x01,0x02]), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
    );
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }
  const central = concatBytes(...centralParts);
  const locals = concatBytes(...localParts);
  const end = concatBytes(new Uint8Array([0x50,0x4b,0x05,0x06]), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(locals.length), u16(0));
  return concatBytes(locals, central, end);
}

function escapeXml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function coverLetterDocxBytes(text) {
  const paragraphs = String(text || "").split(/\r?\n/).map(line => line.trim());
  const body = paragraphs.map(line => line ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>` : "<w:p/>").join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  return createStoredZip([
    {name:"[Content_Types].xml",data:contentTypes},
    {name:"_rels/.rels",data:rels},
    {name:"word/document.xml",data:documentXml},
    {name:"word/_rels/document.xml.rels",data:documentRels}
  ]);
}



async function captureTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      const text = (node) => clean(node?.innerText || node?.textContent || "");
      const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const host = location.hostname.toLowerCase();
      const meta = (name) => clean(document.querySelector(`meta[name="${name}"]`)?.content);
      const prop = (name) => clean(document.querySelector(`meta[property="${name}"]`)?.content);

      const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((node) => {
        try { return JSON.parse(node.textContent || "null"); } catch { return null; }
      });
      const postings = [];
      const collect = (value) => {
        if (!value) return;
        if (Array.isArray(value)) return value.forEach(collect);
        if (typeof value !== "object") return;
        const type = value["@type"];
        if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) postings.push(value);
        if (Array.isArray(value["@graph"])) value["@graph"].forEach(collect);
        if (value.mainEntity) collect(value.mainEntity);
      };
      jsonLd.forEach(collect);
      const posting = postings[0] || null;
      const organization = posting?.hiringOrganization;
      let company = clean(typeof organization === "string" ? organization : organization?.name);
      let title = clean(posting?.title);

      const first = (selectors) => {
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          const value = text(node);
          if (value && value.length < 220) return value;
        }
        return "";
      };

      company ||= first([
        '[data-company-name]', '[data-employer-name]', '[data-testid*="company" i]',
        '[class*="company-name" i]', '[class*="employer-name" i]',
        '[class*="employer" i]', '[class*="company" i]'
      ]);
      title ||= first(['h1', '[data-testid*="job-title" i]', '[class*="job-title" i]']) || meta("title") || prop("og:title");

      const sectionNoise = /apply|submit|sign in|log in|create alert|job alert|privacy|cookie|equal opportunity|eeo|demographic|voluntary|cover letter|resume\/cv|upload|first name|last name|phone|email|country|location \(city\)|how did you hear/i;
      const jdHeadings = /about (the )?role|about the position|job description|what you.?ll do|responsibilities|what you.?ll bring|required skills|preferred skills|qualifications|requirements|your responsibilities|key responsibilities|skills and experience|the role/i;
      const jdNodeSelectors = [
        '[data-job-description]', '[data-testid*="job-description" i]', '[data-test*="job-description" i]',
        '[id*="job-description" i]', '[class*="job-description" i]', '[class*="jobDescription" i]',
        '[data-qa*="job-description" i]', '[itemprop="description"]',
        '.show-more-less-html__markup', '.description__text', '#jobDescriptionText',
        '[data-testid="jobDescriptionText"]', '[data-test="jobDescriptionContent"]'
      ];

      let description = "";
      for (const selector of jdNodeSelectors) {
        const node = document.querySelector(selector);
        const value = text(node);
        if (value.length >= 500 && !sectionNoise.test(value.slice(-1200))) { description = value; break; }
      }

      if (!description) {
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')).filter((h) => visible(h));
        const chunks = [];
        for (const heading of headings) {
          const headingText = text(heading);
          if (!jdHeadings.test(headingText)) continue;
          let node = heading.parentElement;
          let depth = 0;
          while (node && depth < 4) {
            const value = text(node);
            if (value.length >= 500 && value.length <= 30000) { chunks.push(value); break; }
            node = node.parentElement; depth++;
          }
        }
        if (chunks.length) description = chunks.sort((a,b) => b.length-a.length)[0];
      }

      if (!description) {
        const candidates = Array.from(document.querySelectorAll('main,article,section,div'))
          .filter((node) => visible(node))
          .map((node) => ({ node, value: text(node) }))
          .filter(({ value }) => value.length >= 500 && value.length <= 30000)
          .map(({ node, value }) => {
            const headings = Array.from(node.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')).map(text).join(" ");
            const forms = node.querySelectorAll('input,select,textarea,button,[role="combobox"]').length;
            let score = Math.min(value.length / 500, 30);
            if (jdHeadings.test(headings)) score += 20;
            if (sectionNoise.test(value.slice(-1500))) score -= 25;
            if (forms > 5) score -= Math.min(forms * 1.5, 25);
            if (/apply for this job|submit application|create a job alert/i.test(value)) score -= 30;
            return { value, score };
          })
          .sort((a,b) => b.score-a.score);
        description = candidates[0]?.value || "";
      }

      if (!company) {
        company = Array.from(document.querySelectorAll('a[href*="/company/"]')).map(text).find((x) => x.length > 1 && x.length < 120) || "";
      }

      const trimToJob = (value) => {
        const lines = String(value || "").split(/\n+/).map(clean).filter(Boolean);
        const out = [];
        for (const line of lines) {
          if (/^(create (a )?job alert|apply for this job|submit application|first name|last name|email|phone|resume\/cv|cover letter|voluntary demographic)/i.test(line)) break;
          if (out.length && sectionNoise.test(line) && line.length < 100) continue;
          out.push(line);
        }
        return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      };

      return {
        ok: true,
        companyName: company,
        jobTitle: title,
        jobDescription: trimToJob(description),
        jobUrl: location.href,
        jobSite: host
      };

      function visible(el) {
        if (!el || !(el instanceof Element)) return false;
        const style = getComputedStyle(el), rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }
    }
  });
  return results?.[0]?.result || { ok: false, error: "Unable to read the current job page." };
}

async function downloadResume(resumeVersionId, tabId, companyName, profileName, jobDescription) {
  const response = await apiFetch(`/api/extension/resumes/${encodeURIComponent(resumeVersionId)}/download`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Resume download failed (${response.status}).`);
  }

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${btoa(binary)}`;
  const folder = applicationFolder(profileName, companyName);
  const filename = `${folder}/Resume.docx`;
  const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: "overwrite" });

  const jdText = String(jobDescription || "").trim();
  let jobDescriptionDownloadId = null;
  if (jdText) {
    const jdDataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(jdText)}`;
    jobDescriptionDownloadId = await chrome.downloads.download({
      url: jdDataUrl,
      filename: `${folder}/Job Description.txt`,
      saveAs: false,
      conflictAction: "overwrite"
    });
  }

  await setJobState(tabId, { status: "downloaded", downloadId, jobDescriptionDownloadId, resumeVersionId, downloadFilename: filename, downloadFolder: folder });
  return { downloadId, jobDescriptionDownloadId, filename };
}

async function getAutofillProfile(profileId) {
  const response = await apiFetch(`/api/extension/profiles/${encodeURIComponent(profileId)}/autofill`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Unable to load profile data (${response.status}).`);
  return data.profile;
}

async function generateCoverLetterForTab(tabId) {
  const job = await getJobState(tabId);
  if (!job?.applicationId) throw new Error("Generate the tailored resume before generating a cover letter.");

  const response = await apiFetch(`/api/extension/applications/${encodeURIComponent(job.applicationId)}/cover-letter`, {
    method: "POST"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Cover letter generation failed (${response.status}).`);

  const next = await setJobState(tabId, {
    coverLetter: String(data.coverLetter || "").trim(),
    coverLetterCost: data.cost ?? null,
    coverLetterInputTokens: data.inputTokens ?? null,
    coverLetterOutputTokens: data.outputTokens ?? null,
    coverLetterGeneratedAt: new Date().toISOString()
  });
  return { ...data, job: next };
}

async function generateApplicationAnswersForTab(tabId, questions) {
  const job = await getJobState(tabId);
  if (!job?.applicationId) throw new Error("Generate the tailored resume before answering questions.");

  const cleaned = Array.from(new Set((Array.isArray(questions) ? questions : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)))
    .slice(0, 20);

  if (!cleaned.length) throw new Error("Enter or detect at least one application question.");

  const response = await apiFetch(`/api/extension/applications/${encodeURIComponent(job.applicationId)}/questions`, {
    method: "POST",
    body: JSON.stringify({ questions: cleaned })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Application answer generation failed (${response.status}).`);

  const existing = Array.isArray(job.applicationAnswers) ? job.applicationAnswers : [];
  const merged = new Map(existing.map((item) => [String(item.id || item.question), item]));
  (Array.isArray(data.answers) ? data.answers : []).forEach((item) => {
    merged.set(String(item.id || item.question), item);
  });

  const next = await setJobState(tabId, {
    applicationAnswers: Array.from(merged.values()),
    questionGenerationCost: data.cost ?? null,
    questionGenerationInputTokens: data.inputTokens ?? null,
    questionGenerationOutputTokens: data.outputTokens ?? null,
    questionsGeneratedAt: new Date().toISOString()
  });

  return { ...data, job: next };
}

async function downloadCoverLetterForTab(tabId) {
  const job = await getJobState(tabId);
  const coverLetter = String(job?.coverLetter || "").trim();
  if (!coverLetter) throw new Error("Generate or save the cover letter first.");
  if (!job?.companyName || !job?.profileName) throw new Error("Capture the job before downloading the cover letter.");

  const folder = getApplicationFolder(job);
  const bytes = coverLetterDocxBytes(coverLetter);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${btoa(binary)}`;
  const filename = `${folder}/Cover Letter.docx`;
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "overwrite"
  });
  await setJobState(tabId, { coverLetterDownloadId: downloadId, coverLetterFilename: filename, downloadFolder: folder });
  return { downloadId, filename };
}

async function getResumeAutofillData(resumeVersionId) {
  const response = await apiFetch(`/api/extension/resumes/${encodeURIComponent(resumeVersionId)}/autofill`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Unable to load generated resume data (${response.status}).`);
  return data.resume || {};
}

async function getResumeBase64(resumeVersionId) {
  const response = await apiFetch(`/api/extension/resumes/${encodeURIComponent(resumeVersionId)}/download`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Resume download failed (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  return btoa(binary);
}

async function getExtensionSettings(profileId) {
  const response = await apiFetch(`/api/extension/profiles/${encodeURIComponent(profileId)}/settings`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Unable to load extension settings (${response.status}).`);
  return data.settings || {};
}

async function saveExtensionSettings(profileId, settings) {
  const response = await apiFetch(`/api/extension/profiles/${encodeURIComponent(profileId)}/settings`, {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Unable to save extension settings (${response.status}).`);
  return data.settings || settings;
}

async function scanApplicationForTab(tabId) {
  const job = await getJobState(tabId);
  if (!job?.jobUrl) throw new Error("Capture the current job before scanning the application.");
  const currentTab = await chrome.tabs.get(tabId);
  if (normalizeJobUrl(currentTab?.url) !== normalizeJobUrl(job.jobUrl)) throw new Error("The job page changed. Capture this job again before scanning.");
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
      const normalize = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const visible = (el) => {
        if (!el || !(el instanceof Element)) return false;
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
      };
      const labelOf = (el) => {
        const parts = [];
        ["aria-label","name","placeholder","data-testid","data-automation-id","data-qa","id","title"].forEach(a => { const v=el.getAttribute?.(a); if(v) parts.push(v); });
        if (el.id) { try { document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach(x=>parts.push(x.innerText)); } catch {} }
        const ids = el.getAttribute?.("aria-labelledby");
        if (ids) ids.split(/\s+/).forEach(id => { const x=document.getElementById(id); if(x) parts.push(x.innerText); });
        let p=el.parentElement, depth=0;
        while(p && depth++<3){ const t=clean(p.innerText); if(/label|field|question|form-group|form-control|application/i.test(p.className||"") || p.tagName==='LABEL' || p.tagName==='FIELDSET') if(t.length<500) parts.push(t); p=p.parentElement; }
        return clean(parts.filter(Boolean).join(" | "));
      };
      const typeOf = (el) => {
        if (el instanceof HTMLInputElement) return `input:${el.type || "text"}`;
        if (el instanceof HTMLSelectElement) return "select";
        if (el instanceof HTMLTextAreaElement) return "textarea";
        if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox") return "combobox";
        if (el.getAttribute("role") === "radio") return "radio";
        if (el.getAttribute("role") === "checkbox") return "checkbox";
        if (el.isContentEditable) return "contenteditable";
        return el.tagName.toLowerCase();
      };
      const controls = Array.from(document.querySelectorAll('input,select,textarea,[role="combobox"],[role="radio"],[role="checkbox"],[contenteditable="true"],button[aria-haspopup="listbox"]')).filter(visible);
      const fields = controls.map((el, index) => {
        const label = labelOf(el);
        const required = !!el.required || el.getAttribute("aria-required") === "true" || /\*/.test(label);
        const questionLike = el instanceof HTMLTextAreaElement || /why|describe|explain|tell us|experience|achievement|interest|motivation|anything else|additional information/i.test(label);
        return { index, label, type: typeOf(el), required, questionLike, value: clean(el.value || el.textContent || "") };
      }).filter(x => x.label || x.type === "textarea");
      const questions = fields.filter(x => x.questionLike && x.type !== "input:file" && x.label.length > 8);
      const fileFields = fields.filter(x => x.type === "input:file").map(x => ({...x, kind: /cover\s*letter|coverletter|letter/i.test(x.label) ? "cover_letter" : /resume|cv|curriculum/i.test(x.label) ? "resume" : "other"}));
      return { host: location.hostname, url: location.href, totalFields: fields.length, fields, questions, fileFields };
    }
  });
  const result = results?.[0]?.result || { totalFields: 0, fields: [], questions: [], fileFields: [] };
  await setJobState(tabId, { scan: result, pageUrl: job.jobUrl, scannedAt: Date.now() });
  return result;
}

async function autofillForTab(tabId) {
  const job = await getJobState(tabId);
  if (!job?.jobUrl) throw new Error("Capture the current job before autofill.");
  const currentTab = await chrome.tabs.get(tabId);
  if (normalizeJobUrl(currentTab?.url) !== normalizeJobUrl(job.jobUrl)) throw new Error("The job page changed. Capture this job again before autofill.");
  if (!job?.profileId || !job?.resumeVersionId) throw new Error("Generate the resume first, then use Autofill.");

  const profile = await getAutofillProfile(job.profileId);
  const generatedResume = await getResumeAutofillData(job.resumeVersionId);
  const base64 = await getResumeBase64(job.resumeVersionId);
  const settings = await getExtensionSettings(job.profileId);
  const safeName = (profile.name || "Resume").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "Resume";
  const resume = { base64, filename: `${safeName}.docx`, content: generatedResume.content || generatedResume };
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (profileData, resumeData, extensionSettings) => {
      const HKEY = "__HERONSOL_AUTOFILL_V3__";
      const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
      const normalize = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const visible = (el) => { if (!el || !(el instanceof Element)) return false; const s=getComputedStyle(el),r=el.getBoundingClientRect(); return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0; };
      const textOf = (el) => clean(el?.innerText || el?.textContent || "");
      const fire = (el, type) => { try { el.dispatchEvent(new Event(type,{bubbles:true,cancelable:true})); } catch {} };
      const click = (el) => { try { el.scrollIntoView({block:"center",inline:"nearest"}); } catch {} try { el.click(); return true; } catch {} return false; };
      const nativeSetter = (el) => el instanceof HTMLTextAreaElement ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
      const setValue = (el, value) => { const setter=nativeSetter(el); if(setter) setter.call(el,value); else el.value=value; fire(el,"input"); fire(el,"change"); };
      const labelOf = (el) => {
        const parts=[]; ["aria-label","name","placeholder","data-testid","data-automation-id","data-qa","id","title"].forEach(a=>{const v=el.getAttribute?.(a);if(v)parts.push(v);});
        if(el.id){try{document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach(x=>parts.push(x.innerText));}catch{}}
        const ids=el.getAttribute?.("aria-labelledby"); if(ids) ids.split(/\s+/).forEach(id=>{const x=document.getElementById(id);if(x)parts.push(x.innerText);});
        let p=el.parentElement,d=0; while(p&&d++<3){const t=clean(p.innerText);if(/label|field|question|form-group|form-control|application/i.test(p.className||"")||p.tagName==='LABEL'||p.tagName==='FIELDSET')if(t.length<500)parts.push(t);p=p.parentElement;}
        return normalize(parts.filter(Boolean).join(" | "));
      };
      const optionText = (o) => normalize(`${o?.textContent||""} ${o?.value||""} ${o?.getAttribute?.("aria-label")||""} ${o?.getAttribute?.("data-value")||""}`);
      const matchOption = (nodes, wanted) => { const w=normalize(wanted); if(!w)return null; const a=Array.from(nodes).filter(visible); return a.find(o=>optionText(o)===w)||a.find(o=>optionText(o).startsWith(w+" "))||a.find(o=>optionText(o).includes(w))||null; };
      const state={filled:0,fileUploaded:false,coverLetterUploaded:false,details:[],unresolved:[],ats:location.hostname};
      // Questions are optional. Autofill must always work even when no answers were generated.
      const mark=(el,detail)=>{el.dataset.heronsolAutofilled="1";el.dataset.heronsolOwner="extension";state.filled++;state.details.push(detail);};
      const normalizedCustom = Object.entries(extensionSettings?.customFields || {}).map(([k,v])=>[normalize(k),String(v??"")]);
      const profileName=clean(profileData.name), firstName=profileName.split(/\s+/)[0]||"", lastName=profileName.split(/\s+/).slice(1).join(" ");
      const generated=typeof resumeData.content==='string'?(()=>{try{return JSON.parse(resumeData.content)}catch{return{}}})():(resumeData.content||{});
      const experiences=Array.isArray(generated.experiences)?generated.experiences:[];
      const summary=clean(generated.professional_summary||generated.summary||"");
      const answerFor=(label,el)=>{
        const n=normalize(`${label} ${el.name||""}`);
        const built=[
          [/first name|given name/,firstName],[/last name|surname|family name/,lastName],[/full name|your name/,profileName],
          [/email|e mail/,profileData.email||extensionSettings.email],[/phone|mobile|telephone|tel/,profileData.phone||extensionSettings.phone],[/linkedin/,profileData.linkedin_url],[/github/,profileData.github_url],
          [/street address|mailing address|address line 1|home address/,profileData.address],[/city/,extensionSettings.city||""],[/state|province/,extensionSettings.state||""],
          [/postal|zip/,extensionSettings.postalCode||""],[/country/,extensionSettings.country||""],[/current employer|most recent employer/,extensionSettings.currentEmployer||""],
          [/current job title|most recent job title/,extensionSettings.currentTitle||""],[/gender|sex/,extensionSettings.gender||""],[/work authorization|authorized to work|legally authorized/,extensionSettings.workAuthorization||""],
          [/sponsorship|visa sponsorship|require sponsorship/,extensionSettings.sponsorship||""],[/relocat|relocation/,extensionSettings.relocation||""],[/travel/,extensionSettings.travel||""],
          [/desired salary|salary expectation/,extensionSettings.desiredSalary||""],[/start date|available to start|availability/,extensionSettings.startDate||""],[/how did you hear|source/,extensionSettings.source||""]
        ];
        if(el instanceof HTMLInputElement){
          const inputType=String(el.type||"text").toLowerCase();
          if(inputType === "email" && (profileData.email||extensionSettings.email)) return String(profileData.email||extensionSettings.email);
          if(inputType === "tel" && (profileData.phone||extensionSettings.phone)) return String(profileData.phone||extensionSettings.phone);
        }
        for(const [re,val] of built) if(re.test(n)&&val) return String(val);
        for(const [k,v] of normalizedCustom) if(k && (n.includes(k)||k.includes(n)) && v) return v;
        return null;
      };
      const selectValue=async(el,wanted)=>{ const option=matchOption(el.options||[],wanted); if(!option)return false; const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value")?.set; if(setter)setter.call(el,option.value);else el.value=option.value; fire(el,"input");fire(el,"change"); await new Promise(r=>setTimeout(r,30)); return el.value===option.value; };
      const comboValue=async(el,wanted)=>{ click(el); await new Promise(r=>setTimeout(r,100)); let option=matchOption(document.querySelectorAll('[role="option"], [role="listbox"] [role="option"]'),wanted); if(option){click(option);await new Promise(r=>setTimeout(r,60));return true;} if(el instanceof HTMLInputElement){setValue(el,wanted);await new Promise(r=>setTimeout(r,150));option=matchOption(document.querySelectorAll('[role="option"], [role="listbox"] [role="option"]'),wanted);if(option){click(option);return true;}} return false; };
      const upload=async(el,data,kind)=>{ if(!data||el.dataset.heronsolAutofilled==="1")return false; const label=labelOf(el); if(kind==="resume"&&!/resume|cv|curriculum/i.test(label))return false; if(kind==="cover_letter"&&!/cover\s*letter|coverletter/i.test(label))return false; try{const bin=atob(data.base64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);const file=new File([bytes],data.filename,{type:data.mime||"application/pdf"});const dt=new DataTransfer();dt.items.add(file);el.files=dt.files;fire(el,"input");fire(el,"change");mark(el,kind==="resume"?"Resume uploaded":"Cover letter uploaded");if(kind==="resume")state.fileUploaded=true;else state.coverLetterUploaded=true;return true;}catch{return false;}};
      const controls=Array.from(document.querySelectorAll('input,select,textarea,[role="combobox"],[role="radio"],[role="checkbox"],[contenteditable="true"],button[aria-haspopup="listbox"]')).filter(visible);
      for(const el of controls){
        if(el.disabled||el.readOnly||el.dataset.heronsolOwner==="user")continue;
        const label=labelOf(el); if(!label)continue;
        if(el instanceof HTMLInputElement&&el.type==="file"){
          if(/resume|cv|curriculum/i.test(label)) await upload(el,resumeData,"resume");
          continue;
        }
        const value=answerFor(label,el);
         if(el instanceof HTMLSelectElement&&value){if(await selectValue(el,value))mark(el,`Select: ${value}`);else state.unresolved.push({label,type:"select"});continue;}
        if((el.getAttribute("role")==="combobox"||el.getAttribute("aria-haspopup")==="listbox")&&value){if(await comboValue(el,value))mark(el,`Combobox: ${value}`);else state.unresolved.push({label,type:"combobox"});continue;}
        if((el.type==="radio"||el.getAttribute("role")==="radio")&&value){const group=el.closest('fieldset,[role="radiogroup"],[role="group"]')||el.parentElement;const candidates=group?Array.from(group.querySelectorAll('input[type="radio"],[role="radio"]')):[el];const target=candidates.find(x=>optionText(x)===normalize(value)||optionText(x).includes(normalize(value))||normalize(textOf(x.parentElement)).includes(normalize(value)));if(target){click(target);mark(el,`Radio: ${value}`);}continue;}
        if((el.type==="checkbox"||el.getAttribute("role")==="checkbox")&&value){const yes=/^(yes|true|1|checked)$/i.test(value);if(!!el.checked!==yes)click(el);mark(el,`Checkbox: ${value}`);continue;}
        if(value&&!(el instanceof HTMLSelectElement)){setValue(el,value);mark(el,`Field: ${value}`);continue;}
        const n=normalize(label);
        if(summary&&el instanceof HTMLTextAreaElement&&/professional summary|summary|about you|about me|introduction/.test(n)){setValue(el,summary);mark(el,"Generated resume summary");continue;}
        if(el.isContentEditable&&summary&&/summary|about|introduction/.test(n)){el.textContent=summary;fire(el,"input");fire(el,"change");mark(el,"Generated resume summary");}
      }
      // Intentionally no MutationObserver: after the user changes a field, the extension must not fight them.
      window[HKEY]={at:Date.now()};
      return state;
    },
    args: [profile, resume, settings, coverLetter, applicationAnswers, generatedCoverLetter]
  });
  const result = results?.[0]?.result || { filled: 0, fileUploaded: false, coverLetterUploaded: false, details: [], unresolved: [], ats: "Generic" };
  await setJobState(tabId, { autofill: result, pageUrl: job.jobUrl, autofilledAt: Date.now() });
  return result;
}

async function saveApplicationScreenshot(tabId) {
  const job = await getJobState(tabId);
  if (!job?.companyName || !job?.profileName) throw new Error("Capture and generate the job before saving an application screenshot.");

  const tab = await chrome.tabs.get(tabId);
  if (!tab?.windowId || !tab?.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    throw new Error("Chrome cannot capture screenshots on this page.");
  }

  const now = new Date();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const folder = getApplicationFolder(job);
  const screenshotPath = screenshotFilename(job.profileName, job.companyName, folder);
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: screenshotPath,
    saveAs: false,
    conflictAction: "overwrite"
  });

  // Keep the local filesystem path in the HeronSol application as proof metadata.
  // The actual image remains on the bidder's computer in the Chrome Downloads folder.
  if (job.applicationId) {
    try {
      await apiFetch(`/api/extension/applications/${encodeURIComponent(job.applicationId)}/screenshot`, {
        method: "POST",
        body: JSON.stringify({ path: screenshotPath })
      });
    } catch (error) {
      // The screenshot itself is already safely downloaded. Metadata failure must not
      // turn a successful local screenshot into a failed extension action.
      console.warn("Unable to record screenshot metadata:", error);
    }
  }

  await setJobState(tabId, { screenshotDownloadId: downloadId, screenshotFilename: screenshotPath, lastScreenshotAt: now.toISOString(), downloadFolder: folder });
  return { downloadId, filename: screenshotPath };
}

async function markApplicationApplied(tabId) {
  const job = await getJobState(tabId);
  if (!job?.applicationId) throw new Error("No HeronSol application is associated with this job.");

  const response = await apiFetch(`/api/extension/applications/${encodeURIComponent(job.applicationId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "Applied" })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Unable to update application status (${response.status}).`);

  await setJobState(tabId, { applicationStatus: "Applied", appliedAt: data.appliedAt || new Date().toISOString() });
  return data;
}

async function generateForTab(tabId, payload) {
  if (activeGenerations.has(tabId)) return;
  activeGenerations.set(tabId, true);
  const current = await getJobState(tabId);
  const contextId = current?.jobContextId || newJobContextId();
  await setJobState(tabId, { jobContextId: contextId,
    status: "generating",
    error: null,
    companyName: payload.companyName,
    jobTitle: payload.jobTitle,
    jobUrl: payload.jobUrl,
    profileId: payload.profileId,
    profileName: payload.profileName,
    pageUrl: payload.jobUrl
  });

  try {
    const response = await apiFetch("/api/extension/applications", {
      method: "POST",
      body: JSON.stringify({
        profileId: payload.profileId,
        companyName: payload.companyName,
        jobTitle: payload.jobTitle,
        jobDescription: payload.jobDescription,
        jobUrl: payload.jobUrl,
        jobSite: payload.jobSite
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Generation failed (${response.status}).`);
    if (!data.resumeVersionId) throw new Error("HeronSol generated the application but did not return a resume version.");

    const latest = await getJobState(tabId);
    if (!latest || latest.jobContextId !== contextId) return;
    await setJobState(tabId, {
      status: "completed",
      applicationId: data.applicationId,
      resumeVersionId: data.resumeVersionId,
      error: null
    });
  } catch (error) {
    const latest = await getJobState(tabId);
    if (latest?.jobContextId === contextId) {
      await setJobState(tabId, { status: "failed", error: error?.message || "Unable to generate the resume." });
    }
  } finally {
    activeGenerations.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
      if (!tab?.id) throw new Error("No active tab was found.");
      if (!tab.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
        throw new Error("Chrome cannot read this page. Open the job posting in a normal web tab.");
      }
      const result = await captureTab(tab.id);
      await setJobState(tab.id, result.ok ? { ...result, jobContextId: newJobContextId(), status: "ready", error: null, applicationId: null, resumeVersionId: null, applicationAnswers: [], coverLetter: null, autofill: null, scan: null } : { ...result, status: "failed", error: result.error });
      sendResponse({ ...result, tabId: tab.id });
    }).catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to capture the current page." }));
    return true;
  }

  if (message?.type === "GET_TAB_STATE") {
    getJobState(message.tabId, message.url).then((state) => sendResponse({ ok: true, state })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GENERATE_FOR_TAB") {
    generateForTab(message.tabId, message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Generation failed." }));
    return true;
  }

  if (message?.type === "GENERATE_COVER_LETTER_FOR_TAB") {
    generateCoverLetterForTab(message.tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to generate the cover letter." }));
    return true;
  }

  if (message?.type === "GENERATE_APPLICATION_ANSWERS_FOR_TAB") {
    generateApplicationAnswersForTab(message.tabId, message.questions)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to generate application answers." }));
    return true;
  }

  if (message?.type === "DOWNLOAD_COVER_LETTER_FOR_TAB") {
    downloadCoverLetterForTab(message.tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to download the cover letter." }));
    return true;
  }

  if (message?.type === "DOWNLOAD_RESUME_FOR_TAB") {
    const tabId = message.tabId;
    getJobState(tabId).then(async (job) => {
      if (!job?.resumeVersionId) throw new Error("No generated resume is available for this tab.");
      return downloadResume(job.resumeVersionId, tabId, job.companyName, job.profileName, job.jobDescription);
    }).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to download the resume." }));
    return true;
  }

  if (message?.type === "SCAN_APPLICATION_FOR_TAB") {
    scanApplicationForTab(message.tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to scan the application." }));
    return true;
  }

  if (message?.type === "AUTOFILL_FOR_TAB") {
    autofillForTab(message.tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to autofill the application." }));
    return true;
  }

  if (message?.type === "SAVE_APPLICATION_SCREENSHOT") {
    saveApplicationScreenshot(message.tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to save the application screenshot." }));
    return true;
  }

  if (message?.type === "MARK_APPLICATION_APPLIED") {
    markApplicationApplied(message.tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to mark the application as applied." }));
    return true;
  }

  if (message?.type === "GET_EXTENSION_SETTINGS") {
    getExtensionSettings(message.profileId)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to load extension settings." }));
    return true;
  }

  if (message?.type === "SAVE_EXTENSION_SETTINGS") {
    saveExtensionSettings(message.profileId, message.settings || {})
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Unable to save extension settings." }));
    return true;
  }

  if (message?.type === "CLEAR_TAB_STATE") {
    chrome.storage.session.remove(`${JOB_PREFIX}${message.tabId}`).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  getJobState(tabId).then(async (job) => {
    if (!job?.jobUrl) return;
    const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[?#&]jr_id=[^&#]*/g, "").replace(/\/$/, "");
    if (normalize(changeInfo.url) !== normalize(job.jobUrl)) {
      await chrome.storage.session.remove(`${JOB_PREFIX}${tabId}`);
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`${JOB_PREFIX}${tabId}`).catch(() => {});
});
