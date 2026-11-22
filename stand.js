/* Stand mode: the phone sits on a scanning stand, so every card lies in the same place, at the same
   distance, in the same light. These helpers find the card in a camera frame and say where on it the
   number line and the name are. No screen or camera code here; app.js does the drawing and reading. */
(function(root){
  'use strict';
  const CARD = 63 / 88;                       // a trading card's short side over its long side
  /* Where the text sits on an upright card, as fractions of its width and height. The number line stops
     short of the power/toughness box, whose "5/5" would otherwise read as a collector number. */
  const REGIONS = {
    left:  {x: 0.02, y: 0.925, w: 0.78, h: 0.06},
    right: {x: 0.20, y: 0.925, w: 0.78, h: 0.06},
    title: {x: 0.05, y: 0.04, w: 0.76, h: 0.075}
  };
  /* The card in a small greyscale frame (one brightness byte per pixel). A black-bordered card on a pale
     stand is the block of dark rows and columns; anything that isn't card-shaped is turned down, and the
     caller falls back to where the last card was. Returns fractions of the frame, or null. */
  function findCard(luma, w, h, dark = 75){
    const cols = new Uint16Array(w), rows = new Uint16Array(h);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) if (luma[i] < dark){ cols[x]++; rows[y]++; }
    const span = (counts, need) => { let a = -1, b = -1; for (let i = 0; i < counts.length; i++) if (counts[i] >= need){ if (a < 0) a = i; b = i; } return a < 0 ? null : [a, b + 1]; };
    // First pass: rows and columns that are dark over a good part of the frame. Second pass: measured against the box found.
    let cx = span(cols, h * 0.25), cy = span(rows, w * 0.25);
    if (!cx || !cy) return null;
    for (let pass = 0; pass < 2; pass++){
      const bw = cx[1] - cx[0], bh = cy[1] - cy[0];
      const colIn = new Uint16Array(w), rowIn = new Uint16Array(h);
      for (let y = cy[0]; y < cy[1]; y++) for (let x = cx[0]; x < cx[1]; x++) if (luma[y * w + x] < dark){ colIn[x]++; rowIn[y]++; }
      const nx = span(colIn, bh * 0.5), ny = span(rowIn, bw * 0.5);
      if (!nx || !ny) return null;
      cx = nx; cy = ny;
    }
    const bw = cx[1] - cx[0], bh = cy[1] - cy[0], ratio = Math.min(bw, bh) / Math.max(bw, bh);
    if (ratio < CARD * 0.9 || ratio > CARD * 1.1) return null;
    if (Math.max(bw / w, bh / h) < 0.35) return null;
    return {x: cx[0] / w, y: cy[0] / h, w: bw / w, h: bh / h, sideways: bw > bh};
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
  // How different two small frames are: the average brightness change per pixel, 0 to 255.
  function change(a, b){
    let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return a.length ? sum / a.length : 0;
  }
  const api = {CARD, REGIONS, findCard, turns, cleanTitle, change};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InkStand = api;
})(typeof self !== 'undefined' ? self : globalThis);
