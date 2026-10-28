// آمار سایت «صدای عشایر ایران» — Vercel Function + Vercel KV
// GET /api/stats با خروجی ok/total/today/days/device/os/browser/lang/tz/recent
import { kv } from '@vercel/kv';

const TEHRAN = 'Asia/Tehran';
const fmtDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: TEHRAN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const tehranDay = (ts) => fmtDay.format(new Date(ts));

function last7Days() {
  const out = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) out.push(tehranDay(now - i * 86400000));
  return out;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ ok: false, error: 'not found' }, 404);

  const days = last7Days();
  const today = days[days.length - 1];
  const dayMap = new Map(days.map((d) => [d, { day: d, mobile: 0, desktop: 0, total: 0 }]));
  const device = {};
  const os = {};
  const browser = {};
  const lang = {};
  const tz = {};
  const all = [];

  let cursor = 0;
  do {
    const [next, keys] = await kv.scan(cursor, { match: 'visit:*', count: 1000 });
    cursor = next;
    for (const k of keys) {
      const raw = await kv.get(k);
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!r) continue;
      const d = k.split(':')[1];
      const dm = dayMap.get(d);
      if (dm) {
        dm[r.device === 'desktop' ? 'desktop' : 'mobile']++;
        dm.total++;
      }
      device[r.device] = (device[r.device] || 0) + 1;
      if (r.os) os[r.os] = (os[r.os] || 0) + 1;
      if (r.browser) browser[r.browser] = (browser[r.browser] || 0) + 1;
      if (r.lang) lang[r.lang] = (lang[r.lang] || 0) + 1;
      if (r.tz) tz[r.tz] = (tz[r.tz] || 0) + 1;
      all.push(r);
    }
  } while (cursor !== 0);

  all.sort((a, b) => b.ts - a.ts);
  return json({
    ok: true,
    total: all.length,
    today: dayMap.get(today)?.total || 0,
    days: days.map((d) => dayMap.get(d)),
    device,
    os,
    browser,
    lang,
    tz,
    recent: all.slice(0, 50),
  });
}
