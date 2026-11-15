/* InkScan themes, the real thing (v50): each game's own logo and symbols, at Brian's request (2026-11-15).
   Nothing is stored in this repository: every image is fetched when the page opens, from the addresses below,
   the same way card pictures are. Each image is tried first; one that fails to load is simply left out, and
   the app's own drawings (themes/*.svg) stay in its place.
     Magic      mana and cost symbols from Scryfall; logo from Wikimedia Commons
     Lorcana    ink symbols and logo from disneylorcana.com
     Pokémon    logo from Wikimedia Commons (no site that allows embedding offers the energy symbols, so the
                app's own icons stay)
     One Piece  logo from Wikipedia (the game has no colour symbols) */
(function(root){
  'use strict';
  const SF = 'https://svgs.scryfall.io/card-symbols/';
  const LOR = 'https://i0.wp.com/disneylorcana.com/wp-content/uploads/2026/';
  const WM = 'https://upload.wikimedia.org/wikipedia/';
  const ink = n => `${LOR}08/dlc_ink_${n}.png?fit=330%2C380&ssl=1`;
  const ART = {
    mtg: {
      logo: WM + 'commons/3/3f/Magicthegathering-logo.svg',
      syms: {White: SF + 'W.svg', Blue: SF + 'U.svg', Black: SF + 'B.svg', Red: SF + 'R.svg', Green: SF + 'G.svg', Colorless: SF + 'C.svg'},
      stat: ['White', 'Blue', 'Red', 'Green'],
      // cost symbols: {W}, {2}, {W/U}, {2/W}, {W/P}, {X}, {T} and so on; Scryfall names each file after the symbol
      pips: ['W', 'U', 'B', 'R', 'G', 'C', 'X', 'Y', 'Z', 'S', 'T', 'Q', 'E', 'P', ...Array.from({length: 21}, (_, i) => String(i)),
        'WU', 'WB', 'UB', 'UR', 'BR', 'BG', 'RG', 'RW', 'GW', 'GU', '2W', '2U', '2B', '2R', '2G', 'WP', 'UP', 'BP', 'RP', 'GP']
    },
    lorcana: {
      logo: LOR + '09/logo-br-2x.webp?fit=568%2C208&ssl=1',
      syms: {Amber: ink('amber'), Amethyst: ink('amethyst'), Emerald: ink('emerald'), Ruby: ink('ruby'), Sapphire: ink('sapphire'), Steel: ink('steel')},
      stat: ['Amber', 'Amethyst', 'Emerald', 'Ruby']
    },
    pokemon: {
      logo: WM + 'commons/1/1a/Pok%C3%A9mon_Trading_Card_Game_logo.svg',
      syms: {}, stat: []
    },
    onepiece: {logo: WM + 'en/c/c2/One_Piece_Card_Game_logo.webp', plate: true, syms: {}, stat: []}
  };
  const doc = root.document, html = doc.documentElement;
  let sheet = null, run = 0;
  const probe = (url, ok) => { const im = new Image(); im.onload = () => { if (im.naturalWidth) ok(); }; im.src = url; };
  function apply(game){
    const mine = ++run, a = ART[game];
    if (sheet) sheet.remove();
    sheet = doc.createElement('style'); sheet.dataset.themes = game || ''; doc.head.append(sheet);
    html.removeAttribute('data-real'); html.style.removeProperty('--logo');
    if (!a) return;
    const live = () => mine === run, add = css => { if (live()) sheet.append(css + '\n'); }, R = `html[data-real="${game}"]`;
    const on = () => { if (live()) html.dataset.real = game; };
    probe(a.logo, () => {
      if (!live()) return; on(); html.style.setProperty('--logo', `url("${a.logo}")`);
      add(`${R} .hero{--hero-art:var(--logo);--hero-art-size:min(44%,220px) auto;--hero-art-pos:right 16px ${a.plate ? 'bottom 20px;--hero-art-size:min(38%,220px) auto;--hero-plate:linear-gradient(#FFF6E6,#FFF6E6) right 8px bottom 12px/calc(min(38%,220px) + 16px) 52px no-repeat' : 'center'}}`);
      add(`@media (min-width:1100px){${R} .shell .hero{--hero-art-pos:right 388px center${a.plate ? ';--hero-art-size:220px auto;--hero-plate:linear-gradient(#FFF6E6,#FFF6E6) right 380px center/236px 72px no-repeat' : ''}}}`);
      add(`${R} .game-logo{display:block${a.plate ? ';background-color:#FFF6E6' : ''}}`);
    });
    for (const [name, url] of Object.entries(a.syms)) probe(url, () => {
      on();
      add(`${R} .ink.${name},${R} .dot[title="${name}"],${R} .cdot[data-col="${name}"] i{background:url("${url}") center/contain no-repeat !important;border-radius:0 !important;box-shadow:none !important;width:16px;height:16px}`);
      const i = a.stat.indexOf(name);
      if (i >= 0) add(`${R} :is(.tiles>.tile,.statcard):nth-child(4n+${i + 1})::after{background:url("${url}") center/contain no-repeat;-webkit-mask:none;mask:none}`);
    });
    if (a.pips) probe(SF + 'W.svg', () => {
      on();
      add(a.pips.map(p => `${R} .pip-${p.toLowerCase()}`).join(',') + '{min-width:16px;width:16px;height:16px;padding:0;border-radius:0;background:none center/contain no-repeat;color:transparent;overflow:hidden;vertical-align:-3px}');
      add(a.pips.map(p => `${R} .pip-${p.toLowerCase()}{background-image:url("${SF}${p}.svg")}`).join('\n'));
    });
  }
  root.InkThemes = {apply, ART};
  apply(html.dataset.game);
})(self);
