-- ============================================================
-- QUALIDADE V1 — Fase 6: contexto/execução por mensagem
-- Rode no Supabase: SQL Editor > Run
-- ============================================================
create extension if not exists "pgcrypto";

create table if not exists chat_message_context (
  id                uuid primary key default gen_random_uuid(),
  chat_message_id   uuid references chat_messages(id) on delete cascade,
  session_id        uuid references chat_sessions(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete cascade,
  used_history      boolean default false,
  used_memory       boolean default false,
  used_library      boolean default false,
  memory_item_ids   text[] default '{}',
  library_chunk_ids uuid[]  default '{}',
  context_snapshot  text,
  created_at        timestamptz not null default now()
);
create index if not exists ctx_msg_idx     on chat_message_context(chat_message_id);
create index if not exists ctx_session_idx on chat_message_context(session_id);

alter table chat_message_context enable row level security;
create policy "own context" on chat_message_context
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
