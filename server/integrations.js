require('dotenv').config();

const configs = {
  compliancePortal: { baseUrl: process.env.COMPLIANCE_PORTAL_BASE_URL, apiKey: process.env.COMPLIANCE_PORTAL_API_KEY },
  metabase: { baseUrl: process.env.METABASE_BASE_URL, apiKey: process.env.METABASE_API_KEY },
  zohoDesk: { baseUrl: process.env.ZOHO_DESK_BASE_URL, apiKey: process.env.ZOHO_DESK_ACCESS_TOKEN, orgId: process.env.ZOHO_DESK_ORG_ID },
  idfy: { baseUrl: process.env.IDFY_BASE_URL, apiKey: process.env.IDFY_API_KEY },
  fravity: { baseUrl: process.env.FRAVITY_BASE_URL, apiKey: process.env.FRAVITY_API_KEY }
};

function getConfig(name) { return configs[name]; }

async function request(name, method, path, body) {
  const cfg = getConfig(name);
  if (!cfg?.baseUrl) throw new Error(`${name} integration is not configured. Set its BASE_URL/API credentials in .env.`);
  const url = new URL(path.replace(/^\//,''), cfg.baseUrl.endsWith('/') ? cfg.baseUrl : cfg.baseUrl + '/');
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.orgId) headers.orgId = cfg.orgId;
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) { const err = new Error(`Integration returned ${response.status}`); err.status = response.status; err.data = data; throw err; }
  return data;
}

module.exports = { configs, getConfig, request };
