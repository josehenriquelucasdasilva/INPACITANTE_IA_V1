/* ============================================================
   INTELECTUAL IA — v7  |  app.js
   App estático: chama OpenRouter (principal) e Groq (fallback)
   direto do navegador. Chaves no localStorage deste aparelho.
   Imagem gerada via Pollinations, integrada na conversa.
   ============================================================ */

/* ---------- 1. STORE ---------- */
const LS = {
  k1:'iia_v7_openrouter', k2:'iia_v7_groq',
  conv:'iia_v7_conversations', active:'iia_v7_active', set:'iia_v7_settings'
};
const DEFAULTS = { modelMain:'openai/gpt-4o-mini', modelFb:'llama-3.3-70b-versatile' };

const store = {
  get k1(){ return localStorage.getItem(LS.k1) || ''; },
  get k2(){ return localStorage.getItem(LS.k2) || ''; },
  setKeys(a,b){ localStorage.setItem(LS.k1,a); localStorage.setItem(LS.k2,b); },
  get settings(){ try{ return {...DEFAULTS, ...JSON.parse(localStorage.getItem(LS.set)||'{}')}; }catch{ return {...DEFAULTS}; } },
  saveSettings(s){ localStorage.setItem(LS.set, JSON.stringify(s)); },
  get conversations(){ try{ return JSON.parse(localStorage.getItem(LS.conv)||'[]'); }catch{ return []; } },
  saveConversations(c){ localStorage.setItem(LS.conv, JSON.stringify(c.slice(0,200))); },
  get activeId(){ return localStorage.getItem(LS.active); },
  set activeId(id){ id ? localStorage.setItem(LS.active,id) : localStorage.removeItem(LS.active); },
  wipe(){ Object.values(LS).forEach(k=>localStorage.removeItem(k)); }
};

const $ = s => document.querySelector(s);
const el = (t,c)=>{ const e=document.createElement(t); if(c) e.className=c; return e; };

/* ---------- 2. VALIDAÇÃO DE CHAVES ---------- */
async function validateKey(provider, key){
  try{
    if(provider==='openrouter'){
      const r = await fetch('https://openrouter.ai/api/v1/key',{ headers:{ Authorization:'Bearer '+key } });
      return r.ok;
    } else {
      const r = await fetch('https://api.groq.com/openai/v1/models',{ headers:{ Authorization:'Bearer '+key } });
      return r.ok;
    }
  }catch(e){ return null; } // null = falha de rede (não é chave errada)
}

/* ---------- 3. ONBOARDING (encaixe de 2 chaves) ---------- */
const onboarding = $('#onboarding');
const valid = { 1:false, 2:false };

function setupSlot(idx){
  const slot = $('#slot'+idx);
  const input = $('#key'+idx);
  const btn = $('#val'+idx);
  const err = $('#err'+idx);
  const provider = slot.dataset.provider;

  async function run(){
    const key = input.value.trim();
    if(!key){ input.focus(); return; }
    slot.classList.remove('error','valid'); slot.classList.add('testing');
    btn.disabled = true; input.disabled = true;

    const ok = await validateKey(provider, key);
    slot.classList.remove('testing');

    if(ok === true){
      valid[idx] = true;
      slot.classList.add('valid');
      btn.textContent = 'Validada';
      if(idx===1) revealSlot2();
      refreshEnter();
    } else {
      btn.disabled = false; input.disabled = false;
      slot.classList.add('error');
      err.textContent = ok === null
        ? 'Sem resposta da rede. Confira a conexão e tente de novo.'
        : 'Chave inválida ou sem permissão. Verifique e cole de novo.';
      input.focus();
    }
  }
  btn.addEventListener('click', run);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); run(); } });
  input.addEventListener('input', ()=>{ if(slot.classList.contains('error')) slot.classList.remove('error'); });
}

function revealSlot2(){
  const s2 = $('#slot2');
  s2.classList.remove('locked');
  setTimeout(()=>$('#key2').focus(), 250);
}
function refreshEnter(){
  $('#enterBtn').disabled = !(valid[1] && valid[2]);
}

