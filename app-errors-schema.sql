-- ============================================================
-- QUALIDADE V1 — Camada de Erros: app_error_logs
-- Rode no Supabase: SQL Editor > Run
-- ============================================================
create extension if not exists "pgcrypto";

create table if not exists app_error_logs (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references auth.users(id) on delete cascade,
  session_id              uuid,
  module                  text,
  submodule               text,
  error_code              text,
  error_title             text,
  error_message           text,
  technical_details       text,
  stack_trace             text,
  severity                text default 'error',   -- info | warning | error | critical
  related_document_id     uuid,
  related_memory_id       text,
  related_chunk_id        uuid,
  related_chat_message_id uuid,
  context_snapshot        text,
  user_action             text,
  created_at              timestamptz not null default now(),
  resolved_at             timestamptz,
  status                  text default 'open'      -- open | reviewed | resolved | ignored
);
create index if not exists err_user_idx   on app_error_logs(user_id);
create index if not exists err_module_idx on app_error_logs(module);
create index if not exists err_created_idx on app_error_logs(created_at desc);

alter table app_error_logs enable row level security;
drop policy if exists "own errors" on app_error_logs;
create policy "own errors" on app_error_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
