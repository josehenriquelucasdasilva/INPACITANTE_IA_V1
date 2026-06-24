// ============================================================
// QUALIDADE V1 — Edge Function: process-document
// Backend de processamento (Deno, roda no Supabase).
// Deploy: supabase functions deploy process-document
// Chamada (do front): supabase.functions.invoke('process-document',{ body:{ document_id }})
//
// Fluxo: lê library_documents -> extrai por tipo -> limpa -> chunka ->
//        grava library_document_chunks + library_document_processing ->
//        atualiza status em library_documents.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDocumentProxy, extractText } from "https://esm.sh/unpdf@0.12.1";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";

const BUCKET = "biblioteca";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- utilidades ----------
function cleanText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")           // espaços/tab/nbsp -> 1 espaço
    .replace(/ *\n */g, "\n")                 // tira espaços nas bordas das linhas
    .replace(/\n{3,}/g, "\n\n")               // no máx. 1 linha em branco
    .replace(/[^\S\n]+$/gm, "")               // trailing spaces
    .trim();
}

// chunking por caracteres com sobreposição, quebrando perto de fim de frase
function chunkText(text: string, size = 900, overlap = 150): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const chunks: string[] = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + size, t.length);
    if (end < t.length) {
      const slice = t.slice(i, end);
      const m = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
      if (m > size * 0.5) end = i + m + 1;     // corta numa fronteira boa
    }
    chunks.push(t.slice(i, end).trim());
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks.filter(Boolean);
}

function guessLang(t: string): string | null {
  if (!t) return null;
  const s = " " + t.toLowerCase().slice(0, 4000) + " ";
  const pt = (s.match(/ (de|que|não|uma|para|com|por|você|está|também|são|isso) /g) || []).length;
  const en = (s.match(/ (the|and|that|with|for|you|this|are|was|from|have) /g) || []).length;
  if (pt === 0 && en === 0) return null;
  return pt >= en ? "pt" : "en";
}

const approxTokens = (s: string) => Math.ceil((s || "").length / 4);

// embeddings (OpenAI text-embedding-3-small, 1536d) — Fase 5
async function embedAll(texts: string[]): Promise<(number[] | null)[]> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return texts.map(() => null);
  const out: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    try {
      const r = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: "text-embedding-3-small", input: batch }),
      });
      if (!r.ok) { for (const _ of batch) out.push(null); continue; }
      const j = await r.json();
      for (const d of j.data) out.push(d.embedding);
    } catch (_e) { for (const _ of batch) out.push(null); }
  }
  return out;
}

// ---------- extração por tipo ----------
async function extractPdf(buf: Uint8Array) {
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { raw: Array.isArray(text) ? text.join("\n\n") : text, pages: totalPages };
}

function extractDocx(buf: Uint8Array) {
  const files = unzipSync(buf);
  const docXml = files["word/document.xml"];
  if (!docXml) return "";
  let xml = strFromU8(docXml);
  xml = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  return xml;
}

async function extractLink(url: string): Promise<{ raw: string; note: string } | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 QualidadeV1Bot" } });
    clearTimeout(to);
    if (!r.ok) return null;
    let html = await r.text();
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    return { raw: html, note: "Texto extraído do HTML da página (sem JS)." };
  } catch (_e) {
    return null;
  }
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization") || "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } } // age como o usuário (RLS)
    );
    const { data: ures } = await supa.auth.getUser();
    const user = ures?.user;
    if (!user) return json({ error: "Não autenticado." }, 401);

    const { document_id } = await req.json();
    if (!document_id) return json({ error: "document_id obrigatório." }, 400);

    const { data: doc, error: derr } = await supa.from("library_documents").select("*").eq("id", document_id).single();
    if (derr || !doc) return json({ error: "Documento não encontrado." }, 404);

    // marca processing
    await supa.from("library_document_processing").upsert(
      { document_id, user_id: user.id, processing_status: "processing", error_message: null, updated_at: new Date().toISOString() },
      { onConflict: "document_id" }
    );
    await supa.from("library_documents").update({ status: "pending_processing", updated_at: new Date().toISOString() }).eq("id", document_id);

    let raw = "";
    let pages: number | null = null;
    let status = "processed";
    let note = "";

    const type = doc.document_type;

    if (type === "text" || type === "transcript") {
      raw = doc.raw_text || "";
      note = "Texto direto do banco.";
    } else if (type === "pdf" || type === "docx" || type === "image" || type === "audio" || type === "video") {
      if (!doc.storage_path) {
        status = "failed"; note = "Sem arquivo no Storage.";
      } else if (type === "image") {
        status = "pending_ocr"; note = "Imagem registrada. OCR virá em fase futura.";
      } else if (type === "audio" || type === "video") {
        status = "pending_transcription"; note = "Mídia registrada. Transcrição virá em fase futura.";
      } else {
        const { data: blob, error: serr } = await supa.storage.from(BUCKET).download(doc.storage_path);
        if (serr || !blob) {
          status = "failed"; note = "Falha ao baixar do Storage: " + (serr?.message || "?");
        } else {
          const buf = new Uint8Array(await blob.arrayBuffer());
          try {
            if (type === "pdf") { const r = await extractPdf(buf); raw = r.raw || ""; pages = r.pages ?? null; }
            else { raw = extractDocx(buf); }
            if (!raw.trim()) { status = "partial"; note = "Arquivo lido, mas sem texto extraível (possível scan/imagem)."; }
          } catch (e) {
            status = "failed"; note = "Erro na extração: " + (e?.message || e);
          }
        }
      }
    } else if (type === "link") {
      const res = doc.source_url ? await extractLink(doc.source_url) : null;
      if (res && res.raw.trim()) { raw = res.raw; note = res.note; status = "processed"; }
      else { status = "pending_link_processing"; note = "Link salvo; não foi possível capturar agora."; }
    } else {
      status = "failed"; note = "Tipo desconhecido.";
    }

    const clean = cleanText(raw);
    const chunks = (status === "processed" || status === "partial") ? chunkText(clean) : [];

    // regrava chunks (idempotente p/ reprocessar)
    await supa.from("library_document_chunks").delete().eq("document_id", document_id);
    if (chunks.length) {
      let embeds: (number[] | null)[] = chunks.map(() => null);
      try { embeds = await embedAll(chunks); } catch (_e) { note += " (falha nos embeddings)"; }
      const rows = chunks.map((content, idx) => ({
        document_id, user_id: user.id, chunk_index: idx, content,
        token_count: approxTokens(content), char_count: content.length, page_number: null,
        embedding: embeds[idx] || null,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error: cerr } = await supa.from("library_document_chunks").insert(rows.slice(i, i + 100));
        if (cerr) { status = "partial"; note += " (aviso ao salvar chunks: " + cerr.message + ")"; break; }
      }
      if (embeds.some((e) => !e)) note += " (alguns chunks sem embedding)";
    }

    await supa.from("library_document_processing").upsert({
      document_id, user_id: user.id, processing_status: status,
      raw_extracted_text: raw ? raw.slice(0, 200000) : null,
      clean_text: clean ? clean.slice(0, 200000) : null,
      processing_notes: note, chunk_count: chunks.length, page_count: pages,
      language: guessLang(clean), error_message: status === "failed" ? note : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "document_id" });

    const docStatus = status === "failed" ? "failed" : (status === "processed" || status === "partial") ? "processed" : "pending_processing";
    await supa.from("library_documents").update({ status: docStatus, updated_at: new Date().toISOString() }).eq("id", document_id);

    return json({ ok: true, processing_status: status, chunk_count: chunks.length, page_count: pages, note });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
