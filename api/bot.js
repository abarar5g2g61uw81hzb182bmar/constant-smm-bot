const { Bot, webhookCallback, Keyboard, InlineKeyboard } = require("grammy");
const admin = require("firebase-admin");

// ==========================================
// 1. FIREBASE & BOT SETUP
// ==========================================
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

// ==========================================
// 2. MIDDLEWARE & STATE MANAGEMENT
// ==========================================
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
            tempData: {},
            joinedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await userRef.set(newUser);
        ctx.dbUser = newUser;
    } else {
        ctx.dbUser = doc.data();
    }
    
    ctx.updateState = async (step, tempData = {}) => {
        await userRef.update({ step, tempData });
        ctx.dbUser.step = step;
        ctx.dbUser.tempData = tempData;
    };
    
    await next();
});

const getAdminMenu = () => {
    return new Keyboard()
        .text("⚙️ Manage Services").text("📢 Broadcast").row()
        .text("👥 User Details").text("🎁 Manage Promos").row()
        .resized();
};

// ==========================================
// 3. BASE COMMANDS
// ==========================================
bot.command("permanentlyswitchtoadmin", async (ctx) => {
    const textParts = ctx.message.text.split(" ");
    if (textParts.length < 2) return ctx.reply("❌ Please provide the login code.");
    
    if (textParts[1] === process.env.LOGIN_CODE) {
        await ctx.updateState("none", {});
        await db.collection('users').doc(ctx.from.id.toString()).update({ role: "admin" });
        await ctx.reply("✅ **Access Granted!** You are now permanently an Admin.", { parse_mode: "Markdown", reply_markup: getAdminMenu() });
    } else {
        await ctx.reply("❌ Invalid login code.");
    }
});

bot.command("start", async (ctx) => {
    await ctx.updateState("none", {}); 
    if (ctx.dbUser.role === "admin") {
        return ctx.reply(`Welcome back, Admin ${ctx.from.first_name}! ⚙️`, { reply_markup: getAdminMenu() });
    }
    const menu = new Keyboard().text("🛍 Available Deals").row().text("💳 My Wallet").text("📦 My Orders").row().text("🎧 Customer Support").row().resized();
    await ctx.reply(`Hello ${ctx.from.first_name}, welcome to Constant SMM Deals! 🚀\n\nPlease choose an option below:`, { reply_markup: menu });
});

bot.hears("🎧 Customer Support", async (ctx) => {
    await ctx.updateState("none", {});
    await ctx.reply("🎧 **Customer Support**\n\n💬 Message: @ConstAAK\n📞 Call: +91 8637213741", { parse_mode: "Markdown" });
});

// ==========================================
// 4. WALLET & ADD MONEY 
// ==========================================
bot.hears("💳 My Wallet", async (ctx) => {
    await ctx.updateState("none", {}); 
    const balance = ctx.dbUser.walletBalance || 0;
    const inline = new InlineKeyboard().text("➕ Add Money", "ask_amount");
    await ctx.reply(`💳 **Your Wallet**\n\n💰 Current Balance: ₹${balance.toFixed(2)}`, { parse_mode: "Markdown", reply_markup: inline });
});

bot.callbackQuery("ask_amount", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.updateState("entering_amount", {});
    await ctx.reply("💬 **How much money do you want to add?**\n*(Minimum is ₹5)*", { parse_mode: "Markdown" });
});

bot.on("message:text", async (ctx, next) => {
    if (ctx.dbUser.step === "entering_amount") {
        const amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount < 5) return ctx.reply("❌ Minimum deposit is ₹5.");

        await ctx.updateState("none", {});
        const upiId = "abrar2809@ptyes";
        const upiLink = `upi://pay?pa=${upiId}&pn=Constant%20SMM&am=${amount}&cu=INR`;
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(upiLink)}&size=400&margin=2`;

        const sentMsg = await ctx.replyWithPhoto(qrUrl, {
            caption: `🏦 **Scan to Pay: ₹${amount}**\n\nUPI ID: \`${upiId}\`\n\n⏳ *Verification button will appear here in 5 seconds...*`,
            parse_mode: "Markdown"
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        const inlineBtn = new InlineKeyboard().text("✅ PAID, PLEASE CHECK", `paid_${amount}`);
        await ctx.api.editMessageCaption(ctx.chat.id, sentMsg.message_id, {
            caption: `🏦 **Scan to Pay: ₹${amount}**\n\nUPI ID: \`${upiId}\`\n\n✅ *Click the button below to confirm payment.*`,
            parse_mode: "Markdown",
            reply_markup: inlineBtn
        }).catch(() => {});
        return;
    }
    return next();
});

