-- ============================================================
-- QUALIDADE V1 — Histórico de chat (Fase 1)
-- Rode no Supabase: SQL Editor > New query > Run
-- (depende de pgcrypto, já criado pelo supabase-schema.sql; incluído aqui por segurança)
-- ============================================================
create extension if not exists "pgcrypto";

-- Conversas
create table if not exists chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  title      text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on chat_sessions(user_id);
create index if not exists sessions_updated_idx on chat_sessions(updated_at desc);

-- Mensagens
create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  role       text not null,              -- 'user' | 'assistant'
  content    text not null,
  ord        int  not null default 0,    -- ordem da mensagem na conversa
  meta       jsonb,                      -- extras (ex.: perguntas de aprofundamento)
  created_at timestamptz not null default now()
);
create index if not exists messages_session_idx on chat_messages(session_id, ord);

-- RLS: cada usuário só enxerga o que é dele
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

create policy "own sessions" on chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own messages" on chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
