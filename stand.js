/* Stand mode: the phone sits on a scanning stand, so every card lies in the same place, at the same
   distance, in the same light. These helpers find the card in a camera frame and say where on it the
   number line and the name are. No screen or camera code here; app.js does the drawing and reading. */
(function(root){
  'use strict';
  const CARD = 63 / 88;                       // a trading card's short side over its long side
  /* Where the text sits on an upright card, as fractions of its width and height. The number line stops
     short of the power/toughness box, whose "5/5" would otherwise read as a collector number. The strips are
     kept tight: the pale text box just above the number line upsets the reader's contrast. The card's edges
     are only found to within about one part in a hundred, so a strip that fails is tried again a little
     higher (NUDGE). */
  const REGIONS = {
    left:  {x: 0.02, y: 0.925, w: 0.78, h: 0.06},
    right: {x: 0.20, y: 0.925, w: 0.78, h: 0.06},
    title: {x: 0.05, y: 0.04, w: 0.76, h: 0.075}
  };
  const NUDGE = [0, -0.012, -0.024];
  /* The card in a small greyscale frame (one brightness byte per pixel). A black-bordered card on a pale
     stand is a dark, card-shaped block. A dark table round the stand is not card-shaped, and a shape
     with pale all round it is trusted before one that touches the picture's edge. Returns fractions of the
     frame, or null, when the caller falls back to where the last card was. */
  /* Cards pile up in a stand, each a little off the one below, so slivers of the pile show beside the top
     card and stretch the dark block. A sliver is thin, and dark only here and there along its length; the top
     card's own border is dark from end to end. Rows and columns that are not dark over half the block are
     cut away, twice, which leaves the top card. */
  function trim(luma, w, dark, x0, y0, x1, y1){
    for (let pass = 0; pass < 2; pass++){
      const bw = x1 - x0, bh = y1 - y0, cols = new Uint16Array(bw), rows = new Uint16Array(bh);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (luma[y * w + x] < dark){ cols[x - x0]++; rows[y - y0]++; }
      const span = (counts, need) => { let a = -1, b = -1; for (let i = 0; i < counts.length; i++) if (counts[i] >= need){ if (a < 0) a = i; b = i; } return a < 0 ? null : [a, b + 1]; };
      const cx = span(cols, bh * 0.5), cy = span(rows, bw * 0.5);
      if (!cx || !cy) break;
      [x0, x1, y0, y1] = [x0 + cx[0], x0 + cx[1], y0 + cy[0], y0 + cy[1]];
    }
    const h = luma.length / w;
    return {x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h, sideways: x1 - x0 > y1 - y0};
  }
  function findCard(luma, w, h, dark = 80){
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let best = null, bestArea = 0, spare = null, spareArea = 0;
    for (let start = 0; start < w * h; start++){
      if (seen[start] || luma[start] >= dark) continue;
      let top = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, count = 0, edge = false;
      stack[top++] = start; seen[start] = 1;
      while (top){
        const i = stack[--top], x = i % w, y = (i - x) / w; count++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx; if (!seen[j] && luma[j] < dark){ seen[j] = 1; stack[top++] = j; }
        }
      }
      if (edge && x1 - x0 + 1 > w * 0.97 && y1 - y0 + 1 > h * 0.97) continue;    // the whole picture is not a card
      const rect = trim(luma, w, dark, x0, y0, x1 + 1, y1 + 1), bw = Math.round(rect.w * w), bh = Math.round(rect.h * h), ratio = Math.min(bw, bh) / Math.max(bw, bh);
      if (ratio < CARD * 0.9 || ratio > CARD * 1.1) continue;
      if (Math.max(bw / w, bh / h) < 0.12 || count < bw + bh) continue;      // too small to be a card, or a few stray specks
      // A shape clear of the picture's edges is trusted first. One that touches an edge is used only when there
      // is no other and it fills most of the picture (a card zoomed right in, or cards stacked under it): a
      // corner of dark table can be card-shaped too.
      if (!edge){ if (bw * bh > bestArea){ bestArea = bw * bh; best = rect; } }
      else if (Math.max(bw / w, bh / h) >= 0.6 && bw * bh > spareArea){ spareArea = bw * bh; spare = rect; }
    }
    return best || spare;
  }
  /* How far to zoom so the card fills the picture. The camera zooms about the middle of the picture, so the
     card's farthest edge sets the limit: it ends up 6% in from the picture's edge. Returns the new zoom
     level, or the current one when the change would be too small to matter. */
  function zoomFor(rect, current, min, max){
    const reach = Math.max(Math.abs(rect.x - 0.5), Math.abs(rect.x + rect.w - 0.5), Math.abs(rect.y - 0.5), Math.abs(rect.y + rect.h - 0.5));
    const want = Math.round(Math.min(max, Math.max(min, current * 0.44 / reach)) * 10) / 10;
    return Math.abs(want / current - 1) < 0.12 ? current : want;
  }
  /* The turns worth trying for a card lying this way in the frame, the remembered one first. A turn is how
     far the frame must be rotated clockwise for the card to stand upright. */
  function turns(sideways, last){
    const mine = sideways ? [90, 270] : [0, 180];
    return mine.includes(last) ? [last, mine.find(t => t !== last)] : mine;
  }
  /* A card name out of the text read from the name line: the line with the most letters, without the
     mana cost, frame edges and stray marks around it. Empty when there is too little to go on. */
  function cleanTitle(text){
    const word = /^[A-Za-z][A-Za-z',\-]*$/, small = /^(a|i|of|to|in|on|at|by|an|it|is|we|my|no|go|up|as|or|be|do|so|us|me|he)$/i;
    const letters = s => s.replace(/[^A-Za-z]/g, '').length;
    // Real names are made of real-looking words; stray marks read off the frame come out as one- and two-letter scraps.
    const weight = words => words.reduce((n, x) => n + (letters(x) >= 4 ? letters(x) : 0), 0);
    let best = [], bestWeight = 0;
    for (const line of String(text || '').split('\n')){
      const words = line.replace(/[^A-Za-z0-9',\- ]+/g, ' ').split(/\s+/).filter(Boolean);
      const edge = x => !word.test(x) || (x.length <= 2 && !small.test(x));
      while (words.length && edge(words.at(-1))) words.pop();
      while (words.length && (edge(words[0]) || (words[0].length <= 2 && !/^[A-Z]/.test(words[0])))) words.shift();   // a name starts with a capital
      const kept = words.filter(x => word.test(x));
      if (weight(kept) > bestWeight){ best = kept; bestWeight = weight(kept); }
    }
    const name = best.join(' ').replace(/[,\-']+$/, '');
    return bestWeight >= 4 ? name : '';
  }
  /* How different two small frames are: the average brightness change per pixel, 0 to 255. With a card's
     place given (fractions of the frame), only that part is compared: a card that fills a small part of the
     picture would otherwise barely move the average when it is swapped. */
  function change(a, b, w, rect){
    if (!a.length || a.length !== b.length) return 255;
    if (!rect || !w){ let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length; }
    const h = a.length / w, x0 = Math.max(0, Math.floor(rect.x * w)), x1 = Math.min(w, Math.ceil((rect.x + rect.w) * w)), y0 = Math.max(0, Math.floor(rect.y * h)), y1 = Math.min(h, Math.ceil((rect.y + rect.h) * h));
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) sum += Math.abs(a[y * w + x] - b[y * w + x]);
    return n ? sum / n : 0;
  }
  const api = {CARD, REGIONS, NUDGE, findCard, zoomFor, turns, cleanTitle, change};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InkStand = api;
})(typeof self !== 'undefined' ? self : globalThis);
