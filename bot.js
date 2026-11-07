const { Bot } = require("grammy");
const admin = require("firebase-admin");
const http = require("http");


// 1. Firebase Secure Connection
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. Telegram Bot Setup
const bot = new Bot(process.env.BOT_TOKEN);

// 3. Professional English /start Command
bot.command("start", async (ctx) => {
    const firstName = ctx.from.first_name || "User";
    
    const welcomeMessage = `Hello ${firstName}, welcome to Constant SMM Deals! 🚀\n\nWe provide the best and most affordable Social Media Marketing services.\n\nUse the menu below to explore our available deals, manage your wallet, or contact customer support.`;
    
    await ctx.reply(welcomeMessage);
});

// 4. Dummy HTTP Server for Render (To prevent deployment crashes)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running securely!");
}).listen(PORT);

// 5. Start the Bot
bot.start();
console.log("Bot started successfully!");
