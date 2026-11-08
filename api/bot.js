const { Bot, webhookCallback } = require("grammy");
const admin = require("firebase-admin");

// Firebase Connection (Checking if already initialized to prevent Vercel crashes)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}
const db = admin.firestore();

// Telegram Bot Setup
const bot = new Bot(process.env.BOT_TOKEN);

bot.command("start", async (ctx) => {
    const firstName = ctx.from.first_name || "User";
    const welcomeMessage = `Hello ${firstName}, welcome to Constant SMM Deals! 🚀\n\nWe provide the best and most affordable Social Media Marketing services.`;
    await ctx.reply(welcomeMessage);
});

// Export as Webhook for Vercel
module.exports = webhookCallback(bot, "http");
