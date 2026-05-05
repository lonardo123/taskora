const { Telegraf, session, Markup } = require('telegraf');
require('dotenv').config();
const { pool } = require('./db');
const translate = require('@vitalets/google-translate-api');
const https = require('https');

// ====== Deposit System ======
const ADMIN_ID = process.env.ADMIN_ID; // حط ايدي حسابك
const DEPOSIT_ADDRESS = "TATkFzdGGLmivj8rPxMrNhPHpqvP4ybdpW"; // عنوان USDT TRC20


// ========================
// 📌 إعدادات رئيسية - إضافة MAIN_URL المفقود
// ========================
const MAIN_URL = process.env.MAIN_URL || 'https://perceptive-victory-production.up.railway.app';

// ========================
// 📌 نظام اللغات المتعدد (عربي / إنجليزي)
// ========================
const userLang = {};
const LANGS = ["ar", "en"];

function autoDetectLang(ctx) {
  const sys = ctx.from?.language_code?.split("-")[0] || "ar";
  return LANGS.includes(sys) ? sys : "ar";
}

function setLang(ctx, lang) {
  userLang[ctx.from.id] = lang;
}

function getLang(ctx) {
  return userLang[ctx.from.id] || autoDetectLang(ctx);
}

const t = (lang, key, vars = {}) => {
  const messages = {
    ar: {
      welcome: "👋 أهلاً بك، <b>{name}</b>!\n💰 <b>رصيدك:</b> {balance}$",
      choose_lang: "🌐 اختر لغتك:",
      back: "⬅️ رجوع",
      contact_admin: "📩 مراسلة الإدارة",
      write_message_to_admin: "✍️ اكتب رسالتك أو استفسارك وسيتم إرساله للإدارة.",
      your_balance: "💰 رصيدك",
      earn_sources: "🎁 مصادر الربح",
      Units: "📦 وحداتي",
      withdraw: "📤 طلب سحب",
      referral: "👥 ريفيرال",
      tasks: "📝 مهمات TasksRewardBot",
      rate: "🔗 قيم البوت من هنا",
      facebook: "📩 تواصل معنا على فيسبوك",
      language: "🌐 اللغة",
      videos: "🎬 فيديوهاتي",
      english: "🌐 English",
      arabic: "🌐 العربية",
      lang_changed_ar: "✅ تم تغيير اللغة إلى العربية.",
      lang_changed_en: "✅ Language changed to English.",
      referral_message: `👥 <b>برنامج الإحالة</b>\nهذا رابطك الخاص، شاركه مع أصدقائك واربح من نشاطهم:\n🔗 <code>{refLink}</code>\n💡 <b>كيف تُحتسب أرباح الإحالة؟</b>\nتحصل على <b>5%</b> من أرباح كل مستخدم ينضم من طرفك.\n📊 <b>إحصاءاتك</b>\n- عدد الإحالات: <b>{refsCount}</b>`,
      earn_sources_instructions: `📌 <b>طريقة العمل:</b>\n1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.\n2️⃣ اختر 🕒 <b>TimeWall</b>.\n3️⃣ اربط حسابك عبر الرابط الظاهر.\n4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).\n🔑 <b>طريقة سحب المال من TimeWall:</b>\n- ادخل صفحة Withdraw\n- اضغط على زر "سحب" أعلى الصفحة\n✅ الأرباح تضاف لحسابك مباشرة 💵`,
      earn_videos: "💰 الربح من الفيديوهات",
      earn_videos_instructions: `🎬 <b>الربح من الفيديوهات</b>\n📌 <b>طريقة العمل:</b>\n1️⃣ قم بتحميل إضافة متصفح <b><a href="https://www.mediafire.com/file/6wg2y5mgsd4g6se/TasksRewardBot.zip">Google Chrome</a></b>.\n2️⃣ ثبّت الإضافة على <b>متصفح جديد</b>.\n3️⃣ اضغط على أيقونة الإضافة.\n4️⃣ اكتب <b>رقم حسابك الخاص في البوت</b>.\n5️⃣ اضغط <b>حفظ</b>.\n6️⃣ اضغط على زر <b>Start Worker</b>.\n🚀 سيبدأ العمل تلقائيًا،\n👁️‍🗨️ كل فيديو يتم مشاهدته بنجاح\n💰 يتم إضافة الرصيد إلى حسابك في البوت تلقائيًا.`,
      no_tasks: "❌ لا توجد مهمات متاحة حالياً.",
      min_withdraw_error: "❌ الحد الأدنى للسحب هو {min}$. رصيدك: {balance}$",
      request_wallet: `⚡ لإستلام أرباحك:\nالرجاء إدخال عنوان محفظتك الخاص بعملة USDT الشبكة: TRON (TRC20).\nمثال على العنوان:\nTXXXXXXXXXXXX\nتنبيه مهم:\nتأكد من نسخ العنوان بالكامل و الشبكة: TRON (TRC20)وصحيح 100%، أي خطأ قد يؤدي إلى فقدان الأموال.`,
      invalid_ltc: "❌ عنوان محفظة USDT الشبكة: TRON (TRC20) غير صالح. يجب أن يبدأ بـ T ويكون بطول صحيح.",
      withdrawal_submitted: "✅ تم تقديم طلب سحب بقيمة {amount}$. رصيدك المتبقي: {remaining}$",
      deposit: "💰 إيداع",
deposit_instructions: `💰 <b>طريقة الإيداع</b>

🔹 العملة: USDT
🔹 الشبكة: TRON (TRC20)

📌 <b>العنوان:</b>
<code>{address}</code>

⚠️ أرسل على TRC20 فقط`,
deposit_now: "💳 الإيداع الآن",
send_txid: "✍️ من فضلك أرسل TxID الخاص بعملية الإيداع",
deposit_processing: `⏳ جاري معالجة طلب الإيداع الخاص بك من الإدارة
عند التأكد من إيداعك سيتم إضافة الرصيد إلى حسابك
يرجى الانتظار`,
admin_deposit_requests: "📥 طلبات الإيداع",
deposit_approved: "✅ تم قبول طلب الإيداع وإضافة الرصيد إلى حسابك",
deposit_rejected: "❌ تم رفض طلب الإيداع، يرجى التواصل مع الدعم",
      videos_message: "🎬 اضغط على الزر لعرض وإدارة فيديوهاتك:",
      rate_message: "🌟 لو سمحت قيّم البوت من هنا:\n👉 https://toptelegrambots.com/list/TasksRewardBot",
      facebook_message: "📩 للتواصل معنا زور صفحتنا على فيسبوك:\n👉 https://www.facebook.com/profile.php?id=61581071731231",
      internal_error: "حدث خطأ داخلي.",
      proof_already_submitted: "⚠️ لقد سبق وأن أرسلت إثباتاً لهذه المهمة أو تم اعتمادها بالفعل.",
      proof_submitted: "✅ تم إرسال الإثبات، وسيتم مراجعته من الإدارة.",
      apply_now: "📌 قدّم الآن",
      submit_proof: "📝 إرسال إثبات",
      task_duration: "مدة المهمة",
      after_duration: "بعد انتهاء هذه المدة سيظهر لك زر \"إرسال إثبات\"",
      proof_id: "إثبات",
      user: "المستخدم",
      task: "المهمة",
      reward: "المكافأة",
      proof: "الإثبات",
      task_approved: `✅ تمت الموافقة على إثبات المهمة (ID: {task_id}). المبلغ {amount}$ أُضيف إلى رصيدك.`,
      task_rejected: `❌ تم رفض إثبات المهمة (ID: {task_id}). يمكنك إعادة المحاولة وإرسال إثبات جديد.`,
      referral_commission: `🎉 حصلت على عمولة {amount}$ من إحالة {referee} بعد تنفيذ مهمة.`,
      duration_unspecified: "غير محددة",
      seconds: "{n} ثانية",
      minutes: "{n} دقيقة",
      hours: "{n} ساعة",
      days: "{n} يوم",
      expired: "انتهت",
      task_id: "📋 المهمة #{id}",
      title: "🏷️ العنوان",
      description: "📖 الوصف",
      reward: "💰 السعر",
      duration_label: "⏱️ مدة المهمة",
      apply_prompt: "▶️ اضغط \"📌 قدّم الآن\" لبدء العد.\n",
      can_submit_proof: "⏳ انتهت المدة المحددة. الآن يمكنك إرسال الإثبات.",
      waiting_for_duration: "بعد انقضاء المدة المحددة، سيتم تفعيل زر \"إرسال الإثبات\".\nنرجو منك مراجعة متطلبات المهمة والتأكد من تنفيذها بالكامل وفق الوصف قبل إرسال الإثبات، حيث أن أي نقص قد يؤدي إلى رفض المهمة.\n⏳ الوقت المتبقي لإرسال الإثبات: {time}.",
      status_label: "⏳ حالة التقديم: {status}.",
      submit_proof_prompt: "📩 أرسل الآن إثبات إتمام المهمة رقم {id}",
      photo_attachment: "صورة مرفقة - file_id",
      applied_success: "📌 تم تسجيل تقديمك على المهمة رقم {id}.\n⏱️ مدة المهمة: {duration}.\n⏳ بعد انتهاء هذه المدة سيظهر لك زر \"إرسال إثبات\""
    },
    en: {
      welcome: "👋 Welcome, <b>{name}</b>!\n💰 <b>Your balance:</b> {balance}$",
      choose_lang: "🌐 Choose your language:",
      back: "⬅️ Back",
      contact_admin: "📩 Contact Admin",
      write_message_to_admin: "✍️ Write your message or inquiry and it will be sent to the admin.",
      your_balance: "💰 Your Balance",
      earn_sources: "🎁 Earn Sources",
      Units: "📦 My Units",
      withdraw: "📤 Withdraw",
      referral: "👥 Referrals",
      tasks: "📝 Tasks",
      rate: "🔗 Rate the Bot",
      facebook: "📩 Contact Us on Facebook",
      language: "🌐 Language",
      videos: "🎬 My Videos",
      english: "🌐 English",
      arabic: "🌐 Arabic",
      lang_changed_ar: "✅ Language changed to Arabic.",
      lang_changed_en: "✅ Language changed to English.",
      referral_message: `👥 <b>Referral Program</b>\nYour personal link — share it and earn from your friends' activity:\n🔗 <code>{refLink}</code>\n💡 <b>How referral earnings work?</b>\nYou get <b>5%</b> of all earnings from users who join via your link.\n📊 <b>Your Stats</b>\n- Referrals: <b>{refsCount}</b>`,
      earn_sources_instructions: `📌 <b>How it works:</b>\n1️⃣ Tap 🎁 <b>Earn Sources</b> in the menu.\n2️⃣ Choose 🕒 <b>TimeWall</b>.\n3️⃣ Link your account using the shown link.\n4️⃣ Complete tasks (watch ads – do simple tasks).\n🔑 <b>How to withdraw from TimeWall:</b>\n- Go to Withdraw page\n- Click the "Withdraw" button at the top\n✅ Earnings are added instantly to your account 💵`,
      earn_videos: "💰 Earn From Videos",
      earn_videos_instructions: `🎬 <b>Earn From Videos</b>\n📌 <b>How it works:</b>\n1️⃣ Download the <b><a href="https://www.mediafire.com/file/6wg2y5mgsd4g6se/TasksRewardBot.zip">Google Chrome extension</a></b>.\n2️⃣ Install it on a <b>new browser</b>.\n3️⃣ Click the extension icon.\n4️⃣ Enter <b>your bot account ID</b>.\n5️⃣ Click <b>Save</b>.\n6️⃣ Press <b>Start Worker</b>.\n🚀 The worker will start automatically,\n👁️‍🗨️ Each successfully watched video\n💰 earnings are added to your bot balance automatically.`,
      no_tasks: "❌ No tasks available right now.",
      min_withdraw_error: "❌ Minimum withdrawal is {min}$. Your balance: {balance}$",
      request_wallet: `⚡ To receive your earnings:\nPlease enter your USDT Network: TRON (TRC20).\nExample:\nTXXXXXXXXXXXX\n⚠️ Important:\nMake sure the address Network: TRON (TRC20)is 100% correct. Any mistake may result in lost funds.`,
      invalid_ltc: "❌ Invalid USDT Network: TRON (TRC20) wallet. Must start with T and have correct length.",
      withdrawal_submitted: "✅ Withdrawal request for {amount}$ submitted. Remaining balance: {remaining}$",
      deposit: "💰 Deposit",
deposit_instructions: `💰 <b>Deposit Instructions</b>

🔹 Coin: USDT
🔹 Network: TRON (TRC20)

📌 <b>Address:</b>
<code>{address}</code>

⚠️ TRC20 only`,
deposit_now: "💳 Deposit Now",
send_txid: "✍️ Please send your deposit TxID",
deposit_processing: `⏳ Your deposit request is being processed
Once confirmed, balance will be added
Please wait`,
admin_deposit_requests: "📥 Deposit Requests",
deposit_approved: "✅ Your deposit has been approved and balance added",
deposit_rejected: "❌ Your deposit request was rejected, contact support",
      videos_message: "🎬 Tap the button to view/manage your videos:",
      rate_message: "🌟 Please rate the bot here:\n👉 https://toptelegrambots.com/list/TasksRewardBot",
      facebook_message: "📩 Contact us on our Facebook page:\n👉 https://www.facebook.com/profile.php?id=61581071731231",
      internal_error: "An internal error occurred.",
      proof_already_submitted: "⚠️ You have already submitted proof for this task or it has been approved.",
      proof_submitted: "✅ Proof submitted. Admin will review it.",
      apply_now: "📌 Apply Now",
      submit_proof: "📝 Submit Proof",
      task_duration: "Task Duration",
      after_duration: "After this duration, the 'Submit Proof' button will appear.",
      proof_id: "Proof",
      user: "User",
      task: "Task",
      reward: "Reward",
      proof: "Proof",
      task_approved: `✅ Your proof for task ID {task_id} has been approved. {amount}$ added to your balance.`,
      task_rejected: `❌ Your proof for task ID {task_id} was rejected. You may retry with a new proof.`,
      referral_commission: `🎉 You earned a commission of {amount}$ from referring user {referee} after they completed a task.`,
      duration_unspecified: "Not specified",
      seconds: "{n} sec",
      minutes: "{n} min",
      hours: "{n} hour",
      days: "{n} day",
      expired: "Expired",
      task_id: "📋 Task #{id}",
      title: "🏷️ Title",
      description: "📖 Description",
      reward: "💰 Reward",
      duration_label: "⏱️ Duration",
      apply_prompt: "▶️ Tap \"📌 Apply Now\" to start the countdown.\n",
      can_submit_proof: "⏳ The waiting period has ended. You may now submit your proof.",
      waiting_for_duration: "After the waiting period ends, the \"Submit Proof\" button will appear.\nPlease ensure you've fully completed the task as described. Incomplete submissions may be rejected.\n⏳ Time remaining: {time}.",
      status_label: "⏳ Status: {status}.",
      submit_proof_prompt: "📩 Please send your proof for task #{id}",
      photo_attachment: "Attached photo - file_id",
      applied_success: "📌 Your application for task #{id} has been recorded.\n⏱️ Duration: {duration}.\n⏳ After this period, the \"Submit Proof\" button will appear."
    }
  };
  let text = messages[lang][key] || key;
  for (const k in vars) text = text.replace(`{${k}}`, vars[k]);
  return text;
};


