-- v49: every change to a collection, wishlist or deck row stamps updated_at with the server time.
-- Before this, updated_at only held the time a row was first created, so "the newer edit wins" compared
-- a device's edit time against a stale cloud time, and the portal's "only overwrite the version I read"
-- check could pass twice for the same version.

create or replace function public.inkscan_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists inkscan_touch on public.collection;
create trigger inkscan_touch before update on public.collection
  for each row execute function public.inkscan_touch_updated_at();

drop trigger if exists inkscan_touch on public.wishlist;
create trigger inkscan_touch before update on public.wishlist
  for each row execute function public.inkscan_touch_updated_at();

drop trigger if exists inkscan_touch on public.decks;
create trigger inkscan_touch before update on public.decks
  for each row execute function public.inkscan_touch_updated_at();
