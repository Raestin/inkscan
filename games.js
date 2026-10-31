/* InkScan game registry. One game is active at a time; switching saves and reloads.
   Lorcana keeps the exact storage key and behaviour it always had. Every other game
   stores its collection under its own key prefix, so games can never mix on a device. */
(function(root){
  'use strict';
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  const GAME_KEY = 'inkscan.game';

  // Wraps a Storage so InkSafety's fixed keys land under a per-game prefix.
  function namespaced(storage, game){
    const prefix = `inkscan.${game}:`;
    return {
      prefix,
      keyOf: k => prefix + k,
      getItem: k => storage.getItem(prefix + k),
      setItem: (k, v) => storage.setItem(prefix + k, v),
      removeItem: k => storage.removeItem(prefix + k)
    };
  }

  const LORCANA = {
    id: 'lorcana', name: 'Lorcana', tcgLine: 'Lorcana TCG', colorWord: 'Ink',
    colors: ['Amber','Amethyst','Emerald','Ruby','Sapphire','Steel'],
    rarities: ['Common','Uncommon','Rare','Super_rare','Legendary','Epic','Enchanted','Iconic','Promo'],
    rarityLabel: r => (r || '').replace('_', ' '),
    special: c => ['Enchanted','Promo','Iconic','Epic'].includes(c.r),
    finishes: {normal: 'Normal', foil: 'Foil', rainbow: 'Rainbow foil'},
    types: ['Character','Action','Song','Item','Location'],
    legality: true, inkable: true, live: false,
    deck: {size: 60, maxCopies: 4, maxColors: 2, handSize: 7},
    searchPlaceholder: 'Search all Lorcana cards',
    scanPlaceholder: 'Card name, P3 43, PD1 11, or P2 24B',
    scanHint: 'Line the card up in the frame. The number line at the bottom left goes in the gold box.',
    guide: 'bottom-left',
    deckFormatNote: 'Decklists use the "4 Name - Version" format that Dreamborn, Inktable and most Lorcana sites import.'
  };

  const ONEPIECE = {
    id: 'onepiece', name: 'One Piece', tcgLine: 'One Piece Card Game', colorWord: 'Color',
    colors: ['Red','Green','Blue','Purple','Black','Yellow'],
    rarities: ['C','UC','R','SR','SEC','L','SP','P','PR','TR'],
    rarityLabel: r => ({C:'Common',UC:'Uncommon',R:'Rare',SR:'Super Rare',SEC:'Secret Rare',L:'Leader',SP:'Special',P:'Promo',PR:'Promo',TR:'Treasure Rare'})[r] || r || '',
    special: c => !!c.pv,
    finishes: {normal: 'Normal', foil: 'Foil'},
    types: ['Leader','Character','Event','Stage'],
    legality: false, inkable: false, live: false,
    catalog: 'onepiece-cards.json', priceSource: 'TCGplayer market via optcgapi.com',
    deck: {size: 50, maxCopies: 4, maxColors: 0, handSize: 5, leaderType: 'Leader'},
    searchPlaceholder: 'Search all One Piece cards',
    scanPlaceholder: 'Card name or code, like OP01-016',
    scanHint: 'Line the card up in the frame. The card code at the bottom right goes in the gold box.',
    guide: 'bottom-right',
    deckFormatNote: 'Decklists use one card per line, like "4xOP01-016" or "4 Nami - OP01-016". The Leader counts separately from the 50.',
    nvKey: c => 'op|' + norm(c.v),
    setLabel: c => c.s,
    imgUrl: c => c.img || '',
    displayVersion: c => [c.v, c.pv].filter(Boolean).join(' · '),
    stats: c => [['Cost', c.co], ['Power', c.st], ['Counter', c.wp], ['Life', c.lo], ['Attribute', c.at || null]],
    rowMeta: c => [c.ty, c.co != null ? `${c.co} cost` : '', c.st != null ? `${c.st} power` : ''].filter(Boolean).join(' · '),
    deckGroups: [['Leader', c => c.ty === 'Leader'], ['Characters', c => c.ty === 'Character'], ['Events', c => c.ty === 'Event'], ['Stages', c => c.ty === 'Stage']],
    // "OP01-016", "ST10-005", "EB01-012", "PRB01-001", "P-001"
    parseCode(text){
      const refs = []; const source = String(text || '').toUpperCase().replace(/[|!]/g, 'I').replace(/[–—]/g, '-');
      for (const m of source.matchAll(/\b(OP|ST|EB|PRB|P)\s?(\d{0,2})\s?-\s?(\d{3})\b/g)){
        const set = m[1] === 'P' && !m[2] ? 'P' : m[1] + m[2].padStart(2, '0');
        refs.push({set, collector: m[3]});
      }
      return refs;
    },
    deckLine(text){
      const m = /^\s*(\d+)\s*x?\s*([A-Z]+\d*-\d{3})\b/i.exec(text) || /^\s*(\d+)\s*x?\s+.*?\b([A-Z]+\d*-\d{3})\s*$/i.exec(text);
      return m ? {qty: +m[1], key: 'op|' + norm(m[2])} : null;
    }
  };

  const MTG_COLORS = {W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green'};
  const MTG = {
    id: 'mtg', name: 'MTG', tcgLine: 'Magic', colorWord: 'Color',
    colors: ['White','Blue','Black','Red','Green','Colorless'],
    rarities: ['common','uncommon','rare','mythic','special','bonus'],
    rarityLabel: r => r ? r[0].toUpperCase() + r.slice(1) : '',
    special: c => !!c.pv,
    finishes: {normal: 'Nonfoil', foil: 'Foil', rainbow: 'Etched'},
    types: ['Creature','Instant','Sorcery','Artifact','Enchantment','Planeswalker','Land','Battle'],
    legality: false, inkable: false, live: true,
    priceSource: 'TCGplayer market via Scryfall',
    deck: {size: 100, maxCopies: 1, maxColors: 0, handSize: 7, singletonExempt: c => /\bBasic\b/.test(c.ty) || /A deck can have any number of cards named/i.test(c.tx || '')},
    searchPlaceholder: 'Search Scryfall (needs signal)',
    scanPlaceholder: 'Card name, or set and number like MH3 123',
    scanHint: 'Line the card up in the frame. The set code and number at the bottom left go in the gold box.',
    guide: 'bottom-left',
    deckFormatNote: 'Decklists use one card per line, like "1 Sol Ring". Set and number in parentheses are ignored when importing.',
    nvKey: c => norm(c.n) + '|',
    setLabel: c => String(c.s || '').toUpperCase(),
    imgUrl: (c, size) => size === 'normal' ? (c.imgN || c.img || '') : (c.img || ''),
    displayVersion: c => c.pv || '',
    stats: c => [['Mana value', c.co], ['Power', c.st], ['Toughness', c.wp], ['Loyalty', c.lo]],
    rowMeta: c => [c.mc || '', c.ty].filter(Boolean).join(' · '),
    deckGroups: [['Creatures', c => /Creature/.test(c.ty)], ['Planeswalkers', c => /Planeswalker/.test(c.ty) && !/Creature/.test(c.ty)],
      ['Instants & sorceries', c => /Instant|Sorcery/.test(c.ty) && !/Creature/.test(c.ty)],
      ['Artifacts & enchantments', c => /Artifact|Enchantment/.test(c.ty) && !/Creature|Land/.test(c.ty)],
      ['Lands', c => /Land/.test(c.ty) && !/Creature/.test(c.ty)], ['Other', () => true]],
    // Bottom-left collector line, e.g. "0123/0280 R" over "MH3 • EN", or "123 R MH3 EN".
    parseCode(text){
      const t = String(text || '').toUpperCase().replace(/[•·]/g, ' ');
      const refs = [];
      const set = /\b([A-Z0-9]{3,5})\s*(?:EN|☆|\*)\b/.exec(t) || /\b(?:EN)\s+([A-Z0-9]{3,5})\b/.exec(t);
      const num = /\b0*(\d{1,4}[A-Z★]?)\s*(?:\/\s*\d{1,4})?\s+[CURMSLTP]\b/.exec(t) || /\b0*(\d{1,4})\s*\/\s*\d{1,4}\b/.exec(t);
      if (set && num && /[A-Z]/.test(set[1])) refs.push({set: set[1], collector: num[1]});
      return refs;
    },
    deckLine(text){
      const m = /^\s*(\d+)\s*x?\s+(.+?)\s*(?:\([A-Za-z0-9]{2,6}\)\s*[\w★-]*)?\s*(?:\*[A-Z]+\*)?\s*$/.exec(text);
      return m ? {qty: +m[1], name: m[2].replace(/\s+\/\/\s+.*$/, '').trim()} : null;
    },
    fromScryfall(card){
      const face = card.card_faces?.[0] || {};
      const img = card.image_uris || face.image_uris || {};
      const pr = card.prices || {}, f = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const colors = (card.color_identity || []).map(k => MTG_COLORS[k]).filter(Boolean);
      const labels = [];
      if ((card.frame_effects || []).includes('showcase')) labels.push('Showcase');
      if ((card.frame_effects || []).includes('extendedart')) labels.push('Extended Art');
      if (card.border_color === 'borderless') labels.push('Borderless');
      if (card.full_art && !/Basic/.test(card.type_line || '')) labels.push('Full Art');
      if (card.promo) labels.push('Promo');
      return {
        id: 'sf_' + card.id, n: card.name, v: '', s: card.set, sn: card.set_name, c: String(card.collector_number),
        r: card.rarity || '', pv: labels.join(', '), i: (colors.length ? colors : ['Colorless']).join('/'),
        co: card.cmc ?? null, ik: 1, ty: card.type_line || face.type_line || '', cl: '',
        st: num(card.power ?? face.power), wp: num(card.toughness ?? face.toughness), lo: num(card.loyalty ?? face.loyalty),
        mc: card.mana_cost ?? face.mana_cost ?? '',
        tx: card.oracle_text ?? (card.card_faces || []).map(x => x.oracle_text || '').join('\n//\n'),
        p: f(pr.usd), pf: f(pr.usd_foil), pe: f(pr.usd_etched), t: card.tcgplayer_id || null,
        img: img.small || '', imgN: img.normal || '', fn: card.finishes || [], rel: card.released_at || '', oid: card.oracle_id || ''
      };
    }
  };
  function num(v){ const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; }

  const GAMES = {lorcana: LORCANA, mtg: MTG, onepiece: ONEPIECE};
  const ORDER = ['lorcana', 'mtg', 'onepiece'];

  function currentId(storage){
    try { const g = JSON.parse(storage.getItem(GAME_KEY)); return GAMES[g] ? g : 'lorcana'; }
    catch(e){ return 'lorcana'; }
  }
  const api = {GAMES, ORDER, GAME_KEY, namespaced, currentId, get: id => GAMES[id] || LORCANA, norm};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InkGames = api;
})(typeof self !== 'undefined' ? self : this);