// ✅ دالة التحقق من عنوان TRON (TRC20)
function isValidTRC20Address(address) {
  // التحقق من: يبدأ بـ T + 34 حرفاً + أحرف Base58 صالحة
  const tronRegex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  return tronRegex.test(address.trim());
}

const userSessions = {};
// ====== Debug متغيرات البيئة ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);
console.log('🌐 MAIN_URL:', MAIN_URL);

// ====== إعداد اتصال قاعدة البيانات ======
pool.on('error', (err) => {
  console.error('⚠️ PG client error:', err);
});

// ====== إعداد البوت ======
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في ملف .env');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

bot.use((ctx, next) => {
  const from = ctx.from ? `${ctx.from.id} (${ctx.from.username || ctx.from.first_name})` : 'unknown';
  const text = ctx.message?.text || ctx.updateType;
  console.log('📩', from, '→', text);
  return next();
});

const isAdmin = (ctx) => String(ctx.from?.id) === String(process.env.ADMIN_ID);

// 💰 FaucetPay Payment Function (Litecoin فقط) - بدون axios
async function sendFaucetPayPayment(address, amount) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.FAUCETPAY_API_KEY;
    if (!apiKey) {
      return reject(new Error('❌ FAUCETPAY_API_KEY غير موجود في ملف .env'));
    }

    const postData = JSON.stringify({
      api_key: apiKey,
      to: address,
      amount: amount,
      currency: 'LTC',
      ref: `manual_payment_${Date.now()}`
    });

    const options = {
      hostname: 'faucetpay.io',
      port: 443,
      path: '/api/v1/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.status === 200) {
            resolve({
              success: true,
              txid: response.txid,
              amount: response.amount
            });
          } else {
            reject(new Error(response.message || 'فشل الدفع'));
          }
        } catch (e) {
          reject(new Error('فشل تحليل استجابة FaucetPay'));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// 🔵 أداة مساعدة: تطبيق مكافأة الإحالة (3% من الإيداعات)
async function applyReferralBonus(earnerId, earnedAmount) {
  try {
    // البحث عن الريفيرر لهذا المستخدم
    const ref = await pool.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1', 
      [earnerId]
    );
    
    if (ref.rows.length === 0) return; // لا يوجد ريفيرر
    
    const referrerId = ref.rows[0].referrer_id;
    
    // منع المستخدم من الحصول على عمولة من نفسه
    if (!referrerId || Number(referrerId) === Number(earnerId)) return;
    
    // ✅ حساب العمولة: 3% من مبلغ الإيداع
    const bonus = Number(earnedAmount) * 0.03;
    
    if (bonus <= 0) return; // تجاهل المبالغ الضئيلة
    
    // التأكد من وجود الريفيرر في قاعدة البيانات
    const balRes = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1', 
      [referrerId]
    );
    
    if (balRes.rows.length === 0) {
      // إنشاء المستخدم إذا لم يكن موجوداً
      await pool.query(
        'INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', 
        [referrerId, 0]
      );
    }
    
    // إضافة العمولة لرصيد الريفيرر
    await pool.query(
      'UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', 
      [bonus, referrerId]
    );
    
    // تسجيل العمولة في جدول referral_earnings
    await pool.query(
      'INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)',
      [referrerId, earnerId, bonus]
    );
    
    // تسجيل الكسب في جدول earnings (للسجل المالي)
    try {
      await pool.query(
        'INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)',
        [referrerId, bonus, 'referral_deposit']
      );
    } catch (_) {}
    
    console.log(`🎉 إحالة: أضيفت مكافأة ${bonus.toFixed(4)}$ للمحيل ${referrerId} بسبب إيداع ${earnerId}`);
    
  } catch (e) {
    console.error('❌ applyReferralBonus:', e);
  }
}

bot.command('credit', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = (ctx.message.text || '').trim().split(/\s+/);
  const targetId = parts[1];
  const amount = Number(parts[2]);
  if (!targetId || isNaN(amount)) {
    return ctx.reply('استخدم: /credit <userId> <amount>');
  }
  try {
    await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [amount, targetId]);
    try {
      await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [targetId, amount, 'manual_credit']);
    } catch (_) {}
    await applyReferralBonus(targetId, amount);
    return ctx.reply(`✅ تم إضافة ${amount.toFixed(4)}$ للمستخدم ${targetId} وتطبيق مكافأة الإحالة (إن وجدت).`);
  } catch (e) {
    console.error('❌ /credit:', e);
    return ctx.reply('فشل في إضافة الرصيد.');
  }
});

// 🛠 أمر /admin - قائمة الأدمن مع جميع الأزرار في أسطر منفصلة
bot.command('admin', async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const userId = String(ctx.from.id);
  const adminId = String(process.env.ADMIN_ID);
  console.log('🎯 محاولة دخول لوحة الأدمن:', { userId, adminId });
  if (userId !== adminId) {
    console.log('❌ رفض الدخول');
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }
  ctx.session.isAdmin = true;
  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن. اختر العملية:', Markup.keyboard([
    ['📋 عرض الطلبات', '📊 الإحصائيات'],
    ['➕ إضافة رصيد', '➖ خصم رصيد'],
    ['➕ إضافة مهمة جديدة', '📝 المهمات'],
    ['📝 اثباتات مهمات المستخدمين' , '📈 إدارة الاستثمار'],
    ['💰 معالجة الدفع', '📥 طلبات الإيداع'],
    ['👥 ريفيرال'],
    ['📢 رسالة جماعية'],
    ['📬 رسائل المستخدمين'],
    ['🚪 خروج من لوحة الأدمن']
  ]).resize());
});

// 🏠 /start - رسالة ترحيبية مع زر تحميل فقط (بدون أزرار، بدون قاعدة بيانات، بدون إحالات)
bot.start(async (ctx) => {
    try {
        // ✅ الرسالة الترحيبية (بدون ذكر الرصيد أو اسم المستخدم)
        const welcomeMessage = `🌍 Start Earning Real Money Online with Taskora! 💸✨
No experience needed. No hidden fees. Just simple tasks, real rewards.
✅ Free to join | ✅ Min withdrawal: only $1.00
✅ Get paid in USDT (TRC20) | ✅ Transparent & secure
🔥 Referral Bonus: Invite friends & earn 5% on their earnings + 3% on deposits – lifetime passive income!
🚀 Ready to turn your spare time into real cash?`;

        // ✅ رابط التحميل
        const downloadLink = "https://upload.app/download/taskora/earn.cash71/49e0b46a8044a4774ba5d3f0b771b64b3cbbdfb792c23d3fb7d361557a07e908";

        // ✅ إرسال الرسالة مع زر التحميل فقط - بدون أي أزرار أخرى
        await ctx.reply(welcomeMessage, {
            reply_markup: {
                inline_keyboard: [[
                    { 
                        text: "🚀 Download & Register Now", 
                        url: downloadLink 
                    }
                ]]
            },
            disable_web_page_preview: false
        });
        
    } catch (err) {
        console.error('❌ /start error:', err);
        // نسخة احتياطية في حال حدوث خطأ
        await ctx.reply(`🌍 Start Earning Real Money Online with Taskora! 💸✨
🚀 Download Now: https://upload.app/download/taskora/earn.cash71/49e0b46a8044a4774ba5d3f0b771b64b3cbbdfb792c23d3fb7d361557a07e908`);
    }
});

