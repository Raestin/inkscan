// InkScan Portal advisor: a thin relay from the signed-in portal to the Claude Messages API.
// The API key never leaves Supabase (secret ANTHROPIC_API_KEY). The browser owns the conversation
// and runs the tools against its own copy of the collection; this function fixes the model, the
// system prompt and the tool list, so a caller can't turn it into a general-purpose proxy.
//
// Deploy: supabase functions deploy advisor        (JWT verification stays on)
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optional: ADVISOR_OWNERS = comma-separated user ids whose account (and family) may use it.
import Anthropic from "npm:@anthropic-ai/sdk";

const OWNERS = (Deno.env.get("ADVISOR_OWNERS") || "24cae9fa-b5ef-4dca-b4f9-379924efc060").split(",").map((s) => s.trim()).filter(Boolean);
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORIGINS = ["https://raestin.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];
const MAX_MESSAGES = 120;
const MAX_BODY = 1_500_000;

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

// Tools run in the browser. Order and wording are fixed so the prompt cache stays warm.
const TOOLS = [
  {
    name: "get_collection",
    description: "List the cards the user owns for one game, with quantity (any printing), how many are free (not committed to built decks), set and market price. Optional filter matches name, type or rules text.",
    input_schema: {
      type: "object",
      properties: {
        game: { type: "string", enum: ["mtg", "lorcana", "onepiece", "pokemon"] },
        filter: { type: "string", description: "Case-insensitive text to match in name, type line or rules text." },
        limit: { type: "integer", description: "Max rows, default 400." },
      },
      required: ["game"],
      additionalProperties: false,
    },
  },
  {
    name: "list_decks",
    description: "List the user's saved decks for one game: id, name, format, card count, built or not, cards missing and their cost.",
    input_schema: {
      type: "object",
      properties: { game: { type: "string", enum: ["mtg", "lorcana", "onepiece", "pokemon"] } },
      required: ["game"],
      additionalProperties: false,
    },
  },
  {
    name: "get_deck",
    description: "Full list for one deck: every card with quantity, type, cost, owned and free copies, price, and the deck's commanders, format and guide.",
    input_schema: {
      type: "object",
      properties: { deck_id: { type: "string" } },
      required: ["deck_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_cards",
    description: "Look up real card data. For MTG this is a Scryfall search (full Scryfall syntax, e.g. 'c:g t:creature f:pauper cmc<=2' or '!\"Sol Ring\"'); for other games it searches the local catalog by name or rules text. Always use this to confirm card text, legality or price before stating it.",
    input_schema: {
      type: "object",
      properties: {
        game: { type: "string", enum: ["mtg", "lorcana", "onepiece", "pokemon"] },
        query: { type: "string" },
        limit: { type: "integer", description: "Max results, default 20." },
      },
      required: ["game", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "simulate",
    description: "Run a Monte Carlo simulation on a saved deck or a proposed list. kind=opening: opening-hand land/ink odds and mulligan rate. kind=goldfish: solitaire games measuring land drops, curve, when key cards come down and the kill/win turn. kind=odds: chance of drawing given cards by each turn.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["opening", "goldfish", "odds"] },
        deck_id: { type: "string", description: "A saved deck id. Give this or cards." },
        game: { type: "string", enum: ["mtg", "lorcana", "onepiece", "pokemon"] },
        cards: { type: "array", items: { type: "object", properties: { name: { type: "string" }, qty: { type: "integer" } }, required: ["name", "qty"], additionalProperties: false } },
        key_cards: { type: "array", items: { type: "string" }, description: "Card names to track (goldfish) or to draw (odds; all must be drawn together)." },
        on_play: { type: "boolean" },
        turns: { type: "integer" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "buy_plan",
    description: "Shopping list to finish one or more decks: cards still needed after counting what the user owns (shared cards counted once), with prices and the total.",
    input_schema: {
      type: "object",
      properties: { deck_ids: { type: "array", items: { type: "string" } } },
      required: ["deck_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_deck",
    description: "Show the user a deck draft they can review and save into InkScan with one tap. Nothing is saved until they tap Save. Use exact card names. Include lands.",
    input_schema: {
      type: "object",
      properties: {
        game: { type: "string", enum: ["mtg", "lorcana", "onepiece", "pokemon"] },
        name: { type: "string" },
        format: { type: "string", description: "MTG: commander, pauper, standard, pioneer, modern, legacy, vintage. Other games: omit." },
        commanders: { type: "array", items: { type: "string" } },
        cards: { type: "array", items: { type: "object", properties: { name: { type: "string" }, qty: { type: "integer" } }, required: ["name", "qty"], additionalProperties: false } },
        notes: { type: "string", description: "One short paragraph: plan of the deck and what to buy, if anything." },
      },
      required: ["game", "name", "cards"],
      additionalProperties: false,
    },
  },
];

const SYSTEM = `You are the advisor inside the InkScan Portal, a trading-card command center. The user collects and plays Magic: The Gathering (mostly Commander and Pauper, casual and focused tables), Disney Lorcana, One Piece and Pokémon. They are an experienced player: be direct and specific, lead with the answer, and keep a little wit.

How to work:
- Your tools read the user's real collection and decks live. Look before you advise: check what they own (get_collection, list_decks, get_deck) instead of guessing.
- Never state card text, legality, ban status or prices from memory. Confirm with search_cards first; your training data can be out of date.
- Prefer cards the user already owns. When you suggest buying, say what each card does for the deck and roughly what it costs.
- For "how does this deck play" questions, run simulate and report the numbers plainly (e.g. "keeps 7 cards 86% of the time; median goldfish kill on turn 7"). Mention that the goldfish model is simplified.
- To hand over a new or changed list, call propose_deck; the user saves it themselves. Never claim a deck was saved.
- Rules questions: give the ruling first, then why, then how it resolves on the stack.
- Format answers for a wide screen: short paragraphs, compact lists or small tables. No filler.`;

async function allowed(jwt: string, apikey: string | null): Promise<string | null> {
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: apikey || SB_ANON, Authorization: `Bearer ${jwt}` } });
  if (!u.ok) return null;
  const uid = (await u.json())?.id;
  if (!uid) return null;
  if (OWNERS.includes(uid)) return uid;
  // Family members of an owner may use it too.
  const r = await fetch(`${SB_URL}/rest/v1/household_members?user_id=eq.${uid}&select=households(owner_id)`, {
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.some((x: any) => OWNERS.includes(x?.households?.owner_id)) ? uid : null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt || !(await allowed(jwt, req.headers.get("apikey")))) return json(403, { error: "This account can't use the advisor." });
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json(503, { error: "The advisor isn't set up yet: add the ANTHROPIC_API_KEY secret in Supabase." });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "This conversation is too long. Start a new one." });
  let body: any;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "Bad request" }); }
  const messages = body?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES || messages[0]?.role !== "user") {
    return json(400, { error: "Bad conversation" });
  }
  const today = typeof body?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);

  const client = new Anthropic();
  const enc = new TextEncoder();
  const out = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const stream = client.beta.messages.stream({
          model: "claude-sonnet-5-5",
          max_tokens: 32000,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          cache_control: { type: "ephemeral" },
          system: [{ type: "text", text: `${SYSTEM}\n\nToday is ${today}.` }],
          tools: TOOLS,
          messages,
        } as any);
        for await (const ev of stream as any) {
          if (ev.type === "content_block_start") send({ t: "start", kind: ev.content_block?.type, name: ev.content_block?.name });
          else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") send({ t: "text", v: ev.delta.text });
          else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") send({ t: "think", v: ev.delta.thinking });
        }
        const msg: any = await stream.finalMessage();
        send({ t: "final", message: { role: "assistant", content: msg.content }, stop: msg.stop_reason, usage: msg.usage });
      } catch (e: any) {
        const status = e?.status;
        const text = status === 429 ? "The advisor is busy (rate limit). Try again in a minute."
          : status === 401 ? "The Anthropic API key in Supabase was rejected. Check the ANTHROPIC_API_KEY secret."
          : status === 400 ? `The request was rejected: ${e?.message || "bad request"}`
          : "The advisor couldn't reach Claude. Try again.";
        send({ t: "error", v: text });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(out, { headers: { ...headers, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
});