bot.callbackQuery(/^paid_([0-9.]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const amount = parseFloat(ctx.match[1]);
    const reqId = "REQ" + Math.floor(100000 + Math.random() * 900000);
    const userId = ctx.from.id.toString();

    await ctx.editMessageReplyMarkup({ reply_markup: null });
    await db.collection("paymentRequests").doc(reqId).set({
        userId, amount, status: "pending", timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    await ctx.reply(`⏳ Request ID: **#${reqId}** generated for **₹${amount}**.\n\nYou will be notified within 10 minutes.`, { parse_mode: "Markdown" });

    const admins = await db.collection("users").where("role", "==", "admin").get();
    const adminAlert = `🔔 **Payment Request**\n👤 User: ${ctx.from.first_name} (\`${userId}\`)\n💰 Amount: ₹${amount}\n🆔 ID: #${reqId}`;
    admins.forEach(async (adminDoc) => {
        const keyboard = new InlineKeyboard().text("✅ Accept", `accept_${reqId}`).text("❌ Decline", `decline_${reqId}`);
        await bot.api.sendMessage(adminDoc.id, adminAlert, { parse_mode: "Markdown", reply_markup: keyboard });
    });
});

bot.callbackQuery(/^(accept|decline)_(REQ[0-9]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("Processing request...");
    if (ctx.dbUser.role !== "admin") return;

    try {
        const action = ctx.match[1]; 
        const reqId = ctx.match[2];
        const reqRef = db.collection("paymentRequests").doc(reqId);
        const reqDoc = await reqRef.get();

        if (!reqDoc.exists || reqDoc.data().status !== "pending") return ctx.editMessageText("❌ Request already processed.");

        const reqData = reqDoc.data();
        await reqRef.update({ status: action });

        if (action === "accept") {
            let diffInMinutes = reqData.timestamp ? (Date.now() - reqData.timestamp.toMillis()) / 60000 : 0;
            let finalAmount = reqData.amount;
            let bonusMsg = "";

            if (diffInMinutes > 10) {
                const bonus = parseFloat((reqData.amount * 0.05).toFixed(2));
                finalAmount = parseFloat((reqData.amount + bonus).toFixed(2));
                bonusMsg = `\n\n🎁 *Bonus Added:* We were late. A 5% bonus (₹${bonus}) has been added!`;
            }

            await db.collection("users").doc(reqData.userId).update({ walletBalance: admin.firestore.FieldValue.increment(finalAmount) });
            await ctx.editMessageText(`✅ **ACCEPTED (₹${finalAmount} Credited)**\n👤 ID: \`${reqData.userId}\`\n🆔 #${reqId}`, { parse_mode: "Markdown" });
            await bot.api.sendMessage(reqData.userId, `🎉 **Payment Verified!**\n\n**₹${finalAmount}** added to your wallet.\nRequest ID: #${reqId}${bonusMsg}`, { parse_mode: "Markdown" });
        } else {
            await ctx.editMessageText(`❌ **DECLINED**\n👤 ID: \`${reqData.userId}\`\n🆔 #${reqId}`, { parse_mode: "Markdown" });
            await bot.api.sendMessage(reqData.userId, `❌ **Payment Declined!**\n\nRequest #${reqId} was declined. Contact support.`, { parse_mode: "Markdown" });
        }
    } catch (e) { console.error(e); }
});

// ==========================================
// 5. ADMIN PANELS (SERVICES, USERS, PROMOS)
// ==========================================
bot.hears("⚙️ Manage Services", async (ctx) => {
    if (ctx.dbUser.role !== "admin") return;
    await ctx.updateState("none", {});
    const inline = new InlineKeyboard().text("➕ Add New Service", "admin_add_service").row().text("📋 View/Toggle Services", "admin_list_services");
    await ctx.reply("⚙️ **Service Management**", { parse_mode: "Markdown", reply_markup: inline });
});

bot.hears("📢 Broadcast", async (ctx) => {
    if (ctx.dbUser.role !== "admin") return;
    await ctx.updateState("waiting_for_broadcast", {});
    await ctx.reply("📢 Send the message or photo you want to broadcast to all users. (Or type /cancel)");
});

bot.hears("👥 User Details", async (ctx) => {
    if (ctx.dbUser.role !== "admin") return;
    await ctx.updateState("waiting_for_user_id", {});
    await ctx.reply("👥 **User Management**\n\nEnter the Telegram User ID of the customer:");
});

bot.hears("🎁 Manage Promos", async (ctx) => {
    if (ctx.dbUser.role !== "admin") return;
    await ctx.updateState("none", {});
    const inline = new InlineKeyboard().text("➕ Create Promo Code", "admin_add_promo");
    
    const snapshot = await db.collection("promos").get();
    let text = "🎁 **Active Checkout Promos:**\n\n";
    if (snapshot.empty) text += "No promos active.\n";
    snapshot.forEach(doc => {
        const p = doc.data();
        const typeStr = p.type === "FLAT" ? `₹${p.value} Off` : `${p.value}% Off`;
        text += `🎟 **${doc.id}** | ${typeStr} (Min Order: ₹${p.minOrder})\n👥 Uses: ${p.usedBy.length}/${p.maxUses}\n\n`;
    });
    
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inline });
});

