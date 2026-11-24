-- PROPOSAL ONLY. Not applied, not a runnable migration; security/transaction RPC review required.
DO $$ BEGIN RAISE EXCEPTION 'STOP: household schema proposal requires reviewed approval and completed RPC/security design'; END $$;

CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.household_members (
  household_id uuid REFERENCES public.households(id),
  user_id uuid REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('owner','member')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (household_id,user_id)
);
CREATE TABLE public.household_inventory (
  household_id uuid REFERENCES public.households(id),
  printing_id text NOT NULL,
  finish text NOT NULL CHECK (finish IN ('normal','foil')),
  quantity bigint NOT NULL CHECK (quantity>=0),
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (household_id,printing_id,finish)
);
CREATE TABLE public.household_operation_receipts (
  household_id uuid REFERENCES public.households(id),
  operation_id uuid NOT NULL,
  device_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  payload_digest text NOT NULL,
  receipt jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id,operation_id)
);
CREATE TABLE public.household_legacy_seed_map (
  legacy_owner uuid NOT NULL,
  legacy_printing text NOT NULL,
  household_id uuid NOT NULL REFERENCES public.households(id),
  normal_quantity bigint NOT NULL,
  foil_quantity bigint NOT NULL,
  source_updated_at timestamptz,
  PRIMARY KEY (legacy_owner,legacy_printing)
);
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_legacy_seed_map ENABLE ROW LEVEL SECURITY;
-- No client grants, membership changes, policies, seed rows or RPCs are authorized here.
-- A complete reviewed migration must explicitly REVOKE inherited default privileges,
-- define audited membership-based access, implement transactional/idempotent RPCs,
-- add deck schema after its visibility decision, and validate the migration checkpoints.
