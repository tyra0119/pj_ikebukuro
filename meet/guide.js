// 待ち合わせ案内の計算（経路探索と手順の文）。画面（meet/index.html）と点検（build/meet-check.mjs）の両方から読む。
// 規則は Machiawase と同じ（曲がり角・目印・トイレ・推定区間の断り）。

export const WALK = 0, STAIR = 2, ESC = 4, EV = 5, GATE = 6;
const LEVEL_NAME = { 2: '3階', 1.5: '中2階', 1: '2階', 0.5: '中1階', 0: '地上', '-0.5': '地下中1階', '-1': '地下1階', '-2': '地下2階', '-3': '地下3階', '-4': '地下4階' };
export const lvName = (l) => LEVEL_NAME[l] || (l < 0 ? `地下${-l}階` : `${l + 1}階`);

const DIR8 = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export const compass = (dx, dy) => DIR8[Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) / 45) % 8];

export class Guide {
  constructor(D) {
    this.D = D;
    this.adj = D.nodes.map(() => []);
    D.links.forEach((l, li) => { this.adj[l[0]].push([l[1], li]); this.adj[l[1]].push([l[0], li]); });
  }
  N(i) { return this.D.nodes[i]; }
  // 秒: 歩き 1.25 m/s、階段 0.5 m/s + 3 秒、エスカレーター 0.6 m/s + 5 秒、エレベーター 50 秒、改札 6 秒。
  // 推定の線は 1.5 倍 + 15 秒。段差なしのときの推定の上り下り（出口の階段の位置も、エレベーターの有無もデータに無い）は 3 倍 + 120 秒で通し、手順で断る
  cost(l, pr, fareOK) {
    const [a, b, len, mode, , guess, cross] = l;
    let s;
    if (mode === EV) s = 50; else if (mode === ESC) s = len / 0.6 + 5; else if (mode === STAIR) s = len / 0.5 + 3; else if (mode === GATE) s = 6; else s = len / 1.25;
    if (pr === 'ev' && (mode === STAIR || mode === ESC)) return Infinity;
    if (pr === 'stair' && (mode === ESC || mode === EV)) s *= 3;
    if (pr === 'esc' && (mode === STAIR || mode === EV)) s *= 3;
    if (guess) s = pr === 'ev' && this.N(a)[2] !== this.N(b)[2] ? s * 3 + 120 : s * 1.5 + 15;
    if (cross) s += 10;
    if (mode === GATE && !fareOK) s += 3600; // 改札の中を通り抜ける近道は避ける（運賃がかかる）
    return s;
  }
  dijkstra(src, pr, fareOK = false) {
    const D = this.D, n = D.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), prevL = new Int32Array(n).fill(-1);
    const heap = [[0, src]]; dist[src] = 0;
    const push = (v) => { heap.push(v); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, u] = pop(); if (d > dist[u]) continue;
      for (const [v, li] of this.adj[u]) { const c = this.cost(D.links[li], pr, fareOK); if (c === Infinity) continue; const nd = d + c; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevL[v] = li; push([nd, v]); } }
    }
    return { dist, prev, prevL };
  }
  pathTo(res, t) {
    const edges = []; let v = t;
    while (res.prev[v] >= 0) { const li = res.prevL[v], l = this.D.links[li], u = res.prev[v]; edges.unshift({ a: u, b: v, li, len: l[2], mode: l[3], src: l[4], guess: l[5], cross: l[6], name: l[7] }); v = u; }
    return edges;
  }
  isVert(e) { return this.N(e.a)[2] !== this.N(e.b)[2] || e.mode === EV; } // 同じ階の階段・エスカレーターは歩きの中の段差

  // 区間に分ける: 上り下り / 改札 / 歩き。歩きは曲がり角（手前約 25 m と先約 30 m の向きが 60 度以上・前後 30 m 以上）と折り返し（135 度以上・前後 4 m 以上）で分ける
  segment(E) {
    const N = (i) => this.N(i);
    const segs = []; let i = 0;
    while (i < E.length) {
      if (this.isVert(E[i])) { const m = E[i].mode, v = { kind: 'vert', mode: m, edges: [] }; while (i < E.length && this.isVert(E[i]) && E[i].mode === m) v.edges.push(E[i++]); segs.push(v); }
      else if (E[i].mode === GATE) segs.push({ kind: 'gate', edges: [E[i++]] });
      else { const wk = { kind: 'walk', edges: [] }; while (i < E.length && !this.isVert(E[i]) && E[i].mode !== GATE) wk.edges.push(E[i++]); segs.push(wk); }
    }
    const out = [];
    for (const s of segs) {
      if (s.kind !== 'walk') { out.push(s); continue; }
      let cur = { kind: 'walk', edges: [] }, hist = [], run = 0;
      const recent = (win) => { let sx = 0, sy = 0, acc = 0; for (let k = hist.length - 1; k >= 0 && acc < win; k--) { sx += hist[k][0]; sy += hist[k][1]; acc += hist[k][2]; } const l = Math.hypot(sx, sy); return l > 3 ? [sx / l, sy / l] : null; };
      s.edges.forEach((e, ei) => {
        const A = N(e.a), B = N(e.b), dx = B[0] - A[0], dy = B[1] - A[1], Lg = Math.hypot(dx, dy);
        const prev = recent(12);
        if (Lg > 0.8 && prev) {
          const cos = (dx * prev[0] + dy * prev[1]) / Lg;
          const rest = s.edges.slice(ei).reduce((t, x) => t + x.len, 0);
          let turnAhead = false, p25 = null, ax2 = 0, ay2 = 0, la2 = 0;
          if (run >= 30 && rest >= 30) {
            p25 = recent(25); let acc = 0;
            for (let q = ei; q < s.edges.length && acc < 30; q++) { const qa = N(s.edges[q].a), qb = N(s.edges[q].b); ax2 += qb[0] - qa[0]; ay2 += qb[1] - qa[1]; acc += s.edges[q].len; }
            la2 = Math.hypot(ax2, ay2);
            turnAhead = !!p25 && la2 > 10 && (ax2 * p25[0] + ay2 * p25[1]) / la2 < 0.5;
          }
          const uturn = cos < -0.707 && run >= 4 && rest >= 4;
          if (uturn || turnAhead) {
            out.push(cur);
            let c2 = cos, cross = prev[0] * dy - prev[1] * dx;
            if (turnAhead && !uturn) { c2 = (ax2 * p25[0] + ay2 * p25[1]) / la2; cross = p25[0] * ay2 - p25[1] * ax2; }
            cur = { kind: 'walk', edges: [], turn: c2 < -0.7 ? 'back' : cross > 0 ? 'left' : 'right' };
            run = 0; hist = [];
          }
        }
        if (Lg > 0.3) hist.push([dx, dy, Lg]);
        cur.edges.push(e); run += e.len;
      });
      out.push(cur);
    }
    for (const s of out) { s.from = s.edges[0].a; s.to = s.edges[s.edges.length - 1].b; s.l0 = N(s.from)[2]; s.l1 = N(s.to)[2]; s.len = s.edges.reduce((t, e) => t + e.len, 0); }
    // 数 m の歩きは単独の手順にしない（次の手順に含める）
    const res = [];
    for (let k = 0; k < out.length; k++) {
      const s = out[k];
      if (s.kind === 'walk' && s.len < 10 && out.length > 1) {
        if (k < out.length - 1) { out[k + 1].lead = (s.lead || []).concat(s.edges, out[k + 1].lead || []); if (out[k + 1].turn === 'back') out[k + 1].turn = undefined; continue; }
        const p = res[res.length - 1]; if (p) { p.tail = (p.tail || []).concat(s.edges); continue; }
      }
      res.push(s);
    }
    return res;
  }
  secs(s) { return s.kind === 'walk' ? s.len / 1.25 : s.kind === 'gate' ? 6 : s.mode === EV ? 50 : s.mode === ESC ? s.len / 0.6 + 5 : s.len / 0.5 + 3; }
  bendsIn(s) { // 15 m ごとに区切り、50 度以上向きが変わる所（3 つまで）
    const N = (i) => this.N(i), ch = []; let cx = 0, cy = 0, acc = 0;
    for (const e of s.edges) { const A = N(e.a), B = N(e.b); cx += B[0] - A[0]; cy += B[1] - A[1]; acc += e.len; if (acc >= 15) { ch.push([cx, cy]); cx = cy = acc = 0; } }
    if (acc >= 5) ch.push([cx, cy]);
    const words = [];
    for (let k = 1; k < ch.length && words.length < 3; k++) { const [ax, ay] = ch[k - 1], [bx, by] = ch[k], la = Math.hypot(ax, ay), lb = Math.hypot(bx, by); if (la < 1 || lb < 1) continue; const cos = (ax * bx + ay * by) / (la * lb), cr = ax * by - ay * bx; if (cos < 0.64) words.push(cos < -0.7 ? '折り返すよう' : cr > 0 ? '左' : '右'); }
    return words;
  }
  markNear(i, radius, kinds, used, anyLevel = false) { const n = this.N(i); let best = null, bd = radius; for (const m of this.D.marks) { if (!kinds.includes(m[4]) || used[m[3]] || (m[4] !== 'b' && !anyLevel && m[2] !== n[2])) continue; const d = Math.hypot(m[0] - n[0], m[1] - n[1]); if (d < bd) { bd = d; best = m; } } return best; }
  marksAlong(s, radius, kinds, used) { // 線から radius 以内の目印を、通る順に
    const N = (i) => this.N(i), out = [], seen = new Set();
    for (const e of s.edges) { const A = N(e.a), B = N(e.b), dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy; for (const m of this.D.marks) { if (!kinds.includes(m[4]) || used[m[3]] || seen.has(m[3])) continue; const u = L2 ? Math.max(0, Math.min(1, ((m[0] - A[0]) * dx + (m[1] - A[1]) * dy) / L2)) : 0; if (Math.hypot(A[0] + dx * u - m[0], A[1] + dy * u - m[1]) <= radius) { out.push(m); seen.add(m[3]); } } }
    return out;
  }
  toiletNear(s) { const N = (i) => this.N(i); for (const e of s.edges) { const A = N(e.a), B = N(e.b); for (const t of this.D.toilets) { if (t[2] !== A[2]) continue; const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy, u = L2 ? Math.max(0, Math.min(1, ((t[0] - A[0]) * dx + (t[1] - A[1]) * dy) / L2)) : 0; if (Math.hypot(A[0] + dx * u - t[0], A[1] + dy * u - t[1]) <= 10) return t; } } return null; }
  estPart(s) { let n = 0, len = 0, first = -1, last = -1; s.edges.forEach((e, k) => { if (e.guess) { len += e.len; if (first < 0) first = k; last = k; n++; } }); if (!n) return null; return { len, where: first === 0 ? 0 : last === s.edges.length - 1 ? 2 : 1 }; }
  // 出口の名前: 出入口の点の名前（出口 N）。無ければ、そばの地上の建物・通りの名前で「◯◯のそばの出口」
  exitName(s, used) {
    const N = (i) => this.N(i);
    let exitAt = null, exitNode = -1;
    for (const e of s.edges) for (const ni of [e.a, e.b]) if (exitNode < 0 && N(ni)[4] === 2) { exitAt = N(ni)[5] || ''; exitNode = ni; }
    if (exitNode < 0) return null;
    const bm = this.markNear(exitNode, 90, 'b', used) || this.markNear(exitNode, 40, 'gmrso', used, true);
    let en = exitAt;
    if (!en) en = bm ? `${bm[3]}のそばの出口（番号なし）` : '番号のない出口';
    else if (bm) en = `${bm[3]}のそばの${en}`;
    if (bm) used[bm[3]] = 1;
    return en;
  }

  describe(E, from, to, pr = 'std') {
    const N = (i) => this.N(i), segs = this.segment(E), steps = [];
    let total = 0, inFare = false, underLen = 0; const counts = { 2: 0, 4: 0, 5: 0 }, used = {};
    if (to.name) { used[to.name] = 1; used[to.name.replace(/の?前$/, '')] = 1; used[to.name.replace(/^JR /, '').replace(/の?前$/, '')] = 1; }
    steps.push({ icon: 'start', title: `${from.name}から出発`, detail: from.type === 'place' ? `地上の「${from.name}」が出発地点です。` : from.type === 'exit' ? `地上の「${from.name}」の前が出発地点です。` : from.note || '', seg: null });
    for (const s of segs) {
      total += this.secs(s);
      if (s.kind === 'walk') {
        const m = Math.max(5, Math.round(s.len / 5) * 5), ground = s.l0 === 0 && s.l1 === 0;
        if (!ground) underLen += s.len;
        const jrOnly = s.edges.every((e) => e.src === 1);
        const prevIcon = steps.length ? steps[steps.length - 1].icon : '';
        const same = (s.turn === 'right' && prevIcon === 'turnR') || (s.turn === 'left' && prevIcon === 'turnL');
        let lead = !s.turn ? '' : s.turn === 'right' ? (same ? 'さらに右に曲がって、' : '右に曲がって、') : s.turn === 'left' ? (same ? 'さらに左に曲がって、' : '左に曲がって、') : prevIcon === 'uturn' ? 'さらに折り返して、' : '折り返して、';
        if (s.turn === 'back') {
          // 折り返す地点（この手順の始まりの点）の目印。無ければ、前の手順の終わりの約 15 m の進む方角
          const tm = this.markNear(s.from, 12, 'gmrso', used) || (ground ? this.markNear(s.from, 40, 'b', used) : null);
          const prevStep = steps[steps.length - 1], ps = prevStep && prevStep.seg && prevStep.seg.kind === 'walk' ? prevStep.seg : null;
          let dir = null;
          if (ps) { let dx = 0, dy = 0, acc = 0; for (let k = ps.edges.length - 1; k >= 0 && acc < 15; k--) { const A = N(ps.edges[k].a), B = N(ps.edges[k].b); dx += B[0] - A[0]; dy += B[1] - A[1]; acc += ps.edges[k].len; } if (Math.hypot(dx, dy) > 3) dir = compass(dx, dy); }
          if (tm) { used[tm[3]] = 1; lead = `「${tm[3]}」の所で折り返して、`; }
          else if (dir) lead = `いったん${dir}へ進んだ先で折り返して、`;
          else if (prevStep && prevStep.seg && prevStep.seg.kind === 'vert') lead = `${prevStep.icon === 'ev' ? 'エレベーターを出た' : prevStep.icon === 'esc' ? 'エスカレーターを' + (prevStep.seg.l1 > prevStep.seg.l0 ? '上った' : '下りた') : '階段を' + (prevStep.seg.l1 > prevStep.seg.l0 ? '上った' : '下りた')}所で折り返して、`;
          else if (prevStep && prevStep.seg && prevStep.seg.kind === 'gate') lead = '改札を通った所で折り返して、';
          if (prevStep && ps) prevStep.detail = (prevStep.detail || '') + (tm ? `「${tm[3]}」の所で折り返します。` : 'この先で折り返します。');
        }
        const names = [...new Set(s.edges.map((e) => e.name).filter(Boolean))];
        const where = jrOnly ? '駅の中の通路を' : ground ? '地上の歩道を' : names.length ? `${lvName(s.l0)}の通路（${names[0]}）を` : `${lvName(s.l0)}の通路を`;
        let d = s.edges.some((e) => e.mode === STAIR || e.mode === ESC) ? '途中に数段の段差があります。' : '';
        let nx = 0, was = false; for (const e of s.edges) { if (e.cross && !was) nx++; was = !!e.cross; } if (nx) d += `途中で横断歩道を${nx}回渡ります。`;
        const wc = this.toiletNear(s); if (wc) d += `そばにトイレがあります${wc[3] === '車いす' ? '（車いす対応）' : wc[3] === 'JR' ? '（JR の駅の中）' : ''}。`;
        const bends = this.bendsIn(s); if (bends.length) d += `途中で${bends.join('、')}に曲がります。`;
        const est = this.estPart(s); if (est && est.len >= 8) d += `${est.where === 0 ? 'はじめの' : est.where === 2 ? '終わりの' : '途中の'}約${Math.max(5, Math.round(est.len / 5) * 5)}mは、地図データに通路の線が無いので、近くの通路をまっすぐ結んで案内しています。実際の通り道は少し違うかもしれません。`;
        if (ground && s.len >= 120) { const bs = this.marksAlong(s, 20, 'b', used).slice(0, 2); if (bs.length) { for (const b of bs) used[b[3]] = 1; d += `途中で${bs.map((b) => b[3]).join('・')}のそばを通ります。`; } }
        const mk = !ground && this.markNear(s.to, 15, 'gmrso', used); if (mk) { used[mk[3]] = 1; d += `「${mk[3]}」のそばまで進みます。`; }
        steps.push({ icon: !s.turn ? 'walk' : s.turn === 'right' ? 'turnR' : s.turn === 'left' ? 'turnL' : 'uturn', title: `${lead}${where}約${m}m 進む`, detail: d, seg: s });
      } else if (s.kind === 'gate') {
        const enter = !inFare; inFare = !inFare;
        const g = this.markNear(s.to, 20, 'g', {}) || this.markNear(s.from, 20, 'g', {});
        steps.push({ icon: 'gate', title: enter ? `改札に入る${g ? '（' + g[3] + '）' : ''}` : `改札を出る${g ? '（' + g[3] + '）' : ''}`, detail: enter ? 'ICカードやきっぷを用意して、改札を通ります。' : 'ICカードやきっぷで、改札を通って外に出ます。', seg: s });
      } else {
        counts[s.mode] = (counts[s.mode] || 0) + 1;
        const up = s.l1 > s.l0, word = { 2: '階段', 4: 'エスカレーター', 5: 'エレベーター' }[s.mode] || '階段', guess = s.edges.some((e) => e.guess);
        let title, detail;
        if (s.l0 === s.l1) { title = `${word}を通る（同じ${lvName(s.l0)}の中の段差）`; detail = `${lvName(s.l0)}の中の短い${word}（データ上は同じ階どうし）`; }
        else if (s.mode === EV) { title = `エレベーターで${lvName(s.l1)}へ`; detail = `${lvName(s.l0)} → ${lvName(s.l1)}`; }
        else { title = `${up ? '上り' : '下り'}${word}で${lvName(s.l1)}へ`; detail = `${lvName(s.l0)} → ${lvName(s.l1)}`; }
        const en = Math.min(s.l0, s.l1) < 0 && Math.max(s.l0, s.l1) === 0 ? this.exitName(s, used) : null;
        if (!en && s.l0 !== s.l1 && Math.min(s.l0, s.l1) >= 0) { const g = this.markNear(s.to, 30, 'g', {}); title = `${s.mode === EV ? 'エレベーター' : word}で${lvName(s.l1)}へ${up ? '上る' : '下りる'}${g ? '（' + g[3] + 'へ）' : ''}`; }
        if (en) {
          title = `${en}${up ? 'から地上へ出る' : 'から' + lvName(s.l1) + 'へ下りる'}`;
          detail = s.mode === EV ? '車いすで通れる出口です。' : guess ? '出口の階段の位置はデータに無いので、近くの通路と結んで案内しています。' + (pr === 'ev' ? '段差なしで通れるか（エレベーターがあるか）もデータにありません。' : '') : '出口の階段です。エスカレーター・エレベーターがあるかはデータにありません。';
        } else if (guess) detail += '。地図データに階段の線が無いので、近くの通路と結んで案内しています。実際の上り下りの場所は少し違うかもしれません' + (pr === 'ev' ? '。段差なしで通れるかもデータにありません' : '');
        else if (s.edges.every((e) => e.src === 1)) detail += '（JR東日本の駅構内データ）';
        steps.push({ icon: s.mode === EV ? 'ev' : s.mode === ESC ? 'esc' : 'stair', title, detail, seg: s });
      }
    }
    const tn = N(to.node);
    const near = this.D.marks.filter((m) => m[2] === tn[2] && !used[m[3]] && Math.hypot(m[0] - tn[0], m[1] - tn[1]) <= 25).sort((p, q) => Math.hypot(p[0] - tn[0], p[1] - tn[1]) - Math.hypot(q[0] - tn[0], q[1] - tn[1])).slice(0, 3);
    steps.push({ icon: 'goal', title: `${to.name}に到着`, detail: (to.note || '') + (near.length ? `近くの目印: ${near.map((m) => m[3]).join('・')}` : ''), seg: null });
    return { steps, total, counts, underLen, segs };
  }
  // 出発から待ち合わせ場所へ（JR の改札は何か所もあるのでいちばん近い所へ）
  route(from, to, pr = 'std') {
    const res = this.dijkstra(from.node, pr, false);
    let goal = to.node; if (to.nodes) goal = to.nodes.reduce((b, i) => (res.dist[i] < res.dist[b] ? i : b), to.nodes[0]);
    if (res.dist[goal] === Infinity) return null;
    const E = this.pathTo(res, goal);
    return { from, to, E, goal, res, ...this.describe(E, from, to, pr) };
  }
}
