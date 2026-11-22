import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import { classifyStock, validateStockOrder } from './src/domain/rules.mjs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./web', import.meta.url));
const port = Number(process.env.PORT || 8787);
const decisionFile = join(root, '..', 'decisions.json');
const accountFile = join(root, '..', 'accounts.json');
const usersFile = join(root, '..', 'users.json');
const usersDataDir = join(root, '..', 'data', 'tenants');
const sessions = new Map();

async function readDecisions(req) { const userId = req ? sessionUser(req) : null; const target = userId ? join(usersDataDir, userId, 'research', 'decisions.json') : decisionFile; try { return JSON.parse(await readFile(target, 'utf8')); } catch { return []; } }
async function saveDecisions(req, decisions) { const userId = sessionUser(req); const target = userId ? join(usersDataDir, userId, 'research', 'decisions.json') : decisionFile; await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, JSON.stringify(decisions, null, 2), 'utf8'); }

async function readAccounts(req) {
  const userId = req ? sessionUser(req) : null;
  const target = userId ? join(usersDataDir, userId, 'account.json') : accountFile;
  try { return JSON.parse(await readFile(target, 'utf8')); } catch { return { mode: 'beginner', unlimitedCash: true, cash: 200000, positions: [], trades: [] }; }
}
async function saveAccounts(req, account) { const userId = sessionUser(req); const target = userId ? join(usersDataDir, userId, 'account.json') : accountFile; await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, JSON.stringify(account, null, 2), 'utf8'); }
async function readUserSettings(req) { const userId = sessionUser(req); if (!userId) return {}; const target = join(usersDataDir, userId, 'settings.json'); try { return JSON.parse(await readFile(target, 'utf8')); } catch { return {}; } }
async function saveUserSettings(req, settings) { const userId = sessionUser(req); if (!userId) throw new Error('未登录'); const target = join(usersDataDir, userId, 'settings.json'); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, JSON.stringify(settings, null, 2), 'utf8'); }

async function readUsers() { try { return JSON.parse(await readFile(usersFile, 'utf8')); } catch { return []; } }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function sessionUser(req) { const token = (req.headers.cookie || '').match(/session=([^;]+)/)?.[1]; return token ? sessions.get(token) : null; }
function shanghaiTime() { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
function inTradingSession() { const value = shanghaiTime(); const minutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900); }

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
let runtimeTushareToken = process.env.TUSHARE_TOKEN || '';
const llmProvider = process.env.LLM_PROVIDER || (process.env.DEEPSEEK_API_KEY ? 'deepseek' : 'openai');
const llmApiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
const llmBaseUrl = (process.env.DEEPSEEK_API_KEY ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1') : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')).replace(/\/$/, '');
const llmModel = process.env.DEEPSEEK_API_KEY ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat') : (process.env.OPENAI_MODEL || 'gpt-4o-mini');

function tsCode(symbol) {
  const code = symbol.trim().toUpperCase();
  if (code.includes('.')) return code;
  return /^(6|68|9)/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

function classifyAsset(symbol, type = 'stock') {
  const code = symbol.trim().toUpperCase();
  if (type !== 'stock') return { instrumentType: type, market: code.startsWith('51') || code.startsWith('58') ? 'SSE' : 'SZSE', board: null, status: 'normal' };
  if (/^(68)/.test(code)) return { instrumentType: 'stock', market: 'SSE', board: 'STAR', status: 'normal', buyLot: 200, limitPct: 20 };
  if (/^(30)/.test(code)) return { instrumentType: 'stock', market: 'SZSE', board: 'CHINEXT', status: 'normal', buyLot: 100, limitPct: 20 };
  if (/^(8|4)/.test(code)) return { instrumentType: 'stock', market: 'BSE', board: 'BSE', status: 'normal', buyLot: 100, limitPct: 30 };
  if (/^(6)/.test(code)) return { instrumentType: 'stock', market: 'SSE', board: 'MAIN', status: 'normal', buyLot: 100, limitPct: 10 };
  return { instrumentType: 'stock', market: 'SZSE', board: 'MAIN', status: 'normal', buyLot: 100, limitPct: 10 };
}

async function tushare(apiName, params, fields, token = runtimeTushareToken) {
  if (!token) throw new Error('未设置 Tushare Token');
  const response = await fetch('https://api.tushare.pro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
  });
  if (!response.ok) throw new Error(`Tushare HTTP ${response.status}`);
  const body = await response.json();
  if (body.code !== 0) throw new Error(body.msg || `Tushare ${apiName} failed`);
  return body.data;
}

