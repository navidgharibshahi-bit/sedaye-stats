// ثبت بازدید برای آمار سایت «صدای عشایر ایران» — Netlify Function + Netlify Blobs
// POST /api/visit با Content-Type: text/plain و بدنه JSON
// قانون شمارش: هر شناسه بازدیدکننده (vid) در هر روز تهران فقط یک رکورد دارد.
import { getStore } from '@netlify/blobs';

const TEHRAN = 'Asia/Tehran';
const fmtDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: TEHRAN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const tehranDay = (ts) => fmtDay.format(new Date(ts));

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

const clean = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');

async function geo(ip) {
  // بهترین تلاش؛ برای IP خصوصی یا خطای سرویس، خالی برمی‌گردد (داشبورد «ثبت نشده» نشان می‌دهد)
  if (
    !ip || ip === '127.0.0.1' || ip === '::1' ||
    ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.')
  ) return { country: '', region: '', city: '' };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`https://ipapi.co/${ip}/json/`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { country: '', region: '', city: '' };
    const j = await r.json();
    if (j && !j.error) {
      return { country: j.country_name || '', region: j.region || '', city: j.city || '' };
    }
  } catch { /* ignore */ }
  return { country: '', region: '', city: '' };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'not found' }, 404);

  let body = null;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
  }
  const vid = clean(body?.vid, 128);
  if (!vid) return json({ ok: false, error: 'missing vid' }, 400);

  const device = body?.device === 'desktop' ? 'desktop' : 'mobile';
  const day = tehranDay(Date.now());
  const key = `visit:${day}:${vid}`;
  const store = getStore();
  const existing = await store.get(key, { type: 'json' });
  if (existing) return json({ ok: true, deduped: true });

  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0].trim() : '').replace(/^::ffff:/, '');
  const g = await geo(ip);

  const rec = {
    ts: Date.now(),
    ip,
    device,
    os: clean(body?.os),
    osFull: clean(body?.osFull, 128),
    browser: clean(body?.browser),
    browserFull: clean(body?.browserFull, 128),
    screen: clean(body?.screen, 32),
    lang: clean(body?.lang, 8),
    tz: clean(body?.tz, 64),
    country: g.country,
    region: g.region,
    city: g.city,
  };
  await store.setJSON(key, rec);
  return json({ ok: true });
};