// 💰 رصيدك
bot.hears((text, ctx) => text === t(getLang(ctx), 'your_balance'), async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    await ctx.replyWithHTML(`💰 ${t(getLang(ctx), 'your_balance')}: <b>${balance.toFixed(4)}$</b>`);
  } catch (err) {
    console.error('❌ رصيدك:', err);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

// 🔵 👥 ريفيرال
bot.hears((text, ctx) => text === t(getLang(ctx), 'referral'), async (ctx) => {
  const userId = ctx.from.id;
  const botUsername = 'TasksRewardBot';
  const lang = getLang(ctx);
  try {
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
    const countRes = await pool.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = $1', [userId]);
    const refsCount = Number(countRes.rows[0]?.c || 0);
    await ctx.replyWithHTML(t(lang, 'referral_message', { refLink, refsCount }));
  } catch (e) {
    console.error('❌ ريفيرال:', e);
    await ctx.reply(t(lang, 'internal_error'));
  }
});

// 🎁 مصادر الربح
bot.hears((text, ctx) => text === t(getLang(ctx), 'earn_sources'), async (ctx) => {
  const userId = ctx.from.id;
  const lang = getLang(ctx);
  
  // تم تعديل الرابط لإزالة المسافات الزائدة بعد uid=
  const timewallUrl = `https://timewall.io/users/login?oid=b328534e6b994827&uid=${userId}`;
  
  await ctx.reply(
    t(lang, 'earn_sources'),
    Markup.inlineKeyboard([
      // ✅ تم التغيير من button.url إلى button.webApp ليعمل داخل البوت
      [Markup.button.webApp('🕒 TimeWall', timewallUrl)],
      [Markup.button.callback(t(lang, 'earn_videos'), 'earn_videos')]
    ])
  );
  await ctx.replyWithHTML(t(lang, 'earn_sources_instructions'));
});

bot.hears(
  (text, ctx) => text === t(getLang(ctx), 'contact_admin'),
  async (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.awaitingAdminMessage = true;
    await ctx.reply(t(getLang(ctx), 'write_message_to_admin'));
  }
);

bot.hears('📬 رسائل المستخدمين', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const res = await pool.query(
        'SELECT * FROM admin_messages WHERE replied = false ORDER BY created_at ASC LIMIT 10'
    );

    if (res.rows.length === 0) {
        return ctx.reply('📭 لا توجد رسائل جديدة.');
    }

    for (const msg of res.rows) {
        await ctx.reply(
            `📩 رسالة #${msg.id}\n` +
            `👤 المستخدم: ${msg.user_id}\n` +
            `📝 ${msg.message}\n\n` +
            `✍️ للرد أرسل:\n/reply ${msg.id} نص الرد`
        );
    }
});

// 💰 زر الإيداع في القائمة الرئيسية - يعمل بشكل صحيح الآن
bot.hears((text, ctx) => {
  const lang = getLang(ctx);
  return text === t(lang, 'deposit');
}, async (ctx) => {
  const lang = getLang(ctx);
  await ctx.replyWithHTML(
    t(lang, 'deposit_instructions', { address: DEPOSIT_ADDRESS }),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, 'deposit_now'), 'DEPOSIT_NOW')]
    ])
  );
});

bot.action("DEPOSIT_NOW", async (ctx) => {
  await ctx.answerCbQuery();
  const lang = getLang(ctx);
  userSessions[ctx.from.id] = {
    ...(userSessions[ctx.from.id] || {}),
    waitingTxID: true
  };
  await ctx.reply(t(lang, "send_txid"));
});

bot.on("text", async (ctx, next) => {
  const session = userSessions[ctx.from.id];
  if (!session?.waitingTxID) return next();
  
  const lang = getLang(ctx);
  const txid = ctx.message.text.trim();
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || "NoUsername";
  
  // مسح حالة الانتظار
  if (userSessions[userId]) {
    userSessions[userId].waitingTxID = false;
  }

  try {
    // حفظ الطلب في قاعدة البيانات
    const res = await pool.query(
      `INSERT INTO deposit_requests (user_id, username, txid, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING id`,
      [userId, username, txid]
    );
    
    const requestId = res.rows[0].id;
    
    await ctx.reply(t(lang, "deposit_processing"));
    
    // إرسال إشعار للأدمن مع أزرار الموافقة/الرفض
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `📥 طلب إيداع جديد #${requestId}
👤 @${username} (ID: ${userId})
🔗 TxID:
<code>${txid}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback("✅ موافقة", `DEP_OK_${requestId}_${userId}`),
          Markup.button.callback("❌ رفض", `DEP_NO_${requestId}_${userId}`)
        ])
      }
    );
    
  } catch (err) {
    console.error('❌ خطأ في معالجة طلب الإيداع:', err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});

// ✅ موافقة الأدمن - مصحح لانتظار المبلغ فقط
bot.action(/DEP_OK_(\d+)_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مصرح');
  
  const requestId = ctx.match[1];
  const userId = ctx.match[2];  // ← هذا هو telegram_id للمستخدم
  
  try {
    // التحقق من وجود الطلب المعلق
    const reqRes = await pool.query(
      'SELECT * FROM deposit_requests WHERE id = $1 AND status = $2',
      [requestId, 'pending']
    );
    
    if (reqRes.rows.length === 0) {
      return ctx.answerCbQuery('⚠️ الطلب معالج مسبقاً أو غير موجود');
    }
    
    // تحديث الحالة إلى موافق عليه
    await pool.query(
      `UPDATE deposit_requests 
       SET status = 'approved', processed_at = NOW(), processed_by = $1 
       WHERE id = $2`,
      [ctx.from.id, requestId]
    );
    
    // ✅ حفظ حالة انتظار المبلغ في جلسة الأدمن
    if (!ctx.session) ctx.session = {};
    ctx.session.awaitingDepositAmount = {
      requestId: requestId,
      userId: userId,  // ← telegram_id كنص
      timestamp: Date.now()
    };
    
    // تعديل الرسالة لإعلام الأدمن بإدخال المبلغ فقط
    await ctx.editMessageText(
      `✅ تم الموافقة على الطلب #${requestId}
👤 المستخدم: ${userId}
💰 الآن أرسل المبلغ الذي سيتم إضافته (رقم فقط):

مثال:
1.50
أو
10.25`
    );
    
   // إرسال إشعار للمستخدم (مع حماية)
try {
    const userLangCode = userLang[userId] || autoDetectLang({ from: { id: Number(userId) } });
    await ctx.telegram.sendMessage(
        userId,
        t(userLangCode, "deposit_approved")
    );
} catch (notifyErr) {
    console.warn(`⚠️ فشل إشعار المستخدم ${userId} بالموافقة:`, notifyErr.message);
}
await ctx.answerCbQuery('✅ أرسل المبلغ الآن');
    
  } catch (err) {
    console.error('❌ خطأ في الموافقة على الإيداع:', err);
    await ctx.answerCbQuery('حدث خطأ');
  }
});
// 📥 معالج جميع الرسائل النصية - مصحح لانتظار المبلغ فقط بعد الموافقة
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim() || '';
  
 
  // ============================================
// 🔹 أولاً: معالجة انتظار المبلغ بعد الموافقة (للأدمن فقط)
// ============================================
if (ctx.session?.awaitingDepositAmount && isAdmin(ctx)) {
  const { requestId, userId, timestamp } = ctx.session.awaitingDepositAmount;
  
  console.log(`🔍 Admin ${ctx.from.id} sent amount for request #${requestId}`);
  
  // ✅ التحقق من أن الرسالة الحالية هي مبلغ رقمي
  const amountText = text;
  const amount = parseFloat(amountText);
  
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('❌ يرجى إدخال مبلغ صحيح (رقم فقط)، مثال: 1.50');
  }
  
  // ✅ التحقق من أن الجلسة لم تنتهِ (صلاحية 5 دقائق)
  if (Date.now() - timestamp > 5 * 60 * 1000) {
    ctx.session.awaitingDepositAmount = null;
    return ctx.reply('⏰ انتهت مهلة إدخال المبلغ. حاول مجدداً.');
  }
  
  try {
    console.log(`💰 Adding ${amount}$ to user ${userId}...`);
    
    // ✅ 1. تحديث رصيد المستخدم (باستخدام telegram_id كنص)
    const updateRes = await pool.query(
      'UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE telegram_id = $2 RETURNING balance',
      [amount, userId]  // ← تمرير كنص، ليس رقم
    );
    
    console.log(`✅ Balance updated. New balance: ${updateRes.rows[0]?.balance}`);
    
    // ✅ 2. تسجيل الكسب في جدول earnings
    await pool.query(
      'INSERT INTO earnings (user_id, amount, source, description, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [userId, amount, 'deposit', `Manual approval of deposit request #${requestId}`]
    );
    
    // ✅ 3. تحديث deposit_requests بالمبلغ والحالة
    await pool.query(
      `UPDATE deposit_requests 
       SET amount = $1, 
           status = 'approved', 
           processed_at = NOW(), 
           processed_by = $2 
       WHERE id = $3`,
      [amount, ctx.from.id, requestId]
    );
    
    console.log(`✅ Deposit request #${requestId} updated with amount: ${amount}`);
    
    // ✅ 4. تطبيق مكافأة الإحالة (3% من الإيداع) ← هذا هو السطر المهم!
    await applyReferralBonus(userId, amount);
    
    // ✅ 5. إرسال إشعار للمستخدم (مع حماية الخطأ)
    try {
      const userLangCode = userLang[userId] || autoDetectLang({ from: { id: Number(userId) } });
      await ctx.telegram.sendMessage(
        userId,
        t(userLangCode, 'deposit_approved') + `\n💰 تم إضافة ${amount.toFixed(4)}$ لرصيدك`
      );
      console.log(`📩 User ${userId} notified`);
    } catch (notifyErr) {
      console.warn(`⚠️ Failed to notify user ${userId}:`, notifyErr.message);
      // لا نوقف العملية إذا فشل الإشعار
    }
    
    // ✅ 6. تأكيد للأدمن (قبل مسح الجلسة)
    await ctx.reply(`✅ تم إضافة ${amount.toFixed(4)}$ للمستخدم ${userId}
💰 رصيده الجديد: ${updateRes.rows[0]?.balance || 'N/A'}$
🎁 تم تطبيق مكافأة الإحالة 3% (إن وجدت)`);
    
    console.log(`✅ Admin ${ctx.from.id} confirmed`);
    
    // ✅ 7. مسح حالة الانتظار (أخيرًا)
    ctx.session.awaitingDepositAmount = null;
    
  } catch (err) {
    console.error('❌ Critical error in add amount:', err);
    await ctx.reply(`❌ حدث خطأ: ${err.message || 'فشل غير معروف'}`);
  }
  
  return; // ← مهم جدًا: منع تنفيذ الكود التالي
}
  
  // ============================================
  // 🔹 ثانياً: معالجة حالة انتظار TxID (الكود الأصلي للمستخدمين)
  // ============================================
  const session = userSessions[ctx.from.id];
  if (!session?.waitingTxID) return next();
  
  const lang = getLang(ctx);
  const txid = text;
  const txUserId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || "NoUsername";
  
  // مسح حالة الانتظار
  if (userSessions[txUserId]) {
    userSessions[txUserId].waitingTxID = false;
  }

  try {
    // حفظ الطلب في قاعدة البيانات
    const res = await pool.query(
      `INSERT INTO deposit_requests (user_id, username, txid, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING id`,
      [txUserId, username, txid]
    );
    
    const newRequestId = res.rows[0].id;
    
    await ctx.reply(t(lang, "deposit_processing"));
    
    // إرسال إشعار للأدمن مع أزرار الموافقة/الرفض
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `📥 طلب إيداع جديد #${newRequestId}
👤 @${username} (ID: ${txUserId})
🔗 TxID:
<code>${txid}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback("✅ موافقة", `DEP_OK_${newRequestId}_${txUserId}`),
          Markup.button.callback("❌ رفض", `DEP_NO_${newRequestId}_${txUserId}`)
        ])
      }
    );
    
  } catch (err) {
    console.error('❌ خطأ في معالجة طلب الإيداع:', err);
    await ctx.reply(t(lang, 'internal_error'));
  }
  
  return next();
});
// ❌ رفض الأدمن
bot.action(/DEP_NO_(\d+)_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مصرح');
  
  const requestId = ctx.match[1];
  const userId = ctx.match[2];
  
  try {
    await pool.query(
      `UPDATE deposit_requests 
       SET status = 'rejected', processed_at = NOW(), processed_by = $1 
       WHERE id = $2 AND status = 'pending'`,
      [ctx.from.id, requestId]
    );
    
    await ctx.editMessageText(`❌ تم رفض الطلب #${requestId}`);
    
    // إرسال إشعار للمستخدم (مع حماية)
try {
    const userLangCode = userLang[userId] || autoDetectLang({ from: { id: userId } });
    await ctx.telegram.sendMessage(
        userId,
        t(userLangCode, "deposit_rejected")
    );
} catch (notifyErr) {
    console.warn(`⚠️ فشل إشعار المستخدم ${userId} بالرفض:`, notifyErr.message);
}
    
  } catch (err) {
    console.error('❌ خطأ في رفض الإيداع:', err);
    await ctx.answerCbQuery('حدث خطأ');
  }
});