function openOnboarding(reset=true){
  if(reset){
    [1,2].forEach(i=>{
      valid[i]=false;
      const s=$('#slot'+i); s.classList.remove('valid','error','testing');
      $('#val'+i).textContent='Validar'; $('#val'+i).disabled=false;
      const inp=$('#key'+i); inp.disabled=false; inp.value='';
    });
    $('#slot2').classList.add('locked');
    $('#enterBtn').disabled=true;
  }
  onboarding.hidden=false;
  setTimeout(()=>$('#key1').focus(),200);
}

$('#enterBtn').addEventListener('click', ()=>{
  store.setKeys($('#key1').value.trim(), $('#key2').value.trim());
  onboarding.hidden=true;
  toast('Chaves conectadas. Tudo pronto.');
  boot();
});

setupSlot(1); setupSlot(2);

/* ---------- 4. MARKDOWN (escapa antes, à prova de XSS) ---------- */
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function renderMarkdown(src){
  const blocks=[];
  // 1) blocos de código fora primeiro
  src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_,lang,code)=>{
    const id = blocks.length;
    blocks.push(`<pre><button class="copy-code" data-code="${encodeURIComponent(code)}">copiar</button><code>${escapeHtml(code.replace(/\n$/,''))}</code></pre>`);
    return `\u0000B${id}\u0000`;
  });
  // 2) escapa o resto
  let h = escapeHtml(src);
  // 3) inline
  h = h.replace(/`([^`\n]+)`/g,(_,c)=>`<code>${c}</code>`);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  h = h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
  // 4) blocos linha a linha
  const lines = h.split('\n'); const out=[]; let list=null;
  const closeList=()=>{ if(list){ out.push(`</${list}>`); list=null; } };
  for(let line of lines){
    let m;
    if(m=line.match(/^###\s+(.*)/)){ closeList(); out.push(`<h3>${m[1]}</h3>`); }
    else if(m=line.match(/^##\s+(.*)/)){ closeList(); out.push(`<h2>${m[1]}</h2>`); }
    else if(m=line.match(/^#\s+(.*)/)){ closeList(); out.push(`<h1>${m[1]}</h1>`); }
    else if(m=line.match(/^&gt;\s+(.*)/)){ closeList(); out.push(`<blockquote>${m[1]}</blockquote>`); }
    else if(m=line.match(/^[-*]\s+(.*)/)){ if(list!=='ul'){ closeList(); out.push('<ul>'); list='ul'; } out.push(`<li>${m[1]}</li>`); }
    else if(m=line.match(/^\d+\.\s+(.*)/)){ if(list!=='ol'){ closeList(); out.push('<ol>'); list='ol'; } out.push(`<li>${m[1]}</li>`); }
    else if(line.trim()===''){ closeList(); }
    else if(line.startsWith('\u0000B')){ closeList(); out.push(line); }
    else out.push(`<p>${line}</p>`);
  }
  closeList();
  h = out.join('\n');
  // 5) devolve os blocos de código
  h = h.replace(/\u0000B(\d+)\u0000/g,(_,i)=>blocks[+i]);
  return h;
}

/* ---------- 5. IMAGEM INTEGRADA (Pollinations) ---------- */
const IMG_TRIGGER = /\b(ger(e|a|ar)|cri(e|a|ar)|desenh(e|a|ar)|fa(ç|c)a|imagine|ilustr\w+|gera[r]?)\b[\s\S]*\b(imagem|imagens|foto|desenho|ilustra(ç|c)(ã|a)o|figura|logo|arte|wallpaper|cena|retrato|paisagem)\b/i;
function detectImage(text){
  const t = text.trim();
  if(/^\/img(g|em)?\s+/i.test(t)) return t.replace(/^\/img(g|em)?\s+/i,'').trim();
  if(IMG_TRIGGER.test(t)) return t;          // usa o próprio pedido como prompt
  return null;
}
function pollinationsURL(prompt){
  const seed = Math.floor(Math.random()*1e9);
  const p = encodeURIComponent(prompt.slice(0,500));
  return `https://image.pollinations.ai/prompt/${p}?width=1024&height=1024&nologo=true&model=flux&seed=${seed}`;
}