bot.callbackQuery("admin_add_promo", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.updateState("add_promo_code", {});
    await ctx.reply("Step 1/5: Enter the **Promo Code text** (e.g., FESTIVAL50):");
});

bot.callbackQuery("admin_add_service", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.updateState("add_srv_name", {});
    await ctx.reply("Step 1/6: Enter the **Service Name** (e.g., Instagram Followers):", { parse_mode: "Markdown" });
});

bot.callbackQuery("admin_list_services", async (ctx) => {
    await ctx.answerCallbackQuery();
    const snapshot = await db.collection("services").get();
    if (snapshot.empty) return ctx.reply("No services found.");
    
    let inline = new InlineKeyboard();
    snapshot.forEach(doc => {
        const s = doc.data();
        inline.text(`${s.name} [${s.active ? "✅" : "❌"}]`, `toggle_srv_${doc.id}`).row();
    });
    await ctx.reply("Tap a service to toggle it Active/Hidden:", { reply_markup: inline });
});

bot.callbackQuery(/^toggle_srv_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const srvId = ctx.match[1];
    const srvRef = db.collection("services").doc(srvId);
    const srvDoc = await srvRef.get();
    if(srvDoc.exists){
        const newStatus = !srvDoc.data().active;
        await srvRef.update({ active: newStatus });
        await ctx.editMessageText(`Service updated! It is now ${newStatus ? "✅ Live" : "❌ Hidden"}.`);
    }
});

// ==========================================
// 6. CUSTOMER: SMM DEALS & ORDERS
// ==========================================
bot.hears("🛍 Available Deals", async (ctx) => {
    await ctx.updateState("none", {});
    const snapshot = await db.collection("services").where("active", "==", true).get();
    if (snapshot.empty) return ctx.reply("😔 No deals are currently available.");
    
    let inline = new InlineKeyboard();
    let text = "🛍 **Available SMM Deals:**\n\n";
    snapshot.forEach(doc => {
        const s = doc.data();
        text += `🔸 **${s.name}**\n📝 ${s.desc}\n💰 Price: ₹${s.price} per 1000\n📊 Min: ${s.min} | Max: ${s.max}\n\n`;
        inline.text(`🛒 Buy: ${s.name}`, `buy_srv_${doc.id}`).row();
    });
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inline });
});

