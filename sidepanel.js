const state={accessToken:null,refreshToken:null,expiresAt:null,bidder:null,profiles:[],templates:[],activeTabId:null,activeTabUrl:null,job:null,scan:null,settings:{},customFields:[],tabLoadToken:0,applicationId:null,pageContext:null,contextRefreshTimer:null};
const $=id=>document.getElementById(id);
async function baseUrl(){const d=await chrome.storage.local.get("heronsolBaseUrl");return(d.heronsolBaseUrl||"https://platform.totalynx.com/").replace(/\/+$/,"")}
async function api(path,options={},retry=true){const url=await baseUrl();const makeRequest=()=>fetch(`${url}${path}`,{...options,headers:{"Content-Type":"application/json",...(options.headers||{}),...(state.accessToken?{Authorization:`Bearer ${state.accessToken}`}:{})}});let r=await makeRequest();if(r.status===401&&retry&&state.refreshToken){try{const refreshResponse=await fetch(`${url}/api/extension/auth`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"refresh",refreshToken:state.refreshToken})});const refreshData=await refreshResponse.json().catch(()=>({}));if(refreshResponse.ok&&refreshData.session){await setSession(refreshData);r=await api(path,options,false)}}catch{}}const is522=async(res)=>{if(![500,502,503,504].includes(res.status))return false;const type=res.headers.get("content-type")||"";if(!/text\/html/i.test(type))return false;const text=await res.clone().text().catch(()=>"");return /error code 522|connection timed out|cloudflare/i.test(text)};if(await is522(r)){for(const delay of [700,1500]){await new Promise(resolve=>setTimeout(resolve,delay));r=await makeRequest();if(!(await is522(r)))break}}const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d}
async function setSession(d){state.accessToken=d.session.accessToken;state.refreshToken=d.session.refreshToken;state.expiresAt=d.session.expiresAt;state.bidder=d.bidder;state.profiles=d.profiles||[];await chrome.storage.local.set({accessToken:state.accessToken,refreshToken:state.refreshToken,expiresAt:state.expiresAt,bidder:state.bidder,profiles:state.profiles})}
async function refresh(){if(!state.refreshToken)return false;const now=Math.floor(Date.now()/1000);if(state.expiresAt&&state.expiresAt>now+90)return true;try{const d=await api("/api/extension/auth",{method:"POST",body:JSON.stringify({action:"refresh",refreshToken:state.refreshToken})});await setSession(d);return true}catch{return false}}
function status(m,t=""){const el=$("status");if(el){el.textContent=m;el.className=`status ${t}`}renderStateMonitor()}
function renderStateMonitor(){
  const id=state.applicationId||state.job?.applicationId||null;
  const j=state.job||null;
  const page=(state.pageContext?.applicationStage||state.pageContext?.pageType||j?.pageType||j?.pageStatus||"").replace(/_/g," ").trim();
  const jdCaptured=!!(j?.jobDescription||j?.jobTitle||j?.companyName);
  const resumeState=j?.status==="generating"?"Generating":j?.resumeVersionId?(j.status==="downloaded"?"Downloaded":"Ready"):"Not generated";
  const idEl=$("stateApplicationId"), jdEl=$("stateJdState"), resumeEl=$("stateResumeState"), pageEl=$("stateMonitorPage");
  if(!idEl||!jdEl||!resumeEl||!pageEl)return;
  idEl.textContent=id||"No application";
  idEl.title=id||"No application linked";
  jdEl.textContent=jdCaptured?(j?.jobTitle?`Captured · ${j.jobTitle}`:"Captured"):"Not captured";
  resumeEl.textContent=resumeState;
  pageEl.textContent=`PAGE · ${page||"—"}`;
  jdEl.className=`state-value ${jdCaptured?"is-active":""}`;
  resumeEl.className=`state-value ${resumeState!=="Not generated"?"is-active":""}`;
  idEl.className=`state-value ${id?"is-active":""}`;
}
async function loadResumeTemplates(){
  const select=$("resumeTemplate");
  if(!select)return;
  let templates=[];
  try{
    // The platform is the single source of truth for available resume templates.
    // Prefer the dedicated template endpoint; fall back to the application endpoint
    // only for older platform deployments that expose templates there.
    try{
      const d=await api("/api/resume-templates",{method:"GET"});
      templates=Array.isArray(d?.templates)?d.templates:Array.isArray(d)?d:[];
    }catch{
      const d=await api("/api/extension/applications",{method:"GET"});
      templates=Array.isArray(d?.templates)?d.templates:[];
    }
  }catch(error){
    // Never invent templates when the platform cannot be reached.
    // Keep only the two currently supported built-in templates as a safe fallback.
    templates=[
      {id:"template_1",name:"Template 1",description:"Clean ATS structure"},
      {id:"template_2",name:"Template 2",description:"Dense technical format"}
    ];
  }
  // Normalize and de-duplicate the server response. Unsupported legacy template
  // IDs are never displayed or sent back to the platform.
  const seen=new Set();
  state.templates=templates.filter(t=>{
    const id=String(t?.id||t?.templateId||"");
    if(!/^template_[1-2]$/.test(id)||seen.has(id))return false;
    seen.add(id);
    return true;
  }).map(t=>({id:String(t.id||t.templateId),name:t.name||String(t.id||t.templateId),description:t.description||""}));
  if(!state.templates.length){
    state.templates=[
      {id:"template_1",name:"Template 1",description:"Clean ATS structure"},
      {id:"template_2",name:"Template 2",description:"Dense technical format"}
    ];
  }
  const selected=state.job?.resumeTemplateId;
  const validSelected=state.templates.some(t=>t.id===selected)?selected:state.templates[0].id;
  if(state.job && state.job.resumeTemplateId!==validSelected){
    state.job={...state.job,resumeTemplateId:validSelected};
  }
  select.replaceChildren(...state.templates.map(t=>{const o=document.createElement("option");o.value=t.id;o.textContent=t.name;return o;}));
  select.value=validSelected;
}
function showLogin(){$("loginView").classList.remove("hidden");$("mainView").classList.add("hidden");$("settingsView").classList.add("hidden");$("logout").classList.add("hidden")}
function showMain(){$("loginView").classList.add("hidden");$("settingsView").classList.add("hidden");$("mainView").classList.remove("hidden");$("logout").classList.remove("hidden");$("bidderName")?.remove();const p=$("profile");p.replaceChildren();state.profiles.forEach(x=>{const o=document.createElement("option");o.value=x.id;o.textContent=x.name;p.appendChild(o)});if(!state.profiles.length){const o=document.createElement("option");o.textContent="No assigned profiles";o.disabled=true;p.appendChild(o)} }
function switchTab(name){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));["job","apply","materials"].forEach(x=>$(`${x}Tab`).classList.toggle("hidden",x!==name))}
async function loadSettings(){
  const id=$("profile").value;
  if(!id)return;
  const r=await chrome.runtime.sendMessage({type:"GET_EXTENSION_SETTINGS",profileId:id});
  if(!r?.ok)throw new Error(r?.error||"Unable to load extension settings.");
  state.settings=r.settings||{};
  state.customFields=Object.entries(state.settings.customFields||{}).map(([key,value])=>({key,value}));
  fillSettings();
}
function fillSettings(){const map={email:"setEmail",phone:"setPhone",gender:"setGender",country:"setCountry",city:"setCity",state:"setState",postalCode:"setPostalCode",currentEmployer:"setCurrentEmployer",currentTitle:"setCurrentTitle",workAuthorization:"setWorkAuthorization",sponsorship:"setSponsorship",relocation:"setRelocation",travel:"setTravel",desiredSalary:"setDesiredSalary",startDate:"setStartDate",source:"setSource"};Object.entries(map).forEach(([k,id])=>$(id).value=state.settings[k]||"");renderCustom()}
function collectSettings(){const s={};const map={email:"setEmail",phone:"setPhone",gender:"setGender",country:"setCountry",city:"setCity",state:"setState",postalCode:"setPostalCode",currentEmployer:"setCurrentEmployer",currentTitle:"setCurrentTitle",workAuthorization:"setWorkAuthorization",sponsorship:"setSponsorship",relocation:"setRelocation",travel:"setTravel",desiredSalary:"setDesiredSalary",startDate:"setStartDate",source:"setSource"};Object.entries(map).forEach(([k,id])=>s[k]=$(id).value.trim());const custom={};state.customFields.forEach(x=>{if(x.key.trim())custom[x.key.trim()]=x.value});s.customFields=custom;return s}
function renderCustom(){const box=$("customFields");box.replaceChildren();state.customFields.forEach((x,i)=>{const row=document.createElement("div");row.className="custom-row";row.innerHTML=`<input data-key="${i}" value="${x.key.replace(/"/g,"&quot;")}" placeholder="Field name"><input data-value="${i}" value="${String(x.value||"").replace(/"/g,"&quot;")}" placeholder="Value"><button class="secondary" data-remove="${i}">×</button>`;box.appendChild(row)});box.querySelectorAll("input[data-key]").forEach(e=>e.oninput=()=>state.customFields[+e.dataset.key].key=e.value);box.querySelectorAll("input[data-value]").forEach(e=>e.oninput=()=>state.customFields[+e.dataset.value].value=e.value);box.querySelectorAll("button[data-remove]").forEach(e=>e.onclick=()=>{state.customFields.splice(+e.dataset.remove,1);renderCustom()})}
function renderWorkspace(){
  const card=$("workspaceCard"), title=$("workspaceTitle"), meta=$("workspaceMeta"), page=$("workspacePage"), ats=$("workspaceAts");
  if(!card||!title||!meta||!page||!ats)return;
  const j=state.job, p=state.pageContext;
  card.classList.remove("active","restoring","empty");
  const pageType=(p?.applicationStage||p?.pageType||j?.pageType||j?.pageStatus||"").replace(/_/g," ");
  if(state.applicationId || j?.applicationId){
    const id=state.applicationId||j.applicationId;
    const lifecycle={generating:"Generating resume",completed:"Resume ready",downloaded:"Resume downloaded",failed:"Action failed",ready:"Application ready"}[j?.status] || "Application active";
    card.classList.add("active");
    title.textContent=[j?.companyName,j?.jobTitle].filter(Boolean).join(" · ")||`Application ${String(id).slice(0,8)}`;
    meta.textContent=`Application ${String(id).slice(0,8)} · ${lifecycle}${pageType?` · ${pageType}`:""}`;
  }else{
    card.classList.add("empty");
    title.textContent=j?.companyName&&j?.jobTitle?[j.companyName,j.jobTitle].join(" · "):"No application linked";
    meta.textContent=j?"Job captured · generate a resume to create the application workspace":"This tab is not linked to an application yet.";
  }
  page.textContent=`PAGE · ${pageType||"—"}`;
  ats.textContent=`ATS · ${p?.siteName||j?.atsName||j?.ats||"—"}`;
  renderStateMonitor();
}
function markWorkspaceRestoring(tabUrl){
  const card=$("workspaceCard");
  if(!card)return;
  card.classList.remove("active","empty"); card.classList.add("restoring");
  $("workspaceTitle").textContent="Restoring application workspace…";
  $("workspaceMeta").textContent=tabUrl?"Loading the application bound to this tab.":"Loading current tab context.";
  $("workspacePage").textContent="PAGE · loading";
  $("workspaceAts").textContent="ATS · detecting";
}

