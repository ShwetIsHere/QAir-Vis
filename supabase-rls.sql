-- Run once in the Supabase SQL Editor after creating the tables in supabase.sql.
-- These owner-scoped policies are required for the mobile client to read and
-- initialize the signed-in user's inhaler count safely.

alter table public.inhaler_count enable row level security;
alter table public.inhaler_triggers enable row level security;
alter table public.user_settings enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.asthma_action_plan enable row level security;

grant select, insert, update, delete on table
  public.inhaler_count,
  public.inhaler_triggers,
  public.user_settings,
  public.emergency_contacts,
  public.asthma_action_plan
to authenticated;

drop policy if exists "Users manage their inhaler count" on public.inhaler_count;
create policy "Users manage their inhaler count"
on public.inhaler_count
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their inhaler triggers" on public.inhaler_triggers;
create policy "Users manage their inhaler triggers"
on public.inhaler_triggers
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their settings" on public.user_settings;
create policy "Users manage their settings"
on public.user_settings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their emergency contacts" on public.emergency_contacts;
create policy "Users manage their emergency contacts"
on public.emergency_contacts
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their asthma action plan" on public.asthma_action_plan;
create policy "Users manage their asthma action plan"
on public.asthma_action_plan
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
