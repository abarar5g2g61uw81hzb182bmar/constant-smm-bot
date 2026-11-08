const { Bot, webhookCallback, Keyboard, InlineKeyboard } = require("grammy");
const admin = require("firebase-admin");

// 1. Firebase Secure Connection
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

// 2. User Profile Middleware
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
        
        const adminMenu = new Keyboard()
            .text("🔔 Pending Payments").text("⚙️ Manage Services").row()
            .text("👥 User Details").text("📢 Broadcast").row()
            .resized();

        await ctx.reply("✅ **Access Granted!** You are now permanently an Admin.", { parse_mode: "Markdown", reply_markup: adminMenu });
    } else {
        await ctx.reply("❌ Invalid login code. Access Denied.");
    }
});

// 4. Normal /start Command
bot.command("start", async (ctx) => {
    if (ctx.dbUser.role === "admin") {
        const adminMenu = new Keyboard().text("🔔 Pending Payments").text("⚙️ Manage Services").row().text("👥 User Details").text("📢 Broadcast").row().resized();
        return ctx.reply(`Welcome back, Admin ${ctx.from.first_name}! ⚙️\nSystem is fully automated and running smoothly.`, { reply_markup: adminMenu });
    }

    const menuKeyboard = new Keyboard().text("🛍 Available Deals").row().text("💳 My Wallet").text("📦 My Orders").row().text("🎧 Customer Support").row().resized();
    await ctx.reply(`Hello ${ctx.from.first_name}, welcome to Constant SMM Deals! 🚀\n\nPlease choose an option below:`, { reply_markup: menuKeyboard });
});

// 5. 💳 My Wallet & Add Money Flow
bot.hears("💳 My Wallet", async (ctx) => {
    await db.collection('users').doc(ctx.from.id.toString()).update({ step: "none" }); // Reset step
    const balance = ctx.dbUser.walletBalance || 0;
    const inlineKeyboard = new InlineKeyboard().text("➕ Add Money", "ask_amount");
    
    await ctx.reply(`💳 **Your Wallet**\n\n💰 Current Balance: ₹${balance.toFixed(2)}`, { 
        parse_mode: "Markdown", 
        reply_markup: inlineKeyboard 
    });
});

// Ask for exact amount
bot.callbackQuery("ask_amount", async (ctx) => {
    await ctx.answerCallbackQuery();
    await db.collection('users').doc(ctx.from.id.toString()).update({ step: "entering_amount" });
    
    await ctx.reply("💬 **How much money do you want to add?**\n\n*(Minimum is ₹5. You can enter decimals like 10.50, 50, etc.)*", { parse_mode: "Markdown" });
});

// 6. Handle Exact Amount & Generate QR Code
bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();

    // Check if user is in "entering_amount" step
    if (ctx.dbUser.step === "entering_amount") {
        const amount = parseFloat(text);
        
        if (isNaN(amount) || amount < 5) {
            return ctx.reply("❌ Invalid amount. Minimum deposit is ₹5. Please enter a valid number.");
        }

        // Reset step so they don't get stuck
        await db.collection('users').doc(userId).update({ step: "none" });

        const upiId = "constantabrar@upi";
        
        // Exact Amount UPI Link & QR Image Generation
        const upiLink = `upi://pay?pa=${upiId}&pn=Constant%20SMM&am=${amount}&cu=INR`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(upiLink)}&size=400&margin=2`;

        const inlineBtn = new InlineKeyboard().text("✅ PAID, PLEASE CHECK", `paid_${amount}`);

        await ctx.replyWithPhoto(qrUrl, {
            caption: `🏦 **Scan to Pay: ₹${amount}**\n\nOr pay directly to UPI ID: \`${upiId}\`\n\n⚠️ *Please make the payment first, then click the verification button below.*`,
            parse_mode: "Markdown",
            reply_markup: inlineBtn
        });
    }
});