function clearRenderedContext(){
  $("jobBox").classList.add("hidden");
  $("jobHeading").textContent="No job captured";
  $("jobSubheading").textContent="Scan the current job page to begin.";
  ["company","jobTitle","jobSite","jobUrl","description"].forEach(id=>$(id).value="");
  $("generate").disabled=false;
  $("downloadResume").classList.add("hidden");
  $("screenshot").classList.add("hidden");
  $("markApplied").classList.add("hidden");
  $("resumeState").textContent="Not generated";
  $("coverState").textContent="Optional · not generated";
  $("generateCoverLetter").classList.add("hidden");
  $("downloadCoverLetter").classList.add("hidden");
  $("coverLetterBox").classList.add("hidden");
  $("coverLetterText").value="";
  $("autofillResult")?.classList.add("hidden");
  $("autofillResult")?.replaceChildren();

  // A page/tab with no active application must never inherit the previous
  // application's success message. The status element is global UI, so it
  // must be reset whenever the active tab has no job state.
  renderStateMonitor();
  if (state.applicationId) {
    status("Application linked. Scan or open the application to continue.", "ok");
  } else {
    status("Ready to scan a job.", "");
  }
}
function renderJob(){
  renderWorkspace();
  const j=state.job;
  renderStateMonitor();
  if(!j){ clearRenderedContext(); return; }
  $("jobBox").classList.remove("hidden");
  $("company").value=j.companyName||""; $("jobTitle").value=j.jobTitle||""; $("jobSite").value=j.jobSite||""; $("jobUrl").value=j.jobUrl||""; $("description").value=j.jobDescription||"";
  $("jobHeading").textContent=j.jobTitle||"Untitled role";
  if($("resumeTemplate")){const selected=j.resumeTemplateId;const valid=state.templates.some(t=>t.id===selected)?selected:(state.templates[0]?.id||"template_1");$("resumeTemplate").value=valid;if(j.resumeTemplateId!==valid)state.job={...j,resumeTemplateId:valid};}
  const currentPage=(state.pageContext?.applicationStage||state.pageContext?.pageType||j.pageType||j.pageStatus||"").replace(/_/g," ");
  $("jobSubheading").textContent=currentPage ? [j.companyName,currentPage].filter(Boolean).join(" · ") : [j.companyName,j.jobSite].filter(Boolean).join(" · ");
  $("generate").disabled=["generating","downloading"].includes(j.status);
  $("downloadResume").classList.toggle("hidden",!j.resumeVersionId); $("screenshot").classList.toggle("hidden",!j.resumeVersionId);
  $("markApplied").classList.toggle("hidden",!j.applicationId||j.applicationStatus==="Applied");
  $("resumeState").textContent=j.resumeVersionId?"Generated and ready":"Not generated";
  $("coverState").textContent=j.coverLetter?`Generated · optional${j.coverLetterCost!=null?` · AI $${Number(j.coverLetterCost).toFixed(4)}`:""}`:"Optional · not generated";
  $("generateCoverLetter").classList.toggle("hidden",!j.applicationId||!!j.coverLetter); $("downloadCoverLetter").classList.toggle("hidden",!j.coverLetter);
  if(j.coverLetter){$("coverLetterBox").classList.remove("hidden");$("coverLetterText").value=j.coverLetter}else{$("coverLetterBox").classList.add("hidden");$("coverLetterText").value="";}
  // The lower status line follows the active page context. Resume lifecycle
  // state is still preserved, but it must not mask navigation between JD,
  // application, questions, and review pages.
  const currentPageLabel=(state.pageContext?.applicationStage||state.pageContext?.pageType||j.pageType||j.pageStatus||"").replace(/_/g," ").trim();
  const resumeLabel=j.resumeVersionId
    ? (j.status==="downloaded" ? "Tailored resume downloaded" : "Tailored resume ready")
    : "Resume not generated";
  if(j.status==="generating") status(`Generating your tailored resume… · ${currentPageLabel||"current page"}`,"busy");
  else if(j.status==="failed") status(j.error||"Generation failed.","error");
  else if(!state.applicationId) status("Job captured. Generate a tailored resume to create the application workspace.","");
  else if(currentPageLabel) status(`${currentPageLabel.charAt(0).toUpperCase()+currentPageLabel.slice(1)} page · ${resumeLabel}. Application state is preserved.`,j.resumeVersionId?"ok":"");
  else if(j.status==="completed") status("Tailored resume ready. Application state is preserved.","ok");
  else if(j.status==="downloaded") status("Tailored resume downloaded. Application state remains active.","ok");
  else status("Application workspace ready.","");
}
function renderScan(){
  const s=state.scan; const cards=$("applicationSummary").children; const q=$("questionsList"); q.replaceChildren();
  if(!s){ cards[0].querySelector("b").textContent="0"; cards[1].querySelector("b").textContent="0"; cards[2].querySelector("b").textContent="0"; $("fileSummary").textContent="No application scan yet."; $("questionState").textContent="Scan the current application to detect questions."; $("autofill").classList.add("hidden"); $("autofillResult")?.classList.add("hidden"); return; }
  cards[0].querySelector("b").textContent=s.totalFields||0; cards[1].querySelector("b").textContent=s.questions?.length||0; cards[2].querySelector("b").textContent=(s.fields||[]).filter(x=>x.required).length;
  $("fileSummary").textContent=s.fileFields?.length?`Documents detected: ${s.fileFields.map(x=>`${x.kind.replace("_"," ")} (${x.label})`).join(" · ")}`:"No document upload fields detected.";
  (s.questions||[]).slice(0,20).forEach((x,i)=>{const d=document.createElement("div");d.className="question";d.innerHTML=`<div class="tag">Question ${i+1} · ${x.required?"Required":"Optional"}</div><p>${String(x.label||"").replace(/[<>&]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</p>`;q.appendChild(d)});
  $("autofill").classList.toggle("hidden",!s.totalFields); $("questionState").textContent=s.questions?.length?`${s.questions.length} question(s) detected.`:"No open-ended questions detected.";
}
async function loadActiveTab(){
  const token=++state.tabLoadToken;
  const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if(!tab?.id||token!==state.tabLoadToken)return;
  state.activeTabId=tab.id;
  state.activeTabUrl=tab.url||null;
  state.applicationId=null;
  state.pageContext=null;
  markWorkspaceRestoring(state.activeTabUrl);
  const r=await chrome.runtime.sendMessage({type:"GET_TAB_STATE",tabId:tab.id,url:tab.url||null});
  if(token!==state.tabLoadToken||state.activeTabId!==tab.id)return;
  state.job=r?.state||null;
  state.applicationId=r?.applicationId||state.job?.applicationId||null;
  state.pageContext=r?.page||state.job?.pageSnapshot||null;
  state.scan=state.job?.scan||null;
  if(state.job?.profileId)$('profile').value=state.job.profileId;
  renderWorkspace();
  renderJob();
  renderScan();
}
function scheduleContextRefresh(){
  clearTimeout(state.contextRefreshTimer);
  state.contextRefreshTimer=setTimeout(()=>loadActiveTab().catch(()=>{}),120);
}

