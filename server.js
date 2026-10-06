require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000;

let db = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON && process.env.FIREBASE_DATABASE_URL) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
  }
} catch (e) {
  console.error("Firebase initialization failed:", e.message);
}

const botToken = process.env.BOT_TOKEN;
let bot = null;

if (botToken) {
  bot = new TelegramBot(botToken, { polling: true });
  bot.onText(/^\/start(?:\s+.*)?$/, (msg) => {
    const url = process.env.WEBAPP_URL;
    if (!url) return bot.sendMessage(msg.chat.id, "WEBAPP_URL is not configured.");
    bot.sendMessage(msg.chat.id, "🎬 Private Video Link", {
      reply_markup: {
        inline_keyboard: [[
          { text: "▶️ Open Private Video Link", web_app: { url } }
        ]]
      }
    });
  });
  bot.onText(/^\/help$/, (msg) => {
    bot.sendMessage(msg.chat.id, "Open the Mini App from /start.");
  });
}

app.get("/health", (req, res) => res.json({status:"ok", message:"Private Video Link is running!"}));

app.get("/api/config", async (req,res)=>{
  let settings = {};
  if (db) {
    try { settings = (await db.ref("settings/ads").once("value")).val() || {}; }
    catch(e) {}
  }
  res.json({
    provider: settings.provider || process.env.AD_PROVIDER || "adsgram",
    requiredAdsDefault: Number(settings.requiredAdsDefault || process.env.REQUIRED_ADS_DEFAULT || 3),
    adsgramBlockId: settings.adsgramBlockId || process.env.ADSGRAM_BLOCK_ID || "",
    monetagZoneId: settings.monetagZoneId || process.env.MONETAG_ZONE_ID || ""
  });
});

app.get("/api/videos", async (req,res)=>{
  if (!db) return res.json([]);
  try {
    const snap = await db.ref("videos").once("value");
    const raw = snap.val() || {};
    const videos = Object.entries(raw).map(([id,v])=>({id,...v})).filter(v=>v.active !== false);
    res.json(videos);
  } catch(e) { res.status(500).json({error:e.message}); }
});

function adminOk(req) {
  return !!process.env.ADMIN_KEY && req.headers["x-admin-key"] === process.env.ADMIN_KEY;
}

app.get("/api/admin/videos", async (req,res)=>{
  if (!adminOk(req)) return res.status(401).json({error:"Unauthorized"});
  if (!db) return res.json([]);
  const snap = await db.ref("videos").once("value");
  const raw = snap.val() || {};
  res.json(Object.entries(raw).map(([id,v])=>({id,...v})));
});

app.post("/api/admin/videos", async (req,res)=>{
  if (!adminOk(req)) return res.status(401).json({error:"Unauthorized"});
  if (!db) return res.status(500).json({error:"Firebase is not configured"});
  const v = req.body || {};
  if (!v.id) return res.status(400).json({error:"id is required"});
  await db.ref("videos/"+v.id).set({
    title:v.title||"Untitled",
    category:v.category||"General",
    section:v.section||"Premium",
    thumbnailUrl:v.thumbnailUrl||"",
    videoUrl:v.videoUrl||"",
    requiredAds:Number(v.requiredAds||3),
    views:Number(v.views||0),
    active:v.active !== false,
    createdAt:v.createdAt || Date.now()
  });
  res.json({ok:true});
});

app.delete("/api/admin/videos/:id", async (req,res)=>{
  if (!adminOk(req)) return res.status(401).json({error:"Unauthorized"});
  if (!db) return res.status(500).json({error:"Firebase is not configured"});
  await db.ref("videos/"+req.params.id).remove();
  res.json({ok:true});
});

app.get("/api/admin/settings", async (req,res)=>{
  if (!adminOk(req)) return res.status(401).json({error:"Unauthorized"});
  if (!db) return res.json({});
  const snap = await db.ref("settings/ads").once("value");
  res.json(snap.val() || {});
});

app.post("/api/admin/settings", async (req,res)=>{
  if (!adminOk(req)) return res.status(401).json({error:"Unauthorized"});
  if (!db) return res.status(500).json({error:"Firebase is not configured"});
  await db.ref("settings/ads").set({
    provider:req.body.provider || "adsgram",
    requiredAdsDefault:Number(req.body.requiredAdsDefault||3),
    adsgramBlockId:req.body.adsgramBlockId||"",
    monetagZoneId:req.body.monetagZoneId||""
  });
  res.json({ok:true});
});

app.listen(PORT, ()=>console.log(`Private Video Link running on ${PORT}`));
