// آمار سایت «صدای عشایر ایران» — Netlify Function + Netlify Blobs
// GET /api/stats با خروجی ok/total/today/days/device/os/browser/lang/tz/recent
import { getStore } from '@netlify/blobs';

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

export default async (req) => {
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
  const store = getStore();

  let cursor;
  do {
    const page = await store.list({ prefix: 'visit:', cursor });
    for (const b of page.blobs) {
      const r = await store.get(b.key, { type: 'json' });
      if (!r) continue;
      const d = b.key.split(':')[1];
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
    cursor = page.cursor;
  } while (cursor);

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
};
