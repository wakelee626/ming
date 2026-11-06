import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const savesDir = path.join(dataDir, 'saves');
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin2026';

const readJson = async f => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://x').pathname;
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };

  if (req.method === 'POST' && route === '/api/admin') {
    let raw = ''; for await (const p of req) { raw += p; if (Buffer.byteLength(raw) > 8192) break; }
    let a; try { a = JSON.parse(raw); } catch { return send(400, { error: '无效 JSON' }); }
    if (a.adminKey !== ADMIN_KEY) return send(403, { error: '管理密钥错误' });
    const users = await readJson(path.join(dataDir, 'users.json')) || {};
    const list = [];
    for (const u of Object.values(users)) {
      const st = await readJson(path.join(savesDir, u.id + '.json'));
      if (!st) continue;
      list.push({
        id: u.id, username: u.username,
        turn: st.turn, year: 1628 + Math.floor(st.turn / 4), ending: st.ending,
        stats: st.stats, privy: st.privy,
        hasAi: !!(u.aiConfig && u.aiConfig.apiKey),
        decisions: (st.log || []).map(e => ({ year: e.year, season: e.season, decree: e.decree, mode: e.mode })),
      });
    }
    list.sort((a, b) => b.turn - a.turn);
    return send(200, { users: list });
  }

  if (req.method === 'GET' && (route === '/' || route === '/admin.html')) {
    try {
      const html = await readFile(path.join(root, 'admin.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    } catch { return send(500, { error: 'admin.html 未找到' }); }
  }

  send(404, { error: '未找到' });
});

server.listen(Number(process.env.ADMIN_PORT || 60001), '0.0.0.0', () => console.log(`管理面板：http://0.0.0.0:${server.address().port}`));
