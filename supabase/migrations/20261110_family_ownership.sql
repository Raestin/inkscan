-- v47: who owns and who added each card inside a family collection.
-- The collection table keeps the family total per card. inkscan_holdings records the copies that belong to
-- a member other than the family owner; whatever is not recorded there belongs to the family owner.
-- All access goes through the functions below (row-level security is on, with no direct policies).

alter table public.household_members add column if not exists display_name text;

create table if not exists public.inkscan_holdings (
  owner_id uuid not null,
  game text not null,
  card_id text not null,
  person_id uuid not null,
  q integer not null default 0 check (q >= 0),
  f integer not null default 0 check (f >= 0),
  rainbow_foil integer not null default 0 check (rainbow_foil >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, card_id, person_id)
);
create index if not exists inkscan_holdings_person on public.inkscan_holdings (person_id);

create table if not exists public.inkscan_scans (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
  game text not null,
  card_id text not null,
  scanned_by uuid not null,
  for_person uuid not null,
  qty integer not null,
  at timestamptz not null default now()
);
create index if not exists inkscan_scans_owner on public.inkscan_scans (owner_id, game, card_id);

create table if not exists public.inkscan_moves (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
  game text not null,
  card_id text not null,
  from_person uuid not null,
  to_person uuid not null,
  q integer not null default 0,
  f integer not null default 0,
  rainbow_foil integer not null default 0,
  by_user uuid not null,
  deck_id text,
  deck_name text,
  at timestamptz not null default now()
);
create index if not exists inkscan_moves_owner on public.inkscan_moves (owner_id, game, at desc);

create table if not exists public.inkscan_ops (
  op uuid primary key,
  owner_id uuid not null,
  at timestamptz not null default now()
);

alter table public.inkscan_holdings enable row level security;
alter table public.inkscan_scans enable row level security;
alter table public.inkscan_moves enable row level security;
alter table public.inkscan_ops enable row level security;

-- Is this person part of the caller's family (the owner counts)?
create or replace function public.inkscan_is_family(person uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select person = public.inkscan_data_owner() or exists (
    select 1 from household_members m join households h on h.id = m.household_id
    where h.owner_id = public.inkscan_data_owner() and m.user_id = person);
$$;

-- The family list now carries each person's display name.
create or replace function public.inkscan_household() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare hid uuid; o uuid; r text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select m.household_id, h.owner_id, m.role into hid, o, r from household_members m join households h on h.id = m.household_id where m.user_id = auth.uid();
  if hid is null then return jsonb_build_object('owner', auth.uid(), 'role', null, 'members', '[]'::jsonb); end if;
  return jsonb_build_object('owner', o, 'role', r, 'members', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.user_id, 'email', u.email, 'role', m.role,
      'name', coalesce(nullif(trim(m.display_name), ''), initcap(split_part(u.email, '@', 1)))) order by m.role desc, m.joined_at)
    from household_members m join auth.users u on u.id = m.user_id where m.household_id = hid), '[]'::jsonb));
end $function$;

create or replace function public.inkscan_set_name(member uuid, name text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare hid uuid; r text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select household_id, role into hid, r from household_members where user_id = auth.uid();
  if hid is null then raise exception 'You are not in a family yet'; end if;
  if member <> auth.uid() and r <> 'owner' then raise exception 'Only the family owner can rename other people'; end if;
  if length(trim(coalesce(name, ''))) = 0 or length(trim(name)) > 30 then raise exception 'Names are 1 to 30 characters'; end if;
  update household_members set display_name = trim(name) where household_id = hid and user_id = member;
  if not found then raise exception 'That person is not in your family'; end if;
end $$;

-- Everything a client needs to show ownership for one game.
create or replace function public.inkscan_ownership(game text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'holdings', coalesce((select jsonb_agg(jsonb_build_object('c', h.card_id, 'p', h.person_id, 'q', h.q, 'f', h.f, 'r', h.rainbow_foil))
      from inkscan_holdings h where h.owner_id = public.inkscan_data_owner() and h.game = $1
        and h.q + h.f + h.rainbow_foil > 0 and public.inkscan_is_family(h.person_id)), '[]'::jsonb),
    'scans', coalesce((select jsonb_agg(jsonb_build_object('c', s.card_id, 'p', s.scanned_by, 'n', s.n))
      from (select card_id, scanned_by, sum(qty)::int n from inkscan_scans
            where owner_id = public.inkscan_data_owner() and inkscan_scans.game = $1 group by card_id, scanned_by having sum(qty) > 0) s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('c', m.card_id, 'from', m.from_person, 'to', m.to_person, 'q', m.q, 'f', m.f, 'r', m.rainbow_foil,
        'by', m.by_user, 'deck', m.deck_name, 'at', m.at) order by m.id desc)
      from (select * from inkscan_moves where owner_id = public.inkscan_data_owner() and inkscan_moves.game = $1 order by id desc limit 300) m), '[]'::jsonb));
