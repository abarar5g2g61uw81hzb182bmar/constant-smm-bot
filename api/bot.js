const { Bot, webhookCallback, Keyboard } = require("grammy");
const admin = require("firebase-admin");

// Firebase Connection
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

// Updated /start Command with Menu Buttons
bot.command("start", async (ctx) => {
    const firstName = ctx.from.first_name || "User";
    const telegramId = ctx.from.id.toString();

    // Create a Custom Keyboard Menu
    const menuKeyboard = new Keyboard()
        .text("🛍 Available Deals").row()
        .text("💳 My Wallet").text("📦 My Orders").row()
        .text("🎧 Customer Support").row()
        .resized();

    const welcomeMessage = `Hello ${firstName}, welcome to Constant SMM Deals! 🚀\n\nWe provide the best and most affordable Social Media Marketing services.\n\nPlease choose an option from the menu below:`;
    
    await ctx.reply(welcomeMessage, { reply_markup: menuKeyboard });
});

// Export as Webhook for Vercel
module.exports = webhookCallback(bot, "http");
