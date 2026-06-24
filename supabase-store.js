/* ============================================================
   QUALIDADE V1 — supabase-store.js
   Adaptador de storage para a Biblioteca, na nuvem (Supabase).
   Implementa a MESMA interface do IndexedDBStore -> Biblioteca.useStore(SupabaseStore())
     - originais      -> Supabase Storage (bucket "biblioteca")
     - metadados      -> Postgres (documents, knowledge_entities, entity_document_links)
     - chunks/vetores -> document_chunks (pgvector)
     - busca vetorial -> RPC match_chunks (cosseno no servidor)
   Requer: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   Config (localStorage): qv1_sb_url, qv1_sb_anon. Auth: email/senha (para sync entre aparelhos).
   ============================================================ */
window.SupabaseStore = function(){
  const URL =()=>localStorage.getItem('qv1_sb_url')||'';
  const ANON=()=>localStorage.getItem('qv1_sb_anon')||'';
  const BUCKET='biblioteca';
  let _c=null,_uid=null;

  function c(){
    if(!URL()||!ANON()) throw new Error('Supabase não configurado (URL/anon).');
    if(!window.supabase) throw new Error('supabase-js não carregou.');
    if(!_c) _c=window.supabase.createClient(URL(),ANON());
    return _c;
  }
  async function user(){ const {data}=await c().auth.getUser(); _uid=data&&data.user?data.user.id:null; return data?data.user:null; }
  async function signIn(email,password){ const {data,error}=await c().auth.signInWithPassword({email,password}); if(error)throw error; _uid=data.user.id; return data.user; }
  async function signUp(email,password){ const {data,error}=await c().auth.signUp({email,password}); if(error)throw error; return data.user; }
  async function signOut(){ try{await c().auth.signOut();}catch(e){} _uid=null; }

  async function _u(){ return (await user())||{}; }

  /* ---- documents ---- */
  async function putDoc(d){
    const u=await _u();
    const row={ id:d.id, user_id:u.id, title:d.title, original_filename:d.original_filename||null,
      source_type:d.source_type||'file', file_type:d.file_type||null, storage_path:d.storage_path||null,
      source_url:d.source_url||null, theme:d.theme||null, language:d.language||null, summary:d.summary||null,
      tags:d.tags||[], size_bytes:d.size||null, status:d.status, error:d.error||null, updated_at:new Date().toISOString() };
    const {error}=await c().from('documents').upsert(row); if(error)throw error; return d;
  }
  async function listDocs(){
    const {data,error}=await c().from('documents').select('*').order('created_at',{ascending:false});
    if(error)throw error;
    return (data||[]).map(r=>({ id:r.id,title:r.title,original_filename:r.original_filename,file_type:r.file_type,
      source_type:r.source_type,theme:r.theme,language:r.language,summary:r.summary,status:r.status,
      size:r.size_bytes,storage_path:r.storage_path,source_url:r.source_url,tags:r.tags,
      created_at:new Date(r.created_at).getTime(),embedded:true,error:r.error }));
  }
  async function deleteDoc(id){
    const {data}=await c().from('documents').select('storage_path').eq('id',id).maybeSingle();
    if(data&&data.storage_path){ try{await c().storage.from(BUCKET).remove([data.storage_path]);}catch(e){} }
    const {error}=await c().from('documents').delete().eq('id',id); if(error)throw error; // cascade limpa chunks/links
  }

  /* ---- chunks ---- */
  async function putChunks(arr){
    const u=await _u();
    const rows=arr.map(ch=>({ id:ch.id, document_id:ch.document_id, user_id:u.id, chunk_index:ch.chunk_index,
      content:ch.content, page:ch.page, token_count:ch.token_count, embedding:ch.embedding }));
    for(let i=0;i<rows.length;i+=200){ const {error}=await c().from('document_chunks').insert(rows.slice(i,i+200)); if(error)throw error; }
    return rows.length;
  }
  async function chunksByDoc(id){
    const {data,error}=await c().from('document_chunks').select('id,chunk_index,content,page').eq('document_id',id).order('chunk_index');
    if(error)throw error; return (data||[]).map(r=>({...r,document_id:id}));
  }

  /* ---- entidades ---- */
  async function putEntity(e){ const u=await _u(); const {error}=await c().from('knowledge_entities').upsert({id:e.id,user_id:u.id,name:e.name,type:e.type||'conceito',summary:e.summary||null,aliases:e.aliases||[]}); if(error)throw error; return e; }
  async function listEntities(){ const {data,error}=await c().from('knowledge_entities').select('*'); if(error)throw error; return data||[]; }
  async function putLink(l){ const {error}=await c().from('entity_document_links').upsert({id:l.id,entity_id:l.entity_id,document_id:l.document_id},{onConflict:'entity_id,document_id'}); if(error)throw error; return l; }
  async function listLinks(){ const {data,error}=await c().from('entity_document_links').select('*'); if(error)throw error; return data||[]; }

  /* ---- Storage (originais) ---- */
  async function uploadOriginal(file, docId){
    const u=await _u(); const ext=(file.name.split('.').pop()||'bin').toLowerCase();
    const path=u.id+'/'+docId+'.'+ext;
    const {error}=await c().storage.from(BUCKET).upload(path,file,{upsert:true,contentType:file.type||undefined});
    if(error)throw error; return path;
  }
  async function signedUrl(path){ const {data,error}=await c().storage.from(BUCKET).createSignedUrl(path,3600); if(error)throw error; return data.signedUrl; }

  /* ---- busca vetorial (servidor) ---- */
  async function searchVectors(queryEmbedding, k){
    const u=await _u();
    const {data,error}=await c().rpc('match_chunks',{query_embedding:queryEmbedding,match_count:k||6,filter_user:u.id});
    if(error)throw error;
    return (data||[]).map(r=>({content:r.content,score:r.similarity,page:r.page,document_id:r.document_id,title:r.title}));
  }

  return { kind:'supabase', isConfigured:()=>!!(URL()&&ANON()),
    user, signIn, signUp, signOut,
    putDoc, listDocs, deleteDoc, putChunks, chunksByDoc,
    putEntity, listEntities, putLink, listLinks,
    uploadOriginal, signedUrl, searchVectors };
};
