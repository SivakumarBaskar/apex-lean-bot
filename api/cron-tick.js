import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const C = { grok: process.env.GROQ_API_KEY || "", xKey: process.env.X_API_KEY || "", xSecret: process.env.X_API_SECRET || "", xAccess: process.env.X_ACCESS_TOKEN || "", xAccessSecret: process.env.X_ACCESS_TOKEN_SECRET || "", tgToken: process.env.TELEGRAM_BOT_TOKEN || "", tgChat: process.env.TELEGRAM_CHAT_ID || "", minGrade: process.env.SCANNER_MIN_GRADE || "A+", cooldown: process.env.SCANNER_SIGNAL_COOLDOWN_HOURS || "4" };
const ASSETS = [
  { sym: "EUR/USD", pip: 0.0001, sessions: ["London", "New York"], range: [1.04, 1.15], vol: 35 }, { sym: "GBP/USD", pip: 0.0001, sessions: ["London"], range: [1.22, 1.34], vol: 45 }, { sym: "USD/JPY", pip: 0.01, sessions: ["Tokyo", "London"], range: [140, 165], vol: 40 }, { sym: "AUD/USD", pip: 0.0001, sessions: ["Sydney", "Tokyo"], range: [0.60, 0.72], vol: 30 }, { sym: "USD/CAD", pip: 0.0001, sessions: ["New York"], range: [1.30, 1.42], vol: 30 }, { sym: "NZD/USD", pip: 0.0001, sessions: ["Sydney", "London"], range: [0.58, 0.68], vol: 32 }, { sym: "USD/CHF", pip: 0.0001, sessions: ["London"], range: [0.82, 0.92], vol: 30 }, { sym: "SPX500", pip: 0.1, sessions: ["New York"], range: [5100, 5600], vol: 150 }, { sym: "NAS100", pip: 0.1, sessions: ["New York"], range: [18000, 20000], vol: 500 }, { sym: "US30", pip: 1, sessions: ["New York"], range: [38000, 42000], vol: 300 }, { sym: "XAU/USD", pip: 0.01, sessions: ["London", "New York"], range: [2100, 2900], vol: 1200 }, { sym: "BTC/USD", pip: 1, sessions: ["24/7"], range: [65000, 125000], vol: 2500, id: "bitcoin" }, { sym: "ETH/USD", pip: 0.01, sessions: ["24/7"], range: [2200, 5000], vol: 120, id: "ethereum" }, { sym: "SOL/USD", pip: 0.01, sessions: ["24/7"], range: [90, 300], vol: 8, id: "solana" }
];
const CONFS = ["Break of Structure", "Order Block retest", "Fair Value Gap fill", "0.618 Retrace", "Liquidity Sweep", "CHoCH"];
const GRADES = ["A+", "A", "B+", "B"]; 
const STYLES = ["signal", "insight", "relatable", "question", "thread", "commentary"];
const NON_SIGNAL_STYLES = ["insight", "relatable", "commentary", "thread"];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function fmtP(p, pip) { return pip >= 1 ? p.toFixed(0) : pip >= 0.01 ? p.toFixed(2) : p.toFixed(4); }
function getSession() { const h = new Date().getUTCHours(); if (h < 7) return "Tokyo"; if (h < 15) return "London"; if (h < 22) return "New York"; return "Off-Session"; }
function gradeOrd(g) { const i = GRADES.indexOf(g); return i === -1 ? 99 : i; }
async function tgSend(msg) { if (!C.tgToken || !C.tgChat) return; await fetch("https://api.telegram.org/bot" + C.tgToken + "/sendMessage", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ chat_id: C.tgChat, text: msg.slice(0, 4096), parse_mode: "HTML" }) }).catch(() => {}); }
function oauthSign(method, url, body = "") {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36); const ts = Math.floor(Date.now() / 1000).toString();
  const params = { oauth_consumer_key: C.xKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: ts, oauth_token: C.xAccess, oauth_version: "1.0" };
  if (body) params["oauth_body_hash"] = crypto.createHash("sha256").update(body).digest("base64");
  const key = encodeURIComponent(C.xSecret) + "&" + encodeURIComponent(C.xAccessSecret);
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
  const base = method + "&" + encodeURIComponent(url) + "&" + encodeURIComponent(sorted);
  params["oauth_signature"] = crypto.createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.entries(params).filter(([k]) => k.startsWith("oauth_")).map(([k, v]) => encodeURIComponent(k) + "=\"" + encodeURIComponent(v) + "\"").join(", ");
}
async function xPost(text) { if (!C.xKey) return false; const b = JSON.stringify({ text }); const res = await fetch("https://api.twitter.com/2/tweets", { method: "POST", headers: { Authorization: oauthSign("POST", "https://api.twitter.com/2/tweets", b), "Content-Type": "application/json" }, body: b }); return res.ok; }
async function getPrice(asset) { if (asset.id) { try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=" + asset.id + "&vs_currencies=usd"); const d = await r.json(); if (d[asset.id] && d[asset.id].usd) return d[asset.id].usd; } catch(e) {} } const m = Math.floor(Date.now() / 60000); const s = m * 31 + asset.sym.split("").reduce((a, c) => a + c.charCodeAt(0), 0); const f = ((Math.sin(s) * 43758.5453) % 1 + 1) % 1; const mid = (asset.range[0] + asset.range[1]) / 2; return mid + (f - 0.5) * (asset.range[1] - asset.range[0]) * 0.7; }
async function scanOnce() { const session = getSession(); const eligible = ASSETS.filter((a) => a.sessions.includes(session) || a.sessions.includes("24/7")); if (!eligible.length) return null; const asset = pick(eligible); const price = await getPrice(asset); if (!price) return null; const dir = Math.random() > 0.5 ? "BUY" : "SELL"; const v = asset.vol * asset.pip * (0.7 + Math.random() * 0.6); const slD = v, tp1D = slD * (1.5 + Math.random() * 0.8), tp2D = slD * (2.5 + Math.random() * 2); const entry = price; const sl = dir === "BUY" ? entry - slD : entry + slD; const tp1 = dir === "BUY" ? entry + tp1D : entry - tp1D; const tp2 = dir === "BUY" ? entry + tp2D : entry - tp2D; const rr = "1:" + (tp1D / slD).toFixed(1); const confs = [...CONFS].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2)); let grade = confs.length >= 4 ? "A+" : confs.length >= 3 ? "A" : Math.random() > 0.5 ? "B+" : "B"; return { sym: asset.sym, dir, entry, sl, tp1, tp2, rr, confs, grade, session }; }