// 7. Request Verification (User clicks PAID)
bot.callbackQuery(/^paid_([0-9.]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const amount = parseFloat(ctx.match[1]);
    const reqId = "REQ" + Date.now().toString().slice(-6);
    const userId = ctx.from.id.toString();

    // Remove the button so they can't spam it
    await ctx.editMessageReplyMarkup({ reply_markup: null });

    // Save request to Database
    await db.collection("paymentRequests").doc(reqId).set({
        userId: userId,
        amount: amount,
        status: "pending",
        timestamp: admin.firestore.FieldValue.serverTimestamp() // For SLA calculation
    });

    await ctx.reply(`⏳ Request ID: **#${reqId}** generated for **₹${amount}**.\n\nYou will be notified within 10 minutes.`, { parse_mode: "Markdown" });

    // Alert All Admins
    const adminsSnapshot = await db.collection("users").where("role", "==", "admin").get();
    const adminKeyboard = new InlineKeyboard()
        .text("✅ Accept", `accept_${reqId}`)
        .text("❌ Decline", `decline_${reqId}`);

    const adminAlert = `🔔 **New Payment Request**\n\n👤 User: ${ctx.from.first_name} (ID: \`${userId}\`)\n💰 Amount: ₹${amount}\n🆔 ID: #${reqId}\n\nVerify in your Bank App!`;

    adminsSnapshot.forEach(async (adminDoc) => {
        await bot.api.sendMessage(adminDoc.id, adminAlert, { parse_mode: "Markdown", reply_markup: adminKeyboard });
    });
});

// 8. Admin SLA & Approval Logic (Accept/Decline)
bot.callbackQuery(/^(accept|decline)_(REQ[0-9]+)$/, async (ctx) => {
    if (ctx.dbUser.role !== "admin") return ctx.answerCallbackQuery("❌ You are not an admin!");

    const action = ctx.match[1]; 
    const reqId = ctx.match[2];

    const reqRef = db.collection("paymentRequests").doc(reqId);
    const reqDoc = await reqRef.get();

    if (!reqDoc.exists) return ctx.answerCallbackQuery("❌ Request not found.", { show_alert: true });
    
    const reqData = reqDoc.data();
    if (reqData.status !== "pending") return ctx.answerCallbackQuery(`⚠️ This request was already ${reqData.status}.`, { show_alert: true });

    // Lock the request
    await reqRef.update({ status: action });

    if (action === "accept") {
        // Calculate 10-Minute SLA & Bonus
        const requestTimeMillis = reqData.timestamp.toMillis();
        const currentTimeMillis = Date.now();
        const diffInMinutes = (currentTimeMillis - requestTimeMillis) / 60000;
        
        let finalAmount = reqData.amount;
        let bonusMessage = "";
        let bonusPercent = 5; // Configurable bonus %

        if (diffInMinutes > 10) {
            const bonus = parseFloat((reqData.amount * (bonusPercent / 100)).toFixed(2));
            finalAmount = parseFloat((reqData.amount + bonus).toFixed(2));
            bonusMessage = `\n\n🎁 *Bonus Added:* We were running late (took more than 10 mins). As an apology, a ${bonusPercent}% bonus (₹${bonus}) has been automatically added to your deposit!`;
        }

        // Update Wallet Balance
        await db.collection("users").doc(reqData.userId).update({
            walletBalance: admin.firestore.FieldValue.increment(finalAmount)
        });

        // Update Admin Message
        await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ **Status: Accepted (₹${finalAmount} Credited)**`, { parse_mode: "Markdown" });
        
        // Notify Customer
        await bot.api.sendMessage(reqData.userId, `🎉 **Payment Verified!**\n\n**₹${finalAmount}** has been successfully added to your wallet.\nRequest ID: #${reqId}${bonusMessage}`, { parse_mode: "Markdown" });
    } else {
        await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ **Status: Declined**", { parse_mode: "Markdown" });
        await bot.api.sendMessage(reqData.userId, `❌ **Payment Declined!**\n\nYour request for ₹${reqData.amount} (ID: #${reqId}) was declined. Please contact support if money was deducted.`, { parse_mode: "Markdown" });
    }
    await ctx.answerCallbackQuery(`Payment ${action}ed!`);
});

// Export as Webhook for Vercel
module.exports = webhookCallback(bot, "http");
