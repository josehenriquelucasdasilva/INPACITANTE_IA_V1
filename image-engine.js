/* ============================================================
   QUALIDADE V1 — image-engine.js
   Motor de geração de imagem DESACOPLADO.
   Trocar de provedor/modelo = mudar uma string, sem reescrever o site.

   API central:
     await ImageEngine.generateImage(prompt, options, provider)
       -> { url, meta:{provider, model, width, height, seed, ms} }

   provider é uma string "fonte:modelo", ex.:
     "pollinations:flux"      realismo/textura
     "pollinations:seedream"  aderência ao prompt + consistência
     "pollinations:nanobanana" coerência geral (Gemini)
     "pollinations:gptimage"  compreensão de prompt complexa
     "pollinations:zimage"    equilíbrio (default novo do Pollinations)
     "cloudflare:flux-schnell" (precisa backend/worker — stub)
     "bfl:flux2-pro"          (pago — stub)

   Como adicionar um motor novo depois:
     ImageEngine.register("minhafonte", async (prompt,opts,id)=>({url, meta}))
   ============================================================ */
window.ImageEngine = (function(){

  const registry = {};
  const register = (name, adapter) => { registry[name] = adapter; };

  // chave publicável do Pollinations (pk_...). Segura no frontend.
  const POLLEN_PK = () => localStorage.getItem('qv1_pollinations_pk') || '';

  /* ---------- adapter: Pollinations (gateway grátis, browser-friendly) ---------- */
  // Roteia para qualquer modelo do catálogo Pollinations via URL GET.
  function pollinationsAdapter(prompt, opts, providerId){
    const model = (providerId.split(':')[1]) || opts.model || 'flux';
    const {
      width = 1024, height = 1024,
      seed = Math.floor(Math.random()*2147483646),
      nologo = true, enhance = false, negative = ''
    } = opts;

    const pk = POLLEN_PK();
    const qs = new URLSearchParams();
    qs.set('model', model);
    qs.set('width', String(width));
    qs.set('height', String(height));
    qs.set('seed', String(seed));
    qs.set('nologo', nologo ? 'true' : 'false');
    if (enhance) qs.set('enhance', 'true');
    if (negative) qs.set('negative', negative);
    if (pk) qs.set('key', pk); // pk_ desbloqueia catálogo completo + limites maiores

    // Com chave -> endpoint unificado novo; sem chave -> rota legada keyless (flux/zimage)
    const base = pk
      ? `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}`
      : `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;

    const url = `${base}?${qs.toString()}`;
    // URL-based: a imagem carrega no <img>. Resolvemos já com a URL e a meta.
    return Promise.resolve({ url, meta:{ provider:providerId, model, width, height, seed } });
  }

  /* ---------- stub: Cloudflare Workers AI (precisa de Worker/proxy) ---------- */
  function cloudflareStub(){
    return Promise.reject(new Error(
      'Cloudflare Workers AI exige account_id + token e um Worker como proxy (CORS). ' +
      'Não é chamável de um site estático puro. Suba um Worker e implemente este adapter.'
    ));
  }

  /* ---------- stub: BFL FLUX.2 (pago, assíncrono com polling) ---------- */
  function bflStub(){
    return Promise.reject(new Error(
      'BFL/FLUX.2 é pago e usa fluxo assíncrono (submit -> poll). ' +
      'Requer chave secreta + backend para não vazar a chave. Implemente quando migrar para o pago.'
    ));
  }

  register('pollinations', pollinationsAdapter);
  register('cloudflare', cloudflareStub);
  register('bfl', bflStub);

  /* ---------- núcleo: generateImage ---------- */
  // Mede tempo real de resposta (do disparo até o onload da imagem).
  async function generateImage(prompt, options = {}, provider = 'pollinations:flux'){
    const source = provider.split(':')[0];
    const adapter = registry[source];
    if (!adapter) throw new Error('Provedor desconhecido: ' + provider);

    const t0 = performance.now();
    const res = await adapter(prompt, options, provider);

    // pré-carrega para medir latência e detectar falha/fallback
    const ms = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(Math.round(performance.now() - t0));
      img.onerror = () => reject(new Error('Falha ao carregar a imagem (' + provider + ')'));
      img.src = res.url;
    });

    res.meta.ms = ms;
    return res;
  }

  /* ---------- metadados dos modelos (referência p/ UI e relatório) ---------- */
  // Notas = ESTIMATIVA fundamentada em benchmark/documentação jun/2026, não teste cego.
  const CATALOG = {
    'pollinations:flux':       { nome:'FLUX',        forte:'realismo + textura',        free:true,  browser:true },
    'pollinations:seedream':   { nome:'Seedream',    forte:'aderência + consistência',  free:true,  browser:true },
    'pollinations:nanobanana': { nome:'Nano Banana', forte:'coerência geral + texto',   free:true,  browser:true },
    'pollinations:gptimage':   { nome:'GPT Image',   forte:'compreensão de prompt',     free:true,  browser:true },
    'pollinations:zimage':     { nome:'Z-Image',     forte:'equilíbrio (default)',      free:true,  browser:true },
    'cloudflare:flux-schnell': { nome:'CF Flux Schnell', forte:'velocidade', free:true, browser:false },
    'bfl:flux2-pro':           { nome:'FLUX.2 Pro',  forte:'topo absoluto', free:false, browser:false }
  };

  return { register, generateImage, CATALOG, list:()=>Object.keys(registry) };
})();
