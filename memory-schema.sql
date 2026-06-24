-- ============================================================
-- QUALIDADE V1 — Memória (consolidação): memory_items
-- Rode no Supabase: SQL Editor > Run
-- ============================================================
create extension if not exists "pgcrypto";

create table if not exists memory_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  text       text not null,
  kind       text default 'note',     -- note | preference | decision | objective | topic
  created_at timestamptz not null default now()
);
create unique index if not exists mem_user_text on memory_items(user_id, text);
create index if not exists mem_user_idx on memory_items(user_id);

alter table memory_items enable row level security;
drop policy if exists "own memory" on memory_items;
create policy "own memory" on memory_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
