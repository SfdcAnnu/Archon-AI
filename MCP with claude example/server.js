const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT         = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;

// In-memory stores
const stateStore = {};
const tokenStore = {};

// ── PKCE ──
function generateVerifier() { return crypto.randomBytes(32).toString('base64url'); }
async function generateChallenge(v) { return crypto.createHash('sha256').update(v).digest().toString('base64url'); }

// ── Build clean history for Anthropic ──
function sanitiseHistory(messages) {
  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg;
    return {
      ...msg,
      content: msg.content.map(b => {
        if (b.type === 'mcp_tool_use')    return { ...b, server_name: b.server_name || 'salesforce' };
        if (b.type === 'mcp_tool_result') return { type:'mcp_tool_result', tool_use_id:b.tool_use_id, is_error:b.is_error||false, content:b.content||[] };
        return b;
      })
    };
  });
}

const server = http.createServer(async (req, res) => {
  const url   = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Auth: start OAuth ──
  if (req.method === 'GET' && route === '/auth/start') {
    const clientId = url.searchParams.get('clientId');
    const mcpUrl   = url.searchParams.get('mcpUrl');
    const sandbox  = url.searchParams.get('sandbox') === 'true';
    if (!clientId || !mcpUrl) { res.writeHead(400); res.end('Missing params'); return; }

    const verifier  = generateVerifier();
    const challenge = await generateChallenge(verifier);
    const state     = crypto.randomBytes(16).toString('hex');
    const sfBase    = sandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com';

    stateStore[state] = { verifier, clientId, mcpUrl, sfBase };

    const authUrl = sfBase + '/services/oauth2/authorize?' + new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI,
      scope: 'mcp_api refresh_token openid', code_challenge: challenge,
      code_challenge_method: 'S256', state
    });
    res.writeHead(302, { Location: authUrl }); res.end();
    return;
  }

  // ── Auth: callback ──
  if (req.method === 'GET' && route === '/auth/callback') {
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const send  = (type, data) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<script>window.opener&&window.opener.postMessage(${JSON.stringify({type,...data})},'*');window.close();</script><p>${type}</p>`);
    };
    if (error) { send('SF_AUTH_ERROR', { error: url.searchParams.get('error_description')||error }); return; }
    const stored = stateStore[state];
    if (!stored) { res.writeHead(400); res.end('Invalid state'); return; }
    delete stateStore[state];
    try {
      const tr = await fetch(stored.sfBase + '/services/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type:'authorization_code', code, redirect_uri:REDIRECT_URI, client_id:stored.clientId, code_verifier:stored.verifier })
      });
      const tk = await tr.json();
      if (!tk.access_token) throw new Error(tk.error_description || 'Token exchange failed');
      tokenStore['user'] = { access_token:tk.access_token, refresh_token:tk.refresh_token, instance_url:tk.instance_url, client_id:stored.clientId, mcp_url:stored.mcpUrl, sfBase:stored.sfBase, obtained_at:Date.now() };
      send('SF_AUTH_SUCCESS', { instance_url: tk.instance_url, mcp_url: stored.mcpUrl });
    } catch(e) { send('SF_AUTH_ERROR', { error: e.message }); }
    return;
  }

  // ── Auth: status ──
  if (req.method === 'GET' && route === '/auth/status') {
    const t = tokenStore['user'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(t ? { authenticated:true, instance_url:t.instance_url, mcp_url:t.mcp_url, age_minutes:Math.round((Date.now()-t.obtained_at)/60000) } : { authenticated:false }));
    return;
  }

  // ── Auth: refresh ──
  if (req.method === 'POST' && route === '/auth/refresh') {
    const t = tokenStore['user'];
    if (!t?.refresh_token) { res.writeHead(401); res.end(JSON.stringify({error:'No refresh token'})); return; }
    try {
      const tr = await fetch(t.sfBase + '/services/oauth2/token', {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body: new URLSearchParams({ grant_type:'refresh_token', refresh_token:t.refresh_token, client_id:t.client_id })
      });
      const tk = await tr.json();
      if (!tk.access_token) throw new Error(tk.error_description||'Refresh failed');
      tokenStore['user'].access_token = tk.access_token;
      tokenStore['user'].obtained_at  = Date.now();
      res.writeHead(200); res.end(JSON.stringify({success:true}));
    } catch(e) { res.writeHead(401); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ── Auth: logout ──
  if (req.method === 'POST' && route === '/auth/logout') {
    delete tokenStore['user'];
    res.writeHead(200); res.end(JSON.stringify({success:true}));
    return;
  }

  // ══════════════════════════════════════════════
  //  POST /api/chat  — optimised NON-streaming proxy
  //  Single fast JSON round-trip: no SSE overhead
  // ══════════════════════════════════════════════
  if (req.method === 'POST' && route === '/api/chat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);

        if (!payload.apiKey?.startsWith('sk-ant-')) {
          res.writeHead(401, {'Content-Type':'application/json'});
          res.end(JSON.stringify({error:{message:'Invalid Anthropic API key.'}})); return;
        }

        let stored = tokenStore['user'];
        if (!stored) {
          res.writeHead(401, {'Content-Type':'application/json'});
          res.end(JSON.stringify({error:{message:'Not authenticated with Salesforce.'}})); return;
        }

        // Auto-refresh token if >90 min old
        if ((Date.now() - stored.obtained_at) / 60000 > 90 && stored.refresh_token) {
          try {
            const tr = await fetch(stored.sfBase + '/services/oauth2/token', {
              method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
              body: new URLSearchParams({grant_type:'refresh_token', refresh_token:stored.refresh_token, client_id:stored.client_id})
            });
            const tk = await tr.json();
            if (tk.access_token) { tokenStore['user'].access_token = tk.access_token; tokenStore['user'].obtained_at = Date.now(); stored = tokenStore['user']; }
          } catch(e) { console.warn('[proxy] refresh failed:', e.message); }
        }

        const t0 = Date.now();
        console.log('[proxy] → Anthropic', new Date().toISOString());

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         payload.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta':    'mcp-client-2025-11-20'
          },
          body: JSON.stringify({
            model:       'claude-sonnet-4-6',
            max_tokens:  125000,
            system:      payload.system || '',
            messages:    sanitiseHistory(payload.messages || []),
            mcp_servers: [{ type:'url', url:stored.mcp_url, name:'salesforce', authorization_token:stored.access_token }],
            tools:       [{ type:'mcp_toolset', mcp_server_name:'salesforce' }]
          })
        });

        const data = await response.json();
        console.log(`[proxy] ← ${response.status} in ${Date.now()-t0}ms`);

        if (!response.ok) console.error('[proxy] Anthropic error:', JSON.stringify(data?.error));

        // Extract tool call info for display (sent alongside response)
        const toolUses    = (data.content||[]).filter(b => b.type === 'mcp_tool_use');
        const toolResults = (data.content||[]).filter(b => b.type === 'mcp_tool_result');

        const tools = toolUses.map(t => {
          const res2 = toolResults.find(r => r.tool_use_id === t.id);
          let meta = 'Completed';
          if (res2?.content?.[0]?.text) {
            try {
              const p = JSON.parse(res2.content[0].text);
              if (p.records)               meta = p.records.length + ' record' + (p.records.length!==1?'s':'') + ' returned';
              else if (Array.isArray(p))   meta = p.length + ' items returned';
              else if (p.totalSize != null) meta = p.totalSize + ' records';
              else if (p.success)          meta = 'Success';
              else meta = 'Data retrieved';
            } catch(e) { meta = res2.content[0].text.slice(0,50)||'Completed'; }
          }
          return { id:t.id, name:t.name, meta, is_error: res2?.is_error||false };
        });

        res.writeHead(response.status, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ...data, _tools: tools }));

      } catch(e) {
        console.error('[proxy] exception:', e.message);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error:{message:'Proxy error: '+e.message}}));
      }
    });
    return;
  }

  // ── Static files ──
  const filePath = route==='/' ? path.join(__dirname,'index.html') : path.join(__dirname, req.url.split('?')[0]);
  const safe     = path.resolve(filePath);
  if (!safe.startsWith(path.resolve(__dirname))) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(safe, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css'};
    res.writeHead(200, {'Content-Type': mime[path.extname(safe)]||'text/plain'});
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  360 AI Agent  →  http://localhost:' + PORT);
  console.log('');
});
