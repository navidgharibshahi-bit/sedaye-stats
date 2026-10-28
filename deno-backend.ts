// بک‌اند آمار سایت «صدای عشایر ایران» — Deno Deploy + Deno KV
// استقرار: همین یک فایل را در یک پروژه Deno Deploy بگذار (Playground هم کافی است).
// اندپوینت‌ها:
//   POST /api/visit  با Content-Type: text/plain و بدنه JSON
//   GET  /api/stats  با خروجی ok/total/today/days/device/os/browser/lang/tz/recent
// قانون شمارش: هر شناسه بازدیدکننده (vid) در هر روز تهران فقط یک رکورد دارد.

const kv = await Deno.openKv();

const TEHRAN = "Asia/Tehran";
const fmtDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEHRAN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const tehranDay = (ts: number) => fmtDay.format(new Date(ts)); // "YYYY-MM-DD"

function last7Days(): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 6; i >= 0; i--) out.push(tehranDay(now - i * 86400000));
  return out;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const clean = (v: unknown, max = 64) =>
  typeof v === "string" ? v.slice(0, max) : "";

function clientIp(req: Request, info: Deno.ServeHandlerInfo): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().replace(/^::ffff:/, "");
  const h = (info.remoteAddr as Deno.NetAddr)?.hostname || "";
  return h.replace(/^::ffff:/, "");
}

async function geo(ip: string) {
  // بهترین تلاش؛ برای IP خصوصی یا خطای سرویس، خالی برمی‌گردد (داشبورد «ثبت نشده» نشان می‌دهد)
  if (
    !ip || ip === "127.0.0.1" || ip === "::1" ||
    ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.16.")
  ) return { country: "", region: "", city: "" };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`https://ipapi.co/${ip}/json/`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { country: "", region: "", city: "" };
    const j = await r.json();
    if (j && !j.error) {
      return { country: j.country_name || "", region: j.region || "", city: j.city || "" };
    }
  } catch { /* ignore */ }
  return { country: "", region: "", city: "" };
}

Deno.serve(async (req, info) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (url.pathname === "/api/visit" && req.method === "POST") {
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return json({ ok: false, error: "bad json" }, 400);
    }
    const vid = clean(body?.vid, 128);
    if (!vid) return json({ ok: false, error: "missing vid" }, 400);
    const device = body?.device === "desktop" ? "desktop" : "mobile";
    const day = tehranDay(Date.now());
    const key = ["visits", day, vid];
    const existing = await kv.get(key);
    if (existing.value) return json({ ok: true, deduped: true });
    const ip = clientIp(req, info);
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
    await kv.set(key, rec);
    return json({ ok: true });
  }

  if (url.pathname === "/api/stats" && req.method === "GET") {
    const days = last7Days();
    const today = days[days.length - 1];
    const dayMap = new Map(
      days.map((d) => [d, { day: d, mobile: 0, desktop: 0, total: 0 }]),
    );
    const device: Record<string, number> = {};
    const os: Record<string, number> = {};
    const browser: Record<string, number> = {};
    const lang: Record<string, number> = {};
    const tz: Record<string, number> = {};
    const all: Array<Record<string, unknown>> = [];
    for await (const e of kv.list({ prefix: ["visits"] })) {
      const r = e.value as Record<string, unknown>;
      const d = e.key[1] as string;
      const dm = dayMap.get(d);
      if (dm) {
        dm[r.device === "desktop" ? "desktop" : "mobile"]++;
        dm.total++;
      }
      const dev = r.device as string;
      device[dev] = (device[dev] || 0) + 1;
      if (r.os) os[r.os as string] = (os[r.os as string] || 0) + 1;
      if (r.browser) browser[r.browser as string] = (browser[r.browser as string] || 0) + 1;
      if (r.lang) lang[r.lang as string] = (lang[r.lang as string] || 0) + 1;
      if (r.tz) tz[r.tz as string] = (tz[r.tz as string] || 0) + 1;
      all.push(r);
    }
    all.sort((a, b) => (b.ts as number) - (a.ts as number));
    return json({
      ok: true,
      total: all.length,
      today: dayMap.get(today)?.total || 0,
      days: days.map((d) => dayMap.get(d)!),
      device,
      os,
      browser,
      lang,
      tz,
      recent: all.slice(0, 50),
    });
  }

  return json({ ok: false, error: "not found" }, 404);
});
