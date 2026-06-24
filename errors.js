/* ============================================================
   QUALIDADE V1 — errors.js  (camada de erros / diagnóstico)
   window.AppError.log(...)  -> registra (localStorage sempre + Supabase se conectado)
   window.AppError.diagnostic(rec) -> texto pronto para enviar à correção
   window.AppError.openPanel() -> painel de erros
   Captura global de erros não tratados (Regra 1).
   Requer supabase-js para gravar na nuvem (degrada para local sem ele).
   ============================================================ */
window.AppError = (function(){
  const LSK='qv1_error_log';
  const cfg=()=>({url:localStorage.getItem('qv1_sb_url')||'',anon:localStorage.getItem('qv1_sb_anon')||''});
  let _c=null;
  function client(){const{url,anon}=cfg();if(!url||!anon||!window.supabase)return null;if(!_c)_c=window.supabase.createClient(url,anon);return _c;}
  const esc=s=>(s==null?'':String(s)).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  const FRIENDLY={chat:'Houve um problema no chat.',history:'O histórico não foi carregado ou salvo.',memory:'Houve um problema com a memória.',
    library:'Houve um problema na biblioteca.',document_processing:'Falha ao processar o documento.',vector_search:'A busca na biblioteca falhou.',
    sources:'Não foi possível registrar/exibir as fontes.',entities:'Houve um problema nas entidades.',ui:'Ocorreu um erro na interface.',feedback:'Não foi possível salvar o feedback.'};
  const ACTION={document_processing:'Reprocessar o documento / verificar o parser / verificar o arquivo.',
    vector_search:'Verificar a função retrieve-context, a OPENAI_API_KEY e se os documentos foram reprocessados (embeddings).',
    entities:'Verificar a função entities e a OPENAI_API_KEY.',library:'Verificar conexão Supabase, bucket e tamanho do arquivo.',
    chat:'Verificar as chaves do modelo (OpenRouter/Groq) e a conexão.',history:'Verificar conexão Supabase e tabelas de chat.',
    memory:'Verificar a memória local e a conexão.',sources:'Verificar a tabela chat_message_context.'};

  function ring(){try{return JSON.parse(localStorage.getItem(LSK)||'[]')}catch{return[]}}
  function pushRing(r){try{const a=ring();a.unshift(r);localStorage.setItem(LSK,JSON.stringify(a.slice(0,60)))}catch(e){}}
  function normErr(e){if(!e)return{message:'erro desconhecido',stack:null};if(typeof e==='string')return{message:e,stack:null};return{message:e.message||String(e),stack:e.stack||null}}

  async function log(o){
    o=o||{};const e=normErr(o.error!=null?o.error:o.message);
    const rec={ id:(crypto.randomUUID?crypto.randomUUID():'e'+Date.now()+Math.random().toString(36).slice(2)),
      module:o.module||'ui', submodule:o.submodule||null, error_code:o.code||null,
      error_title:o.title||FRIENDLY[o.module]||'Erro', error_message:e.message,
      technical_details:o.details||null, stack_trace:e.stack||null, severity:o.severity||'error',
      action:o.action||ACTION[o.module]||null, user_action:o.user_action||null,
      related_document_id:o.related&&o.related.document_id||null, related_memory_id:o.related&&o.related.memory_id||null,
      related_chunk_id:o.related&&o.related.chunk_id||null, related_chat_message_id:o.related&&o.related.chat_message_id||null,
      session_id:o.session_id||null, context_snapshot:o.context||null, created_at:new Date().toISOString(), status:'open' };
    pushRing(rec); // Regra 1: sempre registra
    try{const cl=client();if(cl){const{data}=await cl.auth.getUser();const u=data&&data.user;if(u){
      await cl.from('app_error_logs').insert({id:rec.id,user_id:u.id,session_id:rec.session_id,module:rec.module,submodule:rec.submodule,
        error_code:rec.error_code,error_title:rec.error_title,error_message:rec.error_message,technical_details:rec.technical_details,
        stack_trace:rec.stack_trace,severity:rec.severity,related_document_id:rec.related_document_id,related_memory_id:rec.related_memory_id,
        related_chunk_id:rec.related_chunk_id,related_chat_message_id:rec.related_chat_message_id,context_snapshot:rec.context_snapshot,
        user_action:rec.user_action,status:'open'});}}}catch(_e){/* nuvem indisponível: fica só no local */}
    return rec;
  }

  function diagnostic(r){
    const L=['🛠️ DIAGNÓSTICO — QUALIDADE V1'];
    L.push('Módulo: '+r.module+(r.submodule?(' > '+r.submodule):''));
    if(r.user_action)L.push('Ação do usuário: '+r.user_action);
    if(r.related_document_id)L.push('Documento: '+r.related_document_id);
    if(r.related_chat_message_id)L.push('Mensagem: '+r.related_chat_message_id);
    if(r.related_chunk_id)L.push('Chunk: '+r.related_chunk_id);
    L.push('Código: '+(r.error_code||'—'));
    L.push('Erro: '+r.error_message);
    if(r.technical_details)L.push('Detalhe técnico: '+r.technical_details);
    if(r.action)L.push('Ação sugerida: '+r.action);
    L.push('Severidade: '+r.severity);
    L.push('Horário: '+new Date(r.created_at).toLocaleString('pt-BR'));
    if(r.stack_trace)L.push('Stack: '+String(r.stack_trace).split('\n').slice(0,4).join(' | '));
    return L.join('\n');
  }

  const BB='font-size:12px;background:none;border:1px solid #2A3B52;color:#9FB2C9;border-radius:7px;padding:6px 10px;cursor:pointer';
  const BP='font-size:12px;background:rgba(61,139,255,.13);border:1px solid rgba(61,139,255,.38);color:#6FA8FF;border-radius:7px;padding:6px 10px;cursor:pointer';
  function openPanel(){
    let ov=document.getElementById('aeOv');
    if(ov)ov.remove();
    ov=document.createElement('div');ov.id='aeOv';
    ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(6,9,14,.74);backdrop-filter:blur(5px);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow:auto';
    ov.addEventListener('click',e=>{if(e.target===ov)ov.remove()});
    const card=document.createElement('div');
    card.style.cssText='background:#152030;border:1px solid #2A3B52;border-radius:14px;max-width:580px;width:100%;color:#EAF1F9;font-family:Inter,system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5)';
    const recs=ring();
    card.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #2A3B52"><b style="font-size:16px;font-family:\'Space Grotesk\',sans-serif">Erros do sistema</b><div><button id="aeClear" style="'+BB+';margin-right:6px">Limpar</button><button id="aeX" style="'+BB+'">Fechar</button></div></div>';
    const body=document.createElement('div');body.style.cssText='padding:12px 16px';
    if(!recs.length)body.innerHTML='<div style="color:#61748C;text-align:center;padding:28px">Nenhum erro registrado. 🎉</div>';
    else recs.forEach(r=>{
      const sc={info:'#6FA8FF',warning:'#E6B450',error:'#F2705F',critical:'#F2705F'}[r.severity]||'#F2705F';
      const it=document.createElement('div');it.style.cssText='border:1px solid #2A3B52;border-radius:10px;padding:11px 12px;margin-bottom:9px';
      it.innerHTML='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:'+sc+';border:1px solid '+sc+';padding:2px 7px;border-radius:20px">'+esc(r.severity)+'</span><b style="font-size:13px">'+esc(r.module)+(r.submodule?(' › '+esc(r.submodule)):'')+'</b><span style="font-size:11px;color:#61748C;margin-left:auto">'+new Date(r.created_at).toLocaleString('pt-BR')+'</span></div><div style="font-size:12.5px;color:#9FB2C9;margin-top:6px">'+esc(r.error_message||'')+'</div>';
      const acts=document.createElement('div');acts.style.cssText='margin-top:9px;display:flex;gap:7px;flex-wrap:wrap';
      const det=document.createElement('button');det.textContent='Ver detalhes';det.style.cssText=BB;
      const cpy=document.createElement('button');cpy.textContent='Copiar diagnóstico';cpy.style.cssText=BP;
      const pre=document.createElement('pre');pre.style.cssText='display:none;white-space:pre-wrap;font-size:11.5px;color:#9FB2C9;background:#0F1620;border:1px solid #2A3B52;border-radius:8px;padding:10px;margin-top:8px;font-family:ui-monospace,monospace';pre.textContent=diagnostic(r);
      det.addEventListener('click',()=>{pre.style.display=pre.style.display==='none'?'block':'none'});
      cpy.addEventListener('click',()=>{navigator.clipboard.writeText(diagnostic(r)).then(()=>{cpy.textContent='Copiado ✓';setTimeout(()=>cpy.textContent='Copiar diagnóstico',1400)})});
      acts.appendChild(det);acts.appendChild(cpy);it.appendChild(acts);it.appendChild(pre);body.appendChild(it);
    });
    card.appendChild(body);ov.appendChild(card);document.body.appendChild(ov);
    card.querySelector('#aeX').addEventListener('click',()=>ov.remove());
    card.querySelector('#aeClear').addEventListener('click',()=>{try{localStorage.removeItem(LSK)}catch(e){}openPanel()});
  }

  // captura global (Regra 1)
  window.addEventListener('error',ev=>{try{log({module:'ui',submodule:'window.onerror',code:'UNCAUGHT',error:ev.error||ev.message,severity:'error'})}catch(_){}});
  window.addEventListener('unhandledrejection',ev=>{try{log({module:'ui',submodule:'promise',code:'UNHANDLED_REJECTION',error:ev.reason,severity:'error'})}catch(_){}});

  return { log, diagnostic, openPanel, recent:ring };
})();
