const { Bot } = require("grammy");
const http = require("http");

// Humne Firebase ko temporarily band kar diya hai error pakadne ke liye
// const admin = require("firebase-admin");
// const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
// admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
// const db = admin.firestore();

// Telegram Bot Setup
const bot = new Bot(process.env.BOT_TOKEN);

bot.command("start", async (ctx) => {
    await ctx.reply("Hello! Bot is live. (Firebase is currently paused for testing)");
});

// Dummy Server for Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running!");
}).listen(PORT);

bot.start();
console.log("Bot started successfully!");
