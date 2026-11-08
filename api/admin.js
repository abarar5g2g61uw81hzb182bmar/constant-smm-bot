const { Composer, InlineKeyboard } = require("grammy");
const admin = require("firebase-admin");

const adminBot = new Composer();
const db = admin.firestore();

// Middleware: Sirf Admin commands yahan chalenge
adminBot.use(async (ctx, next) => {
    if (ctx.dbUser && ctx.dbUser.role === "admin") {
        await next();
    }
});

// Admin Verification Callbacks (Accept/Decline)
adminBot.callbackQuery(/^(accept|decline)_(REQ[0-9]+)$/, async (ctx) => {
    const action = ctx.match[1];
    const reqId = ctx.match[2];

    const reqRef = db.collection("paymentRequests").doc(reqId);
    const reqDoc = await reqRef.get();

    if (!reqDoc.exists) return ctx.answerCallbackQuery("❌ Request not found.", { show_alert: true });
    
    const reqData = reqDoc.data();
    if (reqData.status !== "pending") return ctx.answerCallbackQuery(`⚠️ This request was already ${reqData.status}.`, { show_alert: true });

    // Lock request
    await reqRef.update({ status: action });

    if (action === "accept") {
        // 10-Minute Delay Bonus Logic
        const requestTime = reqData.timestamp.toMillis();
        const currentTime = Date.now();
        const diffInMinutes = (currentTime - requestTime) / 60000;
        
        let finalAmount = reqData.amount;
        let bonusMessage = "";
        let bonusPercent = 5; // Default 5% bonus

        if (diffInMinutes > 10) {
            const bonus = parseFloat((reqData.amount * (bonusPercent / 100)).toFixed(2));
            finalAmount = reqData.amount + bonus;
            bonusMessage = `\n\n🎁 *Bonus Added:* We were running late (took more than 10 mins). As an apology, a ${bonusPercent}% bonus (₹${bonus}) has been added!`;
        }

        // Update Wallet
        await db.collection("users").doc(reqData.userId).update({
            walletBalance: admin.firestore.FieldValue.increment(finalAmount)
        });

        await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ **Status: Accepted (₹${finalAmount} Added)**`, { parse_mode: "Markdown" });
        await ctx.api.sendMessage(reqData.userId, `🎉 **Payment Verified!**\n\n₹${finalAmount} has been successfully added to your wallet.\nRequest ID: #${reqId}${bonusMessage}`, { parse_mode: "Markdown" });
    } else {
        await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ **Status: Declined**", { parse_mode: "Markdown" });
        await ctx.api.sendMessage(reqData.userId, `❌ **Payment Declined!**\n\nYour request for ₹${reqData.amount} (ID: #${reqId}) was declined. Please contact support.`, { parse_mode: "Markdown" });
    }
    await ctx.answerCallbackQuery(`Payment ${action}ed!`);
});

module.exports = adminBot;
