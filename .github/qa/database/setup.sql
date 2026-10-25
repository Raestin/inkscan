-- Disposable CI database only; no production connection or credentials.
CREATE ROLE qa_authenticator LOGIN PASSWORD 'synthetic-local-only';
CREATE ROLE qa_authenticated NOLOGIN;
CREATE ROLE qa_anon NOLOGIN;
GRANT qa_authenticated, qa_anon TO qa_authenticator;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid
$$;
GRANT USAGE ON SCHEMA public, auth TO qa_authenticated, qa_anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO qa_authenticated, qa_anon;
CREATE TABLE public.collection (
 user_id uuid NOT NULL DEFAULT auth.uid(), card_id text NOT NULL,
 q integer NOT NULL DEFAULT 0 CHECK(q>=0), f integer NOT NULL DEFAULT 0 CHECK(f>=0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,card_id)
);
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
CREATE TRIGGER touch_collection BEFORE INSERT OR UPDATE ON public.collection
 FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE public.collection ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows" ON public.collection FOR ALL TO qa_authenticated
 USING(user_id=(SELECT auth.uid())) WITH CHECK(user_id=(SELECT auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.collection TO qa_authenticated;
-- Known existing baseline, BEFORE the proposed additive column.
INSERT INTO public.collection(user_id,card_id,q,f) VALUES
 ('11111111-1111-4111-8111-111111111111','legacy-printing',2,1),
 ('22222222-2222-4222-8222-222222222222','other-owner-printing',9,2);
CREATE TEMP TABLE qa_before_rainbow AS SELECT user_id,card_id,q,f,updated_at FROM public.collection;
-- Exact candidate bridge, exercised in CI only (production proposal remains guarded).
ALTER TABLE public.collection ADD COLUMN rainbow_foil integer NOT NULL DEFAULT 0
 CONSTRAINT collection_rainbow_foil_nonnegative CHECK(rainbow_foil>=0);
DO $$ BEGIN
 IF EXISTS ((SELECT user_id,card_id,q,f,updated_at FROM public.collection EXCEPT SELECT * FROM qa_before_rainbow) UNION ALL (SELECT * FROM qa_before_rainbow EXCEPT SELECT user_id,card_id,q,f,updated_at FROM public.collection)) THEN RAISE EXCEPTION 'Migration changed original rows or timestamp'; END IF;
 IF (SELECT count(*) FROM public.collection WHERE rainbow_foil=0)<>2 THEN
  RAISE EXCEPTION 'Migration did not default existing rows to zero';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.collection WHERE card_id='legacy-printing' AND q=2 AND f=1) THEN
  RAISE EXCEPTION 'Migration changed q/f';
 END IF;
END $$;
UPDATE public.collection SET rainbow_foil=3 WHERE card_id='legacy-printing';