bot.hears('📥 طلبات الإيداع', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ الوصول مرفوض.');
  
  try {
    const res = await pool.query(
      `SELECT id, user_id, username, txid, created_at 
       FROM deposit_requests 
       WHERE status = 'pending' 
       ORDER BY created_at DESC 
       LIMIT 20`
    );
    
    if (res.rows.length === 0) {
      return ctx.reply('✅ لا توجد طلبات إيداع معلقة حالياً.');
    }
    
    // ✅ عرض كل طلب في رسالة منفصلة مع أزرار الموافقة/الرفض
    for (const req of res.rows) {
      const createdAt = new Date(req.created_at).toLocaleString('ar-EG', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
      });
      
      // ✅ إرسال كل طلب كرسالة منفصلة مع أزرار تفاعلية (الكود المصحح)
      await ctx.replyWithHTML(
        `📥 طلب إيداع جديد #${req.id}
👤 ${req.username || req.user_id}
⏰ ${createdAt}
🔗 TxID:
<code>${req.txid}</code>`,
        {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          // ✅ التصحيح: بناء reply_markup يدويًا بدلاً من Markup.inlineKeyboard
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ موافقة", callback_data: `DEP_OK_${req.id}_${req.user_id}` },
                { text: "❌ رفض", callback_data: `DEP_NO_${req.id}_${req.user_id}` }
              ]
            ]
          }
        }
      );
    }
    
    // ✅ رسالة ختامية صغيرة
    await ctx.reply('✅ اضغط على الأزرار أعلاه للموافقة أو الرفض على كل طلب.');
    
  } catch (err) {
    console.error('❌ خطأ في عرض طلبات الإيداع:', err);
    await ctx.reply('حدث خطأ أثناء جلب الطلبات.');
  }
});
// ✅ عرض المهمات (للمستخدمين)
bot.hears((text, ctx) => text === t(getLang(ctx), 'tasks'), async (ctx) => {
  try {
    const userId = ctx.from.id;
    const lang = getLang(ctx);
    const res = await pool.query(
      `SELECT t.id, t.title, t.description, t.price, COALESCE(t.duration_seconds, 2592000) AS duration_seconds,
      ut.status, ut.created_at AS applied_at
      FROM tasks t
      LEFT JOIN user_tasks ut
      ON ut.task_id = t.id AND ut.user_id = $1
      WHERE NOT EXISTS (
        SELECT 1 FROM user_tasks ut2
        WHERE ut2.task_id = t.id
        AND ut2.user_id = $1
        AND ut2.status IN ('pending','approved')
      )
      ORDER BY t.id DESC
      LIMIT 20`,
      [userId]
    );
    if (res.rows.length === 0) {
      return ctx.reply(t(lang, 'no_tasks'));
    }
    const formatDuration = (secs) => {
      if (!secs) return t(lang, 'duration_unspecified');
      if (secs < 60) return t(lang, 'seconds', { n: secs });
      if (secs < 3600) return t(lang, 'minutes', { n: Math.floor(secs / 60) });
      if (secs < 86400) return t(lang, 'hours', { n: Math.floor(secs / 3600) });
      return t(lang, 'days', { n: Math.floor(secs / 86400) });
    };
    const formatRemaining = (ms) => {
      if (ms <= 0) return t(lang, 'expired');
      const secs = Math.ceil(ms / 1000);
      if (secs < 60) return t(lang, 'seconds', { n: secs });
      if (secs < 3600) return t(lang, 'minutes', { n: Math.ceil(secs / 60) });
      if (secs < 86400) return t(lang, 'hours', { n: Math.ceil(secs / 3600) });
      return t(lang, 'days', { n: Math.ceil(secs / 86400) });
    };
    for (const task of res.rows) {
      const price = parseFloat(task.price) || 0;
      const duration = Number(task.duration_seconds) || 2592000;
      let msg =
        `${t(lang, 'task_id', { id: task.id })}\n` +
        `${t(lang, 'title')}: ${task.title}\n` +
        `${t(lang, 'description')}: ${task.description}\n` +
        `${t(lang, 'reward')}: ${price.toFixed(6)}$\n` +
        `${t(lang, 'duration_label')}: ${formatDuration(duration)}\n`;
      const buttons = [];
      const status = task.status;
      if (!status || status === 'rejected') {
        msg += t(lang, 'apply_prompt');
        buttons.push([{ text: t(lang, 'apply_now'), callback_data: `apply_${task.id}` }]);
      } else if (status === 'applied') {
        if (task.applied_at) {
          const appliedAt = new Date(task.applied_at);
          const deadline = new Date(appliedAt.getTime() + duration * 1000);
          const now = new Date();
          if (now >= deadline) {
            msg += t(lang, 'can_submit_proof');
            buttons.push([{ text: t(lang, 'submit_proof'), callback_data: `submit_${task.id}` }]);
          } else {
            const remaining = deadline - now;
            msg += t(lang, 'waiting_for_duration', { time: formatRemaining(remaining) });
          }
        } else {
          msg += t(lang, 'apply_prompt');
          buttons.push([{ text: t(lang, 'apply_now'), callback_data: `apply_${task.id}` }]);
        }
      } else {
        msg += t(lang, 'status_label', { status });
      }
      if (buttons.length > 0) {
        await ctx.reply(msg, { reply_markup: { inline_keyboard: buttons } });
      } else {
        await ctx.reply(msg);
      }
    }
  } catch (err) {
    console.error('❌ عرض المهمات:', err);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

// 💰 زر الإيداع في القائمة الرئيسية
bot.hears((text, ctx) => text === t(getLang(ctx), 'deposit'), async (ctx) => {
  const lang = getLang(ctx);
  await ctx.replyWithHTML(
    t(lang, 'deposit_instructions', { address: DEPOSIT_ADDRESS }),
    Markup.keyboard([
      [t(lang, 'deposit_now')],
      [t(lang, 'back')]
    ]).resize()
  );
});

// 📥 عرض طلبات الإيداع للأدمن
bot.hears('📥 طلبات الإيداع', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ الوصول مرفوض.');
  
  // جلب الطلبات المعلقة من الذاكرة المؤقتة
  const pendingRequests = Object.values(depositRequests).filter(req => req.status === 'pending');
  
  if (pendingRequests.length === 0) {
    return ctx.reply('✅ لا توجد طلبات إيداع معلقة حالياً.');
  }
  
  let message = `📥 <b>طلبات الإيداع المعلقة (${pendingRequests.length})</b>\n\n`;
  
  for (const req of pendingRequests) {
    message += `👤 <b>${req.username}</b> (ID: ${req.userId})\n`;
    message += `🔗 TxID: <code>${req.txid}</code>\n`;
    message += `━━━━━━━━━━━━━━━━━━\n`;
  }
  
  await ctx.replyWithHTML(message);
});
bot.action('earn_videos', async (ctx) => {
  const lang = getLang(ctx);
  await ctx.answerCbQuery();
  await ctx.replyWithHTML(t(lang, 'earn_videos_instructions'));
});

// ✅ عند الضغط على زر "إرسال إثبات"
bot.action(/^submit_(\d+)$/, async (ctx) => {
  try {
    const taskId = ctx.match[1];
    const userId = ctx.from.id;
    if (!userSessions[userId]) userSessions[userId] = {};
    userSessions[userId].awaiting_task_submission = taskId;
    const lang = getLang(ctx);
    await ctx.reply(t(lang, 'submit_proof_prompt', { id: taskId }));
  } catch (err) {
    console.error("❌ submit action error:", err.message, err.stack);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

// ✅ عند الضغط على زر "قدّم الآن" - تصحيح خطأ كتابي في الكود الأصلي
bot.action(/^apply_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const taskId = Number(ctx.match[1]);
    const userId = ctx.from.id;
    let durationSeconds = 30 * 24 * 60 * 60;
    try {
      const tRes = await pool.query('SELECT duration_seconds FROM tasks WHERE id = $1', [taskId]);
      if (tRes.rows.length && tRes.rows[0].duration_seconds) {
        durationSeconds = Number(tRes.rows[0].duration_seconds);
      }
    } catch (e) {
      console.error('❌ خطأ جلب duration_seconds:', e);
    }
    await pool.query(
      `INSERT INTO user_tasks (user_id, task_id, status, created_at)
      VALUES ($1, $2, 'applied', NOW())
      ON CONFLICT (user_id, task_id) DO UPDATE
      SET status = 'applied', created_at = NOW()`,
      [userId, taskId]
    );
    const lang = getLang(ctx);
    const formatDuration = (secs) => {
      if (!secs) return t(lang, 'duration_unspecified');
      if (secs < 60) return t(lang, 'seconds', { n: secs });
      if (secs < 3600) return t(lang, 'minutes', { n: Math.floor(secs / 60) });
      if (secs < 86400) return t(lang, 'hours', { n: Math.floor(secs / 3600) });
      return t(lang, 'days', { n: Math.floor(secs / 86400) });
    };
    await ctx.reply(
      t(lang, 'applied_success', {
        id: taskId,
        duration: formatDuration(durationSeconds)
      })
    );
  } catch (err) {
    console.error('❌ apply error:', err);
    try { await ctx.answerCbQuery(); } catch (_) {}
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

// ✅ استقبال الإثبات من المستخدم
bot.on("message", async (ctx, next) => {
  const userId = ctx.from.id;
  if (!userSessions[userId]) userSessions[userId] = {};
  const session = userSessions[userId];
  if (session.awaiting_task_submission) {
    const taskId = Number(session.awaiting_task_submission);
    let proof = ctx.message.text || "";
    if (ctx.message.photo && ctx.message.photo.length) {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      proof = `📷 ${t(getLang(ctx), 'photo_attachment')}: ${fileId}`;
    }
    try {
      await pool.query('BEGIN');
      const exists = await pool.query(
        'SELECT status FROM user_tasks WHERE user_id = $1 AND task_id = $2',
        [userId, taskId]
      );
      if (exists.rows.length && ['pending', 'approved'].includes(exists.rows[0].status)) {
        await pool.query('ROLLBACK');
        session.awaiting_task_submission = null;
        const lang = getLang(ctx);
        await ctx.reply(t(lang, 'proof_already_submitted'));
        return;
      }
      await pool.query(
        "INSERT INTO task_proofs (task_id, user_id, proof, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())",
        [taskId, userId, proof]
      );
      await pool.query(
        `INSERT INTO user_tasks (user_id, task_id, status)
        VALUES ($1, $2, 'pending')
        ON CONFLICT (user_id, task_id) DO UPDATE
        SET status = 'pending', created_at = NOW()`,
        [userId, taskId]
      );
      await pool.query('COMMIT');
      const lang = getLang(ctx);
      await ctx.reply(t(lang, 'proof_submitted'));
      session.awaiting_task_submission = null;
    } catch (err) {
      try { await pool.query('ROLLBACK'); } catch (_) {}
      console.error("❌ خطأ أثناء حفظ الإثبات:", err);
      await ctx.reply(t(getLang(ctx), 'internal_error'));
    }
    return;
  }
  return next();
});

// 🔗 قيم البوت
bot.hears((text, ctx) => text === t(getLang(ctx), 'rate'), async (ctx) => {
  const lang = getLang(ctx);
  try {
    await ctx.reply(
      t(lang, 'rate_message'),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: lang === 'ar' ? '🔗 افتح صفحة التقييم' : '🔗 Open Rating Page', url: 'https://toptelegrambots.com/list/TasksRewardBot' }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("❌ خطأ في زر التقييم:", err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});

// 📩 تواصل معنا على فيسبوك
bot.hears((text, ctx) => text === t(getLang(ctx), 'facebook'), async (ctx) => {
  const lang = getLang(ctx);
  try {
    await ctx.reply(
      t(lang, 'facebook_message'),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: lang === 'ar' ? '📩 افتح صفحتنا على فيسبوك' : '📩 Open Facebook Page', url: 'https://www.facebook.com/profile.php?id=61581071731231' }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("❌ خطأ في زر فيسبوك:", err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});

const MIN_WITHDRAW = 1.00;

// 📤 طلب سحب
bot.hears((text, ctx) => text === t(getLang(ctx), 'withdraw'), async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const userId = ctx.from.id;
  const lang = getLang(ctx);
  try {
    const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    if (balance < MIN_WITHDRAW) {
      return ctx.reply(t(lang, 'min_withdraw_error', { min: MIN_WITHDRAW, balance: balance.toFixed(4) }));
    }
    ctx.session.awaiting_withdraw = true;
    await ctx.reply(t(lang, 'request_wallet'));
  } catch (err) {
    console.error('❌ طلب سحب:', err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});

// 💰 زر الإيداع - يعمل مع جميع اللغات بعد التغيير
bot.hears((text, ctx) => {
  const lang = getLang(ctx);
  return text === t(lang, 'deposit');
}, async (ctx) => {
  const lang = getLang(ctx);
  await ctx.replyWithHTML(
    t(lang, 'deposit_instructions', { address: DEPOSIT_ADDRESS }),
    Markup.inlineKeyboard([
      [Markup.button.callback(t(lang, 'deposit_now'), 'DEPOSIT_NOW')]
    ])
  );
});

// 💰 معالجة الدفع اليدوي عبر FaucetPay
bot.hears('💰 معالجة الدفع', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'awaiting_wallet_for_payment';
  ctx.session.paymentStep = 'address';
  await ctx.reply('💳 أدخل عنوان محفظة Litecoin:');
});

// 📢 رسالة جماعية
bot.hears('📢 رسالة جماعية', async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.awaitingBroadcast = true;
    await ctx.reply('✉️ أرسل الرسالة التي تريد إرسالها لجميع المستخدمين:');
});

// 📥 معالج جميع الرسائل النصية
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim() || '';
  // 🚫 تجاهل معالجة الأزرار هنا
  const adminButtons = [
    '📋 عرض الطلبات',
    '📊 الإحصائيات',
    '➕ إضافة رصيد',
    '➖ خصم رصيد',
    '➕ إضافة مهمة جديدة',
    '📝 المهمات',
    '📝 اثباتات مهمات المستخدمين',
    '💰 معالجة الدفع',
    '📥 طلبات الإيداع',
    '👥 ريفيرال',
    '📢 رسالة جماعية',
    '📬 رسائل المستخدمين',
    '📈 إدارة الاستثمار',
    '📈 وحداتي',
    '🚪 خروج من لوحة الأدمن'
  ];
  if (adminButtons.includes(text)) {
    return next();
  }
  // 🚫 تجاهل أزرار المستخدم (ديناميكية حسب اللغة)
  const lang = getLang(ctx);
  const userButtons = [
    t(lang, 'deposit'),
    t(lang, 'videos'),
    t(lang, 'Units'),
    t(lang, 'your_balance'),
    t(lang, 'earn_sources'),
    t(lang, 'withdraw'),
    t(lang, 'referral'),
    t(lang, 'tasks'),
    t(lang, 'facebook')
  ];
  if (userButtons.includes(text)) {
    return next();
  }
  if (ctx.session.awaitingAdminMessage) {
    const userId = ctx.from.id;
    const message = ctx.message.text;
    await pool.query(
      'INSERT INTO admin_messages (user_id, message) VALUES ($1, $2)',
      [userId, message]
    );
    ctx.session.awaitingAdminMessage = false;
    await ctx.reply(
      getLang(ctx) === 'ar'
        ? '✅ تم إرسال رسالتك للإدارة، سيتم الرد عليك قريبًا.'
        : '✅ Your message has been sent to the admin. You will receive a reply soon.'
    );
    // إرسال نسخة للإدمن
    await bot.telegram.sendMessage(
      process.env.ADMIN_ID,
      `📩 رسالة جديدة من مستخدم:\n👤 ID: ${userId}\n📝 الرسالة:\n${message}`
    );
    return;
  }
  // 📢 معالجة الرسالة الجماعية
  if (ctx.session.awaitingBroadcast) {
    if (!isAdmin(ctx)) {
      ctx.session.awaitingBroadcast = false;
      return ctx.reply('❌ غير مصرح.');
    }
    const originalMessage = text;
    ctx.session.awaitingBroadcast = false;
    try {
      await ctx.reply('📤 جاري إرسال الرسالة إلى جميع المستخدمين...');
      const users = await pool.query('SELECT telegram_id FROM users');
      const total = users.rows.length;
      let sent = 0;
      let failed = 0;
      for (let i = 0; i < users.rows.length; i++) {
        const uid = users.rows[i].telegram_id;
        const userLangCode = userLang[uid] || 'ar';
        let finalMessage = originalMessage;
        if (userLangCode === 'en') {
          try {
            const res = await translate(originalMessage, { to: 'en' });
            finalMessage = res.text;
          } catch (e) {
            console.warn(`⚠️ فشل ترجمة للمستخدم ${uid}`);
          }
        }
        try {
          await bot.telegram.sendMessage(uid, finalMessage, { parse_mode: 'HTML' });
          sent++;
        } catch (e) {
          failed++;
        }
        if ((i + 1) % 50 === 0 || i === users.rows.length - 1) {
          await ctx.reply(`🔄 ${i + 1}/${total} (${Math.round(((i + 1) / total) * 100)}%)`);
        }
      }
      await ctx.reply(
        `✅ اكتمل الإرسال!\n` +
        `📬 ناجح: ${sent}\n` +
        `❌ فشل: ${failed}\n` +
        `📊 المجموع: ${total}`
      );
    } catch (err) {
      console.error('❌ Broadcast error:', err);
      await ctx.reply(`❌ فشل الإرسال: ${err.message || 'خطأ غير معروف'}`);
    }
    return;
  }

if (text === t(lang, 'deposit_now')) {
  userSessions[ctx.from.id] = { waitingTxID: true };
  await ctx.reply(t(lang, 'send_txid'));
  return;
}

  // 💰 معالجة الدفع اليدوي
  if (ctx.session.awaitingAction === 'awaiting_wallet_for_payment') {
    if (ctx.session.paymentStep === 'address') {
      const address = text;
      if (!/^([LM][a-km-zA-HJ-NP-Z1-9]{26,33}|ltc1[a-z0-9]{39,59})$/i.test(address)) {
        return ctx.reply('❌ عنوان محفظة غير صالح. يجب أن يكون عنوان Litecoin صالح (يبدأ بـ L أو M أو ltc1).');
      }
      ctx.session.paymentWallet = address;
      ctx.session.paymentStep = 'amount';
      return ctx.reply('💵 أدخل المبلغ بالدولار (الحد الأدنى: 0.01$)\nمثال: 5.50');
    } else if (ctx.session.paymentStep === 'amount') {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 0.01 || amount > 100) {
        return ctx.reply('❌ المبلغ غير صالح. أدخل رقمًا بين 0.01 و 100 دولار.');
      }
      const wallet = ctx.session.paymentWallet;
      try {
        await ctx.reply('⏳ جاري تنفيذ الدفع عبر FaucetPay...');
        const result = await sendFaucetPayPayment(wallet, amount);
        await ctx.reply(
          `تم الدفع بنجاح ✅\n` +
          `🪙 العملة: لايتكوين (LTC)\n` +
          `💰 المبلغ: ${result.amount} دولار\n` +
          `🔗 TXID: ${result.txid}`
        );
        ctx.session.awaitingAction = null;
        ctx.session.paymentStep = null;
        ctx.session.paymentWallet = null;
      } catch (error) {
        await ctx.reply(
          `❌ فشل الدفع:\n` +
          `⚠️ السبب: ${error.message || 'خطأ غير معروف'}`
        );
        ctx.session.awaitingAction = null;
        ctx.session.paymentStep = null;
        ctx.session.paymentWallet = null;
      }
      return;
    }
  }
 // —— طلب السحب ——
if (ctx.session.awaiting_withdraw) {
  if (!isValidTRC20Address(text)) {
    return ctx.replyWithHTML(
      `❌ ${t(getLang(ctx), 'invalid_ltc')}\n\n` +
      `يجب أن:\n` +
      `• يبدأ بالحرف <b>T</b>\n` +
      `• يكون طوله 34 حرفاً بالضبط (مثل: TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX)\n` +
      `• يحتوي على أحرف وأرقام صالحة (Base58)\n\n` +
      `مثال صحيح:\n<code>TJYeasTPa6gpEEfYb36X9dU3uG7Qg5L5nL</code>`
    );
  }
  const userId = ctx.from.id;
  try {
    const userRes = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = parseFloat(userRes.rows[0]?.balance) || 0;
    if (balance < MIN_WITHDRAW) {
      return ctx.reply(t(getLang(ctx), 'min_withdraw_error', { min: MIN_WITHDRAW, balance: balance.toFixed(4) }));
    }
    const withdrawAmount = Math.floor(balance * 100) / 100;
    const remaining = balance - withdrawAmount;
    await pool.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)', [userId, withdrawAmount, text.toUpperCase()]);
    await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [remaining, userId]);
    await ctx.reply(t(getLang(ctx), 'withdrawal_submitted', { amount: withdrawAmount.toFixed(2), remaining: remaining.toFixed(4) }));
    ctx.session.awaiting_withdraw = false;
  } catch (err) {
    console.error('❌ خطأ في معالجة السحب:', err);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
  return;
}
  // —— إضافة / خصم رصيد ——
  if (ctx.session.awaitingAction === 'add_balance' || ctx.session.awaitingAction === 'deduct_balance') {
    if (!ctx.session.targetUser) {
      ctx.session.targetUser = text;
      return ctx.reply('💵 أرسل المبلغ:');
    } else {
      const userId = ctx.session.targetUser;
      const amount = parseFloat(text);
      if (isNaN(amount)) {
        ctx.session = {};
        return ctx.reply('❌ المبلغ غير صالح.');
      }
      try {
        const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
        if (res.rows.length === 0) {
          ctx.session = {};
          return ctx.reply('❌ المستخدم غير موجود.');
        }
        let balance = parseFloat(res.rows[0].balance) || 0;
        let newBalance = ctx.session.awaitingAction === 'add_balance' ? balance + amount : balance - amount;
        if (newBalance < 0) newBalance = 0;
        await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, userId]);
        if (ctx.session.awaitingAction === 'add_balance' && amount > 0) {
          await applyReferralBonus(userId, amount);
          try { await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [userId, amount, 'admin_adjust']); } catch(_){}
        }
        ctx.reply(`✅ تم ${ctx.session.awaitingAction === 'add_balance' ? 'إضافة' : 'خصم'} ${amount.toFixed(4)}$ للمستخدم ${userId}.\n💰 رصيده الجديد: ${newBalance.toFixed(4)}$`);
      } catch (err) {
        console.error('❌ خطأ تحديث الرصيد:', err);
        ctx.reply('❌ فشل تحديث الرصيد.');
      }
      ctx.session = {};
      return;
    }
  }
  // ➕ إضافة مهمة جديدة
  if (ctx.session && ctx.session.awaitingAction === 'add_task') {
    if (!isAdmin(ctx)) {
      delete ctx.session.awaitingAction;
      return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
    }
    const raw = ctx.message.text || '';
    const parts = raw.split('|').map(p => p.trim());
    if (parts.length < 3) {
      return ctx.reply('❌ صيغة خاطئة. استخدم: العنوان | الوصف | السعر | المدة (اختياري)\n' +
        'مثال: coinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 30d');
    }
    const title = parts[0];
    let description = '';
    let priceStr = '';
    let durationStr = null;
    if (parts.length === 3) {
      description = parts[1];
      priceStr = parts[2];
    } else {
      durationStr = parts[parts.length - 1];
      priceStr = parts[parts.length - 2];
      description = parts.slice(1, parts.length - 2).join(' | ');
    }
    const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
    }
    let cleanReward = numMatch[0].replace(',', '.');
    const price = parseFloat(cleanReward);
    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010');
    }
    const parseDurationToSeconds = (s) => {
      if (!s) return null;
      s = ('' + s).trim().toLowerCase();
      const m = s.match(/^(\d+(?:[.,]\d+)?)(s|sec|secs|m|min|h|d)?$/);
      if (!m) return null;
      let num = m[1].replace(',', '.');
      let val = parseFloat(num);
      if (isNaN(val) || val < 0) return null;
      const unit = m[2] || '';
      switch (unit) {
        case 's': case 'sec': case 'secs': return Math.round(val);
        case 'm': case 'min': return Math.round(val * 60);
        case 'h': return Math.round(val * 3600);
        case 'd': return Math.round(val * 86400);
        default: return Math.round(val);
      }
    };
    const DEFAULT_DURATION_SECONDS = 30 * 24 * 60 * 60;
    let durationSeconds = DEFAULT_DURATION_SECONDS;
    if (durationStr) {
      const parsed = parseDurationToSeconds(durationStr);
      if (parsed === null || parsed <= 0) {
        return ctx.reply('❌ صيغة المدة غير مفهومة. استخدم أمثلة: 3600s أو 60m أو 1h أو 5d');
      }
      durationSeconds = parsed;
    }
    try {
      const res = await pool.query(
        'INSERT INTO tasks (title, description, price, duration_seconds) VALUES ($1,$2,$3,$4) RETURNING id, title, price, duration_seconds',
        [title, description, price, durationSeconds]
      );
      const formatDuration = (secs) => {
        if (!secs) return 'غير محددة';
        if (secs % 86400 === 0) return `${secs / 86400} يوم`;
        if (secs % 3600 === 0) return `${secs / 3600} ساعة`;
        if (secs % 60 === 0) return `${secs / 60} دقيقة`;
        return `${secs} ثانية`;
      };
      const formattedDescription = description.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
      await ctx.replyWithHTML(
        `✅ تم إضافة المهمة بنجاح.\n📌 <b>العنوان:</b> ${res.rows[0].title}\n` +
        `📝 <b>الوصف:</b> ${formattedDescription}\n` +
        `💰 <b>السعر:</b> ${parseFloat(res.rows[0].price).toFixed(4)}$\n` +
        `⏱️ <b>مدة المهمة:</b> ${formatDuration(res.rows[0].duration_seconds)}`,
        { disable_web_page_preview: true }
      );
      delete ctx.session.awaitingAction;
    } catch (err) {
      console.error('❌ إضافة مهمة: ', err.message);
      console.error(err.stack);
      ctx.reply('حدث خطأ أثناء إضافة المهمة. راجع سجلات السيرفر (console) لمعرفة التفاصيل.');
    }
    return;
  }
  // 📌 استلام بيانات التعديل
  if (!ctx.session || !ctx.session.awaitingEdit) return next();
  if (!isAdmin(ctx)) {
    ctx.session.awaitingEdit = null;
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }
  const taskId = ctx.session.awaitingEdit;
  const raw = ctx.message.text || '';
  const parts = raw.split('|').map(p => p.trim());
  if (parts.length < 3) {
    return ctx.reply('⚠️ الصيغة غير صحيحة. استخدم: العنوان | الوصف | السعر | المدة (اختياري)\nمثال:\ncoinpayu | سجل عبر الرابط https://... | 0.0500 | 10d');
  }
  const title = parts[0];
  let description = '';
  let priceStr = '';
  let durationStr = null;
  if (parts.length === 3) {
    description = parts[1];
    priceStr = parts[2];
  } else {
    durationStr = parts[parts.length - 1];
    priceStr = parts[parts.length - 2];
    description = parts.slice(1, parts.length - 2).join(' | ');
  }
  const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
  if (!numMatch) {
    return ctx.reply('❌ السعر غير صالح. استخدم مثلاً: 0.0500');
  }
  const price = parseFloat(numMatch[0].replace(',', '.'));
  if (isNaN(price) || price <= 0) {
    return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
  }
  const parseDurationToSeconds = (s) => {
    if (!s) return null;
    s = ('' + s).trim().toLowerCase();
    const m = s.match(/^(\d+(?:[.,]\d+)?)(s|sec|secs|m|min|h|d)?$/);
    if (!m) return null;
    let num = m[1].replace(',', '.');
    let val = parseFloat(num);
    if (isNaN(val) || val < 0) return null;
    const unit = m[2] || '';
    switch (unit) {
      case 's': case 'sec': case 'secs': return Math.round(val);
      case 'm': case 'min': return Math.round(val * 60);
      case 'h': return Math.round(val * 3600);
      case 'd': return Math.round(val * 86400);
      default: return Math.round(val);
    }
  };
  const DEFAULT_DURATION_SECONDS = 30 * 24 * 60 * 60;
  let durationSeconds = null;
  if (durationStr) {
    const parsed = parseDurationToSeconds(durationStr);
    if (parsed === null || parsed <= 0) {
      return ctx.reply('❌ صيغة المدة غير مفهومة. أمثلة: 3600s أو 60m أو 1h أو 5d');
    }
    durationSeconds = parsed;
  } else {
    try {
      const cur = await pool.query('SELECT duration_seconds FROM tasks WHERE id=$1', [taskId]);
      durationSeconds = (cur.rows[0] && cur.rows[0].duration_seconds) ? cur.rows[0].duration_seconds : DEFAULT_DURATION_SECONDS;
    } catch (e) {
      durationSeconds = DEFAULT_DURATION_SECONDS;
    }
  }
  const formatDuration = (secs) => {
    if (!secs) return 'غير محددة';
    if (secs < 60) return `${secs} ثانية`;
    if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
    return `${Math.floor(secs / 86400)} يوم`;
  };
  try {
    await pool.query(
      'UPDATE tasks SET title=$1, description=$2, price=$3, duration_seconds=$4 WHERE id=$5',
      [title, description, price, durationSeconds, taskId]
    );
    ctx.session.awaitingEdit = null;
    await ctx.reply(`✅ تم تعديل المهمة #${taskId} بنجاح.\n📌 العنوان: ${title}\n💰 السعر: ${price.toFixed(4)}$\n⏱️ المدة: ${formatDuration(durationSeconds)}`, { disable_web_page_preview: true });
  } catch (err) {
    console.error('❌ تعديل المهمة:', err);
    await ctx.reply('حدث خطأ أثناء تعديل المهمة.');
  }
  return next();
});

