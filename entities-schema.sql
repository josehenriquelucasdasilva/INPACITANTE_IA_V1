-- ============================================================
-- QUALIDADE V1 — Fase 8: Entidades / Conhecimento Estruturado
-- Rode no Supabase: SQL Editor > Run
-- (defensivo: usa IF NOT EXISTS p/ caso já exista de fase anterior)
-- ============================================================
create extension if not exists "pgcrypto";

-- ---------- entidades ----------
create table if not exists knowledge_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  name_norm text,
  type text default 'topic',
  description text,
  summary text,
  aliases text[] default '{}',
  tags text[] default '{}',
  topics text[] default '{}',
  questions text[] default '{}',
  importance_score int default 0,
  auto_created boolean default false,
  use_in_chat boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- colunas (caso a tabela já existisse com formato antigo)
alter table knowledge_entities add column if not exists name_norm text;
alter table knowledge_entities add column if not exists type text default 'topic';
alter table knowledge_entities add column if not exists description text;
alter table knowledge_entities add column if not exists summary text;
alter table knowledge_entities add column if not exists aliases text[] default '{}';
alter table knowledge_entities add column if not exists tags text[] default '{}';
alter table knowledge_entities add column if not exists topics text[] default '{}';
alter table knowledge_entities add column if not exists questions text[] default '{}';
alter table knowledge_entities add column if not exists importance_score int default 0;
alter table knowledge_entities add column if not exists auto_created boolean default false;
alter table knowledge_entities add column if not exists use_in_chat boolean default true;
create unique index if not exists entities_user_name on knowledge_entities(user_id, name_norm);
create index if not exists entities_type_idx on knowledge_entities(type);

-- ---------- links: entidade <-> documento ----------
create table if not exists entity_document_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  entity_id uuid not null references knowledge_entities(id) on delete cascade,
  document_id uuid not null references library_documents(id) on delete cascade,
  relation_type text default 'related',     -- main_subject | mentioned | supporting_source | related
  confidence_score real default 0.5,
  created_at timestamptz not null default now()
);
alter table entity_document_links add column if not exists user_id uuid;
alter table entity_document_links add column if not exists relation_type text default 'related';
alter table entity_document_links add column if not exists confidence_score real default 0.5;
create unique index if not exists edl_unique on entity_document_links(entity_id, document_id);

-- ---------- links: entidade <-> memória ----------
create table if not exists entity_memory_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  entity_id uuid not null references knowledge_entities(id) on delete cascade,
  memory_item_id text,                       -- texto/índice da memória (front-end por enquanto)
  relation_type text default 'related',
  created_at timestamptz not null default now()
);

-- ---------- links: entidade <-> chunk ----------
create table if not exists entity_chunk_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  entity_id uuid not null references knowledge_entities(id) on delete cascade,
  chunk_id uuid references library_document_chunks(id) on delete cascade,
  document_id uuid references library_documents(id) on delete cascade,
  confidence_score real default 0.5,
  created_at timestamptz not null default now()
);
create unique index if not exists ecl_unique on entity_chunk_links(entity_id, chunk_id);

-- ---------- relações entre entidades ----------
create table if not exists entity_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  source_entity_id uuid not null references knowledge_entities(id) on delete cascade,
  target_entity_id uuid not null references knowledge_entities(id) on delete cascade,
  relationship_type text default 'related_to', -- related_to|influenced_by|compared_with|part_of|caused_by|used_in|opposed_to
  description text,
  confidence_score real default 0.5,
  created_at timestamptz not null default now()
);
create unique index if not exists erel_unique on entity_relationships(source_entity_id, target_entity_id, relationship_type);

-- ---------- RLS ----------
alter table knowledge_entities     enable row level security;
alter table entity_document_links  enable row level security;
alter table entity_memory_links    enable row level security;
alter table entity_chunk_links     enable row level security;
alter table entity_relationships   enable row level security;

drop policy if exists "own entities" on knowledge_entities;
drop policy if exists "own edl" on entity_document_links;
drop policy if exists "own eml" on entity_memory_links;
drop policy if exists "own ecl" on entity_chunk_links;
drop policy if exists "own erel" on entity_relationships;

create policy "own entities" on knowledge_entities for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own edl" on entity_document_links for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own eml" on entity_memory_links for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own ecl" on entity_chunk_links for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own erel" on entity_relationships for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
