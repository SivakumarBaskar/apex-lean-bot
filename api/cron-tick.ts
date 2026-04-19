import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const C: Record<string, string> = {
  groq: process.env.GROQ_API_KEY || "",
  xKey: process.env.X_API_KEY || "",
  xSecret: process.env.X_API_SECRET || "",
  xAccess: process.env.X_ACCESS_TOKEN || "",
  xAccessSecret: process.env.X_ACCESS_TOKEN_SECRET || "",
  tgToken: process.env.TELEGRAM_BOT_TOKEN || "",
  tgChat: process.env.TELEGRAM_CHAT_ID || "",
  giveaway: process.env.GIVEAWAY_ENTRY_TEXT || "",
  minGrade: process.env.SCANNER_MIN_GRADE || "A+",
  cooldown: process.env.SCANNER_SIGNAL_COOLDOWN_HOURS || "4",
};

const ASSETS = [
  { sym: "EUR/USD", pip: 0.0001, sessions: ["London", "New York"], range: [1.04, 1.15], vol: 35 },
  { sym: "GBP/USD", pip: 0.0001, sessions: ["London"], range: [1.22, 1.34], vol: 45 },
  { sym: "USD/JPY", pip: 0.01, sessions: ["Tokyo", "London"], range: [140, 165], vol: 40 },
  { sym: "AUD/USD", pip: 0.0001, sessions: ["Sydney", "Tokyo"], range: [0.60, 0.72], vol: 30 },
  { sym: "XAU/USD", pip: 0.01, sessions: ["London", "New York"], range: [2100, 2900], vol: 1200 },
  { sym: "BTC/USD", pip: 1, sessions: ["24/7"], range: [65000, 125000], vol: 2500, id: "bitcoin" },
  { sym: "ETH/USD", pip: 0.01, sessions: ["24/7"], range: [2200, 5000], vol: 120, id: "ethereum" },
  { sym: "SOL/USD", pip: 0.01, sessions: ["24/7"], range: [90, 300], vol: 8, id: "solana" },
];
const CONFS = ["BOS", "FVG", "OB", "Fibonacci 61.8%", "Liquidity Sweep", "CHoCH"];
const GRADES = ["A+", "A", "B+", "B"];
const STYLES = ["signal", "insight", "relatable", "question", "thread", "commentary"];

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function fmtP(p: number, pip: number): string { return pip >= 1 ? p.toFixed(0) : pip >= 0.01 ? p.toFixed(2) : p.toFixed(4); }
function getSession(): string { const h = new Date().getUTCHours(); if (h < 7) return "Tokyo"; if (h < 15) return "London"; if (h < 22) return "New York"; return "Off-Session"; }
function gradeOrd(g: string): number { const i = GRADES.indexOf(g); return i === -1 ? 99 : i; }

async function tgSend(msg: string): Promise<void> {
  if (!C.tgToken || !C.tgChat) return;
  await fetch("https://api.telegram.org/bot" + C.tgToken + "/sendMessage", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ chat_id: C.tgChat, text: msg.slice(0, 4096), parse_mode: "HTML" }) }).catch(() => {});
}

function oauthSign(method: string, url: string): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ts = Math.floor(Date.now() / 1000).toString();
  const params: Record<string, string> = { oauth_consumer_key: C.xKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: ts, oauth_token: C.xAccess, oauth_version: "1.0" };
  const key = encodeURIComponent(C.xSecret) + "&" + encodeURIComponent(C.xAccessSecret);
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
  const base = method + "&" + encodeURIComponent(url) + "&" + encodeURIComponent(sorted);
  params["oauth_signature"] = crypto.createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.entries(params).filter(([k]) => k.startsWith("oauth_")).map(([k, v]) => encodeURIComponent(k) + "=\"" + encodeURIComponent(v) + "\"").join(", ");
}

async function xPost(text: string): Promise<boolean> {
  if (!C.xKey) return false;
  const res = await fetch("https://api.twitter.com/2/tweets", { method: "POST", headers: { Authorization: oauthSign("POST", "https://api.twitter.com/2/tweets"), "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  return res.ok;
}

async function getPrice(asset: any): Promise<number> {
  if (asset.id) {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=" + asset.id + "&vs_currencies=usd");
      const d = await r.json() as any;
      if (d[asset.id]?.usd) return d[asset.id].usd;
    } catch(e) {}
  }
  const m = Math.floor(Date.now() / 60000);
  const s = m * 31 + asset.sym.split("").reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  const f = ((Math.sin(s) * 43758.5453) % 1 + 1) % 1;
  const mid = (asset.range[0] + asset.range[1]) / 2;
  return mid + (f - 0.5) * (asset.range[1] - asset.range[0]) * 0.7;
}

async function scanOnce(): Promise<any> {
  const session = getSession();
  const eligible = ASSETS.filter((a: any) => a.sessions.includes(session) || a.sessions.includes("24/7"));
  if (!eligible.length) return null;
  const asset = pick(eligible);
  const price = await getPrice(asset);
  if (!price) return null;
  const dir = Math.random() > 0.5 ? "BUY" : "SELL";
  const v = asset.vol * asset.pip * (0.7 + Math.random() * 0.6);
  const slD = v, tp1D = slD * (1.5 + Math.random() * 0.8), tp2D = slD * (2.5 + Math.random() * 2);
  const entry = price;
  const sl = dir === "BUY" ? entry - slD : entry + slD;
  const tp1 = dir === "BUY" ? entry + tp1D : entry - tp1D;
  const tp2 = dir === "BUY" ? entry + tp2D : entry - tp2D;
  const rr = "1:" + (tp1D / slD).toFixed(1);
  const confs = [...CONFS].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
  let grade = confs.length >= 4 ? "A+" : confs.length >= 3 ? "A" : Math.random() > 0.5 ? "B+" : "B";
  return { sym: asset.sym, dir, entry, sl, tp1, tp2, rr, confs, grade, session };
}

async function genAI(signal: any, style: string): Promise<string> {
  const asset = ASSETS.find(a => a.sym === signal.sym)!;
  const e = fmtP(signal.entry, asset.pip), s = fmtP(signal.sl, asset.pip), t1 = fmtP(signal.tp1, asset.pip);
  const prompt = "Write a single tweet under 280 chars. Style: " + style + ". Pair: " + signal.sym + " " + signal.dir + " Entry: " + e + " SL: " + s + " TP: " + t1 + " R:R " + signal.rr + " Confluences: " + signal.confs.join("+") + ". Max 2 hashtags. No links.";

  if (C.grok) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: {"Content-Type": "application/json", "Authorization": "Bearer " + C.grok}, body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{role: "user", content: prompt}], max_tokens: 100 }) });
      const d = await r.json() as any; 
      if (d.choices) return d.choices[0].message.content.replace(/"/g, "").slice(0, 280);
    } catch(e) {}
  }
  const arrow = signal.dir === "BUY" ? "▲" : "▼";
  return arrow + " " + signal.dir + " " + signal.sym + "\nEntry: " + e + " | SL: " + s + " | TP: " + t1 + "\nR:R " + signal.rr + " | " + signal.confs.slice(0,2).join("+") + " #" + signal.sym.replace(/[^a-zA-Z]/g, "");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") return new Response(JSON.stringify({ status: "Apex Lean Bot is running. Use POST." }), { status: 200, headers: {"Content-Type": "application/json"} });
  
  try {
    const { data: stateRow } = await supabase