$$;

-- Credit added (or removed) copies to a person, and record who added them. One call per batch; a repeated op is ignored.
create or replace function public.inkscan_credit(op uuid, game text, items jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare o uuid := public.inkscan_data_owner(); it jsonb; c text; p uuid; dq int; df int; dr int; s int;
  tq int; tf int; tr int; oq int; ofo int; orr int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 5000 then raise exception 'Invalid items'; end if;
  begin insert into inkscan_ops (op, owner_id) values (inkscan_credit.op, o);
  exception when unique_violation then return public.inkscan_ownership(inkscan_credit.game); end;
  for it in select * from jsonb_array_elements(items) loop
    c := it->>'c'; p := (it->>'p')::uuid;
    dq := coalesce((it->>'q')::int, 0); df := coalesce((it->>'f')::int, 0); dr := coalesce((it->>'r')::int, 0); s := coalesce((it->>'s')::int, 0);
    if c is null or p is null or not public.inkscan_is_family(p) then continue; end if;
    if s <> 0 then insert into inkscan_scans (owner_id, game, card_id, scanned_by, for_person, qty) values (o, inkscan_credit.game, c, auth.uid(), p, s); end if;
    if p = o or (dq = 0 and df = 0 and dr = 0) then continue; end if;
    select coalesce(k.q, 0), coalesce(k.f, 0), coalesce(k.rainbow_foil, 0) into tq, tf, tr from collection k where k.user_id = o and k.card_id = c;
    if not found then tq := 0; tf := 0; tr := 0; end if;
    select coalesce(sum(h.q), 0), coalesce(sum(h.f), 0), coalesce(sum(h.rainbow_foil), 0) into oq, ofo, orr
      from inkscan_holdings h where h.owner_id = o and h.card_id = c and h.person_id <> p;
    insert into inkscan_holdings as h (owner_id, game, card_id, person_id, q, f, rainbow_foil)
      values (o, inkscan_credit.game, c, p, greatest(0, least(dq, tq - oq)), greatest(0, least(df, tf - ofo)), greatest(0, least(dr, tr - orr)))
    on conflict (owner_id, card_id, person_id) do update set
      q = greatest(0, least(h.q + dq, tq - oq)), f = greatest(0, least(h.f + df, tf - ofo)),
      rainbow_foil = greatest(0, least(h.rainbow_foil + dr, tr - orr)), updated_at = now();
  end loop;
  return public.inkscan_ownership(inkscan_credit.game);
end $$;

-- Move copies from one person to another. Family members trust each other: anyone in the family may move any card.
-- Each item moves at most what the giver actually has, so a whole-deck move never fails halfway.
create or replace function public.inkscan_transfer(game text, items jsonb, deck_id text default null, deck_name text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare o uuid := public.inkscan_data_owner(); it jsonb; c text; a uuid; b uuid; wq int; wf int; wr int;
  tq int; tf int; tr int; sq int; sf int; sr int; aq int; af int; ar int; moved int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 5000 then raise exception 'Invalid items'; end if;
  for it in select * from jsonb_array_elements(items) loop
    c := it->>'c'; a := (it->>'from')::uuid; b := (it->>'to')::uuid;
    wq := greatest(0, coalesce((it->>'q')::int, 0)); wf := greatest(0, coalesce((it->>'f')::int, 0)); wr := greatest(0, coalesce((it->>'r')::int, 0));
    if c is null or a is null or b is null or a = b then continue; end if;
    if not public.inkscan_is_family(a) or not public.inkscan_is_family(b) then raise exception 'Both people must be in your family'; end if;
    perform 1 from collection k where k.user_id = o and k.card_id = c for update;
    if a = o then
      select coalesce(k.q, 0), coalesce(k.f, 0), coalesce(k.rainbow_foil, 0) into tq, tf, tr from collection k where k.user_id = o and k.card_id = c;
      if not found then continue; end if;
      select coalesce(sum(h.q), 0), coalesce(sum(h.f), 0), coalesce(sum(h.rainbow_foil), 0) into sq, sf, sr from inkscan_holdings h where h.owner_id = o and h.card_id = c;
      aq := tq - sq; af := tf - sf; ar := tr - sr;
    else
      select h.q, h.f, h.rainbow_foil into aq, af, ar from inkscan_holdings h where h.owner_id = o and h.card_id = c and h.person_id = a;
      if not found then continue; end if;
    end if;
    wq := greatest(0, least(wq, aq)); wf := greatest(0, least(wf, af)); wr := greatest(0, least(wr, ar));
    if wq + wf + wr = 0 then continue; end if;
    if a <> o then
      update inkscan_holdings h set q = h.q - wq, f = h.f - wf, rainbow_foil = h.rainbow_foil - wr, updated_at = now()
        where h.owner_id = o and h.card_id = c and h.person_id = a;
    end if;
    if b <> o then
      insert into inkscan_holdings as h (owner_id, game, card_id, person_id, q, f, rainbow_foil) values (o, inkscan_transfer.game, c, b, wq, wf, wr)
      on conflict (owner_id, card_id, person_id) do update set q = h.q + wq, f = h.f + wf, rainbow_foil = h.rainbow_foil + wr, updated_at = now();
    end if;
    insert into inkscan_moves (owner_id, game, card_id, from_person, to_person, q, f, rainbow_foil, by_user, deck_id, deck_name)
      values (o, inkscan_transfer.game, c, a, b, wq, wf, wr, auth.uid(), inkscan_transfer.deck_id, inkscan_transfer.deck_name);
    moved := moved + wq + wf + wr;
  end loop;
  return public.inkscan_ownership(inkscan_transfer.game) || jsonb_build_object('moved', moved);
end $$;

-- When the family total for a card drops, nobody may be left holding more copies than exist.
-- Never blocks a collection write: any problem here is swallowed.
create or replace function public.inkscan_trim_holdings() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare h record; xq int; xf int; xr int; tq int := 0; tf int := 0; tr int := 0; n int;
begin
  begin
    if tg_op = 'UPDATE' then tq := coalesce(new.q, 0); tf := coalesce(new.f, 0); tr := coalesce(new.rainbow_foil, 0); end if;
    select coalesce(sum(q), 0) - tq, coalesce(sum(f), 0) - tf, coalesce(sum(rainbow_foil), 0) - tr into xq, xf, xr
      from inkscan_holdings where owner_id = old.user_id and card_id = old.card_id;
    if xq > 0 or xf > 0 or xr > 0 then
      for h in select * from inkscan_holdings where owner_id = old.user_id and card_id = old.card_id order by updated_at desc, person_id loop
        if xq > 0 and h.q > 0 then n := least(xq, h.q); update inkscan_holdings set q = q - n where owner_id = h.owner_id and card_id = h.card_id and person_id = h.person_id; xq := xq - n; end if;
        if xf > 0 and h.f > 0 then n := least(xf, h.f); update inkscan_holdings set f = f - n where owner_id = h.owner_id and card_id = h.card_id and person_id = h.person_id; xf := xf - n; end if;
        if xr > 0 and h.rainbow_foil > 0 then n := least(xr, h.rainbow_foil); update inkscan_holdings set rainbow_foil = rainbow_foil - n where owner_id = h.owner_id and card_id = h.card_id and person_id = h.person_id; xr := xr - n; end if;
      end loop;
    end if;
  exception when others then null;
  end;
  return null;
end $$;

drop trigger if exists inkscan_trim_holdings_upd on public.collection;
create trigger inkscan_trim_holdings_upd after update of q, f, rainbow_foil on public.collection
  for each row when (coalesce(new.q, 0) < coalesce(old.q, 0) or coalesce(new.f, 0) < coalesce(old.f, 0) or coalesce(new.rainbow_foil, 0) < coalesce(old.rainbow_foil, 0))
  execute function public.inkscan_trim_holdings();
drop trigger if exists inkscan_trim_holdings_del on public.collection;
create trigger inkscan_trim_holdings_del after delete on public.collection
  for each row execute function public.inkscan_trim_holdings();

-- Someone who leaves the family no longer holds cards in it: their copies go back to the family owner.
create or replace function public.inkscan_member_gone() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  begin delete from inkscan_holdings where person_id = old.user_id; exception when others then null; end;
  return null;
end $$;
drop trigger if exists inkscan_member_gone on public.household_members;
create trigger inkscan_member_gone after delete on public.household_members
  for each row execute function public.inkscan_member_gone();

revoke all on function public.inkscan_is_family(uuid), public.inkscan_set_name(uuid, text), public.inkscan_ownership(text),
  public.inkscan_credit(uuid, text, jsonb), public.inkscan_transfer(text, jsonb, text, text),
  public.inkscan_trim_holdings(), public.inkscan_member_gone() from public, anon;
grant execute on function public.inkscan_is_family(uuid), public.inkscan_set_name(uuid, text), public.inkscan_ownership(text),
  public.inkscan_credit(uuid, text, jsonb), public.inkscan_transfer(text, jsonb, text, text) to authenticated;
