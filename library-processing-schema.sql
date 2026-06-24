-- ============================================================
-- QUALIDADE V1 — Biblioteca (Fase 4): processamento
-- Rode no Supabase: SQL Editor > New query > Run
-- ============================================================
create extension if not exists "pgcrypto";

-- Resultado do processamento (1 linha por documento)
create table if not exists library_document_processing (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null unique references library_documents(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete cascade,
  processing_status  text not null default 'pending' check (processing_status in
                       ('pending','processing','processed','partial','failed',
                        'pending_link_processing','pending_ocr','pending_transcription')),
  raw_extracted_text text,
  clean_text         text,
  processing_notes   text,
  chunk_count        int default 0,
  page_count         int,
  language           text,
  error_message      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists proc_doc_idx  on library_document_processing(document_id);
create index if not exists proc_user_idx on library_document_processing(user_id);

-- Chunks (preparados para embeddings na Fase 5)
create table if not exists library_document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references library_documents(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  token_count int,
  char_count  int,
  page_number int,
  created_at  timestamptz not null default now()
);
create index if not exists lchunks_doc_idx on library_document_chunks(document_id, chunk_index);
create index if not exists lchunks_user_idx on library_document_chunks(user_id);

-- RLS
alter table library_document_processing enable row level security;
alter table library_document_chunks     enable row level security;
create policy "own processing" on library_document_processing
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own lchunks" on library_document_chunks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
