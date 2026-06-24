/* ============================================================
   QUALIDADE V1 — library.js  (Biblioteca, Fase 3)
   CRUD de library_documents + Supabase Storage. Sem embeddings/RAG.
   Requer: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   Config (localStorage): qv1_sb_url, qv1_sb_anon (mesma conexão das outras fases).
   ============================================================ */
window.Library = (function(){
  const BUCKET='biblioteca';
  const cfg=()=>({url:localStorage.getItem('qv1_sb_url')||'',anon:localStorage.getItem('qv1_sb_anon')||''});
  let _c=null,_uid=null;
  function client(){const{url,anon}=cfg();if(!url||!anon||!window.supabase)return null;if(!_c)_c=window.supabase.createClient(url,anon);return _c;}
  function reset(){_c=null;_uid=null;}

  async function user(){const cl=client();if(!cl)return null;const{data}=await cl.auth.getUser();_uid=data&&data.user?data.user.id:null;return data?data.user:null;}
  async function signIn(email,password){const cl=client();if(!cl)throw new Error('Configure URL/anon');const{data,error}=await cl.auth.signInWithPassword({email,password});if(error)throw error;_uid=data.user.id;return data.user;}
  async function signUp(email,password){const cl=client();if(!cl)throw new Error('Configure URL/anon');const{data,error}=await cl.auth.signUp({email,password});if(error)throw error;return data.user;}
  async function signOut(){const cl=client();if(cl){try{await cl.auth.signOut()}catch(e){}}_uid=null;}

  async function list(){const cl=client();if(!cl)throw new Error('Sem conexão');const{data,error}=await cl.from('library_documents').select('*').order('created_at',{ascending:false});if(error)throw error;return data||[];}
  async function create(doc){const cl=client();const u=await user();if(!u)throw new Error('Entre na conta primeiro');
    const row={ id:doc.id, user_id:u.id, title:doc.title, document_type:doc.document_type,
      storage_path:doc.storage_path||null, source_url:doc.source_url||null, raw_text:doc.raw_text||null,
      theme:doc.theme||null, tags:doc.tags||[], status:doc.status||'saved', notes:doc.notes||null,
      file_size:doc.file_size||null, mime_type:doc.mime_type||null, use_in_chat:!!doc.use_in_chat,
      updated_at:new Date().toISOString() };
    const{data,error}=await cl.from('library_documents').insert(row).select().single();if(error)throw error;return data;}
  async function update(id,patch){const cl=client();const{error}=await cl.from('library_documents').update({...patch,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;}
  async function remove(id){const cl=client();
    const{data}=await cl.from('library_documents').select('storage_path').eq('id',id).maybeSingle();
    if(data&&data.storage_path){try{await cl.storage.from(BUCKET).remove([data.storage_path])}catch(e){}}
    const{error}=await cl.from('library_documents').delete().eq('id',id);if(error)throw error;}

  async function upload(file,id){const cl=client();const u=await user();if(!u)throw new Error('Entre na conta primeiro');
    const ext=(file.name.split('.').pop()||'bin').toLowerCase();const path=u.id+'/library/'+id+'.'+ext;
    const{error}=await cl.storage.from(BUCKET).upload(path,file,{upsert:true,contentType:file.type||undefined});if(error)throw error;return path;}
  async function signedUrl(path){const cl=client();const{data,error}=await cl.storage.from(BUCKET).createSignedUrl(path,3600);if(error)throw error;return data.signedUrl;}

  const uuid=()=>crypto.randomUUID?crypto.randomUUID():'l'+Date.now()+Math.random().toString(36).slice(2);

  async function process(documentId){const cl=client();if(!cl)throw new Error('Sem conexão');
    const{data,error}=await cl.functions.invoke('process-document',{body:{document_id:documentId}});
    if(error){let msg=error.message||error;try{const ctx=await error.context.json();if(ctx&&ctx.error)msg=ctx.error}catch(e){}throw new Error(msg);}
    if(data&&data.error)throw new Error(data.error);return data;}
  async function listProcessing(){const cl=client();if(!cl)return{};const{data,error}=await cl.from('library_document_processing').select('*');if(error)throw error;
    const map={};(data||[]).forEach(r=>map[r.document_id]=r);return map;}
  async function chunks(documentId){const cl=client();const{data,error}=await cl.from('library_document_chunks').select('chunk_index,content,char_count,token_count,page_number').eq('document_id',documentId).order('chunk_index');if(error)throw error;return data||[];}

  return { isConfigured:()=>!!(cfg().url&&cfg().anon), client, reset, user, signIn, signUp, signOut,
    list, create, update, remove, upload, signedUrl, uuid, BUCKET,
    process, listProcessing, chunks };
})();
