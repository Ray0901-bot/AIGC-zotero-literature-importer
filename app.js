'use strict';

// Zotero Literature Importer — static client-side application.
// No analytics, no CDN, no credential persistence. Key is used only in HTTPS request headers.
const $ = (id) => document.getElementById(id);
const state = {
  connected: false, userId: '', apiKey: '', papers: [], collections: [],
  results: [], busy: false, sampleLoaded: false, source: 'paste',
  uploadText: '', imported: new Map()
};
const API = 'https://api.zotero.org';
const REQUEST_TIMEOUT = 30000;
const SAMPLE = {
  papers: [{
    title: 'TEST — Literature Agent Example (delete after testing)',
    authors: ['Example Researcher'], year: 2026, journal: 'Test entry — not a real journal',
    url: 'https://www.zotero.org/',
    tags: ['AI-test', 'delete-after-testing'],
    note: 'TEST NOTE — This is a demonstration only.\n\nResearch question: Verify that the application can create a Zotero parent item and its child note.\n\nImportant: This is NOT a real paper. Delete this example from Zotero after testing.'
  }]
};

function setBadge(text, kind) {
  const node = $('connectionBadge');
  node.textContent = text;
  node.className = `status-badge status-${kind}`;
}
function busy(flag) {
  state.busy = flag;
  for (const id of ['connectBtn', 'parseBtn', 'importBtn', 'sampleBtn', 'clearBtn', 'disconnectBtn']) {
    $(id).disabled = flag;
  }
  $('importBtn').disabled = flag || !state.connected || !state.papers.length;
}
function setStatus(message, type = 'neutral') {
  $('scanStatus').hidden = false;
  $('scanStatus').className = `notice notice-${type}`;
  $('scanStatus').textContent = message;
}
function hideStatus() { $('scanStatus').hidden = true; }
function showError(msg) { $('parseError').hidden = false; $('parseError').textContent = msg; }
function hideError() { $('parseError').hidden = true; }
function cleanText(input) {
  if (input === undefined || input === null) return '';
  return String(input).trim();
}
function normTitle(input) { return cleanText(input).normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim(); }
function normDoi(input) {
  return cleanText(input)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi\s*:/i, '').trim().replace(/[\s]+/g, '')
    .replace(/[.,;]+$/g, '').toLowerCase();
}
function validDoi(input) { return /^10\.\d{4,9}\/\S+$/i.test(input); }
function makeCreators(input) {
  if (!input) return [];
  if (typeof input === 'string') input = input.split(/\s*;\s*/);
  if (!Array.isArray(input)) return [];
  return input.map(x => {
    if (typeof x === 'string') {
      const name = x.trim();
      if (!name) return null;
      // One-field creator avoids misinterpreting East Asian names or multi-part surnames.
      return { creatorType: 'author', name };
    }
    if (!x || typeof x !== 'object') return null;
    if (cleanText(x.name)) return { creatorType: 'author', name: cleanText(x.name) };
    if (cleanText(x.lastName)) return {
      creatorType: 'author', firstName: cleanText(x.firstName), lastName: cleanText(x.lastName)
    };
    return null;
  }).filter(Boolean).slice(0, 150);
}
function makeTags(input) {
  const arr = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,，;]/) : [];
  return [...new Set(arr.map(x => cleanText(typeof x === 'object' ? x?.tag : x)).filter(Boolean))].slice(0, 60);
}
function noteFrom(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input)) return input.map(noteFrom).filter(Boolean).join('\n\n');
  if (input && typeof input === 'object') {
    return Object.entries(input).map(([name, val]) => {
      const content = typeof val === 'object' ? JSON.stringify(val, null, 2) : cleanText(val);
      return content ? `${name}\n${content}` : '';
    }).filter(Boolean).join('\n\n');
  }
  return '';
}
function standardizePaper(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`第 ${index + 1} 篇不是 JSON 对象。`);
  if (raw.itemType && raw.itemType !== 'journalArticle') throw new Error(`第 ${index + 1} 篇的 itemType=${raw.itemType} 暂不支持。本工具当前仅创建 journalArticle。`);
  const title = cleanText(raw.title || raw.paper_title);
  if (!title) throw new Error(`第 ${index + 1} 篇缺少 title。`);
  const doi = normDoi(raw.doi || raw.DOI);
  if (doi && !validDoi(doi)) throw new Error(`第 ${index + 1} 篇 DOI 格式不正确：${doi.slice(0,100)}。请核对或留空。`);
  const note = noteFrom(raw.note ?? raw.notes ?? raw.reading_note ?? '');
  return {
    title, doi, authors: makeCreators(raw.authors || raw.creators),
    date: cleanText(raw.date || raw.year), journal: cleanText(raw.journal || raw.publicationTitle || raw.publication),
    volume: cleanText(raw.volume), issue: cleanText(raw.issue), pages: cleanText(raw.pages),
    url: cleanText(raw.url), abstract: cleanText(raw.abstract || raw.abstractNote),
    language: cleanText(raw.language), note, tags: makeTags(raw.tags),
    sourceIndex: index, localDuplicate: false
  };
}
function parsePapers(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error(`JSON 语法错误：${e.message}`); }
  const arr = Array.isArray(parsed) ? parsed : parsed?.papers ?? parsed?.references ?? parsed?.items ?? (parsed?.title ? [parsed] : null);
  if (!Array.isArray(arr)) throw new Error('顶层数据需要是数组，或包含 papers 数组，例如 {"papers":[...]}。');
  if (!arr.length) throw new Error('没有可导入的论文。');
  if (arr.length > 500) throw new Error('单次最多解析 500 篇论文。请分批导入。');
  const papers = arr.map(standardizePaper);
  const seenDoi = new Set(), seenTitle = new Set();
  for (const p of papers) {
    const nt = normTitle(p.title);
    if ((p.doi && seenDoi.has(p.doi)) || seenTitle.has(nt)) p.localDuplicate = true;
    if (p.doi) seenDoi.add(p.doi);
    seenTitle.add(nt);
  }
  return papers;
}
function makeElement(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function renderPapers() {
  const content = $('reviewContent');
  content.hidden = !state.papers.length;
  $('emptyState').hidden = !!state.papers.length;
  $('totalBadge').textContent = `${state.papers.length} 篇`;
  $('noteCount').textContent = `${state.papers.filter(p => p.note).length} 条笔记`;
  $('importSummary').textContent = `共 ${state.papers.length} 篇论文`;
  $('importBtn').disabled = !state.connected || !state.papers.length || state.busy;
  const list = $('paperList'); list.replaceChildren();
  state.papers.forEach((p, i) => {
    const row = makeElement('div', 'paper-item');
    row.append(makeElement('span', 'paper-index', String(i + 1).padStart(2,'0')));
    const main = makeElement('div', 'paper-main');
    main.append(makeElement('strong', '', p.title));
    const meta = makeElement('div','paper-meta');
    for (const str of [p.authors.slice(0,2).map(a => a.name || `${a.firstName} ${a.lastName}`).join(', '), p.date, p.journal]) {
      if (str) meta.append(makeElement('span','',str));
    }
    main.append(meta);
    if (p.doi) main.append(makeElement('div', 'paper-doi', `DOI: ${p.doi}`));
    if (p.note) main.append(makeElement('div','paper-note',p.note.slice(0,230)));
    const flags = makeElement('div','paper-flags');
    if (p.localDuplicate) flags.append(makeElement('span','mini-tag warn','本批次重复，将跳过'));
    if (p.note) flags.append(makeElement('span','mini-tag good','包含阅读笔记'));
    if (!p.doi) flags.append(makeElement('span','mini-tag','无 DOI：按标题去重'));
    p.tags.slice(0,3).forEach(t => flags.append(makeElement('span','mini-tag',t)));
    main.append(flags); row.append(main); list.append(row);
  });
  hideStatus();
}
async function api(path, { method = 'GET', body, key = state.apiKey, userId = state.userId } = {}) {
  const url = new URL(`${API}/users/${encodeURIComponent(userId)}${path}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const headers = { 'Zotero-API-Version': '3', 'Zotero-API-Key': key };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Zotero-Write-Token'] = randomToken();
  }
  let response;
  try {
    response = await fetch(url.toString(), {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal, cache: 'no-store', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时（30 秒）。请检查网络，必要时重试。');
    throw new Error('网络请求失败。请检查连接、浏览器扩展或跨域访问设置。');
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    let detail = (await response.text().catch(() => '')).slice(0,250).replace(/<[^>]*>/g,'').trim();
    if (response.status === 403 || response.status === 401) detail = '认证失败或密钥权限不足。检查 User ID、API Key及读写授权。';
    if (response.status === 429) detail = 'Zotero 请求过于频繁，请稍后重试。';
    if (response.status === 412) detail = '写入版本/Token冲突，请重新检查后重试。';
    throw new Error(`Zotero HTTP ${response.status}：${detail || response.statusText}`);
  }
  const data = response.status === 204 ? null : await response.json();
  return { data, response };
}
function randomToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, n => n.toString(16).padStart(2, '0')).join('');
}
async function pages(path, onProgress) {
  const results = [];
  for (let start = 0, page = 0; page < 1000; start += 100, page++) {
    const sep = path.includes('?') ? '&' : '?';
    const { data, response } = await api(`${path}${sep}limit=100&start=${start}`);
    if (!Array.isArray(data)) throw new Error('Zotero 返回了非预期格式。');
    results.push(...data);
    const total = Number(response.headers.get('Total-Results'));
    if (onProgress) onProgress(results.length, total || null);
    if (data.length < 100 || (total > 0 && results.length >= total)) return results;
  }
  throw new Error('文献库超过 100,000 条：为避免不完整的去重检查，已中止导入。');
}
async function connect() {
  if (state.busy) return;
  const userId = $('userId').value.trim();
  const key = $('apiKey').value.trim();
  if (!/^\d+$/.test(userId) || !key) { setBadge('填写 User ID 与 Key', 'error'); return; }
  busy(true); setBadge('正在连接…', 'idle');
  try {
    const { data } = await api('/items/top?limit=1', { userId, key });
    if (!Array.isArray(data)) throw new Error('连接测试返回了非预期数据。');
    state.userId = userId; state.apiKey = key; state.connected = true;
    $('apiKey').value = ''; // Clear visible form field: key remains in ephemeral JS memory only.
    $('userId').disabled = true; $('apiKey').disabled = true;
    $('connectBtn').hidden = true; $('disconnectBtn').hidden = false;
    setBadge('已连接', 'success');
    $('collectionSelect').replaceChildren(new Option('不指定（我的文献库根目录）', ''));
    try {
      const cols = await pages('/collections');
      state.collections = cols;
      cols.sort((a,b) => (a.data?.name || '').localeCompare(b.data?.name || '', 'zh-CN'));
      for (const c of cols) $('collectionSelect').add(new Option(c.data?.name || c.key, c.key));
    } catch (e) {
      setStatus(`已连接成功，但获取 Collection 列表失败：${e.message}。仍可保存到文献库根目录。`, 'neutral');
    }
  } catch(e) { state.connected = false; setBadge('连接失败', 'error'); showError(e.message); }
  finally { busy(false); renderPapers(); }
}
function disconnect() {
  state.connected = false; state.userId = ''; state.apiKey = ''; state.collections = [];
  $('userId').disabled = false; $('apiKey').disabled = false;
  $('userId').value = ''; $('apiKey').value = '';
  $('connectBtn').hidden = false; $('disconnectBtn').hidden = true;
  $('collectionSelect').replaceChildren(new Option('不指定（我的文献库根目录）', ''));
  setBadge('未连接','idle'); renderPapers();
}
function switchTab(source) {
  state.source = source;
  const paste = source === 'paste';
  $('pasteTab').classList.toggle('active', paste); $('uploadTab').classList.toggle('active', !paste);
  $('pasteTab').setAttribute('aria-selected', String(paste)); $('uploadTab').setAttribute('aria-selected', String(!paste));
  $('pastePane').hidden = !paste; $('uploadPane').hidden = paste;
}
function parseInput() {
  hideError(); $('resultsSection').hidden = true; state.results = []; state.imported.clear();
  try {
    const txt = state.source === 'paste' ? $('jsonInput').value : state.uploadText;
    if (!txt.trim()) throw new Error('请先粘贴 JSON 或选择一个 .json 文件。');
    state.papers = parsePapers(txt);
    renderPapers(); $('reviewSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) { state.papers = []; renderPapers(); showError(e.message); }
}
function noteHtml(note) {
  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  return `<div data-schema-version="9">${note.split(/\n\s*\n/).map(par => `<p>${esc(par).replace(/\n/g,'<br/>')}</p>`).join('')}</div>`;
}
function toZotero(p, collectionKey, extras) {
  const item = {
    itemType: 'journalArticle', title: p.title,
    creators: p.authors, tags: [...new Set([...p.tags, ...extras])].map(tag => ({tag})),
    collections: collectionKey ? [collectionKey] : []
  };
  for (const [dest, source] of Object.entries({
    DOI: 'doi', date: 'date', publicationTitle: 'journal', volume: 'volume', issue: 'issue',
    pages: 'pages', url: 'url', abstractNote: 'abstract', language: 'language'
  })) if (p[source]) item[dest] = p[source];
  return item;
}
function createdKey(result) {
  const success = result?.successful?.['0'];
  return success?.key || (typeof success === 'string' ? success : result?.success?.['0']) || '';
}
function assertWrite(result, label) {
  const key = createdKey(result);
  if (result?.failed && Object.keys(result.failed).length) {
    const fail = result.failed['0'] || Object.values(result.failed)[0];
    throw new Error(`${label}失败：${fail?.message || JSON.stringify(fail)}`);
  }
  if (!key) throw new Error(`${label}未返回成功条目 Key；请先检查 Zotero 文献库，避免重复提交。`);
  return key;
}
function indexLibrary(items) {
  const byDoi = new Map(), byTitle = new Map();
  for (const item of items) {
    const p = item.data || item;
    if (!p?.title) continue;
    const key = item.key || p.key;
    if (!key) continue;
    const doi = normDoi(p.DOI);
    if (doi && !byDoi.has(doi)) byDoi.set(doi, key);
    const title = normTitle(p.title);
    if (title && !byTitle.has(title)) byTitle.set(title, key);
  }
  return { byDoi, byTitle };
}
function findExisting(p, index) {
  // Exact DOI takes precedence; title also catches missing DOI on either side.
  return (p.doi && index.byDoi.get(p.doi)) || index.byTitle.get(normTitle(p.title)) || '';
}
function addToIndex(p, key, index) {
  if (p.doi) index.byDoi.set(p.doi, key);
  index.byTitle.set(normTitle(p.title), key);
}
function showResultStats() {
  $('resultsSection').hidden = false;
  const stats = { created:0, noted:0, skipped:0, failed:0 };
  for (const r of state.results) {
    if (r.status === 'created') stats.created++;
    if (r.status === 'noted') stats.noted++;
    if (r.status === 'skipped') stats.skipped++;
    if (r.status === 'failed') stats.failed++;
  }
  const summary = $('resultSummary'); summary.replaceChildren();
  for (const [label, num] of [['新建论文', stats.created],['已存在：附加笔记', stats.noted],['跳过', stats.skipped],['失败', stats.failed]]) {
    const card = makeElement('div','metric');
    card.append(makeElement('b','',String(num)),makeElement('span','',label)); summary.append(card);
  }
  const list = $('resultsList'); list.replaceChildren();
  for (const r of state.results) {
    const li = makeElement('li'); const div=makeElement('span');
    div.append(makeElement('strong','',r.title),makeElement('div','',r.message));
    li.append(div);
    if (r.key) {
      const a = makeElement('a','', 'Zotero ↗');
      a.href = `https://www.zotero.org/users/${encodeURIComponent(state.userId)}/items/${encodeURIComponent(r.key)}`;
      a.rel = 'noopener noreferrer'; a.target = '_blank'; li.append(a);
    }
    list.append(li);
  }
}
async function startImport() {
  if (state.busy || !state.connected || !state.papers.length) return;
  const decision = await confirmation();
  if (!decision) return;
  busy(true); hideStatus(); $('resultsSection').hidden = false;
  state.results = []; showResultStats();
  try {
    setStatus('正在读取 Zotero 个人文献库，进行完整的 DOI / 标题去重检查…');
    const all = await pages('/items/top', (n, total) => setStatus(`正在检查已有文献：${n}${total ? ` / ${total}` : ''} 条。请不要关闭页面…`));
    const indexed = indexLibrary(all);
    const collectionKey = $('collectionSelect').value;
    const extras = makeTags($('extraTags').value);
    const addToExisting = $('attachExisting').checked;
    for (const [i, p] of state.papers.entries()) {
      setStatus(`正在导入 ${i+1} / ${state.papers.length}：${p.title.slice(0,60)}`);
      let key = '', wasCreated = false;
      try {
        if (p.localDuplicate) {
          state.results.push({ title:p.title, status:'skipped', message:'同一批 JSON 中重复，已跳过。' });
          showResultStats(); continue;
        }
        // Track completed operations to avoid double-create on button click after partial failure.
        if (state.imported.has(i)) {
          const existing = state.imported.get(i);
          state.results.push({ title:p.title, status:'skipped', key:existing.key, message:existing.noteDone ? '本页此前已导入，跳过。' : '此前已创建条目但笔记未完成。请核对后手动补充笔记。' });
          showResultStats(); continue;
        }
        key = findExisting(p, indexed);
        if (key && !addToExisting) {
          state.results.push({ title:p.title, status:'skipped', key, message:'Zotero 已有匹配的 DOI 或标题，未创建条目或笔记。' });
          showResultStats(); continue;
        }
        if (!key) {
          const { data } = await api('/items', { method:'POST', body:[toZotero(p, collectionKey, extras)] });
          key = assertWrite(data, '论文创建');
          wasCreated = true;
          addToIndex(p, key, indexed);
          state.imported.set(i, {key, noteDone:false});
        }
        if (p.note) {
          const note = { itemType:'note', parentItem:key, note:noteHtml(p.note), tags:[{tag:'AI-generated'}] };
          const { data } = await api('/items', { method:'POST', body:[note] });
          assertWrite(data,'笔记创建');
        }
        if (wasCreated) state.imported.set(i, {key, noteDone:true});
        const message = wasCreated
          ? p.note ? '论文及子笔记已创建。' : '论文已创建（未提供笔记）。'
          : p.note ? '已有论文：已追加一条子笔记。' : '已有论文，未提供新笔记。';
        state.results.push({ title:p.title, status:wasCreated ? 'created' : p.note ? 'noted' : 'skipped', key, message });
      } catch(e) {
        state.results.push({ title:p.title, status:'failed', key, message:e.message + (key ? '（论文条目可能已创建，请查看文献库后再操作。）' : '') });
      }
      showResultStats();
    }
    const failures = state.results.filter(r=>r.status === 'failed').length;
    setStatus(failures ? `导入完成，但 ${failures} 项失败。请在下方核对结果。` : '导入流程完成。请查看下方每篇论文的处理结果。');
    $('resultsSection').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e) {
    setStatus(`导入中止：${e.message}。未完成去重检查时不会开始写入。`, 'error');
    state.results.push({title:'导入流程',status:'failed',message:e.message}); showResultStats();
  } finally { busy(false); }
}
async function confirmation() {
  const dialog = $('confirmDialog');
  $('confirmText').textContent = `共 ${state.papers.length} 篇，${state.papers.filter(p=>p.note).length} 条笔记；将先完整检查个人文献库中的重复记录。`;
  if (typeof dialog.showModal !== 'function') return window.confirm('确认向 Zotero 写入文献和笔记？');
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once:true});
    dialog.showModal();
  });
}
function downloadLog() {
  const data = JSON.stringify({ timestamp:new Date().toISOString(), zoteroUserId:state.userId, results:state.results },null,2);
  const url = URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download='zotero-import-results.json'; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('connectBtn').addEventListener('click', () => { hideError(); connect(); });
$('disconnectBtn').addEventListener('click', disconnect);
$('toggleKey').addEventListener('click', () => {
  const input=$('apiKey'); const show=input.type==='password'; input.type=show?'text':'password';
  $('toggleKey').textContent=show?'隐藏':'显示';
});
$('pasteTab').addEventListener('click',()=>switchTab('paste'));
$('uploadTab').addEventListener('click',()=>switchTab('upload'));
$('fileInput').addEventListener('change', async e => {
  const file=e.target.files?.[0]; if(!file) return;
  if(file.size>3*1024*1024){showError('JSON 文件超过 3MB，请拆分导入。');return;}
  state.uploadText=await file.text();$('fileName').textContent=`已选择：${file.name}`; hideError();
});
for(const ev of ['dragenter','dragover']) $('dropZone').addEventListener(ev,e=>{e.preventDefault();$('dropZone').classList.add('is-dragover');});
for(const ev of ['dragleave','drop']) $('dropZone').addEventListener(ev,e=>{e.preventDefault();$('dropZone').classList.remove('is-dragover');});
$('dropZone').addEventListener('drop',async e=>{
  const file=e.dataTransfer.files?.[0]; if(!file)return;
  if(!file.name.toLowerCase().endsWith('.json') || file.size>3*1024*1024){showError('请选择小于 3MB 的 .json 文件。');return;}
  state.uploadText=await file.text();$('fileName').textContent=`已选择：${file.name}`;hideError();
});
$('sampleBtn').addEventListener('click',()=>{
  switchTab('paste');$('jsonInput').value=JSON.stringify(SAMPLE,null,2);
  state.sampleLoaded=true; hideError();parseInput();
});
$('clearBtn').addEventListener('click',()=>{
  $('jsonInput').value='';$('fileInput').value='';state.uploadText='';$('fileName').textContent='';
  state.papers=[];state.results=[];state.imported.clear();state.sampleLoaded=false;
  hideError();hideStatus();renderPapers();$('resultsSection').hidden=true;
});
$('parseBtn').addEventListener('click',parseInput);
$('importBtn').addEventListener('click',startImport);
$('downloadLogBtn').addEventListener('click',downloadLog);
$('copyPromptBtn').addEventListener('click',async()=>{
  try {await navigator.clipboard.writeText($('promptText').textContent);
    $('copyPromptBtn').textContent='已复制 ✓';setTimeout(()=>$('copyPromptBtn').textContent='复制指令 ⧉',1700);
  }catch(e){$('copyPromptBtn').textContent='复制失败，请手动选择文字';}
});
// Deliberately no localStorage/sessionStorage or requests to analytics endpoints.
renderPapers();