function secid(symbol) {
  const code = symbol.trim().toUpperCase();
  if (/^(6|68|9)/.test(code)) return `1.${code}`;
  return `0.${code}`;
}

async function eastmoney(path) {
  const response = await fetch(`https://push2.eastmoney.com${path}`, {
    headers: { 'User-Agent': 'investment-decision-mvp/0.1' },
  });
  if (!response.ok) throw new Error(`market data HTTP ${response.status}`);
  return response.json();
}

async function tokenFor(req) { return (await readUserSettings(req)).tushareToken || runtimeTushareToken; }

async function quote(symbol, req) {
  const token = await tokenFor(req);
  if (token) {
    try { const data = await tushare('rt_k', { ts_code: tsCode(symbol) }, 'ts_code,name,pre_close,high,open,low,close,vol', token); const row = data?.items?.[0]; if (row) { const current = Number(row[6]); const previous = Number(row[2]); return { f57: row[0], f58: row[1], f43: current * 100, f44: Number(row[3]) * 100, f45: Number(row[5]) * 100, f46: Number(row[4]) * 100, f60: previous * 100, f169: (current - previous) * 100, f170: previous ? (current - previous) / previous * 10000 : 0, f47: row[7], source: 'tushare-rt_k' }; } } catch {}
  }
  const fields = 'f57,f58,f43,f46,f44,f45,f47,f48,f60,f169,f170';
  try {
    const data = await eastmoney(`/api/qt/stock/get?secid=${secid(symbol)}&fields=${fields}`);
    if (data.data) return data.data;
  } catch {}
  const code = symbol.trim().toUpperCase();
  const marketCode = /^(6|68|9)/.test(code) ? `sh${code}` : `sz${code}`;
  const response = await fetch(`https://qt.gtimg.cn/q=${marketCode}`, { headers: { 'User-Agent': 'investment-decision-mvp/0.1' } });
  if (!response.ok) throw new Error(`A 股行情源不可用（${response.status}）`);
  const text = await response.text();
  const match = text.match(/="([^"]*)"/);
  if (!match) throw new Error(`找不到 A 股标的 ${symbol}`);
  const values = match[1].split('~');
  if (!values[1] || !values[3]) throw new Error(`找不到 A 股标的 ${symbol}`);
  const current = Number(values[3]);
  const previous = Number(values[4]);
  return { f57: code, f58: values[1], f43: current, f60: previous, f170: previous ? ((current - previous) / previous) * 10000 : 0, f47: values[36] || '0', source: 'tencent-fallback' };
}

