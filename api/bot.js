const { Bot, webhookCallback, Keyboard, InlineKeyboard } = require("grammy");
const admin = require("firebase-admin");

// 1. Firebase Connection
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

// 2. User Middleware
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
            step: "none",
            joinedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await userRef.set(newUser);
        ctx.dbUser = newUser;
    } else {
        ctx.dbUser = doc.data();
    }
    await next();
});

// 3. Admin Switch Command
bot.command("permanentlyswitchtoadmin", async (ctx) => {
    const userId = ctx.from.id.toString();
    const textParts = ctx.message.text.split(" ");
    
    if (textParts.length < 2) return ctx.reply("❌ Please provide the login code.");
    const code = textParts[1]; 

    if (code === process.env.LOGIN_CODE) {
        await db.collection('users').doc(userId).update({ role: "admin" });
        ctx.dbUser.role = "admin"; 
        
        const adminMenu = new Keyboard().text("🔔 Pending Payments").text("⚙️ Manage Services").row().text("👥 User Details").text("📢 Broadcast").row().resized();
        await ctx.reply("✅ **Access Granted!** You are now permanently an Admin.", { parse_mode: "Markdown", reply_markup: adminMenu });
    } else {
        await ctx.reply("❌ Invalid login code. Access Denied.");
    }
});

// 4. /start Command
bot.command("start", async (ctx) => {
    if (ctx.dbUser.role === "admin") {
        const adminMenu = new Keyboard().text("🔔 Pending Payments").text("⚙️ Manage Services").row().text("👥 User Details").text("📢 Broadcast").row().resized();
        return ctx.reply(`Welcome back, Admin ${ctx.from.first_name}! ⚙️`, { reply_markup: adminMenu });
    }

    const menuKeyboard = new Keyboard().text("🛍 Available Deals").row().text("💳 My Wallet").text("📦 My Orders").row().text("🎧 Customer Support").row().resized();
    await ctx.reply(`Hello ${ctx.from.first_name}, welcome to Constant SMM Deals! 🚀\n\nPlease choose an option below:`, { reply_markup: menuKeyboard });
});

// 5. 💳 Wallet & Ask Amount
bot.hears("💳 My Wallet", async (ctx) => {
    await db.collection('users').doc(ctx.from.id.toString()).update({ step: "none" }); 
    const balance = ctx.dbUser.walletBalance || 0;
    const inlineKeyboard = new InlineKeyboard().text("➕ Add Money", "ask_amount");
    await ctx.reply(`💳 **Your Wallet**\n\n💰 Current Balance: ₹${balance.toFixed(2)}`, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
});

bot.callbackQuery("ask_amount", async (ctx) => {
    await ctx.answerCallbackQuery();
    await db.collection('users').doc(ctx.from.id.toString()).update({ step: "entering_amount" });
    await ctx.reply("💬 **How much money do you want to add?**\n\n*(Minimum is ₹5. You can enter decimals like 10.50, 50, etc.)*", { parse_mode: "Markdown" });
});

// 6. Generate QR with 5-Second Safe Delay
bot.on("message:text", async (ctx) => {
    if (ctx.dbUser.step === "entering_amount") {
        const text = ctx.message.text;
        const userId = ctx.from.id.toString();
        const amount = parseFloat(text);
        
        if (isNaN(amount) || amount < 5) return ctx.reply("❌ Invalid amount. Minimum deposit is ₹5.");

        await db.collection('users').doc(userId).update({ step: "none" });

        const upiId = "constantabrar@upi";
        const upiLink = `upi://pay?pa=${upiId}&pn=Constant%20SMM&am=${amount}&cu=INR`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(upiLink)}&size=400&margin=2`;

        const sentMsg = await ctx.replyWithPhoto(qrUrl, {
            caption: `🏦 **Scan to Pay: ₹${amount}**\n\nOr pay directly to UPI ID: \`${upiId}\`\n\n⏳ *Verification button will appear here in 5 seconds...*`,
            parse_mode: "Markdown"
        });

        // Safe 5-Second Delay (Forces Vercel to stay awake)
        await new Promise(resolve => setTimeout(resolve, 5000));

        const inlineBtn = new InlineKeyboard().text("✅ PAID, PLEASE CHECK", `paid_${amount}`);
        await ctx.api.editMessageCaption(ctx.chat.id, sentMsg.message_id, {
            caption: `🏦 **Scan to Pay: ₹${amount}**\n\nOr pay directly to UPI ID: \`${upiId}\`\n\n✅ *Click the button below to confirm payment.*`,
            parse_mode: "Markdown",
            reply_markup: inlineBtn
        }).catch(() => {});
    }
});

