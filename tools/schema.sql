-- Shared plan storage for the Voorhees Mall planner.
-- Paste this into the Supabase SQL editor and run it once.

create table if not exists plans (
  id          text primary key,
  doc         jsonb       not null default '{"items":[],"deleted":{}}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists plan_versions (
  id        bigserial primary key,
  plan_id   text        not null references plans(id) on delete cascade,
  doc       jsonb       not null,
  label     text,
  saved_by  text,
  saved_at  timestamptz not null default now()
);

create index if not exists plan_versions_plan_idx
  on plan_versions (plan_id, saved_at desc);

-- The anon key is public, so these policies are the only thing standing
-- between the plan and the internet. They allow reading and editing the plan
-- and adding versions -- but never deleting a version, so anything anyone
-- does here can be rolled back from the history.
alter table plans         enable row level security;
alter table plan_versions enable row level security;

drop policy if exists plans_read   on plans;
drop policy if exists plans_write  on plans;
drop policy if exists plans_create on plans;
create policy plans_read   on plans for select using (true);
create policy plans_write  on plans for update using (true) with check (true);
create policy plans_create on plans for insert with check (true);

drop policy if exists versions_read   on plan_versions;
drop policy if exists versions_create on plan_versions;
create policy versions_read   on plan_versions for select using (true);
create policy versions_create on plan_versions for insert with check (true);

insert into plans (id) values ('voorhees') on conflict (id) do nothing;
