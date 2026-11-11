// Painel de leads (server-side): lê o Supabase com a service_role key (bypassa RLS).
// Protegido por senha (ADMIN_KEY). A service key NUNCA vai pro front — fica só em env.
export default async function handler(req, res) {
  const ADMIN = process.env.ADMIN_KEY;
  const URL = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const key = (req.query && req.query.key) || req.headers['x-admin-key'] || '';
  if (!ADMIN || key !== ADMIN) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!URL || !SVC) { res.status(500).json({ error: 'missing_env' }); return; }
  const h = { apikey: SVC, Authorization: 'Bearer ' + SVC };
  try {
    const [leadsR, evR] = await Promise.all([
      fetch(URL + '/rest/v1/wallet_leads?select=*&order=updated_at.desc', { headers: h }),
      fetch(URL + '/rest/v1/wallet_events?select=email,name,created_at&order=created_at.desc&limit=2000', { headers: h })
    ]);
    const leads = await leadsR.json();
    const ev = await evR.json();
    const byEmail = {};
    (Array.isArray(ev) ? ev : []).forEach(function (e) {
      (byEmail[e.email] = byEmail[e.email] || { total: 0, last: null, kinds: {} });
      byEmail[e.email].total++;
      byEmail[e.email].kinds[e.name] = (byEmail[e.email].kinds[e.name] || 0) + 1;
      if (!byEmail[e.email].last) byEmail[e.email].last = e.created_at;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      total: Array.isArray(leads) ? leads.length : 0,
      leads: Array.isArray(leads) ? leads : [],
      eventsByEmail: byEmail
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
