const { Bot, webhookCallback, Keyboard, InlineKeyboard } = require("grammy");
const admin = require("firebase-admin");

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
const bot = new Bot(process.env.BOT_TOKEN);

// User Profile & Database Middleware
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const userId = ctx.from.id.toString();
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    
    if (!doc.exists) {
        const newUser = {
            firstName: ctx.from.first_name || "User",
            role: "customer",
            walletBalance: 0,
            step: "none"
        };
        await userRef.set(newUser);
        ctx.dbUser = newUser;
    } else {
        ctx.dbUser = doc.data();
    }
    await next();
});

// Import Admin Logic
const adminBot = require("./admin");
bot.use(adminBot);

// Permanently Switch to Admin
bot.command("permanentlyswitchtoadmin", async (ctx) => {
    const code = ctx.message.text.split(" ")[1]; 
    if (code === process.env.LOGIN_CODE) {
        await db.collection('users').doc(ctx.from.id.toString()).update({ role: "admin" });
        ctx.dbUser.role = "admin"; 
        const adminMenu = new Keyboard().text("🔔 Pending Payments").text("⚙️ Manage Services").row().resized();
        await ctx.reply("✅ Access Granted! You are now permanently an Admin.", { reply_markup: adminMenu });
    }
});

// Start Command
bot.command("start", async (ctx) => {
    if (ctx.dbUser.role === "admin") {
        return ctx.reply("Welcome back, Admin ⚙️", { reply_markup: new Keyboard().text("🔔 Pending Payments").text("⚙️ Manage Services").row().resized() });
    }
    const menu = new Keyboard().text("🛍 Available Deals").row().text("💳 My Wallet").text("📦 My Orders").row().resized();
    await ctx.reply("Hello, welcome to Constant SMM Deals! 🚀", { reply_markup: menu });
});

// 💳 Wallet Menu
bot.hears("💳 My Wallet", async (ctx) => {
    await db.collection('users').doc(ctx.from.id.toString()).update({ step: "none" });
    const balance = ctx.dbUser.walletBalance || 0;
    const inline = new InlineKeyboard().text("➕ Add Money", "ask_amount");
    await ctx.reply(`💳 **Your Wallet**\n💰 Balance: ₹${balance}`, { parse_mode: "Markdown", reply_markup: inline });
});

// Ask for Amount
bot.callbackQuery("ask_amount", async (ctx) => {
    await ctx.answerCallbackQuery();
    await db.collection('users').doc(ctx.from.id.toString()).update({ step: "entering_amount" });
    await ctx.reply("💬 How much money do you want to add?\n*(Minimum is ₹5. Enter amount like 50, 10.5, etc.)*", { parse_mode: "Markdown" });
});

// Handle Text Inputs (For Amount Entry)
bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();

    // Agar user amount enter kar raha hai
    if (ctx.dbUser.step === "entering_amount") {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount < 5) {
            return ctx.reply("❌ Minimum amount is ₹5. Please enter a valid amount.");
        }

        await db.collection('users').doc(userId).update({ step: "none" }); // Reset step

        // Generate UPI QR Code (Exact Amount)
        const upiId = "constantabrar@upi";
        const upiLink = `upi://pay?pa=${upiId}&pn=Constant%20SMM&am=${amount}&cu=INR`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(upiLink)}&size=400`;

        const sentMsg = await ctx.replyWithPhoto(qrUrl, {
            caption: `🏦 **Scan to Pay: ₹${amount}**\n\nOr pay to UPI ID: \`${upiId}\`\n\n⏳ *Verification button will appear here in 10 seconds...*`,
            parse_mode: "Markdown"
        });

        // 10 Second Delay for Button Appearance
        setTimeout(async () => {
            const inlineBtn = new InlineKeyboard().text("✅ PAID, PLEASE CHECK", `paid_${amount}`);
            await ctx.api.editMessageCaption(ctx.chat.id, sentMsg.message_id, {
                caption: `🏦 **Scan to Pay: ₹${amount}**\n\nOr pay to UPI ID: \`${upiId}\`\n\n✅ *Click the button below to confirm payment.*`,
                parse_mode: "Markdown",
                reply_markup: inlineBtn
            }).catch(() => {}); // Catch error if message was deleted
        }, 10000); 
    }
});

// User clicked PAID
bot.callbackQuery(/^paid_([0-9.]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const amount = parseFloat(ctx.match[1]);
    const reqId = "REQ" + Date.now().toString().slice(-6);
    const userId = ctx.from.id.toString();

    // Edit message to remove button
    await ctx.editMessageReplyMarkup({ reply_markup: null });

    await db.collection("paymentRequests").doc(reqId).set({
        userId: userId,
        amount: amount,
        status: "pending",
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    await ctx.reply(`⏳ Request ID: **#${reqId}** generated for ₹${amount}.\n\nYou will be notified within 10 minutes.`, { parse_mode: "Markdown" });

    // Alert Admins
    const admins = await db.collection("users").where("role", "==", "admin").get();
    const adminMenu = new InlineKeyboard().text("✅ Accept", `accept_${reqId}`).text("❌ Decline", `decline_${reqId}`);
    const alert = `🔔 **New Request**\n\n👤 User: ${ctx.from.first_name}\n💰 Amount: ₹${amount}\n🆔 ID: #${reqId}`;
    
    admins.forEach(async (adminDoc) => {
        await bot.api.sendMessage(adminDoc.id, alert, { parse_mode: "Markdown", reply_markup: adminMenu });
    });
});

module.exports = webhookCallback(bot, "http");
