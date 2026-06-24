-- ============================================================
-- QUALIDADE V1 — Biblioteca Inteligente
-- Schema Supabase (Postgres + pgvector)
-- Rode isto no Supabase: Dashboard > SQL Editor > New query > Run
-- ============================================================

-- 1) Extensões
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists vector;       -- pgvector

-- ============================================================
-- 2) DOCUMENTS  (metadados do material)
-- ============================================================
create table if not exists documents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete cascade,
  title             text not null,
  original_filename text,
  source_type       text not null default 'file',  -- file | text | link | image | audio | video | transcript
  file_type         text,                           -- pdf | docx | txt | md | epub | png | mp3 | mp4 ...
  storage_path      text,                           -- caminho no Supabase Storage (ou URL externa do link)
  source_url        text,                           -- para entradas do tipo 'link'
  theme             text,
  language          text,
  summary           text,
  tags              text[] default '{}',
  size_bytes        bigint,
  status            text not null default 'uploaded', -- uploaded | processing | indexed | failed
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists documents_user_idx   on documents(user_id);
create index if not exists documents_status_idx on documents(status);
create index if not exists documents_type_idx   on documents(source_type);

-- ============================================================
-- 3) DOCUMENT_CHUNKS  (trechos + embeddings)
--    dim 512 = openai-3-small / text-embedding-3-small (dimensions:512)
-- ============================================================
create table if not exists document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  chunk_index  int not null,
  content      text not null,
  page         int,
  token_count  int,
  embedding    vector(512),
  created_at   timestamptz not null default now()
);
create index if not exists chunks_doc_idx on document_chunks(document_id);
-- índice vetorial (cosseno). ivfflat exige ANALYZE depois de carregar dados.
create index if not exists chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================
-- 4) KNOWLEDGE_ENTITIES  (Tesla, Newton, Engenharia Mecânica...)
-- ============================================================
create table if not exists knowledge_entities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null,
  type       text default 'conceito',  -- pessoa | conceito | evento | área
  summary    text,
  aliases    text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entities_user_idx on knowledge_entities(user_id);

create table if not exists entity_document_links (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references knowledge_entities(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  unique (entity_id, document_id)
);

-- ============================================================
-- 5) BUSCA VETORIAL  (o navegador não calcula vetor; o Postgres calcula)
--    Chame via supabase.rpc('match_chunks', {...})
-- ============================================================
create or replace function match_chunks(
  query_embedding vector(512),
  match_count int default 6,
  filter_user uuid default null
)
returns table (
  id uuid, document_id uuid, content text, page int,
  similarity float, title text
)
language sql stable as $$
  select c.id, c.document_id, c.content, c.page,
         1 - (c.embedding <=> query_embedding) as similarity,
         d.title
  from document_chunks c
  join documents d on d.id = c.document_id
  where c.embedding is not null
    and (filter_user is null or c.user_id = filter_user)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- 6) ROW LEVEL SECURITY  (cada usuário só vê o que é dele)
-- ============================================================
alter table documents             enable row level security;
alter table document_chunks       enable row level security;
alter table knowledge_entities    enable row level security;
alter table entity_document_links enable row level security;

create policy "own documents" on documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own chunks" on document_chunks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own entities" on knowledge_entities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own links" on entity_document_links
  for all using (
    exists (select 1 from documents d where d.id = document_id and d.user_id = auth.uid())
  );

-- ============================================================
-- 7) STORAGE  (NÃO é SQL — faça no Dashboard)
--    Dashboard > Storage > New bucket:
--      nome: "biblioteca"  | público: NÃO (privado)
--    Depois, em Storage > Policies, permita o dono ler/gravar
--    os próprios arquivos (auth.uid() = owner).
-- ============================================================