// 🎬 فيديوهاتي - تصحيح كامل باستخدام نظام الترجمة
bot.hears(['🎬 فيديوهاتي', '🎬 My Videos'], async (ctx) => {
  const userId = ctx.from.id;
  const isAr = ctx.message.text.includes('فيديو');
  const url = `${MAIN_URL}/my-videos.html?user_id=${userId}`;
  await ctx.reply(
    isAr
      ? '🎬 اضغط على الزر لعرض وإدارة فيديوهاتك:'
      : '🎬 Click the button below to view and manage your videos:',
    Markup.inlineKeyboard([
      [Markup.button.webApp(isAr ? 'فيديوهاتي' : 'My Videos', url)]
    ])
  );
});

// 📈 استثماري - تصحيح كامل ليعمل كـ WebApp داخلي (مثل الفيديوهات)
bot.hears(
  (text, ctx) => text === t(getLang(ctx), 'Units'),
  async (ctx) => {
    const userId = ctx.from.id;
    const lang = getLang(ctx);

    // ✅ المسار الصحيح
    const url = `${MAIN_URL}/investment?user_id=${userId}&lang=${lang}`;

    await ctx.reply(
      lang === 'ar'
        ? '📈 اضغط على الزر لعرض وإدارة وحداتك:'
        : '📈 Click the button below to view and manage your Units:',
      Markup.inlineKeyboard([
        [
          Markup.button.webApp(
            lang === 'ar' ? '📦 وحداتي' : '📦 My Units',
            url
          )
        ]
      ])
    );
  }
);


