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

// Middleware: Check/Create User Profile in Firebase
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    
    const userId = ctx.from.id.toString();
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    
    if (!doc.exists) {
        // Naya user aaya hai, database mein save karo
        const newUser = {
            firstName: ctx.from.first_name || "User",
            username: ctx.from.username || "",
            role: "customer", // Default role
            walletBalance: 0,
            joinedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await userRef.set(newUser);
        ctx.dbUser = newUser;
    } else {
        // Purana user hai, data fetch karo
        ctx.dbUser = doc.data();
    }
    
    // Pass execution to the next function
    await next();
});

// Admin Authentication Command
bot.command("permanentlyswitchtoadmin", async (ctx) => {
    const userId = ctx.from.id.toString();
    const messageText = ctx.message.text;
    
    // Command format: /permanentlyswitchtoadmin YOUR_CODE
    const code = messageText.split(" ")[1]; 

    if (code === process.env.LOGIN_CODE) {
        // Update user role to admin in Firebase
        await db.collection('users').doc(userId).update({ role: "admin" });
        ctx.dbUser.role = "admin"; // Update local state for immediate use
        
        // Admin Special Menu
        const adminMenu = new Keyboard()
            .text("🔔 Pending Payments").text("⚙️ Manage Services").row()
            .text("👥 User Details").text("📢 Broadcast").row()
            .resized();

        await ctx.reply("✅ Access Granted! You are now permanently an Admin.\n\nYou will no longer see the customer interface. All system alerts, payment verification requests, and service controls will be routed here.", { reply_markup: adminMenu });
    } else {
        await ctx.reply("❌ Invalid login code. Access Denied.");
    }
});

// Main /start Command (Role Based)
bot.command("start", async (ctx) => {
    const firstName = ctx.from.first_name || "User";
    
    // Agar user admin hai, toh alag menu dikhao
    if (ctx.dbUser.role === "admin") {
        const adminMenu = new Keyboard()
            .text("🔔 Pending Payments").text("⚙️ Manage Services").row()
            .text("👥 User Details").text("📢 Broadcast").row()
            .resized();
        return ctx.reply(`Welcome back, Admin ${firstName}! ⚙️\nSystem is fully automated and running smoothly.`, { reply_markup: adminMenu });
    }

    // Normal Customer Menu
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