async function history(symbol, req) {
  const token = await tokenFor(req);
  if (token) {
    try { const data = await tushare('daily', { ts_code: tsCode(symbol), start_date: '20200101', end_date: '20500101' }, 'trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount', token); return { symbol: symbol.toUpperCase(), source: 'tushare', klines: data?.items || [] }; } catch {}
  }
  const code = symbol.trim().toUpperCase();
  const market = secid(code).split('.')[0];
  const url = `/api/qt/stock/kline/get?secid=${secid(code)}&klt=101&fqt=1&beg=20200101&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
  const data = await eastmoney(url);
  if (!data.data?.klines) throw new Error(`没有找到 ${code} 的历史行情`);
  return { symbol: code, market, klines: data.data.klines };
}

async function research(symbol, req) {
  const [current, historical] = await Promise.all([quote(symbol, req), history(symbol, req)]);
  const closeIndex = historical.source === 'tushare' ? 4 : 2;
  const rows = historical.klines.slice(-60).map((line) => {
    const parts = String(line).split(',');
    return { date: parts[0], close: Number(parts[closeIndex]) };
  }).filter((row) => Number.isFinite(row.close));
  const first = rows[0]?.close;
  const last = rows.at(-1)?.close;
  let peak = 0;
  let maxDrawdown = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.close);
    if (peak) maxDrawdown = Math.min(maxDrawdown, (row.close / peak - 1) * 100);
  }
  return {
    symbol: current.f57,
    name: current.f58,
    quote: current,
    history: rows,
    metrics: {
      lookbackDays: rows.length,
      changePct: first ? (last / first - 1) * 100 : null,
      maxDrawdownPct: maxDrawdown,
    },
  };
}

async function financials(symbol, req) {
  const code = tsCode(symbol);
  const token = await tokenFor(req);
  if (!token) return { source: 'unavailable', items: [], message: '请在数据源设置中配置 Tushare Token' };
  const data = await tushare('fina_indicator', { ts_code: code }, 'ts_code,ann_date,end_date,revenue,operate_profit,netprofit,eps,roe,ocf_yoy', token);
  return { source: 'tushare', items: data?.items || [] };
}

async function announcements(symbol, req) {
  const code = tsCode(symbol);
  const token = await tokenFor(req);
  if (!token) return { source: 'unavailable', items: [], message: '请在数据源设置中配置 Tushare Token' };
  const data = await tushare('anns_d', { ts_code: code, start_date: '20200101', end_date: '20500101' }, 'ts_code,ann_date,ann_type,summary', token);
  return { source: 'tushare', items: data?.items || [] };
}

async function evaluation(req) {
  const decisions = await readDecisions(req);
  const reviewed = decisions.filter((item) => item.status === 'reviewed');
  const pnl = reviewed.reduce((sum, item) => {
    if (!item.entryPrice || !item.quantity || !item.currentPrice) return sum;
    const direction = item.action === 'sell' ? -1 : 1;
    return sum + (item.currentPrice - item.entryPrice) * item.quantity * direction;
  }, 0);
  return {
    total: decisions.length,
    open: decisions.filter((item) => item.status === 'open').length,
    reviewed: reviewed.length,
    valid: reviewed.filter((item) => item.outcome === 'valid').length,
    invalid: reviewed.filter((item) => item.outcome === 'invalid').length,
    uncertain: reviewed.filter((item) => item.outcome === 'uncertain').length,
    validityRate: reviewed.length ? reviewed.filter((item) => item.outcome === 'valid').length / reviewed.length : null,
    simulatedPnl: pnl,
    generatedAt: new Date().toISOString(),
  };
}

async function portfolio(req) {
  const account = await readAccounts(req);
  const positions = await Promise.all((account.positions || []).map(async (position) => {
    const quote = await quoteForPortfolio(position.symbol, req);
    const current = Number(quote.f43 || 0) / 100;
    const marketValue = current * Number(position.quantity || 0);
    const cost = Number(position.costPrice || 0) * Number(position.quantity || 0);
    return { ...position, currentPrice: current, marketValue, cost, unrealizedPnl: marketValue - cost, quote: { name: quote.f58, changePct: Number(quote.f170 || 0) / 100 } };
  }));
  const totalCost = positions.reduce((sum, item) => sum + item.cost, 0);
  const marketValue = positions.reduce((sum, item) => sum + item.marketValue, 0);
  const unrealizedPnl = marketValue - totalCost;
  return { mode: account.mode, unlimitedCash: Boolean(account.unlimitedCash), cash: Number(account.cash || 0), cashDisplay: account.unlimitedCash ? '无限模拟资金' : Number(account.cash || 0), positions, marketValue, totalCost, unrealizedPnl, returnPct: totalCost ? unrealizedPnl / totalCost * 100 : 0 };
}

async function quoteForPortfolio(symbol, req) {
  return quote(symbol, req);
}

async function placeOrder(req, order) {
  const account = await readAccounts(req);
  const symbol = String(order.symbol || '').trim().toUpperCase();
  const asset = classifyStock(symbol);
  const quantity = Number(order.quantity);
  if (!symbol || !Number.isFinite(quantity) || quantity <= 0) throw new Error('股票代码和数量必须有效');
  if (!inTradingSession()) throw new Error('当前不在沪深 A 股连续竞价交易时段（09:30-11:30、13:00-15:00）');
  const quoteData = await quote(symbol, req);
  validateStockOrder({ symbol, side: order.side, quantity, price: Number(order.price) || Number(quoteData.f43 || 0) / 100, previousClose: Number(quoteData.f60 || 0) / 100 });
  const price = Number(order.price) || Number(quoteData.f43 || 0) / 100;
  const previousClose = Number(quoteData.f60 || 0) / 100;
  if (price <= 0 || Math.round(price * 100) !== price * 100) throw new Error('A 股委托价格最小变动单位为 0.01 元');
  if (order.side === 'buy' && quantity % asset.buyLot !== 0) throw new Error(`${asset.board} 买入数量必须是 ${asset.buyLot} 的整数倍`);
  if (previousClose > 0 && Math.abs(price / previousClose - 1) > asset.limitPct / 100 + 0.001) throw new Error(`${asset.board} 委托价格超出涨跌停范围`);
  const amount = price * quantity;
  const index = (account.positions || []).findIndex((item) => item.symbol === symbol);
  let realizedPnl = 0;
  if (order.side === 'buy') {
    const fee = Math.max(amount * 0.0003, 5);
    const total = amount + fee;
    if (!account.unlimitedCash) {
      if (Number(account.cash || 0) < total) throw new Error('现金余额不足（含手续费）');
      account.cash = Number(account.cash || 0) - total;
    }
    if (index >= 0) { const item = account.positions[index]; const total = item.quantity * item.costPrice + amount; item.quantity += quantity; item.costPrice = total / item.quantity; }
    else account.positions.push({ symbol, quantity, costPrice: price, availableQuantity: 0, boughtAt: new Date().toISOString().slice(0, 10) });
  } else if (order.side === 'sell') {
    if (index < 0 || account.positions[index].quantity < quantity) throw new Error('持仓数量不足');
    const item = account.positions[index]; const available = item.availableQuantity ?? item.quantity; if (available < quantity) throw new Error('T+1：今日买入的股票不可卖出'); const remainder = available % asset.buyLot; if (quantity % asset.buyLot !== 0 && quantity !== remainder && quantity !== available) throw new Error('卖出零股必须一次性卖出剩余零股'); const fee = Math.max(amount * 0.0003, 5) + amount * 0.001; realizedPnl = (price - item.costPrice) * quantity - fee; if (!account.unlimitedCash) account.cash = Number(account.cash || 0) + amount - fee; item.quantity -= quantity; item.availableQuantity -= quantity; if (!item.quantity) account.positions.splice(index, 1);
  } else throw new Error('side 必须是 buy 或 sell');
  account.trades = account.trades || [];
  account.trades.unshift({ id: crypto.randomUUID(), symbol, side: order.side, quantity, price, amount, fee: order.side === 'buy' ? Math.max(amount * 0.0003, 5) : Math.max(amount * 0.0003, 5) + amount * 0.001, realizedPnl, time: new Date().toISOString(), status: 'filled' });
  account.realizedPnl = Number(account.realizedPnl || 0) + realizedPnl;
  account.cashLedger = account.cashLedger || [];
  account.cashLedger.unshift({ time: new Date().toISOString(), type: order.side, symbol, amount, fee: order.side === 'buy' ? Math.max(amount * 0.0003, 5) : Math.max(amount * 0.0003, 5) + amount * 0.001, realizedPnl, cashAfter: account.cash });
  await saveAccounts(req, account);
  return { order: account.trades[0], portfolio: await portfolio(req) };
}

async function analyze(req, symbol, reason) {
  const settings = await readUserSettings(req);
  const apiKey = settings.deepseekApiKey || llmApiKey;
  const baseUrl = (settings.deepseekBaseUrl || llmBaseUrl).replace(/\/$/, '');
  const model = settings.deepseekModel || llmModel;
  if (!apiKey) throw new Error('未设置 DeepSeek API Key');
  const snapshot = await research(symbol, req);
  const prompt = [
    `标的：${snapshot.name || symbol}`,
    `当前行情：${JSON.stringify(snapshot.quote)}`,
    `近60日指标：${JSON.stringify(snapshot.metrics)}`,
    `用户原始理由：${reason}`,
  ].join('\n');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: '你是投资研究助手。只基于提供的数据分析，不承诺收益。严格区分事实、推断和未知信息。输出 JSON，字段为 facts、inferences、counter_arguments、risks、invalidation_conditions、next_checks。' },
      { role: 'user', content: prompt },
    ] }),
  });
  if (!response.ok) throw new Error(`大模型请求失败 HTTP ${response.status}`);
  const body = await response.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('大模型没有返回内容');
  try { return { provider: 'deepseek', model, analysis: JSON.parse(content), snapshot }; }
  catch { return { provider: 'deepseek', model, analysis: { raw: content }, snapshot }; }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'investment-mvp', dataSource: runtimeTushareToken ? 'tushare' : 'not-configured', time: new Date().toISOString() });
    if (url.pathname === '/api/settings/tushare' && req.method === 'GET') { const settings = await readUserSettings(req); return json(res, 200, { configured: Boolean(settings.tushareToken) }); }
    if (url.pathname === '/api/settings/tushare' && req.method === 'POST') { const body = await readBody(req); if (!body.token || body.token.length < 10) return json(res, 400, { error: 'Token 格式不正确' }); const settings = await readUserSettings(req); settings.tushareToken = body.token.trim(); await saveUserSettings(req, settings); runtimeTushareToken = settings.tushareToken; return json(res, 200, { ok: true, configured: true }); }
    if (url.pathname === '/api/settings/deepseek' && req.method === 'POST') { const body = await readBody(req); if (!body.apiKey || body.apiKey.length < 10) return json(res, 400, { error: 'DeepSeek Key 格式不正确' }); const settings = await readUserSettings(req); settings.deepseekApiKey = body.apiKey.trim(); settings.deepseekBaseUrl = body.baseUrl || 'https://api.deepseek.com/v1'; settings.deepseekModel = body.model || 'deepseek-chat'; await saveUserSettings(req, settings); return json(res, 200, { ok: true, configured: true }); }
    if (url.pathname === '/api/auth/register' && req.method === 'POST') { const body=await readBody(req); const users=await readUsers(); if(!body.username||!body.password) return json(res,400,{error:'用户名和密码必填'}); if(users.some(u=>u.username===body.username)) return json(res,409,{error:'用户名已存在'}); const p=hashPassword(body.password); const user={id:crypto.randomUUID(),username:body.username,salt:p.salt,hash:p.hash}; users.push(user); await writeFile(usersFile,JSON.stringify(users,null,2)); await mkdir(join(usersDataDir,user.id),{recursive:true}); await writeFile(join(usersDataDir,user.id,'account.json'),JSON.stringify({mode:'beginner',unlimitedCash:true,cash:200000,positions:[],trades:[]},null,2)); return json(res,201,{ok:true}); }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') { const body=await readBody(req); const users=await readUsers(); const user=users.find(u=>u.username===body.username); if(!user) return json(res,401,{error:'用户名或密码错误'}); const check=crypto.scryptSync(body.password,user.salt,64).toString('hex'); if(check!==user.hash) return json(res,401,{error:'用户名或密码错误'}); const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,user.id); res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':`session=${token}; HttpOnly; SameSite=Lax; Path=/`}); return res.end(JSON.stringify({ok:true,username:user.username})); }
    if (url.pathname === '/api/auth/me' && req.method === 'GET') { const id=sessionUser(req); return json(res,200,{authenticated:Boolean(id),userId:id}); }
    if (url.pathname === '/api/decisions' && req.method === 'GET') return json(res, 200, await readDecisions(req));
    if (url.pathname === '/api/decisions' && req.method === 'POST') {
      const decision = await readBody(req);
      if (!decision.id || !decision.symbol || !decision.reason) return json(res, 400, { error: 'id、symbol、reason 必填' });
      const decisions = await readDecisions(req);
      const next = [decision, ...decisions.filter((item) => item.id !== decision.id)];
      await saveDecisions(req, next);
      return json(res, 201, decision);
    }
    if (url.pathname === '/api/evaluation') return json(res, 200, await evaluation(req));
    if (url.pathname === '/api/account' && req.method === 'GET') return json(res, 200, await readAccounts(req));
    if (url.pathname === '/api/account' && req.method === 'POST') {
      const account = await readBody(req);
      if (!['beginner', 'experienced'].includes(account.mode)) return json(res, 400, { error: 'mode 必须是 beginner 或 experienced' });
      if (!Array.isArray(account.positions)) return json(res, 400, { error: 'positions 必须是数组' });
      await saveAccounts(req, account);
      return json(res, 201, account);
    }
    if (url.pathname === '/api/portfolio' && req.method === 'GET') return json(res, 200, await portfolio(req));
    if (url.pathname === '/api/orders' && req.method === 'POST') return json(res, 201, await placeOrder(req, await readBody(req)));
    if (url.pathname === '/api/orders' && req.method === 'GET') { const account = await readAccounts(req); return json(res, 200, account.trades || []); }
    if (url.pathname === '/api/quotes' && req.method === 'GET') { const symbols = (url.searchParams.get('symbols') || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 50); const quotes = await Promise.all(symbols.map(async (symbol) => { try { return await quote(symbol, req); } catch (error) { return { symbol, error: error.message }; } })); return json(res, 200, quotes); }
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.symbol || !body.reason) return json(res, 400, { error: 'symbol 和 reason 必填' });
      const result = await analyze(req, body.symbol, body.reason);
      const settings = await readUserSettings(req);
      settings.lastAnalysis = { symbol: body.symbol, reason: body.reason, result, createdAt: new Date().toISOString() };
      await saveUserSettings(req, settings);
      return json(res, 200, result);
    }
    if (url.pathname === '/api/quote') return json(res, 200, await quote(url.searchParams.get('symbol') || '', req));
    if (url.pathname === '/api/asset-info') return json(res, 200, classifyAsset(url.searchParams.get('symbol') || '', url.searchParams.get('type') || 'stock'));
    if (url.pathname === '/api/history') return json(res, 200, await history(url.searchParams.get('symbol') || ''));
    if (url.pathname === '/api/research') return json(res, 200, await research(url.searchParams.get('symbol') || '', req));
    if (url.pathname === '/api/financials') return json(res, 200, await financials(url.searchParams.get('symbol') || '', req));
    if (url.pathname === '/api/announcements') return json(res, 200, await announcements(url.searchParams.get('symbol') || '', req));
    const requested = normalize(url.pathname === '/' ? '/dashboard.html' : url.pathname);
    const file = join(root, requested);
    if (!file.startsWith(root)) return json(res, 403, { error: 'forbidden' });
    const body = await readFile(file);
    const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Investment MVP running at http://localhost:${port}`));