function saveJob(){if(!state.activeTabId||!state.job)return;state.job={...state.job,companyName:$("company").value,jobTitle:$("jobTitle").value,jobSite:$("jobSite").value,jobUrl:$("jobUrl").value,jobDescription:$("description").value};chrome.storage.session.set({[`jobState:${state.activeTabId}`]:{...state.job,tabId:state.activeTabId,updatedAt:Date.now()}})}
$("loginForm").onsubmit=async e=>{e.preventDefault();try{status("Signing in…","busy");const d=await api("/api/extension/auth",{method:"POST",body:JSON.stringify({action:"login",email:$("email").value.trim(),password:$("password").value})});await setSession(d);$("password").value="";showMain();await loadResumeTemplates();await loadSettings();await loadActiveTab();status("Signed in. Ready to scan a job.","ok")}catch(e){status(e.message,"error")}};
$("logout").onclick=async()=>{await chrome.storage.local.clear();Object.assign(state,{accessToken:null,refreshToken:null,expiresAt:null,bidder:null,profiles:[],job:null});showLogin();status("")};
$("profile").onchange=async()=>{await loadSettings();state.scan=null;renderScan();if(state.activeTabId&&state.job){state.job={...state.job,profileId:$("profile").value};chrome.storage.session.set({[`jobState:${state.activeTabId}`]:state.job})}};
$("settingsBtn").onclick=async()=>{$("mainView").classList.add("hidden");$("settingsView").classList.remove("hidden");await loadSettings()};$("closeSettings").onclick=()=>{$("settingsView").classList.add("hidden");$("mainView").classList.remove("hidden")};$("addCustom").onclick=()=>{state.customFields.push({key:"",value:""});renderCustom()};$("saveSettings").onclick=async()=>{if(!$("profile").value)return;try{const s=collectSettings();state.settings=s;$("saveSettings").disabled=true;$("saveSettings").textContent="Saving…";status("Saving extension settings…","busy");const saved=await chrome.runtime.sendMessage({type:"SAVE_EXTENSION_SETTINGS",profileId:$("profile").value,settings:s});if(!saved?.ok)throw new Error(saved?.error||"Unable to save extension settings.");state.settings=saved.settings||s;status("Extension settings saved to your HeronSol profile.","ok");$("settingsView").classList.add("hidden");$("mainView").classList.remove("hidden")}catch(error){status(error?.message||"Unable to save extension settings.","error")}finally{$("saveSettings").disabled=false;$("saveSettings").textContent="Save settings"}};
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$("capture").onclick=async()=>{try{$("capture").disabled=true;status("Reading the job page…","busy");const r=await chrome.runtime.sendMessage({type:"CAPTURE_ACTIVE_TAB"});if(!r?.ok)throw new Error(r?.error||"Unable to read this page.");state.activeTabId=r.tabId;state.job=r;state.applicationId=r.applicationId||r.state?.applicationId||state.applicationId||null;state.scan=null;state.pageContext={url:r.pageUrl||state.activeTabUrl,pageType:"job",siteName:r.jobSite||null};renderWorkspace();renderJob();renderScan();switchTab("job");status("Job captured. Review the description before generating.","ok")}catch(e){status(e.message,"error")}finally{$("capture").disabled=false}};
$("generate").onclick=async()=>{try{const p=state.profiles.find(x=>x.id===$("profile").value);if(!p)throw new Error("Select a profile first.");saveJob();const payload={profileId:p.id,profileName:p.name,companyName:$("company").value.trim(),jobTitle:$("jobTitle").value.trim(),jobDescription:$("description").value.trim(),jobUrl:$("jobUrl").value.trim(),jobSite:$("jobSite").value.trim(),resumeTemplateId:(state.templates.some(t=>t.id===$("resumeTemplate").value)?$("resumeTemplate").value:(state.templates[0]?.id||"template_1"))};if(!payload.jobTitle||!payload.jobDescription)throw new Error("Job title and job description are required.");const r=await chrome.runtime.sendMessage({type:"GENERATE_FOR_TAB",tabId:state.activeTabId,payload,jobContextId:state.job?.jobContextId});if(!r?.ok)throw new Error(r.error);state.job={...state.job,...payload,status:"generating"};renderJob()}catch(e){status(e.message,"error")}};
$("scanApplication").onclick=async()=>{try{status("Scanning application controls…","busy");const r=await chrome.runtime.sendMessage({type:"SCAN_APPLICATION_FOR_TAB",tabId:state.activeTabId});if(!r?.ok)throw new Error(r.error);state.scan=r;renderScan();switchTab("apply");status(`Detected ${r.totalFields||0} fields and ${r.questions?.length||0} questions.`,"ok")}catch(e){status(e.message,"error")}};
$("autofill").onclick=async()=>{try{status("Filling verified fields and real controls…","busy");const r=await chrome.runtime.sendMessage({type:"AUTOFILL_FOR_TAB",tabId:state.activeTabId});if(!r?.ok)throw new Error(r.error);state.job={...state.job,autofill:r};$("autofillResult").classList.remove("hidden");$("autofillResult").innerHTML=`<strong>${r.filled||0} field(s) filled</strong><ul>${(r.details||[]).slice(0,12).map(x=>`<li>${x}</li>`).join("")}</ul>${r.unresolved?.length?`<div>${r.unresolved.length} field(s) need review.</div>`:""}`;status("Autofill finished. The extension will not fight your edits.","ok")}catch(e){status(e.message,"error")}};
$("downloadResume").onclick=async()=>{try{const r=await chrome.runtime.sendMessage({type:"DOWNLOAD_RESUME_FOR_TAB",tabId:state.activeTabId});if(!r?.ok)throw new Error(r?.error||"Unable to download the resume.");status(`Downloaded ${r.filename}.`,"ok")}catch(e){status(e.message,"error")}};
$("generateCoverLetter").onclick=async()=>{try{status("Generating cover letter through HeronSol AI…","busy");const r=await chrome.runtime.sendMessage({type:"GENERATE_COVER_LETTER_FOR_TAB",tabId:state.activeTabId});if(!r?.ok)throw new Error(r?.error||"Unable to generate the cover letter.");state.job=r.job||state.job;renderJob();status(`Cover letter generated through the platform AI. Cost $${Number(r.cost||0).toFixed(4)}.`,"ok")}catch(e){status(e.message,"error")}};
$("downloadCoverLetter").onclick=async()=>{try{status("Downloading cover letter…","busy");const r=await chrome.runtime.sendMessage({type:"DOWNLOAD_COVER_LETTER_FOR_TAB",tabId:state.activeTabId});if(!r?.ok)throw new Error(r?.error||"Unable to download the cover letter.");status(`Downloaded ${r.filename}.`,"ok")}catch(e){status(e.message,"error")}};

