-- InkScan family sharing. One family = one owner's rows, shared with members.
-- Collection, deck and wishlist rows keep user_id = the family owner's id; members read and
-- write those rows through row-level security. Membership changes only through the
-- security-definer functions below; the three family tables have RLS on and no policies.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Family',
  created_at timestamptz not null default now()
);
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade, -- one family per person
  role text not null check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create table if not exists public.household_invites (
  code text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

-- Whose rows this person works on: their family owner's, or their own.
create or replace function public.inkscan_data_owner() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select h.owner_id from household_members m join households h on h.id = m.household_id where m.user_id = auth.uid()), auth.uid());
$$;
create or replace function public.inkscan_can_access(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid() or owner = (select h.owner_id from household_members m join households h on h.id = m.household_id where m.user_id = auth.uid());
$$;

-- Added alongside the existing "own rows" policies; permissive policies combine with OR, so nothing is dropped.
create policy "family rows" on public.collection for all using (public.inkscan_can_access(user_id)) with check (public.inkscan_can_access(user_id));
create policy "family rows" on public.decks for all using (public.inkscan_can_access(user_id)) with check (public.inkscan_can_access(user_id));
create policy "family rows" on public.wishlist for all using (public.inkscan_can_access(user_id)) with check (public.inkscan_can_access(user_id));

-- The caller's family: owner, their role, and members with emails (members see each other).
create or replace function public.inkscan_household() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hid uuid; o uuid; r text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select m.household_id, h.owner_id, m.role into hid, o, r from household_members m join households h on h.id = m.household_id where m.user_id = auth.uid();
  if hid is null then return jsonb_build_object('owner', auth.uid(), 'role', null, 'members', '[]'::jsonb); end if;
  return jsonb_build_object('owner', o, 'role', r, 'members', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.user_id, 'email', u.email, 'role', m.role) order by m.role desc, m.joined_at)
    from household_members m join auth.users u on u.id = m.user_id where m.household_id = hid), '[]'::jsonb));
end $$;

-- Owner (or someone not yet in a family, who becomes its owner) creates a one-time code, valid 7 days.
create or replace function public.inkscan_create_invite() returns text
language plpgsql volatile security definer set search_path = public as $$
declare hid uuid; r text; c text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select household_id, role into hid, r from household_members where user_id = auth.uid();
  if hid is null then
    insert into households (owner_id) values (auth.uid()) returning id into hid;
    insert into household_members (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  elsif r <> 'owner' then raise exception 'Only the family owner can invite people';
  end if;
  -- 8 characters, no 0/O/1/I/L, so a code read aloud is typed right.
  loop
    c := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8));
    exit when not exists (select 1 from household_invites where code = c);
  end loop;
  insert into household_invites (code, household_id, created_by, expires_at) values (c, hid, auth.uid(), now() + interval '7 days');
  return c;
end $$;

-- Join with a code. Someone who owns a family of one gives it up; anyone else must leave first.
create or replace function public.inkscan_join(invite text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare inv household_invites; cur uuid; cur_role text; o uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into inv from household_invites where code = upper(trim(invite)) for update;
  if inv.code is null or inv.used_at is not null or inv.expires_at < now() then raise exception 'That invite code is not valid. Ask for a new one.'; end if;
  select household_id, role into cur, cur_role from household_members where user_id = auth.uid();
  if cur = inv.household_id then raise exception 'You are already in this family'; end if;
  if cur is not null then
    if cur_role = 'owner' and not exists (select 1 from household_members where household_id = cur and user_id <> auth.uid()) then
      delete from households where id = cur;
    else raise exception 'Leave your current family first'; end if;
  end if;
  insert into household_members (household_id, user_id, role) values (inv.household_id, auth.uid(), 'member');
  update household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  select owner_id into o from households where id = inv.household_id;
  return o;
end $$;

-- A member leaves; an owner can only close a family with no other members.
create or replace function public.inkscan_leave() returns void
language plpgsql volatile security definer set search_path = public as $$
declare hid uuid; r text;
begin
  select household_id, role into hid, r from household_members where user_id = auth.uid();
  if hid is null then return; end if;
  if r = 'owner' then
    if exists (select 1 from household_members where household_id = hid and user_id <> auth.uid()) then raise exception 'Remove the other members first'; end if;
    delete from households where id = hid;
  else delete from household_members where user_id = auth.uid(); end if;
end $$;

create or replace function public.inkscan_remove_member(member uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare hid uuid;
begin
  select household_id into hid from household_members where user_id = auth.uid() and role = 'owner';
  if hid is null then raise exception 'Only the family owner can remove people'; end if;
  if member = auth.uid() then raise exception 'The owner cannot remove themselves'; end if;
  delete from household_members where household_id = hid and user_id = member;
end $$;

revoke all on function public.inkscan_data_owner(), public.inkscan_can_access(uuid), public.inkscan_household(), public.inkscan_create_invite(), public.inkscan_join(text), public.inkscan_leave(), public.inkscan_remove_member(uuid) from public, anon;
grant execute on function public.inkscan_data_owner(), public.inkscan_can_access(uuid), public.inkscan_household(), public.inkscan_create_invite(), public.inkscan_join(text), public.inkscan_leave(), public.inkscan_remove_member(uuid) to authenticated;