bot.hears("📦 My Orders", async (ctx) => {
    await ctx.updateState("none", {});
    const snapshot = await db.collection("orders").where("userId", "==", ctx.from.id.toString()).orderBy("timestamp", "desc").limit(5).get();
    if (snapshot.empty) return ctx.reply("📦 You have no recent orders.");
    
    let text = "📦 **Your Recent Orders:**\n\n";
    snapshot.forEach(doc => {
        const o = doc.data();
        text += `🆔 **#${doc.id}**\n🛒 Service: ${o.serviceName}\n🔢 Qty: ${o.quantity} | 💰 Paid: ₹${o.finalPrice}\n⏳ Status: **${o.status.toUpperCase()}**\n\n`;
    });
    await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.callbackQuery(/^buy_srv_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const srvId = ctx.match[1];
    const srvDoc = await db.collection("services").doc(srvId).get();
    if (!srvDoc.exists || !srvDoc.data().active) return ctx.reply("❌ Service unavailable.");
    
    const srv = srvDoc.data();
    await ctx.updateState("order_q_0", { serviceId: srvId, service: srv, answers: [], currentQIndex: 0 });
    await ctx.reply(`🛒 **Ordering:** ${srv.name}\n\n📝 Please provide: **${srv.questions[0]}**`, { parse_mode: "Markdown" });
});

// ==========================================
// 7. TEXT HANDLER (THE BRAIN)
// ==========================================
bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const step = ctx.dbUser.step;
    const data = ctx.dbUser.tempData;
    const userId = ctx.from.id.toString();

    if (text === "/cancel") {
        await ctx.updateState("none", {});
        return ctx.reply("✅ Action cancelled.");
    }

    // --- CREATE PROMO (ADMIN) ---
    if (step === "add_promo_code") {
        await ctx.updateState("add_promo_type", { code: text.trim().toUpperCase() });
        return ctx.reply("Step 2/5: Enter discount type (Type **FLAT** or **PERCENT**):", { parse_mode: "Markdown" });
    }
    if (step === "add_promo_type") {
        const type = text.trim().toUpperCase();
        if (type !== "FLAT" && type !== "PERCENT") return ctx.reply("❌ Please type FLAT or PERCENT.");
        await ctx.updateState("add_promo_value", { ...data, type });
        return ctx.reply(`Step 3/5: Enter the discount value (e.g., 25 for ${type === 'FLAT' ? '₹25' : '25%'}):`);
    }
    if (step === "add_promo_value") {
        await ctx.updateState("add_promo_min_order", { ...data, value: parseFloat(text) });
        return ctx.reply("Step 4/5: Enter **Minimum Order Amount** to use this promo (e.g., 27):");
    }
    if (step === "add_promo_min_order") {
        await ctx.updateState("add_promo_limit", { ...data, minOrder: parseFloat(text) });
        return ctx.reply("Step 5/5: Max number of users who can claim this (e.g., 100):");
    }
    if (step === "add_promo_limit") {
        await db.collection("promos").doc(data.code).set({
            type: data.type, value: data.value, minOrder: data.minOrder, maxUses: parseInt(text), usedBy: [], createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await ctx.updateState("none", {});
        return ctx.reply(`✅ Promo Code **${data.code}** created successfully!`, { parse_mode: "Markdown" });
    }

    // --- USER MANAGEMENT (ADMIN) ---
    if (step === "waiting_for_user_id") {
        const targetUserId = text.trim();
        const targetDoc = await db.collection("users").doc(targetUserId).get();
        if (!targetDoc.exists) {
            await ctx.updateState("none", {});
            return ctx.reply("❌ User not found.");
        }
        const tUser = targetDoc.data();
        let msg = `👤 **Profile**\n**ID:** \`${targetUserId}\`\n**Name:** ${tUser.firstName}\n**Role:** ${tUser.role}\n**Balance:** ₹${(tUser.walletBalance || 0).toFixed(2)}\n\n*Type a number (e.g., 50 or -20) to manually adjust balance, or /cancel.*`;
        await ctx.updateState("admin_edit_balance", { targetUserId });
        return ctx.reply(msg, { parse_mode: "Markdown" });
    }
    if (step === "admin_edit_balance") {
        const amount = parseFloat(text);
        if (isNaN(amount)) return ctx.reply("❌ Enter a valid number.");
        await db.collection("users").doc(data.targetUserId).update({ walletBalance: admin.firestore.FieldValue.increment(amount) });
        await ctx.updateState("none", {});
        await ctx.reply(`✅ Added/Deducted **₹${amount}** for user \`${data.targetUserId}\`.`, { parse_mode: "Markdown" });
        return;
    }

    // --- ADD SERVICE (ADMIN) ---
    if (step === "add_srv_name") {
        await ctx.updateState("add_srv_desc", { name: text });
        return ctx.reply("Step 2/6: Enter a short **Description**:");
    }
    if (step === "add_srv_desc") {
        await ctx.updateState("add_srv_price", { ...data, desc: text });
        return ctx.reply("Step 3/6: Enter **Price per 1000** (e.g., 50.5):");
    }
    if (step === "add_srv_price") {
        await ctx.updateState("add_srv_min", { ...data, price: parseFloat(text) });
        return ctx.reply("Step 4/6: Enter **Minimum Quantity**:");
    }
    if (step === "add_srv_min") {
        await ctx.updateState("add_srv_max", { ...data, min: parseInt(text) });
        return ctx.reply("Step 5/6: Enter **Maximum Quantity**:");
    }
    if (step === "add_srv_max") {
        await ctx.updateState("add_srv_questions", { ...data, max: parseInt(text) });
        return ctx.reply("Step 6/6: What details do you need? (e.g., Target Link, Username):");
    }
    if (step === "add_srv_questions") {
        const questions = text.split(",").map(q => q.trim());
        await db.collection("services").add({ ...data, questions, active: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        await ctx.updateState("none", {});
        return ctx.reply("✅ **Service Added Successfully!**", { parse_mode: "Markdown" });
    }

    // --- BROADCAST (ADMIN) ---
    if (step === "waiting_for_broadcast") {
        await ctx.updateState("none", {});
        await ctx.reply("🚀 Broadcast started...");
        const users = await db.collection("users").get();
        let count = 0;
        for (const user of users.docs) {
            try { await bot.api.copyMessage(user.id, ctx.chat.id, ctx.message.message_id); count++; } catch (e) {}
        }
        return ctx.reply(`✅ Broadcast sent to ${count} users.`);
    }

    // --- ORDER CHECKOUT (CUSTOMER) ---
    if (step && step.startsWith("order_q_")) {
        data.answers.push({ question: data.service.questions[data.currentQIndex], answer: text });
        data.currentQIndex++;

        if (data.currentQIndex < data.service.questions.length) {
            await ctx.updateState(`order_q_${data.currentQIndex}`, data);
            return ctx.reply(`📝 Please provide: **${data.service.questions[data.currentQIndex]}**`, { parse_mode: "Markdown" });
        } else {
            await ctx.updateState("order_quantity", data);
            return ctx.reply(`🔢 **Enter Quantity**\n*(Min: ${data.service.min} | Max: ${data.service.max})*`, { parse_mode: "Markdown" });
        }
    }
    
    if (step === "order_quantity") {
        const qty = parseInt(text);
        if (isNaN(qty) || qty < data.service.min || qty > data.service.max) return ctx.reply(`❌ Qty must be between ${data.service.min} and ${data.service.max}.`);
        
        const originalPrice = parseFloat(((data.service.price / 1000) * qty).toFixed(2));
        data.quantity = qty;
        data.originalPrice = originalPrice;
        data.finalPrice = originalPrice;
        
        await ctx.updateState("order_ask_promo", data);
        return ctx.reply(`💰 Order Total is **₹${originalPrice}**\n\n🎁 **Do you have a Promo Code?**\nType your code below, or type **/skip** to continue without a code.`, { parse_mode: "Markdown" });
    }

    // --- PROMO CODE VALIDATION ---
    if (step === "order_ask_promo") {
        if (text !== "/skip") {
            const code = text.trim().toUpperCase();
            const promoDoc = await db.collection("promos").doc(code).get();

            if (!promoDoc.exists) return ctx.reply("❌ Invalid Promo Code. Try again or type /skip.");
            const promoData = promoDoc.data();

            if (promoData.usedBy.includes(userId)) return ctx.reply("⚠️ You have already used this code. Try another or type /skip.");
            if (promoData.usedBy.length >= promoData.maxUses) return ctx.reply("❌ Code usage limit reached. Try another or type /skip.");
            if (data.originalPrice < promoData.minOrder) return ctx.reply(`❌ Order must be at least ₹${promoData.minOrder} to use this code. Try again or type /skip.`);

            // Apply Discount
            let discountAmount = 0;
            if (promoData.type === "FLAT") discountAmount = promoData.value;
            else if (promoData.type === "PERCENT") discountAmount = (data.originalPrice * promoData.value) / 100;
            
            if (discountAmount > data.originalPrice) discountAmount = data.originalPrice; // Can't be negative

            data.finalPrice = parseFloat((data.originalPrice - discountAmount).toFixed(2));
            data.promoCode = code;
            data.discountAmount = parseFloat(discountAmount.toFixed(2));

            await ctx.reply(`🎉 **Promo Applied!** You saved ₹${data.discountAmount}.`, { parse_mode: "Markdown" });
        }

        await ctx.updateState("order_confirm", data);
        
        const inline = new InlineKeyboard().text("✅ Confirm & Pay", "confirm_order").text("❌ Cancel", "cancel_order");
        let summary = `🧾 **Order Summary**\n\n🛒 ${data.service.name}\n🔢 Qty: ${data.quantity}\n`;
        
        if (data.promoCode) {
            summary += `💰 Original Price: ~~₹${data.originalPrice}~~\n🎁 Promo (${data.promoCode}): -₹${data.discountAmount}\n🔥 **Final Price: ₹${data.finalPrice}**\n\nYour Details:\n`;
        } else {
            summary += `💰 **Total Price: ₹${data.finalPrice}**\n\nYour Details:\n`;
        }
        
        data.answers.forEach(a => summary += `- ${a.question}: ${a.answer}\n`);
        return ctx.reply(summary, { parse_mode: "Markdown", reply_markup: inline });
    }

    return next();
});

// ==========================================
// 8. ORDER PROCESSING & ADMIN MANAGEMENT
// ==========================================
bot.callbackQuery("cancel_order", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.updateState("none", {});
    await ctx.editMessageText("❌ Order Cancelled.");
});

bot.callbackQuery("confirm_order", async (ctx) => {
    await ctx.answerCallbackQuery("Processing...");
    const data = ctx.dbUser.tempData;
    const userId = ctx.from.id.toString();
    if (ctx.dbUser.step !== "order_confirm" || !data.service) return ctx.editMessageText("Session expired.");

    const userDoc = await db.collection("users").doc(userId).get();
    const balance = userDoc.data().walletBalance || 0;

    if (balance < data.finalPrice) {
        await ctx.updateState("none", {});
        return ctx.editMessageText(`❌ **Insufficient Balance!**\nYou have ₹${balance}, but need ₹${data.finalPrice}.`);
    }

    // Deduct Balance & Record Promo Usage
    await db.collection("users").doc(userId).update({ walletBalance: admin.firestore.FieldValue.increment(-data.finalPrice) });
    if (data.promoCode) {
        await db.collection("promos").doc(data.promoCode).update({ usedBy: admin.firestore.FieldValue.arrayUnion(userId) });
    }

    const orderId = "ORD" + Math.floor(100000 + Math.random() * 900000);
    await db.collection("orders").doc(orderId).set({
        userId: userId, serviceId: data.serviceId, serviceName: data.service.name,
        quantity: data.quantity, originalPrice: data.originalPrice, finalPrice: data.finalPrice, 
        promoCode: data.promoCode || null, answers: data.answers, status: "pending",
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await ctx.updateState("none", {});
    await ctx.editMessageText(`✅ **Order Placed!**\n🆔 #${orderId}\n💰 ₹${data.finalPrice} deducted.`, { parse_mode: "Markdown" });

    const admins = await db.collection("users").where("role", "==", "admin").get();
    let adminAlert = `🚨 **NEW ORDER!**\n🆔 #${orderId}\n👤 \`${ctx.from.id}\`\n🛒 ${data.service.name}\n🔢 Qty: ${data.quantity} | 💰 Paid: ₹${data.finalPrice}\n\n**Details:**\n`;
    data.answers.forEach(a => adminAlert += `🔹 ${a.question}: \`${a.answer}\`\n`);
    
    const adminAction = new InlineKeyboard().text("🔄 Processing", `ord_processing_${orderId}`).row()
        .text("✅ Completed", `ord_completed_${orderId}`).row().text("Refund & Cancel", `ord_refund_${orderId}`);

    admins.forEach(async (adminDoc) => { await bot.api.sendMessage(adminDoc.id, adminAlert, { parse_mode: "Markdown", reply_markup: adminAction }); });
});

bot.callbackQuery(/^ord_(processing|completed|refund)_(ORD[0-9]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.dbUser.role !== "admin") return;

    const action = ctx.match[1];
    const orderId = ctx.match[2];
    const ordRef = db.collection("orders").doc(orderId);
    const ordDoc = await ordRef.get();

    if (!ordDoc.exists) return ctx.editMessageText("❌ Order not found.");
    const ordData = ordDoc.data();

    if (action === "refund") {
        if (ordData.status === "refunded") return;
        await db.collection("users").doc(ordData.userId).update({ walletBalance: admin.firestore.FieldValue.increment(ordData.finalPrice) });
        await ordRef.update({ status: "refunded" });
        await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ **Status: REFUNDED (Money returned)**", { parse_mode: "Markdown" });
        await bot.api.sendMessage(ordData.userId, `🔔 **Order Update**\n\nOrder #${orderId} Cancelled. **₹${ordData.finalPrice}** refunded to wallet.`, { parse_mode: "Markdown" });
    } else {
        await ordRef.update({ status: action });
        await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ **Status: ${action.toUpperCase()}**`, { parse_mode: "Markdown" });
        await bot.api.sendMessage(ordData.userId, `🔔 **Order Update**\n\nOrder #${orderId} is now **${action.toUpperCase()}**.`, { parse_mode: "Markdown" });
    }
});

module.exports = webhookCallback(bot, "http");
