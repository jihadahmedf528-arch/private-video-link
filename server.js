require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");

const app = express();

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000;

/* =========================
   FIREBASE
========================= */

let db = null;

try {
  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON &&
    process.env.FIREBASE_DATABASE_URL
  ) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });

    db = admin.database();

    console.log("Firebase connected");
  } else {
    console.log("Firebase environment variables are missing");
  }
} catch (error) {
  console.error("Firebase error:", error.message);
}

/* =========================
   TELEGRAM BOT
========================= */

let bot = null;

if (process.env.BOT_TOKEN) {
  bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
  });

  bot.onText(/^\/start(?:\s+.*)?$/, async (msg) => {
    const chatId = msg.chat.id;

    const webAppUrl = process.env.WEBAPP_URL;

    if (!webAppUrl) {
      return bot.sendMessage(
        chatId,
        "⚠️ Mini App URL is not configured."
      );
    }

    await bot.sendMessage(
      chatId,
      "🎬 Welcome to Private Video Link",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "▶️ Open Private Video Link",
                web_app: {
                  url: webAppUrl
                }
              }
            ]
          ]
        }
      }
    );
  });

  bot.onText(/^\/help$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      "🎬 Private Video Link\n\n/start - Open Mini App"
    );
  });

  bot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error.message);
  });

  console.log("Telegram bot started");
} else {
  console.log("BOT_TOKEN is missing");
}

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Private Video Link is running!"
  });
});

/* =========================
   APP CONFIG
========================= */

app.get("/api/config", async (req, res) => {
  let settings = {};

  if (db) {
    try {
      const snapshot = await db
        .ref("settings/ads")
        .once("value");

      settings = snapshot.val() || {};
    } catch (error) {
      console.error(error.message);
    }
  }

  res.json({
    provider:
      settings.provider ||
      process.env.AD_PROVIDER ||
      "adsgram",

    requiredAdsDefault:
      Number(
        settings.requiredAdsDefault ||
        process.env.REQUIRED_ADS_DEFAULT ||
        3
      ),

    adsgramBlockId:
      settings.adsgramBlockId ||
      process.env.ADSGRAM_BLOCK_ID ||
      "",

    monetagZoneId:
      settings.monetagZoneId ||
      process.env.MONETAG_ZONE_ID ||
      ""
  });
});

/* =========================
   PUBLIC VIDEO LIST
========================= */

app.get("/api/videos", async (req, res) => {
  if (!db) {
    return res.json([]);
  }

  try {
    const snapshot = await db
      .ref("videos")
      .once("value");

    const data = snapshot.val() || {};

    const videos = Object.entries(data)
      .map(([id, video]) => ({
        id,
        ...video
      }))
      .filter((video) => video.active !== false);

    res.json(videos);
  } catch (error) {
    console.error(error.message);

    res.status(500).json({
      error: "Failed to load videos"
    });
  }
});

/* =========================
   ADMIN AUTH
========================= */

function adminAuthorized(req) {
  const adminKey = process.env.ADMIN_KEY;

  if (!adminKey) {
    return false;
  }

  return req.headers["x-admin-key"] === adminKey;
}

/* =========================
   ADMIN - GET VIDEOS
========================= */

app.get("/api/admin/videos", async (req, res) => {
  if (!adminAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  if (!db) {
    return res.json([]);
  }

  try {
    const snapshot = await db
      .ref("videos")
      .once("value");

    const data = snapshot.val() || {};

    const videos = Object.entries(data).map(
      ([id, video]) => ({
        id,
        ...video
      })
    );

    res.json(videos);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   ADMIN - ADD / UPDATE VIDEO
========================= */

app.post("/api/admin/videos", async (req, res) => {
  if (!adminAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  if (!db) {
    return res.status(500).json({
      error: "Firebase is not configured"
    });
  }

  const video = req.body || {};

  if (!video.id) {
    return res.status(400).json({
      error: "Video ID is required"
    });
  }

  try {
    await db
      .ref(`videos/${video.id}`)
      .set({
        title: video.title || "Untitled",
        category: video.category || "General",

        section:
          video.section || "Premium",

        thumbnailUrl:
          video.thumbnailUrl || "",

        videoUrl:
          video.videoUrl || "",

        requiredAds:
          Number(video.requiredAds || 3),

        views:
          Number(video.views || 0),

        active:
          video.active !== false,

        createdAt:
          video.createdAt || Date.now()
      });

    res.json({
      ok: true,
      message: "Video saved successfully"
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   ADMIN - DELETE VIDEO
========================= */

app.delete(
  "/api/admin/videos/:id",
  async (req, res) => {

    if (!adminAuthorized(req)) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    if (!db) {
      return res.status(500).json({
        error: "Firebase is not configured"
      });
    }

    try {
      await db
        .ref(`videos/${req.params.id}`)
        .remove();

      res.json({
        ok: true,
        message: "Video deleted"
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================
   ADMIN - GET SETTINGS
========================= */

app.get("/api/admin/settings", async (req, res) => {
  if (!adminAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  if (!db) {
    return res.json({});
  }

  try {
    const snapshot = await db
      .ref("settings/ads")
      .once("value");

    res.json(
      snapshot.val() || {}
    );
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   ADMIN - SAVE SETTINGS
========================= */

app.post("/api/admin/settings", async (req, res) => {
  if (!adminAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  if (!db) {
    return res.status(500).json({
      error: "Firebase is not configured"
    });
  }

  try {
    await db
      .ref("settings/ads")
      .set({
        provider:
          req.body.provider || "adsgram",

        requiredAdsDefault:
          Number(
            req.body.requiredAdsDefault || 3
          ),

        adsgramBlockId:
          req.body.adsgramBlockId || "",

        monetagZoneId:
          req.body.monetagZoneId || ""
      });

    res.json({
      ok: true,
      message: "Settings saved"
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(
    `Private Video Link running on port ${PORT}`
  );
});
