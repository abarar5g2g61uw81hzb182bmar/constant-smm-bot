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

// 2. Telegram Bot Setup
const bot = new Bot(process.env.BOT_TOKEN);

// 3. User Profile Middleware
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    
    const userId = ctx.from.id.toString();
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    
    if (!doc.exists) {
        const newUser = {
            firstName: ctx.from.first_name || "User",
            username: ctx.from.username || "",
            role: "customer",
            walletBalance: 0,
            joinedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await userRef.set(newUser);
        ctx.dbUser = newUser;
    } else {
        ctx.dbUser = doc.data();
    }
    await next();
});

// 4. Admin Switch Command
bot.command("permanentlyswitchtoadmin", async (ctx) => {
    const userId = ctx.from.id.toString();
    const code = ctx.message.text.split(" ")[1]; 

    if (code === process.env.LOGIN_CODE) {
        await db.collection('users').doc(userId).update({ role: "admin" });
        ctx.dbUser.role = "admin"; 
        
        const adminMenu = new Keyboard()
            .text("🔔 Pending Payments").text("⚙️ Manage Services").row()
            .text("👥 User Details").text("📢 Broadcast").row()
            .resized();

        await ctx.reply("✅ Access Granted! You are now permanently an Admin.", { reply_markup: adminMenu });
    } else {
        await ctx.reply("❌ Invalid login code. Access Denied.");
    }
});

// 5. Normal /start Command
bot.command("start", async (ctx) => {
    const firstName = ctx.from.first_name || "User";
    
    if (ctx.dbUser.role === "admin") {
        const adminMenu = new Keyboard()
            .text("🔔 Pending Payments").text("⚙️ Manage Services").row()
            .text("👥 User Details").text("📢 Broadcast").row()
            .resized();
        return ctx.reply(`Welcome back, Admin ${firstName}! ⚙️\nSystem is fully automated and running smoothly.`, { reply_markup: adminMenu });
    }

    const menuKeyboard = new Keyboard()
        .text("🛍 Available Deals").row()
        .text("💳 My Wallet").text("📦 My Orders").row()
        .text("🎧 Customer Support").row()
        .resized();

    await ctx.reply(`Hello ${firstName}, welcome to Constant SMM Deals! 🚀\n\nPlease choose an option:`, { reply_markup: menuKeyboard });
});

// 6. 💳 My Wallet & Add Money Flow
bot.hears("💳 My Wallet", async (ctx) => {
    const balance = ctx.dbUser.walletBalance || 0;
    const inlineKeyboard = new InlineKeyboard().text("➕ Add Money", "add_money");
    
    await ctx.reply(`💳 **Your Wallet**\n\n💰 Current Balance: ₹${balance}`, { 
        parse_mode: "Markdown", 
        reply_markup: inlineKeyboard 
    });
});

bot.callbackQuery("add_money", async (ctx) => {
    await ctx.answerCallbackQuery();
    // YAHAN APNA UPI ID DAALEIN 👇
    const upiId = "constantabrar@upi"; 
    
    const text = `🏦 **Add Money to Wallet**\n\n1️⃣ Send money to this UPI ID: \`${upiId}\`\n2️⃣ Minimum deposit is ₹5.\n\n⚠️ *Click the button below ONLY AFTER making the payment.*`;
    const inlineKeyboard = new InlineKeyboard().text("✅ I have Paid", "paid_step");
    
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inlineKeyboard });
});

bot.callbackQuery("paid_step", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this exact message with the **amount you paid** (e.g. 50):", {
        parse_mode: "Markdown",
        reply_markup: { force_reply: true, selective: true }
    });
});

// 7. Handle Text Messages (For Payment Amount)
bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    
    // Check if user is replying to the amount prompt
    if (ctx.message.reply_to_message && ctx.message.reply_to_message.text.includes("amount you paid")) {
        const amount = parseInt(text);
        
        if (isNaN(amount) || amount < 5) {
            return ctx.reply("❌ Invalid amount. Minimum deposit is ₹5. Please try again.");
        }

        const reqId = "REQ" + Date.now().toString().slice(-6); // e.g., REQ123456
        const userId = ctx.from.id.toString();

        // Save request to Firebase
        await db.collection("paymentRequests").doc(reqId).set({
            userId: userId,
            amount: amount,
            status: "pending",
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        await ctx.reply(`⏳ Your payment request for **₹${amount}** has been sent for verification.\n\n**Request ID:** #${reqId}\n\nPlease wait while an admin verifies it.`, { parse_mode: "Markdown" });

        // Alert All Admins
        const adminsSnapshot = await db.collection("users").where("role", "==", "admin").get();
        const adminKeyboard = new InlineKeyboard()
            .text("✅ Accept", `accept_${reqId}`)
            .text("❌ Decline", `decline_${reqId}`);

        const adminAlert = `🔔 **New Payment Request**\n\n👤 User: ${ctx.from.first_name} (ID: \`${userId}\`)\n💰 Amount: ₹${amount}\n🆔 ID: #${reqId}\n\nVerify in your Bank App!`;

        adminsSnapshot.forEach(async (adminDoc) => {
            await bot.api.sendMessage(adminDoc.id, adminAlert, { parse_mode: "Markdown", reply_markup: adminKeyboard });
        });
    }
});

// 8. Admin Verification Callbacks (Accept/Decline)
bot.callbackQuery(/^(accept|decline)_(REQ[0-9]+)$/, async (ctx) => {
    if (ctx.dbUser.role !== "admin") return ctx.answerCallbackQuery("❌ You are not an admin!");

    const action = ctx.match[1]; // 'accept' or 'decline'
    const reqId = ctx.match[2];

    const reqRef = db.collection("paymentRequests").doc(reqId);
    const reqDoc = await reqRef.get();

    if (!reqDoc.exists) return ctx.answerCallbackQuery("❌ Request not found.", { show_alert: true });
    
    const reqData = reqDoc.data();
    if (reqData.status !== "pending") return ctx.answerCallbackQuery(`⚠️ This request was already ${reqData.status}.`, { show_alert: true });

    // Lock the request so it can't be clicked twice
    await reqRef.update({ status: action });

    if (action === "accept") {
        // Update user balance
        await db.collection("users").doc(reqData.userId).update({
            walletBalance: admin.firestore.FieldValue.increment(reqData.amount)
        });

        // Update Admin Message (Remove buttons)
        await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n✅ **Status: Accepted & Wallet Credited**", { parse_mode: "Markdown" });
        
        // Notify Customer
        await bot.api.sendMessage(reqData.userId, `🎉 **Payment Verified!**\n\n₹${reqData.amount} has been successfully added to your wallet.\nRequest ID: #${reqId}`, { parse_mode: "Markdown" });
    } else {
        await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ **Status: Declined**", { parse_mode: "Markdown" });
        await bot.api.sendMessage(reqData.userId, `❌ **Payment Declined!**\n\nYour request for ₹${reqData.amount} (ID: #${reqId}) was declined. Please contact support.`, { parse_mode: "Markdown" });
    }
    await ctx.answerCallbackQuery(`Payment ${action}ed!`);
});

// Export Webhook
module.exports = webhookCallback(bot, "http");