async function generateAnswers(questions){try{const cleaned=Array.from(new Set(questions.map(x=>String(x||"").trim()).filter(Boolean)));if(!cleaned.length)throw new Error("Enter or detect at least one application question.");if(cleaned.length>20)throw new Error("Generate up to 20 questions at once.");if(!state.job?.applicationId)throw new Error("Generate the tailored resume before answering questions.");status("Generating answers through HeronSol AI in one batch…","busy");const r=await chrome.runtime.sendMessage({type:"GENERATE_APPLICATION_ANSWERS_FOR_TAB",tabId:state.activeTabId,questions:cleaned});if(!r?.ok)throw new Error(r?.error||"Unable to generate application answers.");state.job=r.job||state.job;$("questionState").textContent=`${r.answers?.length||0} answer(s) generated · AI cost $${Number(r.cost||0).toFixed(4)}`;renderAnswerList(r.answers||[]);status(`Generated ${r.answers?.length||0} answer(s) through the platform AI. Cost $${Number(r.cost||0).toFixed(4)}.`,"ok")}catch(e){status(e.message,"error")}}
function renderAnswerList(answers){const q=$("questionsList");(answers||[]).forEach(item=>{const d=document.createElement("div");d.className="question answer";d.innerHTML=`<div class="tag">AI Answer</div><p>${String(item.question||"").replace(/[<>&]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</p><div class="answer-text">${String(item.answer||"").replace(/[<>&]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</div>`;q.appendChild(d)})}
$("generateAnswers").onclick=async()=>{try{if(!state.scan?.questions?.length)await $("scanApplication").onclick();await generateAnswers((state.scan?.questions||[]).map(x=>x.label))}catch(e){status(e.message,"error")}};
$("generateManualAnswers").onclick=async()=>{await generateAnswers($("manualQuestions").value.split(/\r?\n/))};
$("screenshot").onclick=async()=>{try{const r=await chrome.runtime.sendMessage({type:"SAVE_APPLICATION_SCREENSHOT",tabId:state.activeTabId});if(!r?.ok)throw new Error(r.error);status("Screenshot saved.","ok")}catch(e){status(e.message,"error")}};
$("markApplied").onclick=async()=>{try{const r=await chrome.runtime.sendMessage({type:"MARK_APPLICATION_APPLIED",tabId:state.activeTabId});if(!r?.ok)throw new Error(r.error);state.job={...state.job,applicationStatus:"Applied"};renderJob();status("Application marked Applied.","ok")}catch(e){status(e.message,"error")}};
["company","jobTitle","jobSite","jobUrl","description"].forEach(id=>$(id).addEventListener("input",saveJob));$("resumeTemplate")?.addEventListener("change",()=>{if(!state.activeTabId)return;state.job={...state.job,resumeTemplateId:$("resumeTemplate").value};saveJob()});chrome.tabs.onActivated.addListener(loadActiveTab); chrome.windows.onFocusChanged.addListener(loadActiveTab); chrome.tabs.onUpdated.addListener((tabId,changeInfo)=>{ if(tabId===state.activeTabId && changeInfo.url) loadActiveTab(); });chrome.runtime.onMessage.addListener((message)=>{
  if(message?.type==="APPLICATION_CONTEXT_CHANGED" && message.tabId===state.activeTabId){
    state.applicationId=message.applicationId||state.applicationId;
    state.pageContext=message.page||state.pageContext;
    renderWorkspace();
    // Pull the canonical application state after navigation instead of trusting
    // a transient DOM snapshot. This is the single recovery path for JD → apply
    // → questions → review transitions.
    scheduleContextRefresh();
  }
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="session"||!state.activeTabId)return;
  const c=changes[`jobState:${state.activeTabId}`];
  if(c){
    const next=c.newValue||null;
    // jobUrl is the original JD URL, while activeTabUrl can now be the ATS
    // application URL. They are intentionally allowed to differ.
    if(next && next.tabId === state.activeTabId){
      state.job=next;
      state.applicationId=next.applicationId||state.applicationId;
      state.pageContext=next.pageSnapshot||state.pageContext;
      state.scan=state.job?.scan||null;
      renderWorkspace();
      renderJob();
      renderScan();
    }
  }
});
(async()=>{const d=await chrome.storage.local.get(["accessToken","refreshToken","expiresAt","bidder","profiles"]);Object.assign(state,d);if(state.accessToken&&state.refreshToken&&await refresh()){showMain();await loadResumeTemplates();await loadSettings();await loadActiveTab()}else showLogin()})();

$("coverLetterText").addEventListener("input",()=>{if(!state.activeTabId||!state.job)return;state.job={...state.job,coverLetter:$("coverLetterText").value};chrome.storage.session.set({[`jobState:${state.activeTabId}`]:state.job})});
