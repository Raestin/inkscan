/* Small SVG charts for the portal: vertical bars (one or two series), horizontal ranking bars and lines.
   Marks follow the dataviz rules: thin marks, 4px rounded data ends on the baseline, a 2px gap between bars,
   recessive grid, a legend when there are two series, a hover/focus tooltip on every mark, and labels set
   with textContent (card and deck names are user data). Colors come from tokens: --chart-1, --chart-2,
   or a data color passed per bar (MTG colors, Lorcana inks). */
(function(root){
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let tip = null;
  function showTip(evt, rows){
    if (!tip){ tip = h('div', 'chart-tip'); tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.replaceChildren(...rows.map(([value, label, color]) => {
      const r = h('div', 'tip-row');
      if (color){ const k = h('span', 'tip-key'); k.style.background = color; r.appendChild(k); }
      r.appendChild(h('strong', null, value)); if (label) r.appendChild(h('span', 'tip-label', label)); return r;
    }));
    tip.hidden = false;
    const b = evt.target.getBoundingClientRect?.() || {left: 0, top: 0, width: 0};
    const x = evt.clientX ?? (b.left + b.width / 2), y = evt.clientY ?? b.top;
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - hh - 12) + 'px';
  }
  const hideTip = () => { if (tip) tip.hidden = true; };
  function hover(node, rows){
    node.setAttribute('tabindex', '0');
    node.addEventListener('pointermove', e => showTip(e, rows()));
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', e => showTip(e, rows()));
    node.addEventListener('blur', hideTip);
  }
  const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
  // Rounded top corners only: the data end is rounded, the baseline end is square.
  const barPath = (x, y, w, hgt, r) => { r = Math.min(r, w / 2, hgt); return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`; };

  /* bars(container, {categories:[label], series:[{name, color, values:[n], colors?:[per-bar color]}], format, height, yLabel}) */
  function bars(host, o){
    host.replaceChildren();
    const W = Math.max(280, host.clientWidth || 480), H = o.height || 200, padL = 40, padB = 28, padT = 12, padR = 8;
    const cats = o.categories, S = o.series, fmt = o.format || (v => String(Math.round(v * 100) / 100));
    const max = niceMax(Math.max(0, ...S.flatMap(s => s.values)));
    const svg = el('svg', {viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': o.label || ''}, host);
    const plotH = H - padB - padT, plotW = W - padL - padR, band = plotW / cats.length;
    for (let i = 0; i <= 4; i++){
      const v = max * i / 4, y = padT + plotH - plotH * i / 4;
      el('line', {x1: padL, x2: W - padR, y1: y, y2: y, class: i ? 'grid' : 'axis'}, svg);
      const t = el('text', {x: padL - 6, y: y + 4, class: 'tick', 'text-anchor': 'end'}, svg); t.textContent = fmt(v);
    }
    const gap = 2, groupW = Math.min(band - 8, S.length * 28), bw = (groupW - gap * (S.length - 1)) / S.length;
    cats.forEach((c, i) => {
      const x0 = padL + band * i + (band - groupW) / 2;
      S.forEach((s, j) => {
        const v = s.values[i] || 0, hgt = plotH * v / max, x = x0 + j * (bw + gap), y = padT + plotH - hgt;
        const color = s.colors?.[i] || s.color;
        const hit = el('rect', {x: padL + band * i, y: padT, width: band, height: plotH, class: 'hit'}, svg);
        if (hgt > 0) el('path', {d: barPath(x, y, bw, hgt, 4), fill: color, class: 'mark'}, svg);
        if (S.length === 1) hover(hit, () => [[fmt(v), c]]);
        else if (j === 0) hover(hit, () => S.map(ss => [fmt(ss.values[i] || 0), `${ss.name} · ${c}`, ss.color]));
      });
      const t = el('text', {x: padL + band * i + band / 2, y: H - 8, class: 'tick', 'text-anchor': 'middle'}, svg); t.textContent = c;
    });
    if (S.length > 1) host.appendChild(legend(S));
    return svg;
  }

  /* hbars(container, {rows:[{label, value, sub?, color?}], format}) : a ranking, longest first, labels on the left */
  function hbars(host, o){
    host.replaceChildren();
    const max = Math.max(1e-9, ...o.rows.map(r => r.value)), fmt = o.format || (v => String(v));
    const list = h('div', 'hbars');
    for (const r of o.rows){
      const row = h('div', 'hbar');
      const lab = h('div', 'hbar-l', r.label); if (r.sub) lab.appendChild(h('span', 'hbar-sub', r.sub));
      const track = h('div', 'hbar-t'), fill = h('i'); fill.style.width = (100 * r.value / max).toFixed(2) + '%'; if (r.color) fill.style.background = r.color;
      track.appendChild(fill);
      row.append(lab, track, h('div', 'hbar-v', fmt(r.value)));
      hover(row, () => [[fmt(r.value), r.label + (r.sub ? ` · ${r.sub}` : '')]]);
      list.appendChild(row);
    }
    host.appendChild(list);
  }

  /* line(container, {x:[labels], series:[{name, color, values:[0..1 or n]}], format, height, max}) with a crosshair tooltip */
  function line(host, o){
    host.replaceChildren();
    const W = Math.max(280, host.clientWidth || 480), H = o.height || 220, padL = 44, padB = 28, padT = 12, padR = 28;
    const fmt = o.format || (v => String(v)), max = o.max ?? niceMax(Math.max(0, ...o.series.flatMap(s => s.values)));
    const svg = el('svg', {viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': o.label || ''}, host);
    const plotH = H - padB - padT, plotW = W - padL - padR, n = o.x.length, X = i => padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1)), Y = v => padT + plotH - plotH * Math.min(v, max) / max;
    for (let i = 0; i <= 4; i++){
      const v = max * i / 4, y = Y(v);
      el('line', {x1: padL, x2: W - padR, y1: y, y2: y, class: i ? 'grid' : 'axis'}, svg);
      const t = el('text', {x: padL - 6, y: y + 4, class: 'tick', 'text-anchor': 'end'}, svg); t.textContent = fmt(v);
    }
    o.x.forEach((lab, i) => { if (n > 14 && i % 2) return; const t = el('text', {x: X(i), y: H - 8, class: 'tick', 'text-anchor': 'middle'}, svg); t.textContent = lab; });
    for (const s of o.series){
      el('path', {d: s.values.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join(''), class: 'line', stroke: s.color}, svg);
      s.values.forEach((v, i) => el('circle', {cx: X(i), cy: Y(v), r: 4, fill: s.color, class: 'dot'}, svg));
    }
    const cross = el('line', {y1: padT, y2: padT + plotH, class: 'cross', visibility: 'hidden'}, svg);
    const hit = el('rect', {x: padL, y: padT, width: plotW, height: plotH, class: 'hit'}, svg);
    const at = e => { const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width; return Math.max(0, Math.min(n - 1, Math.round((px - padL) / (n === 1 ? 1 : plotW / (n - 1))))); };
    const rows = i => [[o.x[i], o.xName || ''], ...o.series.map(s => [fmt(s.values[i]), s.name, s.color])];
    hit.addEventListener('pointermove', e => { const i = at(e); cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible'); showTip(e, rows(i)); });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    if (o.series.length > 1) host.appendChild(legend(o.series, true));
    return svg;
  }

  function legend(series, asLine){
    const lg = h('div', 'legend');
    for (const s of series){ const it = h('span', 'legend-i'); const k = h('span', asLine ? 'legend-line' : 'legend-box'); k.style.background = s.color; it.append(k, document.createTextNode(s.name)); lg.appendChild(it); }
    return lg;
  }

  // Read a token so charts follow light and dark mode.
  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  root.PortalCharts = {bars, hbars, line, token, hideTip};
})(self);
