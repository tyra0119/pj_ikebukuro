// 道のりの区切り（曲がる・改札を通る・上り下り・着く）と、そばの目印。案内の札・再生の道順の一覧に使う。
// P: [{ x, y, l, mode?, t? }]（道筋の点、または足あとの点。t は足あとの時刻 ms）
// H: { landmarkAt(x, y, l), gateCross(a, b) → { name, dir: 'in' | 'out', u } | null, fareAt(x, y, l), gateNear(x, y, l), modeOf(P, i) → '階段' など, levelName(l) }
// 返り値: { steps: [{ s, x, y, l, t, kind, act, lm, text }], cum: 点ごとの道のりの長さ, total }

// jump: これより離れた次の点はエレベーターなどの飛び（道のりの長さに数えない）。足あと（0.25 秒ごと）は 8 m、道筋は数えない（経路網の点は遠い）
export function routeSteps(P, H, { start = null, dest = null, jump = Infinity } = {}) {
  const cum = [0];
  for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); cum.push(cum[i - 1] + (d > jump ? 0 : d)); }
  const total = cum[cum.length - 1];
  // 道のりの長さ sv の所の点（階が変わる区間・飛びの区間では ok: false）
  const at = (sv) => {
    let lo = 1, hi = P.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < sv) lo = m + 1; else hi = m; }
    const a = P[lo - 1], b = P[lo], L = cum[lo] - cum[lo - 1], u = L > 0 ? Math.max(0, Math.min(1, (sv - cum[lo - 1]) / L)) : 0;
    const ok = a.l === b.l && Math.hypot(b.x - a.x, b.y - a.y) <= jump;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, l: u < 0.5 ? a.l : b.l, t: a.t != null ? a.t + (b.t - a.t) * u : null, ok };
  };
  const ev = [];
  // 階の変わり目（足あとは階段の途中で階が切り替わるので、その手前で上り下りが始まる所を探す）
  for (let i = 1; i < P.length; i++) {
    if (P[i].l === P[i - 1].l) continue;
    let k = i - 1;
    if (P[k].z != null) while (k > 0 && P[k - 1].l === P[i - 1].l && Math.abs(P[k].z - P[k - 1].z) > 0.02 && cum[i - 1] - cum[k - 1] < 25) k--;
    const prev = ev[ev.length - 1];
    if (prev && prev.kind === 'level' && cum[k] - prev.s < 4) { prev.to = P[i].l; continue; } // 階段の途中の行ったり来たり
    ev.push({ kind: 'level', s: cum[k], i: k, from: P[i - 1].l, to: P[i].l, mode: H.modeOf(P, i) });
  }
  for (let j = ev.length - 1; j >= 0; j--) if (ev[j].kind === 'level' && ev[j].from === ev[j].to) ev.splice(j, 1);
  // 改札を通る所（行ったり来たりは 5 m 以内でまとめる）
  for (let i = 1; i < P.length; i++) {
    if (P[i].l !== P[i - 1].l) continue;
    const g = H.gateCross(P[i - 1], P[i]);
    if (!g) continue;
    const s = cum[i - 1] + (cum[i] - cum[i - 1]) * g.u, prev = ev.filter((e) => e.kind === 'gate').pop();
    if (prev && s - prev.s < 5) { if (prev.dir !== g.dir) { ev.splice(ev.indexOf(prev), 1); } continue; }
    ev.push({ kind: 'gate', s, i, name: g.name, dir: g.dir });
  }
  // 改札機の列の端の外を通った足あともあるので、改札の内・外が切り替わる所（1 m ごとに見て、2 m 続いたもの）も改札を通る所に。
  // ただし 20 m 以内に改札があるときだけ（内・外の判定は改札から離れると近くの経路網の点で決めるので、改札の無い所で切り替わることがある）
  if (H.fareAt) {
    let state = null, cand = null;
    for (let sv = 0; sv <= total; sv += 1) {
      const p = at(sv);
      if (!p.ok) continue;
      const f = H.fareAt(p.x, p.y, p.l);
      if (state == null) { state = f; continue; }
      if (f === state) { cand = null; continue; }
      if (!cand) { cand = { sv, p }; continue; }
      if (sv - cand.sv >= 2) {
        state = f;
        const name = H.gateNear(cand.p.x, cand.p.y, cand.p.l);
        if (name && !ev.some((e) => e.kind === 'gate' && Math.abs(e.s - cand.sv) < 8)) ev.push({ kind: 'gate', s: cand.sv, name, dir: f });
        cand = null;
      }
    }
  }
  // 改札を通る所は、3 m 手前と 8 m 先で改札の内・外が本当に変わっているものだけ（列の端をかすめただけのものを除く。東京の丸の内地下中央口改札
  // から 5番線へ、列の外側を 4 m かすめて「改札の外へ」と出た）。向きも 8 m 先で決める
  if (H.fareAt) for (let j = ev.length - 1; j >= 0; j--) {
    const e = ev[j];
    if (e.kind !== 'gate') continue;
    const a = at(Math.max(0, e.s - 3)), b = at(Math.min(total, e.s + 8));
    const fa = H.fareAt(a.x, a.y, a.l), fb = H.fareAt(b.x, b.y, b.l);
    if (fa === fb) ev.splice(j, 1); else e.dir = fb;
  }
  // 同じ改札で入る・出るが 15 m 以内に続くものは、列の端のそばを通っただけとみて両方除く（池袋の中央改札2 の東）
  ev.sort((p, q) => p.s - q.s);
  for (let j = ev.length - 1; j > 0; j--) {
    const a = ev[j - 1], b = ev[j];
    if (a.kind === 'gate' && b.kind === 'gate' && a.name === b.name && a.dir !== b.dir && b.s - a.s < 15) { ev.splice(j - 1, 2); j--; }
  }
  // 中にいるのに「中へ」、外にいるのに「外へ」は数え方の重なりなので除く（新宿の新南改札で「外へ」が 2 回続いた）
  if (H.fareAt) {
    let state = H.fareAt(P[0].x, P[0].y, P[0].l);
    for (let j = 0; j < ev.length; j++) { const e = ev[j]; if (e.kind !== 'gate') continue; if (e.dir === state) { ev.splice(j, 1); j--; } else state = e.dir; }
  }
  // 曲がり角: 0.5 m ごとに、4 m 手前から今と、今から 4 m 先の向きの違い。35 度を超える所のいちばん大きい所
  const turns = [];
  let run = null;
  for (let sv = 3; sv <= total - 3; sv += 0.5) {
    const a = at(sv - 4), b = at(sv), c = at(sv + 4);
    let d = 0;
    if (a.ok && b.ok && c.ok && a.l === b.l && b.l === c.l && Math.hypot(b.x - a.x, b.y - a.y) > 2 && Math.hypot(c.x - b.x, c.y - b.y) > 2) {
      const h1 = Math.atan2(b.x - a.x, b.y - a.y), h2 = Math.atan2(c.x - b.x, c.y - b.y);
      d = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    }
    if (Math.abs(d) > (35 * Math.PI) / 180) { if (!run || sv - run.end > 3) { run = { best: sv, ang: d, end: sv }; turns.push(run); } else { run.end = sv; if (Math.abs(d) > Math.abs(run.ang)) { run.best = sv; run.ang = d; } } }
  }
  for (const r of turns) {
    if (r.best < 4 || r.best > total - 5) continue; // 歩きはじめ・着く手前の向き直し
    if (ev.some((e) => e.kind !== 'turn' && Math.abs(e.s - r.best) < 5)) continue; // 改札・階段のところ（そちらで案内する）
    ev.push({ kind: 'turn', s: r.best, ang: r.ang });
  }
  ev.sort((p, q) => p.s - q.s);
  // 言葉にする
  const steps = [];
  const put = (e, act, lm) => { const p = at(Math.max(0.01, Math.min(total, e.s))); steps.push({ s: e.s, x: p.x, y: p.y, l: e.kind === 'level' ? e.from : p.l, t: e.i != null && P[e.i].t != null ? P[e.i].t : p.t, kind: e.kind, act, lm, text: lm ? `${lm}のところで${act}` : act }); };
  const p0 = P[0];
  const startName = start || H.landmarkAt(p0.x, p0.y, p0.l, 15);
  steps.push({ s: 0, x: p0.x, y: p0.y, l: p0.l, t: p0.t ?? null, kind: 'start', act: '歩きはじめる', lm: null, text: startName ? `${startName}から歩きはじめる` : '歩きはじめる' });
  for (const e of ev) {
    if (e.kind === 'turn') {
      const deg = (Math.abs(e.ang) * 180) / Math.PI, side = e.ang > 0 ? '右' : '左';
      const act = deg > 140 ? '向きを変えて戻る' : deg > 70 ? `${side}へ曲がる` : `斜め${side}へ進む`;
      const p = at(e.s);
      put(e, act, H.landmarkAt(p.x, p.y, p.l));
    } else if (e.kind === 'gate') put(e, e.name ? `${e.name}を通る（改札${e.dir === 'in' ? 'の中' : 'の外'}へ）` : `改札を通る（改札${e.dir === 'in' ? 'の中' : 'の外'}へ）`, null);
    else put(e, `${e.mode}で ${H.levelName(e.to)} へ${e.to > e.from ? '上る' : '下りる'}`, null);
  }
  const pe = P[P.length - 1];
  const endName = dest || H.landmarkAt(pe.x, pe.y, pe.l, 10);
  steps.push({ s: total, x: pe.x, y: pe.y, l: pe.l, t: pe.t ?? null, kind: 'arrive', act: '着く', lm: null, text: endName ? `${endName}に着く` : '着く' });
  return { steps, cum, total, startName, endName };
}

// 案内の札の言葉: d m 先の区切り
export function stepLine(st, d) {
  if (d < 3) return st.kind === 'arrive' ? st.text : `ここで${st.act}${st.lm ? `（${st.lm}）` : ''}`;
  if (d < 8) return `まもなく、${st.text}`;
  return `約${Math.round(d)} m 先、${st.text}`;
}
