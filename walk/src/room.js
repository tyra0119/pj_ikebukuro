// ふたりで待ち合わせ: 中継サーバ（tyra.jp）の部屋 /room/<ID> に、わたし（a）とあいて（b）の位置と進み具合を置き、5 秒ごとに読み合う。
// Machiawase の「あいてに入力してもらう」と同じ部屋。ID は推測できない 20 文字、3 日で消える。書けるのは許可したオリジン（公開ページ）だけ。
// 手元で試すときは ?roomapi=http://127.0.0.1:8787/ で、手元の中継サーバに向けられる（localhost と 127.0.0.1 だけ）

export const ROOMAPI = (() => {
  try { const u = new URLSearchParams(location.search).get('roomapi'); if (u && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/$/.test(u)) return u + 'room/'; } catch { /* 無ければ既定 */ }
  return 'https://tyra.jp/odpt/api/room/';
})();
export function roomId() { const a = new Uint8Array(15), c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; let o = ''; crypto.getRandomValues(a); for (let i = 0; i < a.length; i++) o += c[a[i] % c.length]; return 'w' + o + 'xyzw'.charAt(a[0] % 4); }
const ID_RE = /^[A-Za-z0-9_-]{16,32}$/;

// room: { id, role: 'a' | 'b' }。mine(): いま置くもの（JSON にできる小さなもの）。onPartner(o): あいての分が届いた（変わったときだけ）。onError(msg)
export function startRoom({ id, role, mine, onPartner, onError, every = 5000 }) {
  if (!ID_RE.test(id) || (role !== 'a' && role !== 'b')) return null;
  const st = { id, role, sent: '', got: '', timer: 0, err: '', stopped: false, lastOk: 0 };
  const put = async () => {
    if (st.stopped) return;
    const body = JSON.stringify(mine());
    if (body === st.sent) return;
    try {
      const r = await fetch(ROOMAPI + id + '/' + role, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(String(r.status));
      st.sent = body; st.err = ''; st.lastOk = Date.now();
    } catch (e) { st.err = 'あいてに届けられませんでした（' + (e.message || '通信') + '）'; onError && onError(st.err); }
  };
  const get = async () => {
    if (st.stopped) return;
    try {
      const r = await fetch(ROOMAPI + id, { cache: 'no-store' });
      if (r.status === 404) return; // まだ誰も置いていない
      if (!r.ok) throw new Error(String(r.status));
      const o = await r.json(), other = role === 'a' ? o.b : o.a;
      if (!other) return;
      const js = JSON.stringify(other);
      if (js !== st.got) { st.got = js; onPartner && onPartner(other); }
    } catch (e) { st.err = 'あいての様子を読めませんでした（' + (e.message || '通信') + '）'; onError && onError(st.err); }
  };
  const tick = async () => { await put(); await get(); };
  tick();
  st.timer = setInterval(tick, every);
  return { st, put, get, stop() { st.stopped = true; clearInterval(st.timer); } };
}
