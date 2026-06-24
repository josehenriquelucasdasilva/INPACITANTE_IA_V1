-- ============================================================
-- QUALIDADE V1 — Biblioteca (Fase 3): base + upload
-- Rode no Supabase: SQL Editor > New query > Run
-- ============================================================
create extension if not exists "pgcrypto";

create table if not exists library_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  title         text not null,
  document_type text not null check (document_type in
                  ('pdf','docx','text','link','image','audio','video','transcript')),
  storage_path  text,        -- caminho no Supabase Storage (arquivos)
  source_url    text,        -- quando for link
  raw_text      text,        -- quando for texto/transcrição colada
  theme         text,
  tags          text[] default '{}',
  status        text not null default 'saved' check (status in
                  ('uploaded','saved','pending_processing','processed','failed')),
  notes         text,
  file_size     bigint,
  mime_type     text,
  use_in_chat   boolean not null default false,  -- marcar para uso futuro no chat
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists lib_user_idx   on library_documents(user_id);
create index if not exists lib_type_idx   on library_documents(document_type);
create index if not exists lib_status_idx on library_documents(status);
create index if not exists lib_created_idx on library_documents(created_at desc);

-- RLS: cada usuário só vê o que é dele
alter table library_documents enable row level security;
create policy "own library" on library_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- STORAGE (NÃO é SQL — faça no Dashboard, se ainda não fez):
--   Storage > New bucket: nome "biblioteca" | privado
--   (reusa o mesmo bucket das fases anteriores)
--   Em Storage > Policies, permita ao dono ler/gravar os
--   próprios arquivos (auth.uid() = owner).
-- ============================================================