/* ---------- 6. CHAT (stream OpenRouter -> fallback Groq) ---------- */
let abortCtrl = null;
const SYS_PROMPT = `Você é a INTELECTUAL IA, assistente pessoal de José Henrique. Responda em português do Brasil com precisão, profundidade e foco prático. Seja direto, sem enrolação. Quando houver mais de uma abordagem, compare e indique a melhor com justificativa. Use Markdown quando ajudar a clareza.`;

async function streamChat(messages, onToken){
  const s = store.settings;
  const payloadMsgs = [{role:'system',content:SYS_PROMPT}, ...messages];
  abortCtrl = new AbortController();

  const attempts = [
    { url:'https://openrouter.ai/api/v1/chat/completions', key:store.k1, model:s.modelMain,
      extra:{ 'HTTP-Referer':location.origin, 'X-Title':'INTELECTUAL IA' } },
    { url:'https://api.groq.com/openai/v1/chat/completions', key:store.k2, model:s.modelFb, extra:{} }
  ];

  let lastErr=null;
  for(let i=0;i<attempts.length;i++){
    const a = attempts[i];
    if(!a.key) { lastErr=new Error('sem chave'); continue; }
    try{
      const r = await fetch(a.url,{
        method:'POST', signal:abortCtrl.signal,
        headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+a.key, ...a.extra },
        body:JSON.stringify({ model:a.model, messages:payloadMsgs, stream:true })
      });
      if(!r.ok){ lastErr=new Error('HTTP '+r.status+(i===0?' (OpenRouter)':' (Groq)')); continue; }

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf='';
      while(true){
        const {value,done} = await reader.read();
        if(done) break;
        buf += dec.decode(value,{stream:true});
        const parts = buf.split('\n');
        buf = parts.pop();
        for(const line of parts){
          const t = line.trim();
          if(!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if(data==='[DONE]') return { provider:i };
          try{
            const j = JSON.parse(data);
            const tok = j.choices?.[0]?.delta?.content;
            if(tok) onToken(tok);
          }catch{}
        }
      }
      return { provider:i };
    }catch(e){
      if(e.name==='AbortError') throw e;
      lastErr=e;
    }
  }
  throw lastErr || new Error('Falha nos dois provedores.');
}

/* ---------- 7. ESTADO DE CONVERSA ---------- */
let convs = store.conversations;
let activeId = store.activeId;

function active(){ return convs.find(c=>c.id===activeId); }
function newConversation(){
  const c = { id:'c'+Date.now(), title:'Nova conversa', messages:[], createdAt:Date.now() };
  convs.unshift(c); activeId=c.id; persist(); renderSidebar(); renderThread();
  $('#input').focus();
}
function persist(){ store.saveConversations(convs); store.activeId=activeId; }
function deleteConversation(id){
  convs = convs.filter(c=>c.id!==id);
  if(activeId===id) activeId = convs[0]?.id || null;
  persist(); renderSidebar(); renderThread();
}

/* ---------- 8. RENDER ---------- */
function renderSidebar(){
  const list = $('#convList'); list.innerHTML='';
  if(!convs.length){ const e=el('div','empty'); e.textContent='Nenhuma conversa ainda.'; list.appendChild(e); return; }
  convs.forEach(c=>{
    const d = el('div','conv'+(c.id===activeId?' active':''));
    const t = el('span','ttl'); t.textContent=c.title; d.appendChild(t);
    const del = el('button','del'); del.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
    del.addEventListener('click',e=>{ e.stopPropagation(); deleteConversation(c.id); });
    d.appendChild(del);
    d.addEventListener('click',()=>{ activeId=c.id; persist(); renderSidebar(); renderThread(); closeNav(); });
    list.appendChild(d);
  });
}

function renderThread(){
  const inner = $('#threadInner'); inner.innerHTML='';
  const c = active();
  if(!c || !c.messages.length){ renderWelcome(inner); return; }
  c.messages.forEach(m=>inner.appendChild(messageNode(m)));
  scrollDown();
}

