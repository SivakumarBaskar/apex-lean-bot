import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const C = { 
  grok: process.env.GROK_API_KEY || "", xKey: process.env.X_API_KEY || "", xSecret: process.env.X_API_SECRET || "", 
  xAccess: process.env.X_ACCESS_TOKEN || "", xAccessSecret: process.env.X_ACCESS_TOKEN_SECRET || "", 
  tgToken: process.env.TELEGRAM_BOT_TOKEN || "", tgChat: process.env.TELEGRAM_CHAT_ID || "",
  moonBtc: process.env.MOONPAY_BTC || "", moonSol: process.env.MOONPAY_SOL || ""
};

function oauthSign(method, url, body) {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ts = Math.floor(Date.now() / 1000).toString();
  const params = { 
    oauth_consumer_key: C.xKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", 
    oauth_timestamp: ts, oauth_token: C.xAccess, oauth_version: "1.0" 
  };
  if (body) {
    params["oauth_body_hash"] = crypto.createHash("sha256").update(body).digest("base64");
  }
  const key = encodeURIComponent(C.xSecret) + "&" + encodeURIComponent(C.xAccessSecret);
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
  const base = method + "&" + encodeURIComponent(url) + "&" + encodeURIComponent(sorted);
  params["oauth_signature"] = crypto.createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.entries(params).filter(([k]) => k.startsWith("oauth_")).map(([k, v]) => encodeURIComponent(k) + "=\"" + encodeURIComponent(v) + "\"").join(", ");
}

async function tgSend(msg) { 
  if (!C.tgToken || !C.tgChat) return; 
  await fetch("https://api.telegram.org/bot" + C.tgToken + "/sendMessage", { 
    method: "POST", headers: {"Content-Type": "application/json"}, 
    body: JSON.stringify({ chat_id: C.tgChat, text: msg.slice(0, 4096), parse_mode: "HTML" }) 
  }).catch(() => {}); 
}

async function xApi(method, url, body) {
  const res = await fetch(url, { 
    method, 
    headers: { Authorization: oauthSign(method, url, body), "Content-Type": "application/json" }, 
    body: body || undefined 
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown X Error");
    throw new Error("X API " + res.status + ": " + errText.slice(0, 150));
  }
  return await res.json();
}

export default async function handler(req) {
  const url = new URL(req.url);
  const rawUrl = url.searchParams.get("url") || "";
  const match = rawUrl.match(/status\/(\d+)/);
  const tweetId = match ? match[1] : rawUrl;

  if (!tweetId) return new Response(JSON.stringify({ error: "Missing url" }), { status: 400 });

  try {
    // 1. Get Tweet and Author Info
    const apiUrl = "https://api.twitter.com/2/tweets/" + tweetId + "?tweet.fields=text,author_id&expansions=author_id&user.fields=username,name,description";
    const data = await xApi("GET", apiUrl);
    
    if (!data.data || !data.includes || !data.includes.users) {
      return new Response(JSON.stringify({ error: "Could not read tweet or author" }), { status: 400 });
    }
    
    const tweet = data.data;
    const author = data.includes.users[0];
    const username = author.username.toLowerCase();
    const tweetText = tweet.text;

    // 2. Determine Payload & Type
    let payload = "";
    let isGiveaway = false;

    if (username.includes("metawin") || username.includes("menance")) {
      payload = "ID: SivakumarBaskar";
      isGiveaway = true;
    } else if (username.includes("moonpay")) {
      if (tweetText.toLowerCase().includes("sol") || tweetText.toLowerCase().includes("solana")) {
        payload = "SOL Wallet: " + (C.moonSol || "Not set in Vercel");
      } else {
        payload = "BTC Wallet: " + (C.moonBtc || "Not set in Vercel");
      }
      isGiveaway = true;
    }

    // 3. Generate AI Comment (Contextual for EVERYONE)
    let aiComment = "";
    let prompt = "";

    if (isGiveaway) {
      prompt = "You are an excited trader entering a giveaway from @" + username + ". Read their exact tweet. Write a very short, natural 1-sentence comment reacting to what they are giving away or the rules they mentioned. Do NOT include any ID or wallet address in your response. Max 40 words.";
    } else {
      prompt = "You are elite trader @SivakumarBMS. Read @" + username + " tweet. Write a VERY SHORT, human-sounding reply (max 40 words). Agree or add a quick Price Action insight. No hashtags.";
    }

    if (C.grok) {
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { 
          method: "POST", 
          headers: {"Content-Type": "application/json", "Authorization": "Bearer " + C.grok}, 
          body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{role: "user", content: prompt}], max_tokens: 60 }) 
        });
        const d = await r.json();
        if (d.choices && d.choices[0]) aiComment = d.choices[0].message.content.replace(/["]/g, "").trim();
      } catch(e) { /* AI fail is non-fatal */ }
    }
    
    // Fallback if AI fails
    if (!aiComment) {
      aiComment = isGiveaway ? "Awesome giveaway, thanks for doing this! 🔥" : "This. 👆";
    }

    // 4. Combine: AI Comment + Payload (Guarantees correct formatting)
    const finalText = isGiveaway ? (aiComment + "\n\n" + payload) : aiComment;

    // 5. Post the Reply
    const bodyStr = JSON.stringify({ text: finalText, reply: { in_reply_to_tweet_id: tweetId } });
    const postRes = await fetch("https://api.twitter.com/2/tweets", { 
      method: "POST", 
      headers: { Authorization: oauthSign("POST", "https://api.twitter.com/2/tweets", bodyStr), "Content-Type": "application/json" }, 
      body: bodyStr 
    });

    if (postRes.ok) {
      await tgSend("🚀 <b>Sniped @" + username + "</b>\n" + finalText);
      return new Response(JSON.stringify({ status: "replied", target: username }), { status: 200 });
    } else {
      const err = await postRes.text();
      await tgSend("❌ Snipe Failed: " + err.slice(0, 100));
      return new Response(JSON.stringify({ error: err }), { status: 500 });
    }

  } catch (e) {
    const msg = e && e.message ? e.message : "Unknown error";
    await tgSend("❌ Snipe Error: " + msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