async function getMetaStyle(allowedStyles) {
  try {
    const { data } = await supabase.from("signals").select("style, posted").eq("posted", true);
    if (data && data.length > 5) {
      const counts = {}; 
      for (const r of data) if (allowedStyles.includes(r.style)) counts[r.style] = (counts[r.style] || 0) + 1;
      let best = allowedStyles[0], max = 0;
      for (const [k, v] of Object.entries(counts)) { if (v > max) { max = v; best = k; } }
      return Math.random() > 0.3 ? best : pick(allowedStyles);
    }
  } catch(e) {}
  return pick(allowedStyles);
}

async function genAI(signal) {
  const asset = ASSETS.find(a => a.sym === signal.sym); const e = fmtP(signal.entry, asset.pip), s = fmtP(signal.sl, asset.pip), t1 = fmtP(signal.tp1, asset.pip); const htf = signal.dir === "BUY" ? "BULLISH" : "BEARISH"; 
  const prompt = "Write a single tweet under 280 chars. Pure Price Action + Market Structure.\n" + signal.dir + " " + signal.sym + "\nHTF Bias: " + htf + "\nEntry: " + e + " (0.618 retrace)\nSL: " + s + " | TP1: " + t1 + "\nR:R: " + signal.rr + "\nTrigger: " + signal.confs.join(" + ") + "\nRules: Sprinkle emojis (😎 📍 🚀 🛡️ 🎯) between sections. NO ICT/SMC jargon. NO links. Max 2 hashtags."; 
  if (C.grok) { try { const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: {"Content-Type": "application/json", "Authorization": "Bearer " + C.grok}, body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{role: "user", content: prompt}], max_tokens: 150 }) }); const d = await r.json(); if (d.choices && d.choices[0]) return d.choices[0].message.content.replace(/"/g, "").slice(0, 280); } catch(e) {} } 
  const arrow = signal.dir === "BUY" ? "🟢" : "🔴"; return arrow + " APEX SIGNAL — " + signal.sym + "\nHTF Bias: " + htf + " 😎\nEntry: " + e + " 📍\nSL: " + s + " | TP1: " + t1 + " 🚀\nR:R " + signal.rr + "\nTrigger: " + signal.confs.slice(0,2).join(" + ") + " 🛡️\nPure Price Action";
}