// 📈 إدارة الاستثمار (للأدمن) - تصحيح كامل ليعمل كـ WebApp داخلي
bot.hears('📈 إدارة الاستثمار', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const url = `${MAIN_URL}/admin-investment.html`;
  await ctx.reply(
    "📈 لوحة إدارة الاستثمار",
    Markup.inlineKeyboard([
      [Markup.button.webApp("⚙️ فتح لوحة الأدمن", url)]
    ])
  );
});

// 🔐 لوحة الأدمن - عرض الطلبات (مع أزرار تفاعلية)
bot.hears('📋 عرض الطلبات', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ الوصول مرفوض.');
  
  try {
    const res = await pool.query(
      'SELECT * FROM withdrawals WHERE status = $1 ORDER BY id DESC', 
      ['pending']
    );
    
    if (res.rows.length === 0) {
      await ctx.reply('✅ لا توجد طلبات معلقة.');
    } else {
      for (const req of res.rows) {
        await ctx.reply(
          `طلب سحب #${req.id}
👤 المستخدم: ${req.user_id}
💵 المبلغ: ${Number(req.amount).toFixed(2)}$
💳 محفظة USDT (TRC20): ${req.payeer_wallet}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ قبول", callback_data: `WITHDRAW_OK_${req.id}_${req.user_id}` },
                  { text: "❌ رفض", callback_data: `WITHDRAW_NO_${req.id}_${req.user_id}` }
                ]
              ]
            }
          }
        );
      }
    }
  } catch (err) {
    console.error('❌ خطأ في عرض الطلبات:', err);
    await ctx.reply('حدث خطأ فني.');
  }
});

// ✅ معالجة زر قبول السحب
bot.action(/WITHDRAW_OK_(\d+)_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مصرح');
  
  const withdrawId = ctx.match[1];
  const userId = ctx.match[2];
  
  try {
    // تحديث حالة السحب إلى "مدفوع"
    const res = await pool.query(
      "UPDATE withdrawals SET status = 'paid', processed_at = NOW() WHERE id = $1 RETURNING *",
      [withdrawId]
    );
    
    if (res.rowCount === 0) {
      return ctx.answerCbQuery('⚠️ الطلب غير موجود أو معالج مسبقاً');
    }
    
    const withdrawal = res.rows[0];
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;
    
    // ✅ تعديل رسالة الزر - التصحيح هنا: "callback_data:" مع النقطتين
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: "✅ تم القبول", callback_data: "done" }]  // ← ✅ هذا هو التصحيح
      ]
    });
    
    // إشعار المستخدم
    try {
      await ctx.telegram.sendMessage(
        userId,
        `✅ تم قبول طلب السحب الخاص بك.
💰 المبلغ: ${amount}$
💳 المحفظة: ${wallet}
⏳ سيتم تنفيذ السحب قريباً.`
      );
    } catch (e) {
      console.error('❌ خطأ عند إرسال رسالة للمستخدم:', e);
    }
    
    await ctx.answerCbQuery('✅ تم قبول الطلب');
    
  } catch (err) {
    console.error('❌ WITHDRAW_OK error:', err);
    await ctx.answerCbQuery('حدث خطأ');
  }
});

// ✅ معالجة زر رفض السحب - إرجاع المبلغ الكامل قبل خصم العمولة
bot.action(/WITHDRAW_NO_(\d+)_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مصرح');
  
  const withdrawId = ctx.match[1];
  const userId = ctx.match[2];
  
  try {
    // ✅ أولاً: جلب تفاصيل الطلب قبل التحديث (للتأكد من أنه معلق)
    const withdrawalRes = await pool.query(
      'SELECT * FROM withdrawals WHERE id = $1 AND status = $2',
      [withdrawId, 'pending']
    );
    
    if (withdrawalRes.rowCount === 0) {
      return ctx.answerCbQuery('⚠️ الطلب غير موجود أو معالج مسبقاً');
    }
    
    const withdrawal = withdrawalRes.rows[0];
    const netAmount = parseFloat(withdrawal.amount); // ← هذا هو المبلغ بعد خصم العمولة (95%)
    const wallet = withdrawal.payeer_wallet;
    
    // ✅ حساب المبلغ الأصلي المطلوب قبل خصم العمولة (100%)
    // المعادلة: netAmount = requestedAmount × 0.95
    // إذن: requestedAmount = netAmount ÷ 0.95
    const requestedAmount = netAmount / 0.95;
    
    // ✅ ثانياً: تحديث حالة السحب إلى "مرفوض"
    await pool.query(
      'UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2',
      ['rejected', withdrawId]
    );
    
    // ✅ ثالثاً: إرجاع المبلغ الكامل (قبل خصم العمولة) لرصيد المستخدم ← هذا هو المطلوب
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [requestedAmount, userId]
    );
    
    // ✅ رابعاً: تعديل رسالة الزر
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: "❌ تم الرفض", callback_data: "done" }]
      ]
    });
    
    // ✅ خامساً: إشعار المستخدم
    try {
      await ctx.telegram.sendMessage(
        userId,
        `❌ تم رفض طلب السحب الخاص بك.
💰 المبلغ الأصلي: ${requestedAmount.toFixed(2)}$
💰 المبلغ المسجل: ${netAmount.toFixed(2)}$ (بعد خصم 5%)
💳 المحفظة: ${wallet}
🔄 تم إرجاع المبلغ الكامل إلى رصيدك.`
      );
    } catch (e) {
      console.error('❌ خطأ عند إرسال رسالة للمستخدم:', e);
    }
    
    await ctx.answerCbQuery('❌ تم رفض الطلب وإرجاع المبلغ الكامل');
    
  } catch (err) {
    console.error('❌ WITHDRAW_NO error:', err);
    await ctx.answerCbQuery('حدث خطأ');
  }
});

// ➕ إضافة مهمة جديدة
bot.hears('➕ إضافة مهمة جديدة', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'add_task';
  ctx.reply(`📌 أرسل المهمة الجديدة بصيغة: العنوان | الوصف | السعر | المدة (اختياري)\nمثال مدة: 3600s أو 60m أو 1h أو 5d\nمثال كامل: coinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 30d`);
});

// 📝 عرض كل المهمات (للأدمن)
bot.hears('📝 المهمات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await pool.query('SELECT id, title, description, price, duration_seconds FROM tasks ORDER BY id DESC');
    if (res.rows.length === 0) return ctx.reply('⚠️ لا توجد مهام حالياً.');
    const formatDuration = (secs) => {
      if (!secs) return 'غير محددة';
      if (secs < 60) return `${secs} ثانية`;
      if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
      if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
      return `${Math.floor(secs / 86400)} يوم`;
    };
    for (const task of res.rows) {
      const price = parseFloat(task.price) || 0;
      const text = `📋 المهمة #${task.id}\n` +
        `🏷️ العنوان: ${task.title}\n` +
        `📖 الوصف: ${task.description}\n` +
        `💰 السعر: ${price.toFixed(4)}$\n` +
        `⏱️ المدة: ${formatDuration(task.duration_seconds)}`;
      await ctx.reply(text, Markup.inlineKeyboard([
        [ Markup.button.callback(`✏️ تعديل ${task.id}`, `edit_${task.id}`) ],
        [ Markup.button.callback(`🗑️ حذف ${task.id}`, `delete_${task.id}`) ]
      ]));
    }
  } catch (err) {
    console.error('❌ المهمات:', err);
    await ctx.reply('خطأ أثناء جلب المهمات.');
  }
});

// ✏️ زر تعديل المهمة
bot.action(/^edit_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ غير مسموح');
    return;
  }
  const taskId = ctx.match[1];
  ctx.session.awaitingEdit = taskId;
  await ctx.answerCbQuery();
  await ctx.reply(
    `✏️ أرسل المهمة الجديدة لـ #${taskId} بصيغة:\n` +
    `العنوان | الوصف | السعر | المدة\n` +
    `👉 المدة اكتبها بالدقائق أو الساعات أو الأيام.\n` +
    `مثال:\ncoinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 3 أيام`
  );
});

