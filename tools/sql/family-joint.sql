-- InkScan family: joint owners. Applied to the live database on 2026-11-22 (migration family_joint_owner).
-- A family member can be made a joint owner with the family owner: one pile of cards between them.
-- Run after family.sql and the ownership tables and functions (inkscan_holdings, inkscan_credit, inkscan_transfer).

alter table public.household_members add column if not exists joint boolean not null default false;

-- Who a person's cards count as: the family owner for a joint member of the caller's family, themselves otherwise.
create or replace function public.inkscan_counts_as(p uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from household_members m join households h on h.id = m.household_id
    where h.owner_id = public.inkscan_data_owner() and m.user_id = p and m.joint and m.user_id <> h.owner_id)
  then public.inkscan_data_owner() else p end;
$$;

-- Only the family owner turns it on or off. Turning it on puts the member's copies into the shared pile
-- (the owner's is whatever nobody else holds, so their holdings rows are simply removed).
create or replace function public.inkscan_set_joint(member uuid, joint boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
declare hid uuid; r text; o uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select m.household_id, m.role, h.owner_id into hid, r, o from household_members m join households h on h.id = m.household_id where m.user_id = auth.uid();
  if hid is null or r <> 'owner' then raise exception 'Only the family owner can change this'; end if;
  if member = o then raise exception 'That is you'; end if;
  update household_members set joint = coalesce(inkscan_set_joint.joint, false) where household_id = hid and user_id = member;
  if not found then raise exception 'That person is not in your family'; end if;
  if coalesce(inkscan_set_joint.joint, false) then delete from inkscan_holdings where owner_id = o and person_id = member; end if;
end $$;

revoke all on function public.inkscan_set_joint(uuid, boolean) from public, anon;
revoke all on function public.inkscan_counts_as(uuid) from public, anon;
grant execute on function public.inkscan_set_joint(uuid, boolean) to authenticated;
grant execute on function public.inkscan_counts_as(uuid) to authenticated;

-- Three existing functions gain one thing each, by exact replacement in their current text, so nothing else in them changes:
--   inkscan_household: each member also carries 'joint'.
--   inkscan_credit:    copies credited to a joint member count as the family owner's.
--   inkscan_transfer:  moves from or to a joint member are moves from or to the family owner.
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.inkscan_household()'::regprocedure) into d;
  n := replace(d, $q$'role', m.role,$q$, $q$'role', m.role, 'joint', m.joint,$q$);
  if n = d then raise exception 'inkscan_household: text to change not found'; end if;
  execute n;

  select pg_get_functiondef('public.inkscan_credit(uuid,text,jsonb)'::regprocedure) into d;
  n := replace(d, $q$p := (it->>'p')::uuid;$q$, $q$p := public.inkscan_counts_as((it->>'p')::uuid);$q$);
  if n = d then raise exception 'inkscan_credit: text to change not found'; end if;
  execute n;

  select pg_get_functiondef('public.inkscan_transfer(text,jsonb,text,text)'::regprocedure) into d;
  n := replace(d, $q$a := (it->>'from')::uuid; b := (it->>'to')::uuid;$q$, $q$a := public.inkscan_counts_as((it->>'from')::uuid); b := public.inkscan_counts_as((it->>'to')::uuid);$q$);
  if n = d then raise exception 'inkscan_transfer: text to change not found'; end if;
  execute n;
end $$;
