-- ============================================================
-- QUALIDADE V1 — Fase 7: fontes / rastreabilidade
-- Consolidamos na tabela da Fase 6 (chat_message_context),
-- em vez de criar chat_response_sources duplicada.
-- Rode no Supabase: SQL Editor > Run
-- ============================================================
alter table chat_message_context add column if not exists library_document_ids uuid[] default '{}';
alter table chat_message_context add column if not exists sources jsonb;

-- A coluna chat_message_id já aponta para a resposta do assistente.
-- "sources" guarda o detalhe agrupado p/ a UI:
--   { history:bool, memory:[{id,text}],
--     library:[{document_id,title,document_type,theme,created_at,
--               chunks:[{chunk_id,chunk_index,similarity}] }] }