// 🗑️ زر حذف المهمة
bot.action(/^delete_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ غير مسموح');
    return;
  }
  const taskId = ctx.match[1];
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    try {
      await ctx.editMessageText(`🗑️ تم حذف المهمة #${taskId}`);
    } catch (_) {
      await ctx.reply(`🗑️ تم حذف المهمة #${taskId}`);
    }
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('❌ حذف المهمة:', err);
    await ctx.answerCbQuery('حدث خطأ أثناء الحذف.');
    await ctx.reply('حدث خطأ أثناء حذف المهمة.');
  }
});

// =================== إثباتات مهمات المستخدمين (للأدمن) ===================
bot.hears('📝 اثباتات مهمات المستخدمين', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await pool.query(
      `SELECT tp.id, tp.task_id, tp.user_id, tp.proof, tp.status, tp.created_at, t.title, t.price
      FROM task_proofs tp
      JOIN tasks t ON t.id = tp.task_id
      WHERE tp.status = $1
      ORDER BY tp.id DESC
      LIMIT 10`,
      ['pending']
    );
    if (res.rows.length === 0) return ctx.reply(t(getLang(ctx), 'no_tasks'));
    for (const sub of res.rows) {
      const price = parseFloat(sub.price) || 0;
      const userLangCode = userLang[sub.user_id] || autoDetectLang({ from: { id: sub.user_id } });
      const langLabel = userLangCode === 'ar' ? 'ar' : 'en';
      const text =
        `📌 ${t(langLabel, 'proof_id') || 'Proof'} #${sub.id}\n` +
        `👤 ${t(langLabel, 'user') || 'User'}: <code>${sub.user_id}</code>\n` +
        `📋 ${t(langLabel, 'task') || 'Task'}: ${sub.title} (ID: ${sub.task_id})\n` +
        `💰 ${t(langLabel, 'reward') || 'Reward'}: ${price.toFixed(4)}$\n` +
        `📝 ${t(langLabel, 'proof') || 'Proof'}:\n${sub.proof}`;
      await ctx.replyWithHTML(text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `approve_${sub.id}` },
              { text: "❌ Reject", callback_data: `deny_${sub.id}` }
            ]
          ]
        }
      });
    }
  } catch (err) {
    console.error('❌ اثباتات:', err);
    ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

// ✅ موافقة الأدمن
bot.action(/^approve_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Not allowed');
  const subId = Number(ctx.match[1]);
  try {
    await pool.query('BEGIN');
    const subRes = await pool.query('SELECT * FROM task_proofs WHERE id=$1 AND status=$2', [subId, 'pending']);
    if (!subRes.rows.length) {
      await pool.query('ROLLBACK');
      return ctx.answerCbQuery('Already processed or not found');
    }
    const sub = subRes.rows[0];
    const taskRes = await pool.query('SELECT price FROM tasks WHERE id=$1', [sub.task_id]);
    const price = parseFloat(taskRes.rows[0]?.price) || 0;
    const upd = await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [price, sub.user_id]);
    if (upd.rowCount === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [sub.user_id, price]);
    }
    await pool.query(
      'INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [sub.user_id, 'task', price, `Task ID ${sub.task_id}: reward`]
    );
    await pool.query('UPDATE task_proofs SET status=$1 WHERE id=$2', ['approved', subId]);
    await pool.query(
      `INSERT INTO user_tasks (user_id, task_id, status)
      VALUES ($1, $2, 'approved')
      ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'approved'`,
      [sub.user_id, sub.task_id]
    );
    await pool.query('COMMIT');
    try {
      await ctx.editMessageText(`✅ Approved proof #${subId}\n👤 User: ${sub.user_id}\n💰 +${price.toFixed(4)}$`);
    } catch (_) {}
    const userLangCode = userLang[sub.user_id] || autoDetectLang({ from: { id: sub.user_id } });
    const langCode = userLangCode === 'ar' ? 'ar' : 'en';
    const successMsg = t(langCode, 'task_approved', {
      task_id: sub.task_id,
      amount: price.toFixed(4)
    });
    try {
      await bot.telegram.sendMessage(sub.user_id, successMsg);
    } catch (_) {}
    try {
      const refRes = await pool.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [sub.user_id]);
      if (refRes.rows.length > 0) {
        const referrerId = refRes.rows[0].referrer_id;
        const commission = price * 0.05;
        if (commission > 0) {
          const updRef = await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id=$2', [commission, referrerId]);
          if (updRef.rowCount === 0) {
            await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1,$2)', [referrerId, commission]);
          }
          await pool.query(
            'INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)',
            [referrerId, sub.user_id, commission]
          );
          await pool.query(
            'INSERT INTO earnings (user_id, amount, source, created_at) VALUES ($1,$2,$3,NOW())',
            [referrerId, commission, 'referral_bonus']
          );
          const refLang = userLang[referrerId] || autoDetectLang({ from: { id: referrerId } });
          const refLangCode = refLang === 'ar' ? 'ar' : 'en';
          const refMsg = t(refLangCode, 'referral_commission', {
            referee: sub.user_id,
            amount: commission.toFixed(4)
          });
          try {
            await bot.telegram.sendMessage(referrerId, refMsg);
          } catch (_) {}
        }
      }
    } catch (e) {
      console.error('❌ خطأ أثناء تطبيق مكافأة الإحالة بعد الموافقة:', e);
    }
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
    console.error('❌ approve error:', err);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

