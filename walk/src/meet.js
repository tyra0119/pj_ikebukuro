// 待ち合わせ案内を歩く画面に組み込む。経路は統合データ（data/meet.json）と guide.js で 1 回だけ作り、
// 同じ経路を「図と手順」（この画面のパネル）と「立体」（床の矢印・案内カード）の両方で見せる。手順を押すとその場所へ立体で飛ぶ。
// 地上の歩道にも床があるので、出発から立体で歩ける。立体に床の無い点（地下 2 階・データの範囲外）の区間だけ図と手順で案内する。

import { Guide, lvName } from './guide.js?v=mvvpq6mg';
import { startRoom, roomId } from './room.js?v=mvvpq6mg';

export async function initMeet(A) {
  const { $, VER, data, LV, me, nav, phys, toast, jumpTo, landingAt, levelOf, scene, THREE, V3, floorNear, shared, setMeetRoute, clearRoute, view } = A; // view: 地図で見ているか・切り替え・地図をある所へ（app.js）
  let D;
  try { D = await fetch(`data/${data.key === 'ikebukuro' ? 'meet' : `meet-${data.key}`}.json${VER}`).then((r) => r.json()); } catch { return; } // 池袋は meet.json、ほかの駅は meet-<駅>.json
  const G = new Guide(D);
  let detour = null, comp = null; // exitDetour・groundTree が一度だけ作るもの（run が読み込みの途中で呼ぶので、先に置く）
  const N = (i) => D.nodes[i];
  // 統合データの階 → この画面の階（JR の数え方: 1F が 1）。地下 2 階以下は床が無い
  const WL = (lv) => (lv === 0 ? 1 : lv === 1 ? 2 : lv === -1 ? -1 : null);
  const fromList = [...D.places.map((p) => ({ ...p, type: 'place', id: 'place:' + p.name })), ...D.exits.map((e) => ({ ...e, type: 'exit', id: 'exit:' + e.name })), ...D.spots.map((s) => ({ ...s, type: 'spot', id: 'spot:' + s.key }))];
  const spots = D.spots.map((s) => ({ ...s, type: 'spot', id: 'spot:' + s.key }));
  const find = (id) => fromList.find((x) => x.id === id) || spots.find((x) => x.id === id);
  let cur = null; // { from, to, pr, r, pts, walkFrom }
  // ---- ふたりで待ち合わせ（部屋）。わたしの位置・進み具合を置き、あいての分を読んで、立体（人の形と光の柱）・小さな地図・パネルに出す
  let room = null, partner = null, fig = null, figTo = null;
  const mine = () => ({ v: 1, t: Date.now(), x: Math.round(me.x), y: Math.round(me.y), l: levelOf(me.z), yaw: Math.round((me.yaw * 180) / Math.PI), k: cur ? cur.k ?? 0 : 0, n: cur ? cur.r.steps.length : 0, rem: cur ? Math.round(cur.rem ?? 0) : 0, at: !!(cur && (nav.arrived || cur.k >= cur.r.steps.length - 1)), from: cur ? cur.from.id : null, to: cur ? cur.to.id : null, pr: cur ? cur.pr : null });
  function makeFig() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: '#f08c00' });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.15, 16), mat); body.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshLambertMaterial({ color: '#ffd9a8' })); head.position.y = 1.4;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.8, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#f08c00', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, fog: false })); col.position.y = 1.4;
    const xray = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.8, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#f08c00', transparent: true, opacity: 0.18, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false })); xray.position.y = 1.4; xray.renderOrder = 6;
    g.add(body, head, col, xray); g.visible = false; scene.add(g);
    return g;
  }
  function placeFig() { // あいての位置へ（1 秒かけて寄せる）
    if (!partner || partner.l == null || !LV[partner.l]) { if (fig) fig.visible = false; return; }
    fig = fig || makeFig();
    const z = floorNear(partner.x, partner.y, LV[partner.l].z) ?? LV[partner.l].z;
    const to = V3(partner.x, partner.y, z);
    if (!fig.visible) { fig.position.copy(to); fig.visible = true; }
    figTo = { from: fig.position.clone(), to, t0: performance.now() };
    fig.rotation.y = -((partner.yaw || 0) * Math.PI) / 180;
    const step = () => { if (!figTo) return; const u = Math.min(1, (performance.now() - figTo.t0) / 1000); fig.position.lerpVectors(figTo.from, figTo.to, u); if (u < 1) requestAnimationFrame(step); else figTo = null; };
    requestAnimationFrame(step);
  }
  function partnerText() {
    if (!room) return '';
    if (!partner) return 'あいてを待っています…（リンクを開くと、ここにあいての様子が出ます）';
    const ago = Math.round((Date.now() - partner.recvAt) / 1000), old = partner.t && Date.now() - partner.t > 5 * 60 * 1000;
    const where = partner.l != null && LV[partner.l] ? LV[partner.l].name : '';
    const pf = partner.from && find(partner.from);
    const head = pf ? `あいては「${pf.name}」から。` : '';
    let t = head + (partner.at ? 'あいてはもう着いています' : partner.n ? `あいてはいま ${partner.k} / ${partner.n - 1}（${where}）、あと約${partner.rem} m` : `あいては${where}にいます（まだ出発を選んでいません）`);
    if (cur && !partner.at && partner.n) { const sec = Math.max(cur.rem ?? 0, partner.rem) / 1.25; t += `。そろうまで約${Math.max(1, Math.round(sec / 60))}分`; }
    if (old) t += '（しばらく更新がありません）'; else if (ago > 15) t += `（${ago} 秒前）`;
    return t;
  }
  function paintPartner() { const el = $('meetPartner'); el.hidden = !room; el.textContent = partnerText(); }
  function startShare(role, id) {
    if (room) room.stop();
    room = startRoom({ id, role, mine, onPartner: (o) => { partner = { ...o, recvAt: Date.now() }; shared.p = partner; placeFig(); paintPartner(); if (partner.at && !room.toldAt) { room.toldAt = true; toast('あいてが待ち合わせ場所に着きました'); } }, onError: () => paintPartner() });
    if (!room) return;
    room.role = role; room.id = id;
    $('meetStop').hidden = false; paintPartner();
    setInterval(paintPartner, 5000);
  }
  function stopShare() { if (room) room.stop(); room = null; partner = null; shared.p = null; if (fig) fig.visible = false; $('meetStop').hidden = true; paintPartner(); const u = new URL(location.href); u.searchParams.delete('room'); u.searchParams.delete('role'); history.replaceState(null, '', u); toast('共有をやめました'); }
  $('meetStop').onclick = stopShare;
  // 現在地（利用者 2026-10-30「出発は、地上にいるかもしれないので、現在地も設定できるようにして」）: 端末の位置から 3 km 以内の、いちばん近い地上の歩道の点
  const ORIGIN = D.origin, aE = 6378137, e2 = 0.00669438002290, phi = (ORIGIN.lat * Math.PI) / 180, wv = Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const KX = (Math.PI / 180) * (aE / wv) * Math.cos(phi), KY = (Math.PI / 180) * ((aE * (1 - e2)) / wv ** 3);
  $('meetHere').onclick = () => {
    if (!navigator.geolocation) { toast('この端末では位置が取れません'); return; }
    $('meetHere').disabled = true;
    navigator.geolocation.getCurrentPosition((p) => {
      $('meetHere').disabled = false;
      const x = (p.coords.longitude - ORIGIN.lon) * KX, y = (p.coords.latitude - ORIGIN.lat) * KY;
      let best = -1, bd = 3000;
      D.nodes.forEach((n, i) => { if (n[2] !== 0 || n[6] !== 'mlit' || !G.adj[i].length) return; const d = Math.hypot(n[0] - x, n[1] - y); if (d < bd) { bd = d; best = i; } });
      if (best < 0) { toast('駅から 3 km 以内で使ってください'); return; }
      const it = { name: '現在地', type: 'place', id: 'place:現在地', node: best, x: D.nodes[best][0], y: D.nodes[best][1], note: `いまいる場所のそばの歩道（約${Math.round(bd)} m）から案内します。` };
      const k = fromList.findIndex((f) => f.id === it.id); if (k >= 0) fromList[k] = it; else fromList.unshift(it);
      if (![...fromSel.options].some((o) => o.value === it.id)) { const o = document.createElement('option'); o.value = it.id; o.textContent = '現在地'; fromSel.insertBefore(o, fromSel.firstChild); }
      fromSel.value = it.id;
      if (toSel.value) run(); else toast('現在地を出発にしました。待ち合わせ場所を選んでください');
    }, () => { $('meetHere').disabled = false; toast('位置が取れませんでした'); }, { enableHighAccuracy: true, timeout: 8000 });
  };

  // ---- 画面
  const fromSel = $('meetFrom'), toSel = $('meetTo'), prSel = $('meetPr');
  const grp = (sel, label, items, fmt) => { const g = document.createElement('optgroup'); g.label = label; for (const it of items) { const o = document.createElement('option'); o.value = it.id; o.textContent = fmt(it); g.appendChild(o); } sel.appendChild(g); };
  grp(fromSel, '地上の場所', fromList.filter((x) => x.type === 'place'), (x) => x.name);
  grp(fromSel, '出口の前（地上）', fromList.filter((x) => x.type === 'exit'), (x) => x.name);
  grp(fromSel, '待ち合わせ場所', fromList.filter((x) => x.type === 'spot'), (x) => `${x.name}（${lvName(x.level)}）`);
  const fillTo = (q = '') => { const keep = toSel.value; toSel.innerHTML = ''; let last = null; for (const s of spots) { if (q && !s.name.includes(q) && !s.kind.includes(q)) continue; if (s.kind !== last) { last = s.kind; } const o = document.createElement('option'); o.value = s.id; o.textContent = `［${s.kind}］${s.name}（${lvName(s.level)}）`; toSel.appendChild(o); } if (keep && [...toSel.options].some((o) => o.value === keep)) toSel.value = keep; };
  fillTo();
  $('meetQ').oninput = () => fillTo($('meetQ').value.trim());
  $('meetBtn').onclick = () => { $('meetPanel').hidden = false; if (cur) render(); };
  $('meetClose').onclick = () => { $('meetPanel').hidden = true; };
  $('meetPanel').onclick = (e) => { if (e.target === $('meetPanel')) $('meetPanel').hidden = true; };
  $('meetGo').onclick = () => run();
  toSel.onchange = () => run();
  $('meetWalk').onclick = () => { if (!cur) return; if (view && view.map && cur.walkFrom >= 0) view.set(false); walkFrom(cur.walkFrom); }; // 地図で見ていれば立体に切り替えて歩きはじめる
  $('meetShare').onclick = async () => {
    if (!cur) return;
    if (!room) { startShare('a', roomId()); const u = new URL(location.href); u.searchParams.set('room', room.id); u.searchParams.set('role', 'a'); history.replaceState(null, '', u); }
    const url = shareURL();
    if (navigator.share) { try { await navigator.share({ title: `${(D.name || data.station.replace(/^JR/, ''))} 待ち合わせ案内`, text: `待ち合わせ場所は「${cur.to.name}」。開いて出発を選ぶと道順が出て、お互いの位置と進み具合が見えます`, url }); return; } catch { /* 取り消し */ } }
    try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch { toast(url); }
  };
  const shareURL = () => { const u = new URL(location.href); u.hash = ''; u.searchParams.delete('from'); u.searchParams.delete('to'); u.searchParams.set('mto', cur.to.id); u.searchParams.set('pr', cur.pr); if (room) { u.searchParams.delete('mfrom'); u.searchParams.set('room', room.id); u.searchParams.set('role', room.role === 'a' ? 'b' : 'a'); } else u.searchParams.set('mfrom', cur.from.id); return u.href; }; // あいてへのリンク: 待ち合わせ場所と部屋だけ（出発はあいてが選ぶ）。部屋が無いときは自分の案内そのもの

  // ---- 経路 → 立体の道筋。床のある最初の点から（地上の歩道にも床がある。無いのは地下 2 階・データの範囲外）
  function toPts(E) {
    const ids = [E[0].a, ...E.map((e) => e.b)];
    const pts = ids.map((i, k) => { const n = N(i); const l = WL(n[2]); const e = k ? E[k - 1] : null; return { x: n[0], y: n[1], z: n[3], l: l ?? -1, lv: n[2], mode: e ? (e.mode === 2 ? 2 : e.mode === 4 ? 4 : e.mode === 5 ? 5 : undefined) : undefined, ground: l == null || !landingAt(n[0], n[1], l, false) }; }); // ground: 立体に床の無い点（地下 2 階、データの範囲外）。地上の歩道には床があるので歩ける（2026-10-30）。以前の注: 階 0 以上は JR の点（ホーム・コンコース）だけ歩ける。地上の歩道・OSM の出入口の点には床が無い
    let first = -1;
    for (let k = 0; k < pts.length; k++) { const p = pts[k]; if (p.ground) continue; if (landingAt(p.x, p.y, p.l, true)) { first = k; break; } }
    return { pts, first };
  }
  function run(fromId = fromSel.value, toId = toSel.value, pr = prSel.value) {
    const from = find(fromId), to = find(toId);
    if (!from || !to) return;
    const r = G.route(from, to, pr);
    if (!r) { $('meetSum').textContent = 'この条件では道が見つかりません。' + (pr === 'ev' ? '条件を「標準」にすると出ます。' : ''); $('meetSteps').innerHTML = ''; return; }
    const { pts, first } = toPts(r.E);
    cur = { from, to, pr, r, pts, walkFrom: first };
    shared.route = pts; // 地図で見るときに道を描く（app.js の drawMini）
    if (view && view.map && pts.length) view.focus(pts[0].x, pts[0].y, pts[0].l); // 地図で見ていれば出発の所へ
    const u = new URL(location.href); u.searchParams.set('mfrom', from.id); u.searchParams.set('mto', to.id); u.searchParams.set('pr', pr); history.replaceState(null, '', u);
    // 立体の案内: 床のある部分の道筋を固定の経路として渡す
    if (first >= 0) {
      const walkPts0 = pts.slice(first).filter((p) => !p.ground);
      // 地下 1 階どうしの点のあいだは、歩く画面のます目の経路探索（床・壁・上れる段差を見る）でつなぐ。案内の線をまっすぐ結ぶと、手すりの
      // あいだや折り返し階段の踊り場を通って進めない所があった（2026-10-30 地上からの通しの点検）。探索の道が遠回りすぎるときはまっすぐのまま
      const gp = window.ekisanpo && window.ekisanpo.gridPath;
      const walkPts = [], map = [];
      // ます目で行けない点（階段の中・手すりのあいだにある案内の点）は飛ばして、前後の点をつなぐ（最初と最後、上り下りの点は残す）
      const reach = (p) => { if (!gp || p.l !== -1) return true; const g = gp(p.x, p.y, p.x + 0.01, p.y); return !g || Math.hypot(g[0][0] - p.x, g[0][1] - p.y) < 1.0; };
      let prev = null;
      walkPts0.forEach((p, i) => {
        const nearLv = [1, 2, 3].some((d) => walkPts0[i + d] && (walkPts0[i + d].l !== p.l || walkPts0[i + d].mode === 4 || walkPts0[i + d].mode === 5)); // 階が変わる・エスカレーター・エレベーターの手前 3 つの点（出口の階段の足元とその手前）は残す
        const keep = i === 0 || i === walkPts0.length - 1 || p.l !== -1 || p.mode === 4 || p.mode === 5 || (prev && prev.l !== -1) || nearLv || reach(p);
        if (!keep) { map[i] = walkPts.length; return; }
        const q = prev;
        if (q && gp && p.l === -1 && q.l === -1 && p.mode !== 4 && p.mode !== 5 && !(q.z > 29.6) && !(p.z > 29.6)) { // ます目の高さ（地下 1 階の 2 m 上まで）より高い点（階段の上の端など）はつながない（ます目は下の床を通る）
          const g = gp(q.x, q.y, p.x, p.y), straight = Math.hypot(p.x - q.x, p.y - q.y);
          if (g && g.length > 2 && Math.hypot(g[g.length - 1][0] - p.x, g[g.length - 1][1] - p.y) < 1.0) { let L = 0; for (let k = 1; k < g.length; k++) L += Math.hypot(g[k][0] - g[k - 1][0], g[k][1] - g[k - 1][1]); if (L < straight * 6 + 40) for (let k = 1; k < g.length - 1; k++) walkPts.push({ x: g[k][0], y: g[k][1], l: -1, lv: -1, grid: 1 }); }
        }
        // 地上どうしの線が出口の階段（坂）の上を横切るときは、階段の口の 2 m 先の角を回る（階段室の横の壁に当たった）。回る点を足したあとの線も
        // 確かめ直す（出口の階段が 3 つ固まった所で、1 つ目を回る点が 2 つ目の口にかかった。池袋の (133,-14)）
        if (q && p.l === 1 && q.l === 1 && data.ramps) {
          const route = exitDetour();
          walkPts.push(...route(q, p));
        }
        map[i] = walkPts.length; walkPts.push(p); prev = p;
      });
      cur.walk = walkPts;
      const end = walkPts[walkPts.length - 1];
      // 手順ごとの、立体の道筋の上の位置（道のりの長さ）。地上の手順は -Infinity（通り過ぎた扱い）
      const ids = [r.E[0].a, ...r.E.map((e) => e.b)].slice(first);
      const cum = [0]; for (let i = 1; i < walkPts.length; i++) cum.push(cum[i - 1] + Math.hypot(walkPts[i].x - walkPts[i - 1].x, walkPts[i].y - walkPts[i - 1].y));
      const walkIdx = new Map(); ids.forEach((ni, k) => { if (!walkIdx.has(ni) && map[k] != null) walkIdx.set(ni, map[k]); });
      const stepS = r.steps.map((st, k) => { if (st.seg && st.seg.kind === 'vert' && !canWalk(st.seg.from)) return -Infinity; const ni = stepNode(st, k); const wi = walkIdx.get(ni); return wi == null ? -Infinity : cum[Math.min(wi, cum.length - 1)]; }); // 地上から下りてくる上り下りは、立体に立った時点で済んでいる
      stepS[stepS.length - 1] = cum[cum.length - 1];
      cur.stepS = stepS; cur.cum = cum;
      // 案内カードの文: 道筋の上のいまの位置（app.js の progress()）から、次の手順まで
      const hintAt = (pr) => {
        const sCur = cum[pr.i - 1] + (cum[pr.i] - cum[pr.i - 1]) * pr.t;
        cur.rem = Math.max(0, cum[cum.length - 1] - sCur);
        let next = -1; for (let k = 1; k < r.steps.length; k++) if (stepS[k] > sCur - 1) { next = k; break; }
        let curK = 0; for (let k = 0; k < r.steps.length - 1; k++) if (stepS[k] <= sCur + 1) curK = k;
        if (curK !== cur.k) { cur.k = curK; highlight(curK); }
        if (next < 0) return null;
        const st = r.steps[next], d = stepS[next] - sCur, title = st.icon === 'goal' ? `${to.name}に着く` : st.title;
        return d < 3 ? `ここで、${title}` : d < 8 ? `まもなく、${title}` : `約${Math.round(d)} m 先、${title}`;
      };
      setMeetRoute({ name: to.name, x: end.x, y: end.y, level: end.l, pts: walkPts, all: pts, meet: true, hintAt });
    } else clearRoute();
    render();
  }
  // いまの手順をパネルで強調（歩いて進むと自動でめくれる。開いていれば見える所へ）
  function highlight(k) { const lis = $('meetSteps').children; for (let i = 0; i < lis.length; i++) lis[i].classList.toggle('here', i === k); if (!$('meetPanel').hidden && lis[k]) lis[k].scrollIntoView({ block: 'nearest' }); }
  // 手順の点（この手順が始まる統合データの点）
  const canWalk = (ni) => { const n = N(ni); const l = WL(n[2]); return l != null && n[6] !== 'mlit' && !(n[2] >= 0 && n[6] !== 'jr') && !!landingAt(n[0], n[1], l, true); };
  const stepNode = (s, k) => (s.seg ? (s.seg.kind === 'vert' && !canWalk(s.seg.from) && canWalk(s.seg.to) ? s.seg.to : s.seg.from) : k === 0 ? cur.r.from.node : cur.r.goal);
  function walkFrom(k) {
    if (k == null || k < 0) { toast('この道は地上の区間だけなので、立体では歩けません（図で案内します）'); return; }
    const p = cur.pts[k];
    $('meetPanel').hidden = true;
    jumpTo(p.x, p.y, p.l, true);
  }
  function render() {
    const r = cur.r, min = Math.max(1, Math.round(r.total / 60)), stairs = r.counts[2] || 0, esc = r.counts[4] || 0, ev = r.counts[5] || 0;
    const len = r.E.reduce((t, e) => t + e.len, 0);
    $('meetTitle').textContent = `${cur.from.name} → ${cur.to.name}`;
    $('meetSum').textContent = `約${min}分・道のり約${Math.round(len / 10) * 10}m（地下 約${Math.round(r.underLen / 10) * 10}m）・${stairs ? `階段 ${stairs}回` : '階段なし'}${esc ? `・エスカレーター ${esc}回` : ''}${ev ? `・エレベーター ${ev}回` : ''}` + (cur.walkFrom > 0 ? '。地上の区間は図で案内し、駅・地下街に入ってから立体で歩けます' : cur.walkFrom < 0 ? '。この道は立体では歩けません（地上だけ）' : '');
    const ol = $('meetSteps'); ol.innerHTML = '';
    // いまいる所に近い手順を強調（同じ階で、手順の始まりの点から 15 m 以内）
    const pl = levelOf(me.z);
    let nearK = cur.k ?? -1, nd = 15;
    if (nearK < 0) r.steps.forEach((s, k) => { const ni = stepNode(s, k), n = N(ni); if (WL(n[2]) !== pl) return; const d = Math.hypot(n[0] - me.x, n[1] - me.y); if (d < nd) { nd = d; nearK = k; } });
    r.steps.forEach((s, k) => {
      const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button';
      const ni = stepNode(s, k), walk = canWalk(ni);
      const cls = s.icon === 'start' ? 's' : s.icon === 'goal' ? 'g' : '';
      b.innerHTML = `<span class="no ${cls}">${s.icon === 'start' ? '出' : s.icon === 'goal' ? '着' : k}</span><span><span class="t"></span>${s.detail ? `<br><small class="d"></small>` : ''}</span><small>${walk ? '立体' : '図'}</small>`;
      b.querySelector('.t').textContent = s.title; if (s.detail) b.querySelector('.d').textContent = s.detail;
      if (k === nearK) li.classList.add('here');
      b.onclick = () => { const n = N(ni); if (view && view.map) { view.focus(n[0], n[1], WL(n[2]) ?? 1); highlight(k); return; } if (!walk) { toast('ここは地上の区間です（立体には床がありません）。地図と文で案内します'); return; } $('meetPanel').hidden = true; jumpTo(n[0], n[1], WL(n[2]), true); }; // 地図で見ているときは、その手順の所・階を地図に出す（地上の区間も）
      li.append(b); ol.append(li);
    });
    $('meetWalk').disabled = cur.walkFrom < 0;
    requestAnimationFrame(drawMap);
  }
  // 図: 通る階の床（上が北）と道筋。地上の区間は灰色、立体で歩ける区間は橙
  function drawMap() {
    const cv = $('meetMap'), W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (!W || !cur) return;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'), P = cur.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const pad = 14, k = Math.min((W - 2 * pad) / Math.max(20, x1 - x0), (H - 2 * pad) / Math.max(20, y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, X = (x) => W / 2 + (x - cx) * k, Y = (y) => H / 2 - (y - cy) * k;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, W, H);
    const levels = new Set(P.filter((p) => !p.ground).map((p) => p.l));
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.strokeStyle = '#cfc8bb'; g.lineWidth = 0.8;
    for (const f of data.floors) { if (!levels.has(f.l)) continue; g.beginPath(); for (const r of f.r) { for (let i = 0; i < r.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(r[i]), Y(r[i + 1])); g.closePath(); } g.fill('evenodd'); g.stroke(); }
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i]; g.strokeStyle = a.ground || b.ground ? '#8a8a8a' : '#f08c00'; g.lineWidth = a.ground || b.ground ? 3 : 4; g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke(); }
    g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    cur.r.steps.forEach((s, i) => { const n = N(stepNode(s, i)), x = X(n[0]), y = Y(n[1]); g.fillStyle = s.icon === 'start' ? '#0b8f4d' : s.icon === 'goal' ? '#e8453c' : '#f08c00'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff'; g.fillText(s.icon === 'start' ? '出' : s.icon === 'goal' ? '着' : String(i), x, y + 0.5); });
    // いまいる所
    g.fillStyle = '#1a73e8'; g.beginPath(); g.arc(X(me.x), Y(me.y), 5, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  }
  // URL から: ?mfrom=&mto=&pr=（待ち合わせ案内の共有リンク、meet/ の「立体で歩く」）
  const q = new URLSearchParams(location.search);
  if (q.get('mto')) {
    toSel.value = q.get('mto');
    if (q.get('pr')) prSel.value = q.get('pr');
    if (q.get('mfrom')) {
      fromSel.value = q.get('mfrom');
      run(fromSel.value, toSel.value, prSel.value);
      if (cur && cur.walkFrom >= 0) { const p = cur.pts[cur.walkFrom]; jumpTo(p.x, p.y, p.l, true); }
    } else { // あいてのリンク: 出発はあいて自身が選ぶ
      const t = find(toSel.value);
      $('meetTitle').textContent = t ? `待ち合わせ場所: ${t.name}（${lvName(t.level)}）` : '';
      $('meetSum').textContent = '出発（いまいる所に近い地上の場所・出口）を選んで「案内」を押してください。';
      $('meetSteps').innerHTML = '';
    }
    $('meetPanel').hidden = false;
  }
  if (q.get('room') && q.get('role')) startShare(q.get('role'), q.get('room'));
  // 地上の 2 点のあいだが出口の階段（坂）の上を横切るとき、階段の四隅（少し外）を回る点（run の立体の道筋と、groundTree の道で使う）
  function exitDetour() {
    if (detour) return detour;
    const onFloor = (k) => phys.surfacesAt(k.x, k.y).some((z) => z > 31 && z < 36);
    const geo = data.ramps.filter((r) => r.exit).map((r) => { const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1; return { r, L, ux: (r.b[0] - r.a[0]) / L, uy: (r.b[1] - r.a[1]) / L, hw: r.w / 2 + 0.6 }; });
    const inR = (g, x, y) => { const al = (x - g.r.a[0]) * g.ux + (y - g.r.a[1]) * g.uy, sd = Math.abs((x - g.r.a[0]) * -g.uy + (y - g.r.a[1]) * g.ux); return al > -0.5 && al < g.L + 0.8 && sd < g.hw + 0.25; }; // 上の端の先 0.8 m・横は体の半径ぶん広く（坂の横の壁の端に当たった。池袋の (137,-10)）
    const crosses = (a, b) => geo.find((g) => { if (inR(g, a.x, a.y) || inR(g, b.x, b.y)) return false; const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.3); for (let k = 1; k < n; k++) { const u = k / n; if (inR(g, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)) return true; } return false; });
    // 回り方: 近くの出口の階段の四隅（少し外）を点にして、横切らない線だけで a から b までのいちばん短い道を探す。
    // 1 本ずつ角を回る作り方では、出口の階段が 3 つ固まった所で行ったり来たりした（池袋の (133,-13)〜(139,-11)。2026-10-30）
    // 回る線が建物などの壁を横切らないか（地上の床の 1 m 上の壁の線。出口の階段の角を回る線が建物の角を横切り、止まった。2026-10-30）
    const X = (p, q, r, t) => { const d = (q[0] - p[0]) * (t[1] - r[1]) - (q[1] - p[1]) * (t[0] - r[0]); if (Math.abs(d) < 1e-9) return false; const u = ((r[0] - p[0]) * (t[1] - r[1]) - (r[1] - p[1]) * (t[0] - r[0])) / d, v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return u > 0 && u < 1 && v > 0 && v < 1; };
    const wallCut = (a, b) => { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = Math.hypot(b.x - a.x, b.y - a.y) / 2 + 0.5; return phys.segsNear(mx, my, (data.levels['1'] ? data.levels['1'].z : 0) + 1.0, r).some(([x1, y1, x2, y2]) => !geo.some((g) => inR(g, (x1 + x2) / 2, (y1 + y2) / 2)) && X([a.x, a.y], [b.x, b.y], [x1, y1], [x2, y2])); }; // 出口の階段室の壁は除く（回る点は階段のそばなので、階段室の壁で回り道がふさがった）
    detour = (a, b) => {
      if (!crosses(a, b)) return [];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, R = Math.hypot(b.x - a.x, b.y - a.y) / 2 + 25;
      const ns = [a, b];
      for (const g of geo) {
        if (Math.hypot(g.r.a[0] - mx, g.r.a[1] - my) > R + g.L) continue;
        for (const al of [-1.0, g.L + 2.0]) for (const sg of [1, -1]) {
          const o = g.hw + 0.8, k = { x: g.r.a[0] + g.ux * al - g.uy * o * sg, y: g.r.a[1] + g.uy * al + g.ux * o * sg, l: 1, lv: 0, around: 1 };
          if (onFloor(k) && !geo.some((h) => inR(h, k.x, k.y))) ns.push(k);
        }
      }
      const n = ns.length, dist = new Array(n).fill(Infinity), from = new Array(n).fill(-1), done = new Array(n).fill(false);
      dist[0] = 0;
      for (;;) {
        let u = -1; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0 || u === 1) break;
        done[u] = true;
        for (let v = 0; v < n; v++) {
          if (done[v] || v === u) continue;
          const d = dist[u] + Math.hypot(ns[v].x - ns[u].x, ns[v].y - ns[u].y);
          if (d < dist[v] && !crosses(ns[u], ns[v]) && !wallCut(ns[u], ns[v])) { dist[v] = d; from[v] = u; }
        }
      }
      if (from[1] < 0) return [];
      const out = []; for (let v = from[1]; v > 0; v = from[v]) out.unshift(ns[v]);
      return out;
    };
    detour.inside = (x, y) => geo.some((g) => inR(g, x, y)); // 出口の階段（坂）の上（口の先 0.8 m まで）
    return detour;
  }
  // 地上にいるときの道の木: いまいる所のそばの地上の点から、地上（階 0: 歩道・JR の 1F）の線をたどった道のり。歩く画面の「出発・行き先」で、地上から
  // 駅の経路網（JR の 1F の点）までの道に使う（app.js の findRoute。歩く画面の経路網には地上の歩道が無く、まっすぐ建物を横切った。2026-10-30）。
  // 出口の階段で地下へ下りる道は使わない（待ち合わせの経路網の階段の線は、歩く立体の出口の階段の向き・位置と違い、階段室の壁に当たった）。
  // reach: (x, y) から r m 以内の階 lv の行ける点のうち、道のり + 残りがいちばん短いもの。path: そこまでの点（歩く画面の階）
  function groundTree(ax, ay) {
    if (!comp) {
      comp = new Int32Array(D.nodes.length);
      const ok = (i) => N(i)[2] === 0;
      for (let i = 0; i < D.nodes.length; i++) {
        if (comp[i] || !ok(i)) continue;
        const q = [i], seen = new Set([i]);
        for (let k = 0; k < q.length; k++) for (const [v, li] of G.adj[q[k]]) if (!seen.has(v) && ok(v) && D.links[li][3] !== 5) { seen.add(v); q.push(v); }
        for (const v of q) comp[v] = q.length;
      }
    }
    // いちばん近い地上の点（200 m 以内。GPS の現在地は線路や建物の中のこともある）。数点だけの離れたかたまりの点は使わない（駅の南で、まわりとつながらない点から歩きはじめた）
    let s = -1, bs = 200;
    D.nodes.forEach((m, i) => { if (m[2] !== 0 || comp[i] < 50) return; const d = Math.hypot(m[0] - ax, m[1] - ay); if (d < bs) { bs = d; s = i; } });
    if (s < 0) return null;
    const n = D.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), heap = [[0, s]];
    dist[s] = 0;
    while (heap.length) {
      let m = 0; for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[m][0]) m = k;
      const [d, u] = heap[m]; heap[m] = heap[heap.length - 1]; heap.pop();
      if (d > dist[u]) continue;
      for (const [v, li] of G.adj[u]) { const L = D.links[li]; if (N(v)[2] !== 0 || L[3] === 5) continue; const nd = d + L[2]; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push([nd, v]); } }
    }
    return {
      reach(x, y, lv, r = 10) {
        let t = -1, bt = Infinity;
        D.nodes.forEach((m, i) => { if (m[2] !== lv || dist[i] === Infinity) return; const q = Math.hypot(m[0] - x, m[1] - y); if (q <= r && dist[i] + q < bt) { bt = dist[i] + q; t = i; } });
        return t < 0 ? null : { node: t, cost: bs + bt };
      },
      path(t) { // 出口の階段の上を横切る所は回る
        let ps = []; for (let v = t; v >= 0; v = prev[v]) ps.unshift({ x: N(v)[0], y: N(v)[1], l: WL(N(v)[2]) });
        const rt = data.ramps ? exitDetour() : null, out = [];
        if (rt) ps = ps.filter((p, k) => k === ps.length - 1 || !rt.inside(p.x, p.y)); // 出口の階段の上にある地上の点は飛ばす（階段室の壁に当たった）
        ps.forEach((p, k) => { if (k && rt) for (const q of rt(ps[k - 1], p)) out.push([q.x, q.y, 1]); out.push([p.x, p.y, p.l]); });
        return out;
      },
    };
  }
  return { run, render, groundTree, get cur() { return cur; }, get partner() { return partner; }, get room() { return room; }, startShare, stopShare };
}
