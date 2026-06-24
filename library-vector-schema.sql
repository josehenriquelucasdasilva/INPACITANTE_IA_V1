-- ============================================================
-- QUALIDADE V1 — Fase 5 (cola p/ Fase 6): vetores na Biblioteca
-- Rode no Supabase: SQL Editor > Run
-- Dim 1536 = OpenAI text-embedding-3-small (padrão)
-- ============================================================
create extension if not exists vector;

alter table library_document_chunks add column if not exists embedding vector(1536);

create index if not exists lchunks_embedding_idx
  on library_document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Busca vetorial (roda no servidor). Chamada via supabase.rpc('match_library_chunks', {...})
create or replace function match_library_chunks(
  query_embedding vector(1536),
  match_count int default 6,
  filter_user uuid default null,
  only_chat boolean default false
)
returns table (
  id uuid, document_id uuid, content text, chunk_index int,
  similarity float, title text, document_type text
)
language sql stable as $$
  select c.id, c.document_id, c.content, c.chunk_index,
         1 - (c.embedding <=> query_embedding) as similarity,
         d.title, d.document_type
  from library_document_chunks c
  join library_documents d on d.id = c.document_id
  where c.embedding is not null
    and (filter_user is null or c.user_id = filter_user)
    and (not only_chat or d.use_in_chat = true)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