// ✅ رفض الأدمن
bot.action(/^deny_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Not allowed');
  const subId = Number(ctx.match[1]);
  try {
    const res = await pool.query(
      'UPDATE task_proofs SET status=$1 WHERE id=$2 AND status=$3 RETURNING *',
      ['rejected', subId, 'pending']
    );
    if (!res.rowCount) return ctx.reply('Already processed or not found');
    const row = res.rows[0];
    await pool.query(
      `INSERT INTO user_tasks (user_id, task_id, status)
      VALUES ($1, $2, 'rejected')
      ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'rejected'`,
      [row.user_id, row.task_id]
    );
    try { await ctx.editMessageText(`❌ Rejected proof #${subId}`); } catch (_) {}
    const userLangCode = userLang[row.user_id] || autoDetectLang({ from: { id: row.user_id } });
    const langCode = userLangCode === 'ar' ? 'ar' : 'en';
    const rejectMsg = t(langCode, 'task_rejected', { task_id: row.task_id });
    try { await bot.telegram.sendMessage(row.user_id, rejectMsg); } catch (_) {}
  } catch (err) {
    console.error('❌ deny error:', err);
    ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

// 🔐 لوحة الأدمن - الإحصائيات
bot.hears('📊 الإحصائيات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const [users, earnings, paid, pending, proofs] = await Promise.all([
      pool.query('SELECT COUNT(*) AS c FROM users'),
      pool.query('SELECT COALESCE(SUM(amount), 0) AS s FROM earnings'),
      pool.query('SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE status = $1', ['paid']),
      pool.query('SELECT COUNT(*) AS c FROM withdrawals WHERE status = $1', ['pending']),
      pool.query("SELECT COUNT(*) AS c FROM user_tasks WHERE status = 'pending'")
    ]);
    await ctx.replyWithHTML(
      `📈 <b>الإحصائيات</b>\n` +
      `👥 عدد المستخدمين: <b>${users.rows[0].c}</b>\n` +
      `💰 الأرباح الموزعة: <b>${Number(earnings.rows[0].s).toFixed(2)}$</b>\n` +
      `📤 المدفوعات: <b>${Number(paid.rows[0].s).toFixed(2)}$</b>\n` +
      `⏳ طلبات معلقة: <b>${pending.rows[0].c}</b>\n` +
      `📝 إثباتات مهمات المستخدمين: <b>${proofs.rows[0].c}</b>`
    );
  } catch (err) {
    console.error('❌ خطأ في الإحصائيات:', err);
    await ctx.reply('حدث خطأ في جلب الإحصائيات.');
  }
});

// ➕ إضافة رصيد
bot.hears('➕ إضافة رصيد', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'add_balance';
  ctx.session.targetUser = null;
  await ctx.reply('🆔 أرسل ID المستخدم لإضافة رصيد:');
});

// ➖ خصم رصيد
bot.hears('➖ خصم رصيد', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'deduct_balance';
  ctx.session.targetUser = null;
  await ctx.reply('🆔 أرسل ID المستخدم لخصم رصيد:');
});

// 👥 ريفيرال (للأدمن)
bot.hears('👥 ريفيرال', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await pool.query(`
      SELECT r.referrer_id, COUNT(*) as count, SUM(re.amount) as total_earned
      FROM referrals r
      LEFT JOIN referral_earnings re ON re.referrer_id = r.referrer_id
      GROUP BY r.referrer_id
      ORDER BY count DESC
      LIMIT 20
    `);
    if (res.rows.length === 0) return ctx.reply('لا توجد إحالات.');
    let msg = '📊 إحصائيات الإحالة:\n';
    for (const row of res.rows) {
      msg += `\n• ${row.referrer_id}: ${row.count} مستخدم - ${Number(row.total_earned || 0).toFixed(4)}$`;
    }
    await ctx.reply(msg);
  } catch (err) {
    console.error('❌ إحالة:', err);
    ctx.reply('خطأ.');
  }
});

// 🔐 لوحة الأدمن - خروج
bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session = {};
  const userId = ctx.from.id;
  const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
  const balance = parseFloat(res.rows[0]?.balance) || 0;
  const lang = getLang(ctx);
  await ctx.reply(`✅ خرجت من لوحة الأدمن.\n💰 ${t(lang, 'your_balance')}: ${balance.toFixed(4)}$`,
    Markup.keyboard([
      [t(lang, 'your_balance'), t(lang, 'earn_sources')],
      [t(lang, 'withdraw'), t(lang, 'referral')],
      [t(lang, 'tasks'), t(lang, 'videos')],
      [t(lang, 'language'), t(lang, 'Units')],
      [t(lang, 'facebook')],
      [t(lang, 'contact_admin')]
    ]).resize()
  );
});

// 🌐 تغيير اللغة
bot.hears('🌐 اللغة', async (ctx) => {
  const lang = getLang(ctx);
  await ctx.reply(
    t(lang, "choose_lang"),
    Markup.keyboard([
      [t('en', "english"), t('ar', "arabic")],
      [t(lang, "back")]
    ]).resize()
  );
});

// English
bot.hears('🌐 English', async (ctx) => {
  setLang(ctx, "en");
  await ctx.reply(t("en", "lang_changed_en"));
});

// Arabic
bot.hears('🌐 العربية', async (ctx) => {
  setLang(ctx, "ar");
  await ctx.reply(t("ar", "lang_changed_ar"));
});

// 🌐 Language (English support)
bot.hears('🌐 Language', async (ctx) => {
  const lang = getLang(ctx);
  await ctx.reply(
    t(lang, "choose_lang"),
    Markup.keyboard([
      [t('en', "english"), t('ar', "arabic")],
      [t(lang, "back")]
    ]).resize()
  );
});

// ↩️ زر الرجوع
// ↩️ زر الرجوع - رسالة بسيطة بدون أزرار (بدون قاعدة بيانات)
bot.hears((text, ctx) => {
    const lang = getLang(ctx);
    const backLabel = t(lang, 'back');
    return text === backLabel || text === '⬅️ رجوع' || text === '⬅️ Back';
}, async (ctx) => {
    try {
        const lang = getLang(ctx);
        
        // ✅ الرسالة الترحيبية المبسطة
        const welcomeMessage = `🌍 Start Earning Real Money Online with Taskora! 💸✨
No experience needed. No hidden fees. Just simple tasks, real rewards.
✅ Free to join | ✅ Min withdrawal: only $1.00
✅ Get paid in USDT (TRC20) | ✅ Transparent & secure
🔥 Referral Bonus: Invite friends & earn 5% on their earnings + 3% on deposits – lifetime passive income!
🚀 Ready to turn your spare time into real cash?`;

        // ✅ رابط التحميل
        const downloadLink = "https://upload.app/download/taskora/earn.cash71/49e0b46a8044a4774ba5d3f0b771b64b3cbbdfb792c23d3fb7d361557a07e908";

        // ✅ إرسال الرسالة مع زر التحميل فقط - بدون أي أزرار أخرى
        await ctx.reply(welcomeMessage, {
            reply_markup: {
                inline_keyboard: [[
                    { 
                        text: "🚀 Download & Register Now", 
                        url: downloadLink 
                    }
                ]]
            },
            disable_web_page_preview: false
        });
        
    } catch (err) {
        console.error('❌ Back button error:', err);
        await ctx.reply(`🚀 Download Taskora: https://upload.app/download/taskora/earn.cash71/49e0b46a8044a4774ba5d3f0b771b64b3cbbdfb792c23d3fb7d361557a07e908`);
    }
});
// 🔁 دعم زر الرجوع باللغتين في أي مكان
bot.hears(['⬅️ Back', '⬅️ رجوع'], async (ctx) => {
  await ctx.reply('🔄');
});

bot.command('pay', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /pay <ID>');
  
  try {
    const res = await pool.query(
      'UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2 RETURNING *',
      ['paid', id]
    );
    
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');
    
    const withdrawal = res.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;
    
    try {
      await bot.telegram.sendMessage(
        userId,
        `✅ تم الموافقة على طلب السحب الخاص بك.
💰 المبلغ: ${amount}$
💳 المحفظة: ${wallet}
⏳ سيتم تنفيذ السحب قريباً.`
      );
    } catch (e) {
      console.error('❌ خطأ عند إرسال رسالة للمستخدم:', e);
    }
    
    await ctx.reply(`✅ تم تعليم الطلب #${id} كمدفوع وتم إعلام المستخدم.`);
    
  } catch (e) {
    console.error('❌ pay:', e);
    await ctx.reply('فشل تحديث الحالة.');
  }
});
bot.command('reject', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /reject <ID>');
  
  try {
    // ✅ أولاً: جلب تفاصيل الطلب قبل التحديث (للتأكد من أنه معلق)
    const withdrawalRes = await pool.query(
      'SELECT * FROM withdrawals WHERE id = $1 AND status = $2',
      [id, 'pending']
    );
    
    if (withdrawalRes.rowCount === 0) {
      return ctx.reply('لم يتم العثور على الطلب أو هو غير معلق.');
    }
    
    const withdrawal = withdrawalRes.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount);
    const wallet = withdrawal.payeer_wallet;
    
    // ✅ ثانياً: تحديث حالة السحب إلى "مرفوض"
    await pool.query(
      'UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2',
      ['rejected', id]
    );
    
    // ✅ ثالثاً: إرجاع المبلغ لرصيد المستخدم ← هذا هو التعديل المطلوب
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [amount, userId]
    );
    
    // ✅ رابعاً: إشعار المستخدم
    try {
      await bot.telegram.sendMessage(
        userId,
        `❌ تم رفض طلب السحب الخاص بك.
💰 المبلغ: ${amount.toFixed(2)}$
💳 المحفظة: ${wallet}
🔄 تم إرجاع المبلغ إلى رصيدك.`
      );
    } catch (e) {
      console.error('❌ خطأ عند إرسال رسالة للمستخدم:', e);
    }
    
    await ctx.reply(`⛔ تم رفض الطلب #${id} وإرجاع ${amount.toFixed(2)}$ للمستخدم.`);
    
  } catch (e) {
    console.error('❌ reject:', e);
    await ctx.reply('فشل تحديث الحالة.');
  }
});

bot.command('reply', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const parts = ctx.message.text.split(' ');
    const msgId = parts[1];
    const replyText = parts.slice(2).join(' ');

    if (!msgId || !replyText) {
        return ctx.reply('استخدم:\n/reply رقم_الرسالة نص_الرد');
    }

    const res = await pool.query(
        'SELECT * FROM admin_messages WHERE id = $1 AND replied = false',
        [msgId]
    );

    if (res.rows.length === 0) {
        return ctx.reply('❌ الرسالة غير موجودة أو تم الرد عليها.');
    }

    const userId = res.rows[0].user_id;

    await pool.query(
        'UPDATE admin_messages SET admin_reply = $1, replied = true WHERE id = $2',
        [replyText, msgId]
    );

    try {
    await bot.telegram.sendMessage(
        userId,
        `📩 رد الإدارة:
        ${replyText}`
    );
    await ctx.reply('✅ تم إرسال الرد للمستخدم.');
} catch (e) {
    console.error(`❌ فشل إرسال الرد للمستخدم ${userId}:`, e.message);
    await ctx.reply(`⚠️ تم حفظ الرد في القاعدة، لكن فشل الإرسال للمستخدم (قد يكون البوت محظوراً).`);
}
});

// ==================== التشغيل النهائي ====================
(async () => {
  try {
    if (typeof bot !== 'undefined') {
      await bot.launch();
      console.log('🤖 Telegram bot launched successfully!');
    }
    console.log('✅ Bot is running. Container should stay alive!');
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
  }
})();