function renderWelcome(inner){
  const w = el('div','welcome');
  w.innerHTML = `
    <div class="big-mark"></div>
    <h1 class="brand">INTELECTUAL IA</h1>
    <p>Seu motor de raciocínio pessoal. Pergunte, calcule, escreva — ou peça uma imagem direto no chat.</p>
    <div class="suggest">
      <button data-q="Explique de forma estratégica como aplicar juros compostos pra independência financeira aos 25."><b>Estratégia financeira</b>Juros compostos na prática</button>
      <button data-q="Me dê um plano de estudo semanal de matemática e inglês com foco em desempenho."><b>Plano de estudo</b>Matemática + inglês</button>
      <button data-q="Crie uma imagem de uma escavadeira hidráulica em estilo blueprint técnico"><b>Gerar imagem</b>Blueprint de máquina</button>
      <button data-q="Quais princípios de engenharia explicam a estabilidade de uma estrutura de madeira?"><b>Engenharia</b>Estrutura em madeira</button>
    </div>`;
  w.querySelectorAll('.suggest button').forEach(b=>{
    b.addEventListener('click',()=>{ $('#input').value=b.dataset.q; autosize(); send(); });
  });
  inner.appendChild(w);
}

function messageNode(m){
  const wrap = el('div','msg '+(m.role==='user'?'user':'ai'));
  const av = el('div','av'); av.textContent = m.role==='user'?'JH':'';
  const body = el('div','body');
  if(m.type==='image'){
    body.appendChild(imageNode(m.img, m.prompt, m.error));
    if(m.caption){ const p=el('p'); p.textContent=m.caption; body.appendChild(p); }
  } else if(m.role==='user'){
    m.content.split('\n').forEach(line=>{ const p=el('p'); p.textContent=line; body.appendChild(p); });
  } else {
    body.innerHTML = renderMarkdown(m.content||'');
  }
  wrap.appendChild(av); wrap.appendChild(body);
  return wrap;
}

function imageNode(url, prompt, error){
  if(error){ const e=el('div','img-loading'); e.textContent='Não consegui gerar a imagem. Tente reformular o pedido.'; return e; }
  const box = el('div','gen-img');
  const img = el('img'); img.alt = prompt||'imagem gerada'; img.loading='lazy'; img.src=url;
  const cap = el('div','cap');
  cap.innerHTML = `<span>imagem gerada</span><a href="${url}" target="_blank" rel="noopener">abrir</a>`;
  box.appendChild(img); box.appendChild(cap);
  return box;
}

/* ---------- 9. ENVIO ---------- */
let busy=false;
async function send(){
  const input = $('#input');
  const text = input.value.trim();
  if(!text || busy) return;
  if(!active()) newConversation();
  const c = active();

  c.messages.push({role:'user',content:text});
  if(c.title==='Nova conversa') c.title = text.slice(0,46);
  input.value=''; autosize();
  renderSidebar();
  $('#threadInner').appendChild(messageNode({role:'user',content:text}));
  scrollDown();
  persist();

  // rota de imagem (integrada, sem módulo aparente)
  const imgPrompt = detectImage(text);
  if(imgPrompt){ await runImage(c, imgPrompt); return; }

  await runChat(c);
}

async function runImage(c, prompt){
  setBusy(true);
  const loadNode = el('div','msg ai');
  loadNode.innerHTML = `<div class="av"></div><div class="body"><div class="img-loading"><div class="ring"></div>gerando imagem…</div></div>`;
  $('#threadInner').appendChild(loadNode); scrollDown();

  const url = pollinationsURL(prompt);
  const pre = new Image();
  const done = (error)=>{
    const msg = { role:'assistant', type:'image', img:error?null:url, prompt, error };
    c.messages.push(msg); persist();
    loadNode.replaceWith(messageNode(msg));
    setBusy(false); scrollDown();
  };
  pre.onload = ()=>done(false);
  pre.onerror = ()=>done(true);
  pre.src = url;
}

