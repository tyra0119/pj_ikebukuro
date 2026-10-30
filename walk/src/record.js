// 録画: 歩いた道すじ（足あと）を URL に入れて共有する形と、画面そのものの動画。
//
// 足あとの形（版 1）: 0.25 秒ごとに位置（10 cm 単位）と向き（256 分の 1 周）を取り、
// 先頭だけそのまま、あとは前との差（-127〜127）で並べ、deflate で縮めて base64url にする。
// 差に収まらない飛び（エレベーター）は -128 のあとにそのままの値を入れる。

export const SAMPLE_MS = 250;
export const MAX_SAMPLES = 4 * 60 * 10; // 10 分まで

const q = (v) => Math.round(v * 10);
const qa = (a) => ((Math.round((a / (Math.PI * 2)) * 256) % 256) + 256) % 256;
const qp = (p) => Math.max(-127, Math.min(127, Math.round((p / 1.2) * 127)));

export function encodeTrack(samples, destIndex = 255) {
  const out = [1, destIndex & 255];
  const put16 = (v) => { out.push((v >> 8) & 255, v & 255); };
  let prev = null;
  for (const s of samples) {
    const c = [q(s.x), q(s.y), q(s.z), qa(s.yaw), qp(s.pitch)];
    if (prev) {
      const d = [c[0] - prev[0], c[1] - prev[1], c[2] - prev[2], ((c[3] - prev[3] + 384) % 256) - 128, c[4] - prev[4]];
      if ([d[0], d[1], d[2], d[4]].every((v) => v >= -127 && v <= 127)) { out.push(...d.map((v) => v & 255)); prev = c; continue; }
    }
    out.push(prev ? 128 : 0); // 0: 先頭、128（-128）: 飛び
    put16(c[0] & 0xffff); put16(c[1] & 0xffff); put16(c[2] & 0xffff);
    out.push(c[3], c[4] & 255);
    prev = c;
  }
  return pack(new Uint8Array(out));
}

export async function decodeTrack(text) {
  const b = await unpack(text);
  if (b[0] !== 1) throw new Error('足あとの版が違います');
  const destIndex = b[1];
  const s8 = (v) => (v > 127 ? v - 256 : v);
  const s16 = (i) => { const v = (b[i] << 8) | b[i + 1]; return v > 32767 ? v - 65536 : v; };
  const samples = [];
  let c = null;
  for (let i = 2; i < b.length;) {
    if (!c || b[i] === 128) {
      i++;
      c = [s16(i), s16(i + 2), s16(i + 4), b[i + 6], s8(b[i + 7])];
      i += 8;
    } else {
      c = [c[0] + s8(b[i]), c[1] + s8(b[i + 1]), c[2] + s8(b[i + 2]), (c[3] + s8(b[i + 3]) + 256) % 256, c[4] + s8(b[i + 4])];
      i += 5;
    }
    samples.push({ x: c[0] / 10, y: c[1] / 10, z: c[2] / 10, yaw: (c[3] / 256) * Math.PI * 2, pitch: (c[4] / 127) * 1.2 });
  }
  return { samples, destIndex };
}

// 縮める（先頭の 1 文字で、縮めたか z / そのままか r）
async function pack(bytes) {
  let body = bytes, tag = 'r';
  if (typeof CompressionStream !== 'undefined') {
    body = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    tag = 'z';
  }
  let s = '';
  for (const v of body) s += String.fromCharCode(v);
  return tag + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(text) {
  const tag = text[0];
  const bin = atob(text.slice(1).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  if (tag === 'r') return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザでは足あとを開けません');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

// 画面の動画（canvas の captureStream と MediaRecorder）。使えないブラウザでは null
export function startVideo(canvas) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null;
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return null;
  const chunks = [];
  let rec;
  try {
    rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 4_000_000 });
  } catch { return null; }
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000);
  return {
    type,
    stop: () => new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: type.split(';')[0] }));
      rec.stop();
    }),
  };
}