// 7. Request Verification (User clicks PAID)
bot.callbackQuery(/^paid_([0-9.]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const amount = parseFloat(ctx.match[1]);
    const reqId = "REQ" + Math.floor(100000 + Math.random() * 900000); // Bulletproof 6-digit ID
    const userId = ctx.from.id.toString();

    await ctx.editMessageReplyMarkup({ reply_markup: null });

    await db.collection("paymentRequests").doc(reqId).set({
        userId: userId,
        amount: amount,
        status: "pending",
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    await ctx.reply(`⏳ Request ID: **#${reqId}** generated for **₹${amount}**.\n\nYou will be notified within 10 minutes.`, { parse_mode: "Markdown" });

    // Alert Admins
    const adminsSnapshot = await db.collection("users").where("role", "==", "admin").get();
    const adminAlert = `🔔 **New Payment Request**\n\n👤 User: ${ctx.from.first_name} (ID: \`${userId}\`)\n💰 Amount: ₹${amount}\n🆔 ID: #${reqId}\n\nVerify in your Bank App!`;

    adminsSnapshot.forEach(async (adminDoc) => {
        const adminKeyboard = new InlineKeyboard()
            .text("✅ Accept", `accept_${reqId}`)
            .text("❌ Decline", `decline_${reqId}`);
        await bot.api.sendMessage(adminDoc.id, adminAlert, { parse_mode: "Markdown", reply_markup: adminKeyboard });
    });
});

// 8. Fixed Admin SLA & Approval Logic
bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    
    // Check if it's an admin action
    if (data.startsWith("accept_") || data.startsWith("decline_")) {
        if (ctx.dbUser.role !== "admin") return ctx.answerCallbackQuery("❌ You are not an admin!");

        const action = data.split("_")[0]; 
        const reqId = data.split("_")[1];

        const reqRef = db.collection("paymentRequests").doc(reqId);
        const reqDoc = await reqRef.get();

        if (!reqDoc.exists) return ctx.answerCallbackQuery("❌ Request not found.", { show_alert: true });
        
        const reqData = reqDoc.data();
        if (reqData.status !== "pending") return ctx.answerCallbackQuery(`⚠️ This request was already ${reqData.status}.`, { show_alert: true });

        await reqRef.update({ status: action });

        if (action === "accept") {
            const requestTimeMillis = reqData.timestamp.toMillis();
            const diffInMinutes = (Date.now() - requestTimeMillis) / 60000;
            
            let finalAmount = reqData.amount;
            let bonusMessage = "";

            // 10 Min Late Bonus Logic
            if (diffInMinutes > 10) {
                const bonus = parseFloat((reqData.amount * 0.05).toFixed(2));
                finalAmount = parseFloat((reqData.amount + bonus).toFixed(2));
                bonusMessage = `\n\n🎁 *Bonus Added:* We were running late (took >10 mins). A 5% bonus (₹${bonus}) has been added!`;
            }

            await db.collection("users").doc(reqData.userId).update({
                walletBalance: admin.firestore.FieldValue.increment(finalAmount)
            });

            await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ **Status: Accepted (₹${finalAmount} Credited)**`, { parse_mode: "Markdown" });
            await bot.api.sendMessage(reqData.userId, `🎉 **Payment Verified!**\n\n**₹${finalAmount}** added to your wallet.\nRequest ID: #${reqId}${bonusMessage}`, { parse_mode: "Markdown" });
        } else {
            await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ **Status: Declined**", { parse_mode: "Markdown" });
            await bot.api.sendMessage(reqData.userId, `❌ **Payment Declined!**\n\nRequest (ID: #${reqId}) was declined. Contact support if money was deducted.`, { parse_mode: "Markdown" });
        }
        await ctx.answerCallbackQuery(`Payment ${action}ed!`);
    } else {
        return next();
    }
});

module.exports = webhookCallback(bot, "http");