async function runChat(c){
  setBusy(true);
  const aiNode = el('div','msg ai');
  const av = el('div','av'); const body = el('div','body');
  aiNode.appendChild(av); aiNode.appendChild(body);
  $('#threadInner').appendChild(aiNode); scrollDown();

  let acc='';
  const history = c.messages.filter(m=>m.type!=='image').map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));

  try{
    await streamChat(history, tok=>{
      acc += tok;
      body.innerHTML = renderMarkdown(acc) + '<span class="caret"></span>';
      scrollDown(true);
    });
    body.innerHTML = renderMarkdown(acc);
    c.messages.push({role:'assistant',content:acc});
    persist();
  }catch(e){
    if(e.name==='AbortError'){
      body.innerHTML = renderMarkdown(acc || '_interrompido_');
      if(acc) c.messages.push({role:'assistant',content:acc});
    } else {
      body.innerHTML = `<p style="color:var(--danger)">Erro: ${escapeHtml(e.message)}.</p><p style="color:var(--text-dim);font-size:13px">Confira as chaves em Configurações ou tente de novo.</p>`;
    }
    persist();
  }finally{
    setBusy(false); abortCtrl=null; scrollDown();
  }
}

function setBusy(b){
  busy=b;
  const send=$('#send');
  if(b){
    send.classList.add('stop'); send.disabled=false;
    send.innerHTML='<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  }else{
    send.classList.remove('stop');
    send.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    send.disabled = !$('#input').value.trim();
  }
}

/* ---------- 10. UI: composer, nav, settings ---------- */
function autosize(){ const i=$('#input'); i.style.height='auto'; i.style.height=Math.min(i.scrollHeight,200)+'px'; }
function scrollDown(soft){ const t=$('#thread'); if(!soft || t.scrollHeight-t.scrollTop-t.clientHeight<140) t.scrollTop=t.scrollHeight; }

$('#input').addEventListener('input',()=>{ autosize(); if(!busy) $('#send').disabled=!$('#input').value.trim(); });
$('#input').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });
$('#send').addEventListener('click',()=>{ if(busy){ abortCtrl?.abort(); } else send(); });
$('#newChat').addEventListener('click',()=>{ newConversation(); closeNav(); });

// copiar código
document.addEventListener('click',e=>{
  const b=e.target.closest('.copy-code');
  if(b){ navigator.clipboard.writeText(decodeURIComponent(b.dataset.code)); b.textContent='copiado'; setTimeout(()=>b.textContent='copiar',1200); }
});

// nav mobile
const app=$('#app');
function openNav(){ app.classList.add('nav-open'); }
function closeNav(){ app.classList.remove('nav-open'); }
$('#menuBtn').addEventListener('click',openNav);
$('#scrim').addEventListener('click',closeNav);

// settings
function openSettings(){
  const s=store.settings;
  $('#setModelMain').value=s.modelMain; $('#setModelFb').value=s.modelFb;
  $('#settings').hidden=false;
}
$('#openSettings').addEventListener('click',()=>{ openSettings(); closeNav(); });
$('#closeSettings').addEventListener('click',()=>$('#settings').hidden=true);
$('#saveSettings').addEventListener('click',()=>{
  store.saveSettings({ modelMain:$('#setModelMain').value.trim()||DEFAULTS.modelMain, modelFb:$('#setModelFb').value.trim()||DEFAULTS.modelFb });
  $('#settings').hidden=true; updateModelLabel(); toast('Configurações salvas.');
});
$('#reconnect').addEventListener('click',()=>{ $('#settings').hidden=true; openOnboarding(true); });
$('#wipe').addEventListener('click',()=>{
  if(confirm('Apagar todas as chaves e conversas deste aparelho?')){ store.wipe(); location.reload(); }
});

function updateModelLabel(){ $('#modelLabel').textContent = store.settings.modelMain; }

/* ---------- 11. TOAST ---------- */
let toastT;
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2600);
}

/* ---------- 12. BOOT ---------- */
function boot(){
  convs = store.conversations; activeId = store.activeId;
  if(activeId && !active()) activeId=convs[0]?.id||null;
  updateModelLabel(); renderSidebar(); renderThread(); autosize();
  $('#send').disabled = !$('#input').value.trim();
}

function start(){
  if(!store.k1 || !store.k2){ openOnboarding(true); }
  else boot();
}
start();