// NEW: Generate non-signal tweets (Insight, Relatable, Commentary, Thread)
async function genFallbackAI(style) {
  let prompt = "";
  if (style === "insight") prompt = "Write a short, professional market insight about recent price action structure, HTF bias, or liquidity sweeps. Do NOT give a specific trade entry/SL. Max 280 chars. Sprinkle emojis like 📊 💡 🛡️.";
  else if (style === "relatable") prompt = "Write a relatable tweet about a trader waiting patiently for a setup, dealing with FOMO, or staring at charts. Funny but professional. Max 280 chars. Sprinkle emojis like 😌 🎯 😂.";
  else if (style === "commentary") prompt = "Write a brief market commentary on session volatility or structure. No specific trade. Max 280 chars. Sprinkle emojis like 🧠 🔥 📈.";
  else if (style === "thread") prompt = "Write the FIRST tweet of a 3-tweet thread teasing a Pure Price Action concept (e.g., how to read liquidity sweeps). End with 'Thread below 🧵'. Max 280 chars.";
  else prompt = "Write a short trading thought. Max 280 chars.";

  if (C.grok) { try { const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: {"Content-Type": "application/json", "Authorization": "Bearer " + C.grok}, body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{role: "user", content: prompt}], max_tokens: 100 }) }); const d = await r.json(); if (d.choices && d.choices[0]) return d.choices[0].message.content.replace(/"/g, "").slice(0, 280); } catch(e) {} }
  return "Discipline over FOMO. Wait for structure to align. 🛡️";
}

export default async function handler(req) {
  try {
    const { data: state } = await supabase.from("bot_state").select("key, value").in("key", ["lastSigTs", "lastFallbackTs"]);
    const stateMap = {}; if (state) for (const r of state) stateMap[r.key] = parseInt(r.value || "0");
    
    const lastTs = stateMap["lastSigTs"] || 0;
    const lastFallback = stateMap["lastFallbackTs"] || 0;
    const coolMs = parseInt(C.cooldown) * 3600000;
    const fallbackCoolMs = 2 * 3600000; // 2 hour cooldown for non-signals

    // If both are in cooldown, do nothing
    
    // Try to find an A+ Signal
    for (let i = 0; i < 10; i++) {
      const sig = await scanOnce();
      if (!sig || gradeOrd(sig.grade) > gradeOrd(C.minGrade)) continue;
      
      await supabase.from("bot_state").upsert({ key: "lastSigTs", value: Date.now().toString() });
      const style = await getMetaStyle(STYLES);
      const content = await genAI(sig);
      
      await supabase.from("signals").insert({ symbol: sig.sym, direction: sig.dir, entry: sig.entry, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2, rr: sig.rr, confluences: sig.confs.join(","), grade: sig.grade, session: sig.session, style, content, posted: false });
      
      if (content) {
        const posted = await xPost(content);
        if (posted) {
          await supabase.from("signals").update({ posted: true }).eq("symbol", sig.sym).order("created_at", { ascending: false }).limit(1).single();
          await supabase.from("logs").insert({ type: "SIGNAL", message: sig.dir + " " + sig.sym, details: content, success: true });
          await tgSend("✅ <b>Signal Posted</b>\n" + sig.dir + " " + sig.sym + " [" + sig.grade + "]\n" + content);
        }
      }
    }

    // NO SIGNAL FOUND -> Post a Fallback Tweet (Insight/Relatable/Commentary/Thread)
    if (!lastFallback || Date.now() - lastFallback >= fallbackCoolMs) {
      const fallbackStyle = await getMetaStyle(NON_SIGNAL_STYLES);
      const fallbackContent = await genFallbackAI(fallbackStyle);
      
      const posted = await xPost(fallbackContent);
      if (posted) {
        await supabase.from("bot_state").upsert({ key: "lastFallbackTs", value: Date.now().toString() });
        await supabase.from("logs").insert({ type: "FALLBACK", message: fallbackStyle, details: fallbackContent, success: true });
        await tgSend("📝 <b>Fallback Posted</b> (" + fallbackStyle + ")\n" + fallbackContent);
        return new Response(JSON.stringify({ status: "posted", type: fallbackStyle }), { status: 200, headers: {"Content-Type": "application/json"} });
      }
    }

    return new Response(JSON.stringify({ status: "no_signal" }), { status: 200, headers: {"Content-Type": "application/json"} });
  } catch (e) {
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: {"Content-Type": "application/json"} });
  }
}
