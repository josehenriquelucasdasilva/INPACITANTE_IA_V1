/* ============================================================
   QUALIDADE V1 — entities.js  (Fase 8)
   CRUD de knowledge_entities + links + chamadas à function 'entities'.
   Requer supabase-js. Config: qv1_sb_url, qv1_sb_anon (mesma conexão).
   ============================================================ */
window.Entities = (function(){
  const cfg=()=>({url:localStorage.getItem('qv1_sb_url')||'',anon:localStorage.getItem('qv1_sb_anon')||''});
  let _c=null,_uid=null;
  function client(){const{url,anon}=cfg();if(!url||!anon||!window.supabase)return null;if(!_c)_c=window.supabase.createClient(url,anon);return _c;}
  function reset(){_c=null;_uid=null;}
  async function user(){const cl=client();if(!cl)return null;const{data}=await cl.auth.getUser();_uid=data&&data.user?data.user.id:null;return data?data.user:null;}
  async function signIn(email,password){const cl=client();if(!cl)throw new Error('Configure URL/anon');const{data,error}=await cl.auth.signInWithPassword({email,password});if(error)throw error;_uid=data.user.id;return data.user;}
  async function signUp(email,password){const cl=client();if(!cl)throw new Error('Configure URL/anon');const{data,error}=await cl.auth.signUp({email,password});if(error)throw error;return data.user;}
  async function signOut(){const cl=client();if(cl){try{await cl.auth.signOut()}catch(e){}}_uid=null;}

  async function list(){const cl=client();if(!cl)throw new Error('Sem conexão');const{data,error}=await cl.from('knowledge_entities').select('*').order('importance_score',{ascending:false}).order('updated_at',{ascending:false});if(error)throw error;return data||[];}
  async function counts(){const cl=client();
    const out={docs:{},mems:{}};
    try{const{data:d}=await cl.from('entity_document_links').select('entity_id');(d||[]).forEach(r=>out.docs[r.entity_id]=(out.docs[r.entity_id]||0)+1)}catch(e){}
    try{const{data:m}=await cl.from('entity_memory_links').select('entity_id');(m||[]).forEach(r=>out.mems[r.entity_id]=(out.mems[r.entity_id]||0)+1)}catch(e){}
    return out;}
  async function update(id,patch){const cl=client();const{error}=await cl.from('knowledge_entities').update({...patch,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;}
  async function create(e){const cl=client();const u=await user();const nn=(e.name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    const{data,error}=await cl.from('knowledge_entities').insert({user_id:u.id,name:e.name,name_norm:nn,type:e.type||'topic',description:e.description||null,summary:e.summary||null,aliases:e.aliases||[],tags:e.tags||[],auto_created:false,importance_score:e.importance_score||0}).select().single();if(error)throw error;return data;}
  async function remove(id){const cl=client();const{error}=await cl.from('knowledge_entities').delete().eq('id',id);if(error)throw error;}

  async function docLinks(entityId){const cl=client();const{data,error}=await cl.from('entity_document_links').select('relation_type,confidence_score,document_id,library_documents(title,document_type,theme,created_at)').eq('entity_id',entityId);if(error)throw error;return data||[];}
  async function chunkLinks(entityId){const cl=client();const{data,error}=await cl.from('entity_chunk_links').select('chunk_id,document_id,library_document_chunks(content,chunk_index)').eq('entity_id',entityId).limit(20);if(error)throw error;return data||[];}

  async function extract(documentId){const cl=client();const{data,error}=await cl.functions.invoke('entities',{body:{action:'extract',document_id:documentId}});if(error){let m=error.message;try{const c=await error.context.json();if(c&&c.error)m=c.error}catch(e){}throw new Error(m)}if(data&&data.error)throw new Error(data.error);return data;}
  async function consolidate(entityId,memories){const cl=client();const{data,error}=await cl.functions.invoke('entities',{body:{action:'consolidate',entity_id:entityId,memories:memories||[]}});if(error){let m=error.message;try{const c=await error.context.json();if(c&&c.error)m=c.error}catch(e){}throw new Error(m)}if(data&&data.error)throw new Error(data.error);return data;}
  async function processedDocs(){const cl=client();const{data,error}=await cl.from('library_documents').select('id,title,status').eq('status','processed');if(error)throw error;return data||[];}

  return { isConfigured:()=>!!(cfg().url&&cfg().anon), client, reset, user, signIn, signUp, signOut,
    list, counts, create, update, remove, docLinks, chunkLinks, extract, consolidate, processedDocs };
})();
