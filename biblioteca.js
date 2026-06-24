/* ============================================================
   QUALIDADE V1 — biblioteca.js
   Biblioteca + RAG + Embeddings + Busca vetorial + Entidades.
   Arquitetura DESACOPLADA: o storage é um adaptador.
     - Agora: IndexedDBStore (navegador, sem backend)
     - Depois: SupabaseStore (mesma interface, sync + pgvector)
   Trocar o banco = trocar o adaptador, sem mexer no pipeline/UI.

   Schema lógico (= o spec do José):
     documents      {id,title,original_filename,file_type,theme,language,summary,status,tags,created_at,updated_at}
     chunks         {id,document_id,chunk_index,content,page,token_count,embedding}
     entities       {id,name,type,summary,aliases,created_at}
     entity_links   {id,entity_id,document_id}
   ============================================================ */
window.Biblioteca = (function(){

  /* ---------- chaves / config ---------- */
  const pk = ()=>localStorage.getItem('qv1_pollinations_pk')||'';
  const openaiKey = ()=>localStorage.getItem('qv1_openai_key')||'';
  const orKey = ()=>localStorage.getItem('iia_v7_openrouter')||'';
  const groqKey = ()=>localStorage.getItem('iia_v7_groq')||'';
  const llmModel = ()=>{try{return JSON.parse(localStorage.getItem('iia_v7_settings')||'{}').modelMain||'openai/gpt-4o-mini'}catch{return 'openai/gpt-4o-mini'}};
  const EMB_DIM = 512;

  /* ================= ADAPTADOR: IndexedDB ================= */
  function IndexedDBStore(){
    const DB='qv1_biblioteca', V=1;
    function db(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,V);
      r.onupgradeneeded=()=>{const d=r.result;
        if(!d.objectStoreNames.contains('documents'))d.createObjectStore('documents',{keyPath:'id'});
        if(!d.objectStoreNames.contains('chunks')){const s=d.createObjectStore('chunks',{keyPath:'id'});s.createIndex('doc','document_id',{unique:false});}
        if(!d.objectStoreNames.contains('entities'))d.createObjectStore('entities',{keyPath:'id'});
        if(!d.objectStoreNames.contains('links'))d.createObjectStore('links',{keyPath:'id'});
      };
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
    function tx(store,mode,fn){return db().then(d=>new Promise((res,rej)=>{const t=d.transaction(store,mode);const out=fn(t);t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);}));}
    function all(store,idx,key){return tx(store,'readonly',t=>{const s=t.objectStore(store);const src=idx?s.index(idx):s;const out=[];const rq=key!=null?src.openCursor(IDBKeyRange.only(key)):src.openCursor();rq.onsuccess=e=>{const c=e.target.result;if(c){out.push(c.value);c.continue();}};return out;});}
    return {
      putDoc:d=>tx('documents','readwrite',t=>{t.objectStore('documents').put(d);return d;}),
      getDoc:id=>tx('documents','readonly',t=>{let v=null;t.objectStore('documents').get(id).onsuccess=e=>v=e.target.result;return new Promise(r=>setTimeout(()=>r(v),0));}).then(p=>p),
      listDocs:()=>all('documents'),
      deleteDoc:async id=>{await tx('documents','readwrite',t=>t.objectStore('documents').delete(id));const cs=await all('chunks','doc',id);await tx('chunks','readwrite',t=>{cs.forEach(c=>t.objectStore('chunks').delete(c.id));});const ls=(await all('links')).filter(l=>l.document_id===id);await tx('links','readwrite',t=>{ls.forEach(l=>t.objectStore('links').delete(l.id));});},
      putChunks:arr=>tx('chunks','readwrite',t=>{arr.forEach(c=>t.objectStore('chunks').put(c));return arr.length;}),
      chunksByDoc:id=>all('chunks','doc',id),
      allChunks:()=>all('chunks'),
      putEntity:e=>tx('entities','readwrite',t=>{t.objectStore('entities').put(e);return e;}),
      listEntities:()=>all('entities'),
      putLink:l=>tx('links','readwrite',t=>{t.objectStore('links').put(l);return l;}),
      listLinks:()=>all('links')
    };
  }
  let store = IndexedDBStore();
  function useStore(s){ store=s; }   // <- aqui entra o SupabaseStore no futuro

  /* ================= EXTRAÇÃO ================= */
  async function extractFile(file){
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(ext==='txt'||ext==='md') return { text: await file.text() };
    if(ext==='pdf'){
      if(typeof pdfjsLib==='undefined') throw new Error('pdf.js não carregou');
      const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
      let text=''; const pageMarks=[];
      for(let p=1;p<=pdf.numPages;p++){const pg=await pdf.getPage(p);const c=await pg.getTextContent();pageMarks.push({page:p,at:text.length});text+=c.items.map(i=>i.str).join(' ')+'\n';}
      return { text, pageMarks };
    }
    if(ext==='docx'){ if(!window.mammoth) throw new Error('mammoth não carregou'); const r=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()}); return { text:r.value }; }
    if(ext==='epub'){ if(!window.JSZip) throw new Error('JSZip não carregou'); const zip=await JSZip.loadAsync(await file.arrayBuffer()); let text='';
      const names=Object.keys(zip.files).filter(f=>/\.x?html?$/i.test(f)).sort();
      for(const n of names){const html=await zip.files[n].async('string');text+=html.replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z]+;/gi,' ')+'\n';}
      return { text }; }
    throw new Error('formato não suportado (.pdf .txt .md .docx .epub)');
  }

  function clean(t){return (t||'').replace(/\r/g,'').replace(/\u00ad/g,'').replace(/[ \t]+/g,' ').replace(/ ?\n ?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();}

  /* ================= CHUNKING (~800 tok, overlap ~120) ================= */
  const CHARS_PER_TOK=4, SIZE=800*CHARS_PER_TOK, OVERLAP=120*CHARS_PER_TOK;
  function chunkText(text, pageMarks){
    text=text.replace(/\s+/g,' ').trim();
    const out=[]; let i=0, idx=0;
    const pageAt=pos=>{ if(!pageMarks)return null; let pg=1; for(const m of pageMarks){if(m.at<=pos)pg=m.page;else break;} return pg; };
    while(i<text.length){
      let end=Math.min(i+SIZE,text.length);
      if(end<text.length){const dot=text.lastIndexOf('. ',end);if(dot>i+SIZE*0.6)end=dot+1;}
      const content=text.slice(i,end).trim();
      if(content.length>40) out.push({content, chunk_index:idx++, page:pageAt(i), token_count:Math.round(content.length/CHARS_PER_TOK)});
      if(end>=text.length)break;
      i=end-OVERLAP;
    }
    return out;
  }

  /* ================= EMBEDDINGS ================= */
  async function embed(texts){
    if(pk()){
      const r=await fetch('https://gen.pollinations.ai/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pk()},body:JSON.stringify({model:'openai-3-small',input:texts,dimensions:EMB_DIM})});
      if(!r.ok) throw new Error('Embeddings Pollinations HTTP '+r.status);
      return (await r.json()).data.map(d=>d.embedding);
    }
    if(openaiKey()){
      const r=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+openaiKey()},body:JSON.stringify({model:'text-embedding-3-small',input:texts,dimensions:EMB_DIM})});
      if(!r.ok) throw new Error('Embeddings OpenAI HTTP '+r.status);
      return (await r.json()).data.map(d=>d.embedding);
    }
    return null; // sem chave -> usa fallback por palavra-chave
  }
  async function embedBatched(texts, batch=32){
    const out=[];
    for(let i=0;i<texts.length;i+=batch){const part=await embed(texts.slice(i,i+batch));if(part===null)return null;out.push(...part);}
    return out;
  }
  function cos(a,b){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return d/(Math.sqrt(na)*Math.sqrt(nb)+1e-9);}

  /* fallback keyword */
  const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const STOP=new Set('a o e de da do das dos para por com sem que qual um uma no na em ao as os se sua seu como mais sobre entre e foi era ser ter tem'.split(' '));
  const terms=s=>norm(s).split(' ').filter(w=>w.length>2&&!STOP.has(w));

  /* ================= RESUMO + ENTIDADES (LLM) ================= */
  async function summarize(text, title){
    const sys='Você analisa um documento e responde APENAS com JSON válido, sem markdown: {"summary":"resumo denso em 3-5 frases","theme":"tema principal","language":"idioma","entities":[{"name":"Nome","type":"pessoa|conceito|evento|área"}]}. Liste de 1 a 6 entidades importantes.';
    const usr='Título: '+title+'\n\nTrecho do documento:\n'+text.slice(0,6000);
    const tries=[{u:'https://openrouter.ai/api/v1/chat/completions',k:orKey(),m:llmModel(),x:{'HTTP-Referer':location.origin,'X-Title':'QUALIDADE V1'}},{u:'https://api.groq.com/openai/v1/chat/completions',k:groqKey(),m:'llama-3.3-70b-versatile',x:{}}];
    for(const t of tries){ if(!t.k)continue;
      try{const r=await fetch(t.u,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t.k,...t.x},body:JSON.stringify({model:t.m,temperature:.3,messages:[{role:'system',content:sys},{role:'user',content:usr}]})});
        if(!r.ok)continue; let txt=(await r.json()).choices[0].message.content.replace(/```json|```/g,'').trim();
        const a=txt.indexOf('{'),b=txt.lastIndexOf('}'); if(a>=0)txt=txt.slice(a,b+1);
        return JSON.parse(txt);
      }catch(e){}
    }
    return {summary:'',theme:'',language:'',entities:[]};
  }

  /* ================= PIPELINE DE INGESTÃO ================= */
  async function ingest(file, onStatus){
    const now=Date.now();
    const doc={id:'doc'+now+Math.random().toString(36).slice(2,5), title:file.name.replace(/\.[^.]+$/,''),
      original_filename:file.name, file_type:(file.name.split('.').pop()||'').toLowerCase(),
      theme:'', language:'', summary:'', status:'uploaded', tags:[], size:file.size, created_at:now, updated_at:now};
    await store.putDoc(doc);
    if(store.uploadOriginal && file){ try{ doc.storage_path=await store.uploadOriginal(file, doc.id); await store.putDoc(doc); }catch(e){ onStatus&&onStatus(doc,'aviso: upload do original falhou ('+e.message+')'); } }
    const set=s=>{doc.status=s;doc.updated_at=Date.now();store.putDoc(doc);onStatus&&onStatus(doc);};
    try{
      set('processing'); onStatus&&onStatus(doc,'extraindo texto…');
      const {text,pageMarks}=await extractFile(file);
      const cldoc=clean(text);
      if(cldoc.length<30) throw new Error('texto vazio/ilegível');
      onStatus&&onStatus(doc,'dividindo em trechos…');
      const raw=chunkText(cldoc,pageMarks);

      onStatus&&onStatus(doc,'gerando embeddings…');
      let vecs=null; try{ vecs=await embedBatched(raw.map(c=>c.content)); }catch(e){ vecs=null; onStatus&&onStatus(doc,'embeddings falharam, usando palavra-chave'); }

      const chunks=raw.map((c,i)=>({id:doc.id+'_c'+i, document_id:doc.id, chunk_index:c.chunk_index, content:c.content, page:c.page, token_count:c.token_count,
        embedding:vecs?vecs[i]:null, kw:vecs?null:terms(c.content)}));
      await store.putChunks(chunks);

      onStatus&&onStatus(doc,'resumindo e detectando entidades…');
      const meta=await summarize(cldoc, doc.title);
      doc.summary=meta.summary||''; doc.theme=meta.theme||''; doc.language=meta.language||'';
      for(const ent of (meta.entities||[])){ await upsertEntity(ent, doc.id); }

      doc.embedded=!!vecs; set('indexed');
      return doc;
    }catch(e){ doc.error=e.message; set('failed'); throw e; }
  }

  async function upsertEntity(ent, docId){
    const name=(ent.name||'').trim(); if(!name)return;
    const ents=await store.listEntities();
    let e=ents.find(x=>norm(x.name)===norm(name));
    if(!e){ e={id:'ent'+Date.now()+Math.random().toString(36).slice(2,5), name, type:ent.type||'conceito', summary:'', aliases:[], created_at:Date.now()}; await store.putEntity(e); }
    const links=await store.listLinks();
    if(!links.some(l=>l.entity_id===e.id&&l.document_id===docId)) await store.putLink({id:'lnk'+Date.now()+Math.random().toString(36).slice(2,5), entity_id:e.id, document_id:docId});
  }

  /* ================= BUSCA (vetorial, com fallback) ================= */
  async function search(query, opts={}){
    const k=opts.k||6;
    if(store.searchVectors){            // adaptador na nuvem -> busca vetorial no servidor
      const qv=await embed([query]);
      if(!qv) throw new Error('Sem chave de embeddings para a busca.');
      return store.searchVectors(qv[0], k);
    }
    const docs=await store.listDocs();
    const titleById={}; docs.forEach(d=>titleById[d.id]=d.title);
    let chunks=await store.allChunks();
    if(opts.document_id) chunks=chunks.filter(c=>c.document_id===opts.document_id);
    if(!chunks.length) return [];

    const hasEmb=chunks[0].embedding!=null;
    let scored;
    if(hasEmb){
      const qv=(await embed([query]));
      if(!qv) return keyword(query,chunks,k,titleById);
      const q=qv[0];
      scored=chunks.filter(c=>c.embedding).map(c=>({c,score:cos(q,c.embedding)}));
    } else {
      return keyword(query,chunks,k,titleById);
    }
    return scored.sort((a,b)=>b.score-a.score).slice(0,k).map(({c,score})=>({
      content:c.content, score, page:c.page, document_id:c.document_id, title:titleById[c.document_id]||'documento'
    }));
  }
  function keyword(query,chunks,k,titleById){
    const q=terms(query); if(!q.length)return [];
    const scored=chunks.map(c=>{const set=new Set(c.kw||terms(c.content));let s=0;q.forEach(t=>{if(set.has(t))s++;});return {c,score:s};}).filter(x=>x.score>0);
    return scored.sort((a,b)=>b.score-a.score).slice(0,k).map(({c,score})=>({content:c.content,score,page:c.page,document_id:c.document_id,title:titleById[c.document_id]||'documento'}));
  }

  /* ================= API pública ================= */
  return {
    useStore, ingest, search, extractFile,
    listDocs:()=>store.listDocs(),
    deleteDoc:id=>store.deleteDoc(id),
    chunksByDoc:id=>store.chunksByDoc(id),
    listEntities:()=>store.listEntities(),
    listLinks:()=>store.listLinks(),
    hasEmbeddings:()=>!!(pk()||openaiKey())
  };
})();
