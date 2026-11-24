// Frontend e chamadas ao n8n na mesma origem.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { completarAnoDaMensagem } = require('./completar_ano');

const port = Number(process.env.PORT || 8080);
const n8n = new URL(process.env.N8N_URL || 'http://127.0.0.1:5678');
const adminChatPath = (process.env.ADMIN_CHAT_PATH || '').trim();
const clientWebhookPath = '/webhook/clinica-atendimento';
const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const adminPage = fs.readFileSync(path.join(__dirname, 'admin.html'));

if (adminChatPath && !/^\/webhook\/[^/]+\/chat$/.test(adminChatPath)) {
  throw new Error('ADMIN_CHAT_PATH deve ser o caminho /webhook/<id>/chat do n8n.');
}

function reply(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error('Mensagem muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function proxy(req, res, targetPath, body, rewriteAdminChat = false) {
  const headers = { ...req.headers, host: n8n.host };
  if (body) {
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = Buffer.byteLength(body);
  }
  // O HTML do chat hospedado traz uma URL absoluta localhost. Sem compressão,
  // podemos trocá-la pela origem atual (inclusive quando acessada via ngrok).
  if (rewriteAdminChat) headers['accept-encoding'] = 'identity';

  const upstream = http.request({
    hostname: n8n.hostname,
    port: n8n.port || 80,
    method: req.method,
    path: targetPath,
    headers,
  }, upstreamResponse => {
    const responseHeaders = { ...upstreamResponse.headers };
    if (responseHeaders.location?.startsWith(n8n.origin)) {
      responseHeaders.location = responseHeaders.location.slice(n8n.origin.length);
    }

    if (rewriteAdminChat &&
        String(responseHeaders['content-type'] || '').includes('text/html') &&
        upstreamResponse.statusCode === 200) {
      const chunks = [];
      upstreamResponse.on('data', chunk => chunks.push(chunk));
      upstreamResponse.on('end', () => {
        const original = Buffer.concat(chunks).toString('utf8');
        const corrected = original.replace(
          /webhookUrl:\s*"[^"\n]+"/,
          `webhookUrl: window.location.origin + ${JSON.stringify(adminChatPath)}`,
        );
        if (corrected === original) {
          reply(res, 502, 'Não foi possível preparar o chat administrativo.');
          return;
        }
        delete responseHeaders['content-encoding'];
        delete responseHeaders['transfer-encoding'];
        responseHeaders['content-length'] = Buffer.byteLength(corrected);
        responseHeaders['cache-control'] = 'no-store';
        res.writeHead(200, responseHeaders);
        res.end(corrected);
      });
      return;
    }

    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });

  upstream.setTimeout(10 * 60 * 1000, () => upstream.destroy(new Error('Tempo esgotado.')));
  upstream.on('error', error => {
    if (!res.headersSent) reply(res, 502, 'n8n indisponível: ' + error.message);
    else res.destroy(error);
  });

  if (body) upstream.end(body);
  else req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://local');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    reply(res, 200, page, 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/admin') {
    reply(res, 200, adminPage, 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    try {
      const check = await fetch(new URL('/healthz', n8n), { signal: AbortSignal.timeout(4000) });
      reply(res, check.ok ? 200 : 503, JSON.stringify({ online: check.ok }), 'application/json; charset=utf-8');
    } catch {
      reply(res, 503, JSON.stringify({ online: false }), 'application/json; charset=utf-8');
    }
    return;
  }
  if (url.pathname === '/api/cliente') {
    if (req.method !== 'POST') {
      reply(res, 405, 'Método não permitido.');
      return;
    }
    try {
      const data = await readJson(req);
      const sessao = String(data.sessao_id || '').trim();
      const mensagem = String(data.mensagem || '').trim();
      if (!sessao || sessao.length > 128 || !mensagem || mensagem.length > 2000) {
        reply(res, 400, 'Informe uma sessão e uma mensagem de até 2000 caracteres.');
        return;
      }
      proxy(req, res, clientWebhookPath, JSON.stringify({
        sessao_id: sessao,
        mensagem: completarAnoDaMensagem(mensagem),
      }));
    } catch (error) {
      if (!res.headersSent && !res.destroyed) reply(res, 400, error.message);
    }
    return;
  }
  if (url.pathname === '/api/status') {
    if (req.method !== 'GET') {
      reply(res, 405, 'Método não permitido.');
      return;
    }
    const id = String(url.searchParams.get('id') || '');
    if (!/^[0-9]{1,12}$/.test(id)) {
      reply(res, 400, 'ID de agendamento inválido.');
      return;
    }
    // O n8n retorna apenas o status; nenhum dado do tutor ou do pet é exposto.
    proxy(req, res, '/webhook/clinica-status?id=' + encodeURIComponent(id));
    return;
  }
  if (url.pathname === '/api/admin') {
    if (req.method !== 'POST') {
      reply(res, 405, 'Método não permitido.');
      return;
    }
    if (!adminChatPath) {
      reply(res, 503, 'Configure ADMIN_CHAT_PATH no servidor do chat.');
      return;
    }
    proxy(req, res, adminChatPath, null);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    reply(res, 404, 'Rota não encontrada.');
    return;
  }

  // O login e os comandos administrativos continuam sendo validados pelo n8n.
  // A página hospedada original do n8n permanece disponível como reserva.
  proxy(req, res, url.pathname + url.search, null,
    req.method === 'GET' && url.pathname === adminChatPath);
});

server.requestTimeout = 11 * 60 * 1000;
server.listen(port, '127.0.0.1', () => {
  console.log(`Chat do cliente: http://127.0.0.1:${port}`);
  console.log(`Administração: http://127.0.0.1:${port}/admin`);
});
