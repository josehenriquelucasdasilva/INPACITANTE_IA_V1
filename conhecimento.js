/* ============================================================
   QUALIDADE V1 — conhecimento.js  (motor de recuperação / RAG)
   Fontes:
     - Wikipedia (PT)        -> grátis, sem chave, CORS ok (origin=*)
     - Base pessoal          -> seus .txt/.md/.pdf, indexados no navegador (IndexedDB)
     - Web atual             -> NÃO mora aqui; é o ':online' do OpenRouter (no index.html)
   Busca da base pessoal: por palavra-chave (TF simples). Sem custo, client-side.
   ============================================================ */
window.Conhecimento = (function(){

  /* ---------- util texto ---------- */
  const norm = s => (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')   // tira acentos
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const STOP = new Set('a o e de da do das dos para por com sem que qual quais um uma uns umas no na nos nas em ao aos as os se sua seu suas seus como mais menos sobre entre é são foi era ser ter tem'.split(' '));
  const terms = s => norm(s).split(' ').filter(w=>w.length>2 && !STOP.has(w));

  /* ---------- 1) WIKIPEDIA (PT) ---------- */
  async function wikipedia(query, n=3){
    try{
      const sr = await fetch('https://pt.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit='+n+'&srsearch='+encodeURIComponent(query));
      const sj = await sr.json();
      const hits = (sj.query && sj.query.search) || [];
      const out = [];
      for(const h of hits.slice(0,n)){
        const er = await fetch('https://pt.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&origin=*&pageids='+h.pageid);
        const ej = await er.json();
        const pg = ej.query.pages[h.pageid];
        out.push({ source:'Wikipedia', title:h.title, text:(pg.extract||'').slice(0,1400),
                   url:'https://pt.wikipedia.org/?curid='+h.pageid });
      }
      return out.filter(o=>o.text);
    }catch(e){ return []; }
  }

  /* ---------- 2) BASE PESSOAL (IndexedDB) ---------- */
  const DB='qv1_kb', STORE='docs';
  function db(){
    return new Promise((res,rej)=>{
      const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});};
      r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
    });
  }
  async function tx(mode,fn){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(STORE,mode);const s=t.objectStore(STORE);const out=fn(s);t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);});}

  function chunk(text, size=900){
    const parts=[]; let buf='';
    text.replace(/\s+/g,' ').split(/(?<=[.!?])\s+/).forEach(sent=>{
      if((buf+sent).length>size){ if(buf)parts.push(buf.trim()); buf=sent+' '; }
      else buf+=sent+' ';
    });
    if(buf.trim())parts.push(buf.trim());
    return parts.filter(p=>p.length>40);
  }

  async function addDoc(name, text, agent){
    agent=agent||'geral';
    const chunks=chunk(text).map(t=>({t, k:terms(t)}));
    if(!chunks.length) throw new Error('texto vazio ou ilegível');
    const doc={id:'d'+Date.now()+Math.random().toString(36).slice(2,6), name, agent, n:chunks.length, chunks, ts:Date.now()};
    await tx('readwrite',s=>s.put(doc));
    return doc;
  }
  async function listDocs(agent){
    return tx('readonly',s=>{const out=[];s.openCursor().onsuccess=e=>{const c=e.target.result;if(c){const v=c.value;if(!agent||(v.agent||'geral')===agent)out.push({id:v.id,name:v.name,n:v.n,ts:v.ts,agent:v.agent||'geral'});c.continue();}};return out;});
  }
  async function removeDoc(id){ return tx('readwrite',s=>s.delete(id)); }

  async function searchKB(query, n=4, agent){
    const q=terms(query); if(!q.length) return [];
    const all=await tx('readonly',s=>{const out=[];s.openCursor().onsuccess=e=>{const c=e.target.result;if(c){out.push(c.value);c.continue();}};return out;});
    const scored=[];
    all.filter(doc=>!agent||(doc.agent||'geral')===agent).forEach(doc=>doc.chunks.forEach(ch=>{
      let sc=0; const set=new Set(ch.k);
      q.forEach(term=>{ if(set.has(term)) sc+=1; });
      if(sc>0){ sc += sc/Math.sqrt(ch.k.length||1); scored.push({source:doc.name, title:doc.name, text:ch.t, score:sc}); }
    }));
    return scored.sort((a,b)=>b.score-a.score).slice(0,n);
  }

  /* ---------- 3) EXTRAÇÃO DE PDF / TEXTO ---------- */
  async function extractFile(file){
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(ext==='txt'||ext==='md') return await file.text();
    if(ext==='pdf'){
      if(typeof pdfjsLib==='undefined') throw new Error('pdf.js não carregou (precisa de internet).');
      const buf=await file.arrayBuffer();
      const pdf=await pdfjsLib.getDocument({data:buf}).promise;
      let txt='';
      for(let p=1;p<=pdf.numPages;p++){
        const page=await pdf.getPage(p);
        const c=await page.getTextContent();
        txt+=c.items.map(i=>i.str).join(' ')+'\n';
      }
      return txt;
    }
    throw new Error('formato não suportado (use .txt, .md ou .pdf)');
  }

  /* ---------- recuperação unificada ---------- */
  // sources = {wiki:bool, kb:bool}.  (web é tratado pelo :online do OpenRouter)
  async function retrieve(query, sources, agent){
    const jobs=[];
    if(sources.wiki) jobs.push(wikipedia(sources.wikiQuery||query,3));
    if(sources.kb)   jobs.push(searchKB(query,4,agent));
    const res=await Promise.allSettled(jobs);
    const snippets=[];
    res.forEach(r=>{ if(r.status==='fulfilled') snippets.push(...r.value); });
    return snippets;
  }

  return { wikipedia, addDoc, listDocs, removeDoc, searchKB, extractFile, retrieve, chunk };
})();
