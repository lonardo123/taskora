import { Hono } from 'hono';
import { cors } from 'hono/cors';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, initDb } from './db.js'; // <-- لاحظ إضافة initDb هنا

const app = new Hono();

// 1. إعداد CORS
app.use('*', cors());

// 2. 🚀 Middleware حاسم: يهيئ قاعدة البيانات باستخدام أسرار Cloudflare (c.env)
// هذا يحل مشكلة "No database host" نهائياً
app.use('*', async (c, next) => {
  try {
    initDb(c.env); // نمرر متغيرات البيئة الخاصة بـ Cloudflare هنا
  } catch (err) {
    console.error('❌ Failed to init DB:', err.message);
    return c.json({ status: 'error', message: 'Database connection failed: ' + err.message }, 500);
  }
  await next();
});


// ==========================================
// دالة مساعدة واحدة فقط (مدمجة ومصححة)
// ==========================================
async function getOrCreateUser(client, telegramId) {
  let q = await client.query(
    'SELECT id, balance FROM users WHERE telegram_id = $1',
    [telegramId]
  );

  if (q.rows.length === 0) {
    q = await client.query(
      'INSERT INTO users (telegram_id, balance) VALUES ($1, 0) RETURNING id, balance',
      [telegramId]
    );
  }

  return {
    userDbId: q.rows[0].id,
    balance: Number(q.rows[0].balance)
  };
}

// ==========================================
// تخزين آخر رسالة للسيرفر مؤقتًا
// ==========================================
let currentMessage = null;


// ==========================================
// ⚙️ Quiz Settings Page
// فتح صفحة إعدادات الكويز من public/quiz-settings.html
// ==========================================
app.get('/quiz-settings', async (c) => {
  try {
    const url = new URL(c.req.url);

    url.pathname = '/quiz-settings.html';

    return c.env.ASSETS.fetch(
      new Request(url.toString(), c.req.raw)
    );

  } catch (err) {
    console.error('❌ /quiz-settings:', err);

    return c.text(
      'Quiz Settings page failed to load.',
      500
    );
  }
});

   app.get('/admin-marketing', async (c) => {
     try {
       const url = new URL(c.req.url);
       url.pathname = '/admin-marketing.html';
       return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
     } catch (err) {
       return c.text('Admin Marketing page failed to load.', 500);
     }
   });

// ==========================================
// ⚙️ Admin Providers Page
// فتح صفحة إدارة المنصات من public/admin-providers.html
// ==========================================
app.get('/admin-providers', async (c) => {
  try {
    const url = new URL(c.req.url);
    url.pathname = '/admin-providers.html';
    
    return c.env.ASSETS.fetch(
      new Request(url.toString(), c.req.raw)
    );
  } catch (err) {
    console.error('❌ /admin-providers:', err);
    return c.text('Admin Providers page failed to load.', 500);
  }
});

// مسار احتياطي في حال طلب المستخدم الرابط بامتداد .html مباشرة
app.get('/admin-providers.html', async (c) => {
  try {
    const url = new URL(c.req.url);
    return c.env.ASSETS.fetch(
      new Request(url.toString(), c.req.raw)
    );
  } catch (err) {
    console.error('❌ /admin-providers.html:', err);
    return c.text('Admin Providers page failed to load.', 500);
  }
});


// ==========================================
// Worker Start
// Cloudflare Workers لا يستخدم express.static()
// ==========================================
app.get('/worker/start', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Taskora Worker</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          padding: 40px;
          background: #f5f5f5;
        }
        .box {
          max-width: 600px;
          margin: auto;
          background: white;
          padding: 30px;
          border-radius: 15px;
          box-shadow: 0 4px 20px rgba(0,0,0,.08);
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>Taskora</h1>
        <p>Worker يعمل بنجاح.</p>
      </div>
    </body>
    </html>
  `);
});

// ==========================================
// إرسال أمر إلى Worker
// ==========================================
app.post('/api/server/send', async (c) => {
  try {
    const { action, data } = await c.req.json();

    if (!action) {
      return c.json(
        {
          status: 'error',
          message: 'action required'
        },
        400
      );
    }

    currentMessage = {
      action,
      data: data || {},
      time: new Date().toISOString()
    };

    console.log(
      '📨 تم تعيين رسالة جديدة إلى الإضافة:',
      currentMessage
    );

    return c.json({
      status: 'ok',
      message: currentMessage
    });

  } catch (err) {
    console.error('❌ Error in /api/server/send:', err);

    return c.json(
      {
        status: 'error',
        message: 'Invalid JSON request'
      },
      400
    );
  }
});

// ==========================================
// Polling
// ==========================================
app.get('/api/worker/message', (c) => {
  if (currentMessage) {
    const msg = currentMessage;

    // إزالة الرسالة بعد إرسالها حتى لا تتكرر
    currentMessage = null;

    return c.json(msg);
  }

  return c.json({
    action: 'NONE'
  });
});

// ==========================================
// مسار الملف الشخصي للمستخدم (مُحسّن ومتوافق 100% مع Schema)
// ==========================================
app.get('/api/user/profile', async (c) => {
  const user_id = c.req.query('user_id');

  // 1. التحقق من وجود المعرف
  if (!user_id) {
    return c.json({ status: 'error', message: 'user_id is required' }, 400);
  }

  try {
    // 2. محاولة جلب بيانات المستخدم
    const result = await pool.query(`
      SELECT
        id,
        telegram_id,
        username,
        name,
        balance,
        payeer_wallet,
        referral_code,
        referral_earnings,
        created_at,
        last_login_at
      FROM users
      WHERE telegram_id = $1
      LIMIT 1
    `, [user_id]);

    // 3. إذا لم يكن المستخدم موجوداً، نقوم بإنشائه
    if (result.rows.length === 0) {
      await pool.query(`
        INSERT INTO users (telegram_id, balance, created_at, last_login_at)
        VALUES ($1, $2, NOW(), NOW())
      `, [user_id, 0]);

      return c.json({
        status: 'ok',
        user: {
          telegram_id: Number(user_id),
          balance: 0,
          username: null,
          name: null,
          referral_code: null,
          referral_earnings: 0
        }
      });
    }

    // 4. إذا كان موجوداً، نقوم بتنسيق البيانات (تحويل الأرقام من string إلى number)
    const user = result.rows[0];
    const formattedUser = {
      id: user.id,
      telegram_id: Number(user.telegram_id),
      username: user.username,
      name: user.name,
      balance: parseFloat(user.balance) || 0,          // تحويل مهم جداً
      payeer_wallet: user.payeer_wallet,
      referral_code: user.referral_code,
      referral_earnings: parseFloat(user.referral_earnings) || 0, // تحويل مهم جداً
      created_at: user.created_at,
      last_login_at: user.last_login_at
    };

    return c.json({
      status: 'ok',
      user: formattedUser
    });

  } catch (err) {
    console.error('❌ Error in /api/user/profile:', err);
    return c.json({ status: 'error', message: 'Server error' }, 500);
  }
});
// =======================
// المسار الرئيسي للتحقق من عمل السيرفر
// =======================
app.get('/', (c) => {
  return c.text('✅ السيرفر يعمل! Postback جاهز.');
});

// =======================
// تحديث السعر من الأدمن (محول إلى Hono)
// =======================
app.post('/admin/set-price', async (c) => {
  // 1. قراءة البيانات باستخدام await c.req.json()
  const { price } = await c.req.json();
  const parsedPrice = parseFloat(price);
  
  if (isNaN(parsedPrice) || parsedPrice < 0) {
    // 2. إرجاع خطأ 400 في حال كانت البيانات غير صحيحة
    return c.json({ success: false, message: "❌ Invalid price" }, 400);
  }
  
  await pool.query(
    'INSERT INTO stock_settings (price, updated_at) VALUES ($1, NOW())',
    [parsedPrice]
  );
  
  // 3. استخدام return c.json بدلاً من res.json
  return c.json({
    success: true,
    message: `✅ Price updated to ${parsedPrice}`
  });
});

// =======================
// تحديث الحد الأقصى للشراء (محول إلى Hono)
// =======================
app.post('/admin/set-max', async (c) => {
  const { max } = await c.req.json();
  try {
    await pool.query(
      'INSERT INTO stock_limits(max_buy) VALUES($1)',
      [max]
    );
    return c.json({ message: "تم تحديث الحد الأقصى" });
  } catch (err) {
    console.error(err);
    // 4. إرجاع كود الحالة 500 مع رسالة الخطأ
    return c.json({ message: "فشل تحديث الحد الأقصى" }, 500);
  }
});

// ============================================================
// Existing callbacks and other endpoints (Converted to Hono)
// ============================================================

app.get('/callback', async (c) => {
  const user_id = c.req.query('user_id');
  const amount = c.req.query('amount');
  const transaction_id = c.req.query('transaction_id');
  const secret = c.req.query('secret');
  const network = c.req.query('network');

  if (secret !== c.env.CALLBACK_SECRET) {
    return c.text('Forbidden: Invalid Secret', 403);
  }
  if (!transaction_id) {
    return c.text('Missing transaction_id', 400);
  }
  
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return c.text('Invalid amount', 400);
  }

  const percentage = 0.60;
  const finalAmount = parsedAmount * percentage;
  const source = network === 'bitcotasks' ? 'bitcotasks' : 'offer';

  try {
    await pool.query('BEGIN');
    
    const existing = await pool.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );
    if (existing.rows.length > 0) {
      await pool.query('ROLLBACK');
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return c.text('Duplicate transaction ignored', 200);
    }

    const userCheck = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [user_id]
    );
    if (userCheck.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, finalAmount]
      );
    } else {
      await pool.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [finalAmount, user_id]
      );
    }

    await pool.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at)
      VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );
    console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${parsedAmount}$) للمستخدم ${user_id} (Transaction: ${transaction_id})`);

    const ref = await pool.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1',
      [user_id]
    );
    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03;
      
      const refCheck = await pool.query(
        'SELECT balance FROM users WHERE telegram_id = $1',
        [referrerId]
      );
      if (refCheck.rows.length === 0) {
        await pool.query(
          'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
          [referrerId, bonus]
        );
      } else {
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [bonus, referrerId]
        );
      }

      await pool.query(
        `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at)
        VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
        [referrerId, 'referral', bonus, `Referral bonus from ${user_id} (Transaction: ${transaction_id})`]
      );
      
      await pool.query(
        `INSERT INTO referral_earnings (referrer_id, referee_id, amount, created_at)
        VALUES ($1, $2, $3, NOW())`,
        [referrerId, user_id, bonus]
      );
      
      console.log(`👥 تم إضافة ${bonus}$ (3%) للمحيل ${referrerId} من ربح المستخدم ${user_id}`);
    }
    
    await pool.query('COMMIT');
    return c.text('تمت المعالجة بنجاح', 200);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Callback Error:', err);
    return c.text('Server Error', 500);
  }
});

// =========================
// REGISTER - مع دعم الريفيرال
// =========================
app.post("/register", async (c) => {
  try {
    const { name, username, password, referral_code } = await c.req.json();
    
    if (!name || !username || !password) {
      return c.json({ success: false, message: "Missing data" });
    }
    
    const checkUser = await pool.query(
      "SELECT id FROM users WHERE username=$1",
      [username]
    );
    if (checkUser.rows.length > 0) {
      return c.json({ success: false, message: "Username already exists" });
    }
    
    const generateReferralCode = () => {
      return 'REF' + Math.random().toString(36).substr(2, 6).toUpperCase();
    };
    let newReferralCode = generateReferralCode();
    
    let codeExists = true;
    while (codeExists) {
      const checkCode = await pool.query(
        "SELECT id FROM users WHERE referral_code=$1",
        [newReferralCode]
      );
      if (checkCode.rows.length === 0) codeExists = false;
      else newReferralCode = generateReferralCode();
    }
    
    let telegram_id;
    while (true) {
      telegram_id = Math.floor(900000000000 + Math.random() * 100000000000);
      const checkId = await pool.query(
        "SELECT id FROM users WHERE telegram_id=$1",
        [telegram_id]
      );
      if (checkId.rows.length === 0) break;
    }
    
    const hash = await bcrypt.hash(password, 10);
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      await client.query(
        `INSERT INTO users (name, username, password, telegram_id, balance, referral_code)
         VALUES ($1,$2,$3,$4,0,$5)`,
        [name, username, hash, telegram_id, newReferralCode]
      );
      
      if (referral_code && referral_code.trim() !== '') {
        const referrer = await client.query(
          "SELECT telegram_id FROM users WHERE referral_code=$1",
          [referral_code.trim().toUpperCase()]
        );
        
        if (referrer.rows.length > 0) {
          const referrerTelegramId = referrer.rows[0].telegram_id;
          await client.query(
            "INSERT INTO referrals (referrer_id, referee_id, created_at) VALUES ($1, $2, NOW())",
            [referrerTelegramId, telegram_id]
          );
          console.log(`👥 Referral link created: referrer_id=${referrerTelegramId}, referee_id=${telegram_id}`);
        }
      }
      
      try {
        await client.query(
          `UPDATE users SET balance = balance + 0.10 WHERE telegram_id = $1`,
          [telegram_id]
        );
        await client.query(
          `INSERT INTO new_user_bonuses (user_id, bonus_amount) VALUES ($1, 0.10)`,
          [telegram_id]
        );
        console.log(`🎁 Welcome bonus $0.10 awarded to user: ${telegram_id}`);
      } catch (bonusErr) {
        if (bonusErr.code !== '23505') {
          console.error("⚠️ Bonus insertion error:", bonusErr);
        }
      }
      
      await client.query('COMMIT');
      
      return c.json({ 
        success: true, 
        message: "✅ Account created! +$0.10 welcome bonus added!",
        referral_code: newReferralCode, 
        telegram_id: telegram_id,
        bonus: 0.10
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error("Register error:", err);
    return c.json({ success: false, message: "Registration failed" });
  }
});

// =========================
// LOGIN
// =========================
app.post("/login", async (c) => {
  try {
    const { username, password } = await c.req.json();

    const result = await pool.query(
      "SELECT id, telegram_id, username, password, balance, name FROM users WHERE username=$1",
      [username]
    );

    if (result.rows.length === 0) {
      return c.json({ success: false });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return c.json({ success: false });
    }

    return c.json({
      success: true,
      telegram_id: user.telegram_id,
      username: user.username,
      name: user.name,
      balance: user.balance
    });

  } catch (err) {
    console.error(err);
    return c.json({ success: false });
  }
});

// =========================
// USER DASHBOARD
// =========================
app.get("/user/dashboard", async (c) => {
  try {
    const idParam = c.req.query('id');
    
    if(!idParam || typeof idParam !== 'string' || !/^\d+$/.test(idParam.trim())){
      return c.json({success:false, message:"Invalid user id"});
    }
    
    const telegramId = Number(idParam.trim());
    
    const userQuery = await pool.query(
      `SELECT telegram_id, username, name, balance, payeer_wallet 
       FROM users 
       WHERE telegram_id = $1`,
      [telegramId]
    );

    if (userQuery.rows.length === 0) {
      return c.json({ success: false, message: "User not found" });
    }

    await pool.query(
      `UPDATE users 
       SET last_login_at = now() 
       WHERE telegram_id = $1
         AND last_login_at < now() - interval '24 hours'`,
      [telegramId]
    );
    
    const user = userQuery.rows[0];
    
    const withdrawQuery = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals WHERE user_id=$1 AND (status='paid' OR status='done')",
      [telegramId]
    );
    
    const totalWithdrawn = parseFloat(withdrawQuery.rows[0].total) || 0;
    
    return c.json({
      success: true,
      telegram_id: user.telegram_id,
      username: user.username,
      name: user.name,
      balance: parseFloat(user.balance) || 0,
      payeer_wallet: user.payeer_wallet,
      totalWithdrawn: totalWithdrawn,
      timestamp: new Date().toISOString()
    });
    
  } catch(err) {
    console.error("❌ Server error /user/dashboard:", err);
    return c.json({success:false, message:"Server error"});
  }
});

// =========================
// DAILY REWARDS
// =========================
app.get('/api/daily-rewards/status', async (c) => {
  const userId = c.req.query('id');
  const today = new Date().toISOString().split('T')[0];
  
  const earnings = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) as total 
     FROM earnings 
     WHERE user_id = $1 
  AND DATE(created_at) = $2
  AND source IN ('offer', 'task_execution')`,
    [userId, today]
  );
  
  const claimed = await pool.query(
    `SELECT claimed FROM daily_rewards 
     WHERE user_id = $1 AND claim_date = $2`,
    [userId, today]
  );
  
  return c.json({
    success: true,
    today_earnings: earnings.rows[0].total,
    already_claimed: claimed.rows[0]?.claimed || false
  });
});

app.post('/api/daily-rewards/claim', async (c) => {
  const { user_id } = await c.req.json();
  const today = new Date().toISOString().split('T')[0];
  
  // ✅ حساب أرباح اليوم من offer و task_execution فقط
  const earnings = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) as total 
     FROM earnings 
     WHERE user_id = $1 
       AND DATE(created_at) = $2
       AND source IN ('offer', 'task_execution')`,
    [user_id, today]
  );
  
  const todayEarnings = parseFloat(earnings.rows[0].total);
  
  // ✅ التحقق من الوصول إلى العتبة ($0.03)
  if(todayEarnings < 0.03){
    return c.json({ 
      success: false, 
      message: `❌ Need $0.03+ earnings to claim. You have $${todayEarnings.toFixed(4)}` 
    });
  }
  
  // ✅ التحقق من عدم المطالبة المسبقة
  const alreadyClaimed = await pool.query(
    `SELECT id FROM daily_rewards WHERE user_id = $1 AND claim_date = $2`,
    [user_id, today]
  );
  
  if(alreadyClaimed.rows.length > 0){
    return c.json({ success: false, message: "❌ Already claimed today" });
  }
  
  // ✅ حساب المكافأة: 5% من أرباح اليوم
  const REWARD_PERCENTAGE = 0.05; // 5%
  const rewardAmount = todayEarnings * REWARD_PERCENTAGE;
  
  await pool.query(`BEGIN`);
  try{
    // إضافة المكافأة إلى رصيد المستخدم
    await pool.query(
      `UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`,
      [rewardAmount, user_id]
    );
    
    // تسجيل المطالبة في جدول daily_rewards
    await pool.query(
      `INSERT INTO daily_rewards (user_id, today_earnings, reward_amount, claimed, claim_date) 
       VALUES ($1, $2, $3, true, $4)`,
      [user_id, todayEarnings, rewardAmount, today]
    );
    
    await pool.query(`COMMIT`);
    
    return c.json({ 
      success: true, 
      message: `✅ Reward claimed! You earned $${rewardAmount.toFixed(4)} (5% of $${todayEarnings.toFixed(4)})`,
      reward_amount: rewardAmount,
      today_earnings: todayEarnings
    });
  } catch(e){
    await pool.query(`ROLLBACK`);
    console.error('❌ Daily reward claim error:', e);
    return c.json({ success: false, message: "❌ Database error" });
  }
});

app.get('/api/daily-rewards/history', async (c) => {
  const userId = c.req.query('id');
  const history = await pool.query(
    `SELECT claim_date, reward_amount, created_at 
     FROM daily_rewards 
     WHERE user_id = $1 AND claimed = true 
     ORDER BY claim_date DESC LIMIT 30`,
    [userId]
  );
  
  return c.json({ success: true, data: history.rows });
});

// =========================
// WITHDRAWALS - Pending
// =========================
app.get("/api/withdrawals/pending", async (c) => {
  try {
    const id = c.req.query('id');
    
    if (!id || !/^\d+$/.test(id)) {
      return c.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    const result = await pool.query(
      `SELECT id, amount, payeer_wallet, status, requested_at 
       FROM withdrawals 
       WHERE user_id = $1 AND status = 'pending' 
       ORDER BY requested_at DESC`,
      [telegramId]
    );
    
    return c.json({ 
      success: true, 
      data: result.rows.map(row => ({
        id: row.id,
        amount: parseFloat(row.amount),
        payeer_wallet: row.payeer_wallet,
        status: row.status,
        requested_at: row.requested_at
      }))
    });
  } catch (err) {
    console.error("Pending withdrawals error:", err);
    return c.json({ success: false, message: "Failed to load pending withdrawals" });
  }
});

// =========================
// WITHDRAWALS - Completed
// =========================
app.get("/api/withdrawals/completed", async (c) => {
  try {
    const id = c.req.query('id');
    
    if (!id || !/^\d+$/.test(id)) {
      return c.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    const result = await pool.query(
      `SELECT id, amount, payeer_wallet, status, requested_at, processed_at 
       FROM withdrawals 
       WHERE user_id = $1 AND status = 'done' 
       ORDER BY processed_at DESC 
       LIMIT 10`,
      [telegramId]
    );
    
    return c.json({ 
      success: true, 
      data: result.rows.map(row => ({
        id: row.id,
        amount: parseFloat(row.amount),
        payeer_wallet: row.payeer_wallet,
        status: row.status,
        requested_at: row.requested_at,
        processed_at: row.processed_at
      }))
    });
  } catch (err) {
    console.error("Completed withdrawals error:", err);
    return c.json({ success: false, message: "Failed to load completed withdrawals" });
  }
});

// =========================
// REFERRAL - Statistics
// =========================
app.get("/api/referral/stats", async (c) => {
  try {
    const id = c.req.query('id');
    console.log("🔍 Referral stats request for telegram_id:", id);
    
    if (!id || !/^\d+$/.test(id)) {
      return c.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = id.toString().trim();
    
    const userRes = await pool.query(
      "SELECT referral_code FROM users WHERE telegram_id = $1",
      [telegramId]
    );
    
    if (userRes.rows.length === 0) {
      return c.json({ success: false, message: "User not found" });
    }
    
    const referralCode = userRes.rows[0].referral_code || "N/A";
    console.log("✅ Found user - referral_code:", referralCode);
    
    const statsRes = await pool.query(`
      SELECT 
        COUNT(DISTINCT r.referee_id) as total_referrals,
        COALESCE(SUM(re.amount), 0) as total_earned
      FROM referrals r
      LEFT JOIN referral_earnings re 
        ON r.referee_id = re.referee_id AND r.referrer_id = re.referrer_id
      WHERE r.referrer_id = $1
    `, [telegramId]);
    
    const totalReferrals = parseInt(statsRes.rows[0].total_referrals) || 0;
    const totalEarned = parseFloat(statsRes.rows[0].total_earned) || 0;
    
    console.log("📊 Stats:", { totalReferrals, totalEarned });
    
    const referralsRes = await pool.query(`
      SELECT 
        u.username,
        r.created_at as joined_at,
        COALESCE(SUM(re.amount), 0) as earned_for_you
      FROM referrals r
      JOIN users u ON r.referee_id = u.telegram_id
      LEFT JOIN referral_earnings re 
        ON r.referee_id = re.referee_id AND r.referrer_id = re.referrer_id
      WHERE r.referrer_id = $1
      GROUP BY u.username, r.created_at
      ORDER BY r.created_at DESC
      LIMIT 50
    `, [telegramId]);
    
    const referrals = referralsRes.rows.map(row => ({
      username: row.username,
      joined_at: row.joined_at,
      earned_for_you: parseFloat(row.earned_for_you)
    }));
    
    console.log("👥 Referrals list:", referrals.length);
    
    return c.json({
      success: true,
      message: "Referral stats loaded",
      data: {
        referral_code: referralCode,
        total_referrals: totalReferrals,
        total_earned: totalEarned,
        referrals: referrals
      }
    });
  } catch (err) {
    console.error("❌ Referral stats error:", err);
    return c.json({ 
      success: false, 
      message: "Failed to load referral stats: " + err.message 
    });
  }
});

// =========================
// المسار العام /user/:id
// =========================
app.get("/user/:id", async (c) => {
  try {
    // في Hono نستخدم c.req.param('id') بدلاً من req.params.id
    const id = c.req.param('id');
    const result = await pool.query(
      "SELECT id, telegram_id, username, name, balance, payeer_wallet FROM users WHERE telegram_id=$1",
      [id]
    );
    
    if (result.rows.length === 0) {
      return c.json({ success: false });
    }
    
    return c.json({
      success: true,
      user: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    return c.json({ success: false });
  }
});

// =========================
// DEPOSIT - Submit TxID
// =========================
app.post("/api/deposit/submit", async (c) => {
  try {
    const { user_id, txid, network } = await c.req.json();
    
    if (!user_id || !txid || txid.length < 10) {
      return c.json({ success: false, message: "Invalid data" });
    }
    
    const username = `user_${user_id}`;
    
    const result = await pool.query(
      `INSERT INTO deposit_requests (user_id, username, txid, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING id, txid`,
      [user_id, username, txid]
    );
    
    const requestId = result.rows[0].id;
    const fullTxid = result.rows[0].txid;
    
    const ADMIN_ID = c.env.ADMIN_ID;
    
    // ملاحظة: كود البوت لن يعمل داخل Worker مباشرة، ولكن شرط التحقق يمنعه من التسبب في خطأ
    if (ADMIN_ID && typeof bot !== 'undefined' && bot?.telegram) {
      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `📥 طلب إيداع جديد #${requestId}\nمن التطبيق\n👤 @${username} (ID: ${user_id})\n🔗 TxID:\n<code>${fullTxid}</code>`,
          {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ موافقة", callback_data: `DEP_OK_${requestId}_${user_id}` },
                  { text: "❌ رفض", callback_data: `DEP_NO_${requestId}_${user_id}` }
                ]
              ]
            }
          }
        );
        console.log(`✅ Deposit notification sent to admin for request #${requestId}`);
      } catch (notifyErr) {
        console.error(`❌ Failed to send deposit notification: ${notifyErr.message}`);
      }
    } else {
      console.warn(`⚠️ Bot not available or ADMIN_ID not set, deposit #${requestId} saved but no notification sent`);
    }
    
    return c.json({ 
      success: true, 
      message: "Deposit request submitted",
      request_id: requestId 
    });
  } catch (err) {
    console.error("❌ Deposit submit error:", err.message);
    return c.json({ 
      success: false, 
      message: "Failed to submit deposit: " + err.message 
    });
  }
});

// =========================
// DEPOSIT - History
// =========================
app.get("/api/deposit/history", async (c) => {
  try {
    const id = c.req.query('id');
    
    if (!id || !/^\d+$/.test(id)) {
      return c.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    const result = await pool.query(
      `SELECT id, txid, amount, status, created_at, processed_at, admin_note
       FROM deposit_requests 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [telegramId]
    );
    
    return c.json({ 
      success: true, 
      data: result.rows.map(row => ({
        id: row.id,
        txid: row.txid,
        amount: parseFloat(row.amount || 0),
        status: row.status,
        created_at: row.created_at,
        processed_at: row.processed_at,
        admin_note: row.admin_note
      }))
    });
  } catch (err) {
    console.error("Deposit history error:", err);
    return c.json({ success: false, message: "Failed to load history" });
  }
});

// =========================
// دالة مساعدة لتنظيف عنوان المحفظة
// =========================
function cleanTRC20Address(address) {
  if (!address) return '';
  return address
    .trim()
    .replace(/\s/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

// =========================
// WITHDRAW - Submit Request
// =========================
app.post("/api/withdraw/submit", async (c) => {
  try {
    const { user_id, wallet, network, amount: requestedAmount } = await c.req.json();
    
    if (!user_id || !wallet) {
      return c.json({ success: false, message: "Invalid data" });
    }

    const cleanWallet = cleanTRC20Address(wallet);
    
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(cleanWallet)) {
      return c.json({ success: false, message: "Invalid TRC20 address" });
    }
    
    const requested = parseFloat(requestedAmount);
    // ملاحظة: تم استبدال MIN_WITHDRAW بـ 1.00 لضمان عدم وجود متغير غير معرف
    if (!requested || isNaN(requested) || requested < 1.00) {
      return c.json({ success: false, message: "Minimum withdraw is $1.00" });
    }
    
    const userRes = await pool.query(
      "SELECT telegram_id, balance FROM users WHERE telegram_id = $1",
      [user_id]
    );
    
    if (userRes.rows.length === 0) {
      return c.json({ success: false, message: "User not found" });
    }
    
    let balance = parseFloat(userRes.rows[0].balance) || 0;
    
    if (balance < requested) {
      return c.json({ 
        success: false, 
        message: `Insufficient balance. Required: $${requested.toFixed(4)}, Available: $${balance.toFixed(4)}` 
      });
    }
    
    const withdrawalFee = requested * 0.05;
    const netAmount = requested - withdrawalFee;
    const remaining = balance - requested;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(
        `INSERT INTO withdrawals (user_id, amount, payeer_wallet, status, requested_at, admin_note)
         VALUES ($1, $2, $3, 'pending', NOW(), $4)`,
        [user_id, netAmount, cleanWallet, `Requested: ${requested.toFixed(4)}$, Fee: ${withdrawalFee.toFixed(4)}$ (5%)`]
      );
      
      await client.query(
        "UPDATE users SET balance = $1 WHERE telegram_id = $2",
        [remaining, user_id]
      );
      
      await client.query('COMMIT');
      
      return c.json({
        success: true,
        message: "Withdrawal request submitted",
        requested_amount: requested,
        fee: withdrawalFee,
        net_amount: netAmount,
        remaining: remaining
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Withdraw submit error:", err);
    return c.json({ success: false, message: "Failed to submit withdrawal: " + err.message });
  }
});

// =========================
// WITHDRAW - History
// =========================
app.get("/api/withdraw/history", async (c) => {
  try {
    const id = c.req.query('id');
    
    if (!id || !/^\d+$/.test(id)) {
      return c.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    const result = await pool.query(
      `SELECT amount, payeer_wallet, status, requested_at, processed_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY requested_at DESC
       LIMIT 20`,
      [telegramId]
    );
    
    return c.json({
      success: true,
      data: result.rows.map(row => ({
        amount: parseFloat(row.amount),
        wallet: row.payeer_wallet,
        status: row.status,
        requested_at: row.requested_at,
        processed_at: row.processed_at
      }))
    });
  } catch (err) {
    console.error("Withdraw history error:", err);
    return c.json({ success: false, message: "Failed to load history" });
  }
});

// =========================
// CONTACT - Submit Message
// =========================
app.post("/api/contact/submit", async (c) => {
  try {
    const { user_id, message } = await c.req.json();
    
    if (!user_id || !message || message.trim().length < 5) {
      return c.json({ success: false, message: "Invalid message" });
    }
    
    const result = await pool.query(
      `INSERT INTO admin_messages (user_id, message, replied, created_at)
       VALUES ($1, $2, false, NOW())
       RETURNING id`,
      [user_id, message.trim()]
    );
    
    const messageId = result.rows[0].id;
    const ADMIN_ID = c.env.ADMIN_ID;
    
    if (ADMIN_ID && typeof bot !== 'undefined' && bot?.telegram) {
      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `📩 رسالة جديدة #${messageId} من التطبيق\n👤 المستخدم: ${user_id}\n📝 الرسالة:\n${message.trim()}`
        );
      } catch (notifyErr) {
        console.error(`❌ Failed to send contact notification: ${notifyErr.message}`);
      }
    }
    
    return c.json({
      success: true,
      message: "Message submitted",
      message_id: messageId
    });
  } catch (err) {
    console.error("Contact submit error:", err);
    return c.json({ success: false, message: "Failed to submit message" });
    }
});

// =========================
// CONTACT - User History
// =========================
app.get("/api/contact/history", async (c) => {
  try {
    const id = c.req.query('id');
    
    if (!id || !/^\d+$/.test(id)) {
      return c.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    const result = await pool.query(
      `SELECT id, message, admin_reply, replied, created_at
       FROM admin_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [telegramId]
    );
    
    return c.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        message: row.message,
        admin_reply: row.admin_reply,
        replied: row.replied,
        created_at: row.created_at
      }))
    });
  } catch (err) {
    console.error("Contact history error:", err);
    return c.json({ success: false, message: "Failed to load history" });
  }
});

// =========================
// 🔐 Middleware الأدمن
// =========================
const verifyAdmin = async (c, next) => {
  try {
    const adminId =
      c.req.query('admin_id') ||
      c.req.query('user_id');

    const REQUIRED_ADMIN_ID = (
      c.env?.ADMIN_ID || '7171208519'
    ).toString().trim();

    const providedId = adminId
      ? adminId.toString().trim()
      : '';

    if (!providedId || providedId !== REQUIRED_ADMIN_ID) {
      return c.json(
        {
          success: false,
          message: '❌ Access denied'
        },
        403
      );
    }

    // ⚠️ مهم:
    // لا يوجد هنا أي UPDATE لـ last_login_at.
    // هذا Middleware للتحقق فقط.
    
    await next();

  } catch (err) {
    console.error('❌ verifyAdmin error:', err);

    return c.json(
      {
        success: false,
        message: 'Server error'
      },
      500
    );
  }
};


// =========================
// 🔐 Admin Authentication
// =========================
// يستخدم نفس نظام التحقق بدون تسجيل دخول
const isAdminAuthenticated = verifyAdmin;
// =========================
// 🔐 ADMIN LOGIN
// تسجيل دخول الأدمن وتحديث آخر دخول
// =========================
app.post('/api/admin/login', async (c) => {
  try {
    const adminId =
      c.req.query('admin_id') ||
      c.req.query('user_id');

    const REQUIRED_ADMIN_ID = (
      c.env?.ADMIN_ID || '7171208519'
    ).toString().trim();

    const providedId = adminId
      ? adminId.toString().trim()
      : '';

    // =========================
    // التحقق من Admin ID
    // =========================
    if (!providedId || providedId !== REQUIRED_ADMIN_ID) {
      return c.json(
        {
          success: false,
          message: '❌ Admin access required'
        },
        403
      );
    }

    // =========================
    // تسجيل آخر دخول
    // =========================
    const result = await pool.query(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE telegram_id = $1
      RETURNING telegram_id, username, last_login_at
      `,
      [providedId]
    );

    // =========================
    // الأدمن غير موجود في users
    // =========================
    if (!result.rows.length) {
      return c.json(
        {
          success: false,
          message: '❌ Admin user not found in users table'
        },
        404
      );
    }

    const admin = result.rows[0];

    console.log(
      `✅ Admin login recorded: ${providedId} at ${admin.last_login_at}`
    );

    return c.json({
      success: true,
      message: '✅ Admin login recorded successfully',
      data: {
        telegram_id: admin.telegram_id,
        username: admin.username,
        last_login_at: admin.last_login_at
      }
    });

  } catch (err) {
    console.error(
      '❌ POST /api/admin/login:',
      err.message
    );

    return c.json(
      {
        success: false,
        message: 'Server error'
      },
      500
    );
  }
});
// =====================================================
// 📥 1. جلب طلبات الإيداع
// =====================================================
app.get('/api/admin/deposits', verifyAdmin, async (c) => {

  try {

    const status = c.req.query('status') || 'pending';

    const allowedStatuses = [
      'pending',
      'approved',
      'rejected'
    ];

    if (!allowedStatuses.includes(status)) {
      return c.json({
        success: false,
        message: '❌ Invalid status'
      }, 400);
    }


    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        username,
        txid,
        amount,
        status,
        created_at,
        processed_at,
        processed_by,
        admin_note
      FROM deposit_requests
      WHERE status = $1
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [status]
    );


    return c.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });

  } catch (err) {

    console.error(
      '❌ GET /api/admin/deposits:',
      err.message
    );

    return c.json({
      success: false,
      message: 'Server error'
    }, 500);

  }

});



// =====================================================
// ✅ 2. الموافقة على إيداع
// =====================================================
app.post(
  '/api/admin/deposits/:id/approve',
  verifyAdmin,
  async (c) => {

    const client = await pool.connect();

    try {

      const depositId = c.req.param('id');

      const body = await c.req.json().catch(() => ({}));

      const {
        final_amount
      } = body;


      // معرف الأدمن من Middleware فقط
      const adminId = c.get('adminId');


      await client.query('BEGIN');


      // 🔒 قفل الطلب لمنع الموافقة مرتين
      const check = await client.query(
        `
        SELECT *
        FROM deposit_requests
        WHERE id = $1
        AND status = 'pending'
        FOR UPDATE
        `,
        [depositId]
      );


      if (check.rows.length === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: '❌ Deposit not found or already processed'
        }, 404);

      }


      const deposit = check.rows[0];


      const amountToAdd =
        final_amount !== undefined &&
        final_amount !== null &&
        final_amount !== ''
          ? Number(final_amount)
          : Number(deposit.amount);


      if (
        !Number.isFinite(amountToAdd) ||
        amountToAdd <= 0
      ) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: '❌ Invalid amount'
        }, 400);

      }


      // =================================================
      // تحديث حالة الإيداع
      // =================================================
      await client.query(
        `
        UPDATE deposit_requests
        SET
          status = 'approved',
          processed_at = NOW(),
          processed_by = $1,
          amount = $2
        WHERE id = $3
        `,
        [
          adminId,
          amountToAdd,
          depositId
        ]
      );


      // =================================================
      // إضافة الرصيد للمستخدم
      // =================================================
      const userResult = await client.query(
        `
        UPDATE users
        SET balance = COALESCE(balance, 0) + $1
        WHERE telegram_id = $2
        RETURNING balance
        `,
        [
          amountToAdd,
          deposit.user_id
        ]
      );


      if (userResult.rowCount === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: '❌ User not found'
        }, 404);

      }


      // =================================================
      // 🎁 عمولة الإحالة 3%
      // =================================================
      let commissionAdded = 0;

      const referrerCheck = await client.query(
        `
        SELECT referrer_id
        FROM referrals
        WHERE referee_id = $1
        LIMIT 1
        `,
        [deposit.user_id]
      );


      if (referrerCheck.rows.length > 0) {

        const referrerId =
          referrerCheck.rows[0].referrer_id;


        if (
          referrerId &&
          referrerId.toString() !==
          deposit.user_id.toString()
        ) {

          commissionAdded =
            Math.round(
              amountToAdd * 0.03 * 1000000
            ) / 1000000;


          await client.query(
            `
            UPDATE users
            SET balance =
              COALESCE(balance, 0) + $1
            WHERE telegram_id = $2
            `,
            [
              commissionAdded,
              referrerId
            ]
          );


          await client.query(
            `
            INSERT INTO referral_earnings
            (
              referrer_id,
              referee_id,
              amount,
              created_at
            )
            VALUES ($1, $2, $3, NOW())
            `,
            [
              referrerId,
              deposit.user_id,
              commissionAdded
            ]
          );

        }

      }


      await client.query('COMMIT');


      return c.json({

        success: true,

        message:
          `✅ Deposit approved. $${amountToAdd.toFixed(4)} added successfully`,

        amount_added: amountToAdd,

        commission_added: commissionAdded,

        new_balance:
          userResult.rows[0].balance

      });


    } catch (err) {

      await client.query('ROLLBACK');

      console.error(
        '❌ POST /api/admin/deposits/:id/approve:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    } finally {

      client.release();

    }

  }
);



// =====================================================
// ❌ 3. رفض إيداع
// =====================================================
app.post(
  '/api/admin/deposits/:id/reject',
  verifyAdmin,
  async (c) => {

    try {

      const depositId = c.req.param('id');

      const body =
        await c.req.json().catch(() => ({}));

      const reason =
        body.reason ||
        'Does not meet requirements';


      const adminId =
        c.get('adminId');


      const result = await pool.query(
        `
        UPDATE deposit_requests
        SET
          status = 'rejected',
          processed_at = NOW(),
          processed_by = $1,
          admin_note = $2
        WHERE id = $3
        AND status = 'pending'
        RETURNING *
        `,
        [
          adminId,
          reason,
          depositId
        ]
      );


      if (result.rowCount === 0) {

        return c.json({
          success: false,
          message:
            '❌ Deposit not found or already processed'
        }, 404);

      }


      return c.json({
        success: true,
        message: '❌ Deposit rejected',
        data: result.rows[0]
      });


    } catch (err) {

      console.error(
        '❌ POST /api/admin/deposits/:id/reject:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    }

  }
);



// =====================================================
// 📤 4. جلب طلبات السحب
// =====================================================
app.get(
  '/api/admin/withdrawals',
  verifyAdmin,
  async (c) => {

    try {

      const status =
        c.req.query('status') ||
        'pending';


      const allowedStatuses = [
        'pending',
        'paid',
        'rejected'
      ];


      if (!allowedStatuses.includes(status)) {

        return c.json({
          success: false,
          message: '❌ Invalid status'
        }, 400);

      }


      const result = await pool.query(
        `
        SELECT
          id,
          user_id,
          amount,
          payeer_wallet,
          status,
          requested_at,
          processed_at,
          admin_note
        FROM withdrawals
        WHERE status = $1
        ORDER BY requested_at DESC
        LIMIT 50
        `,
        [status]
      );


      return c.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });


    } catch (err) {

      console.error(
        '❌ GET /api/admin/withdrawals:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    }

  }
);



// =====================================================
// ✅ 5. الموافقة على سحب
// =====================================================
app.post(
  '/api/admin/withdrawals/:id/approve',
  verifyAdmin,
  async (c) => {

    try {

      const withdrawId =
        c.req.param('id');


      const result = await pool.query(
        `
        UPDATE withdrawals
        SET
          status = 'paid',
          processed_at = NOW()
        WHERE id = $1
        AND status = 'pending'
        RETURNING *
        `,
        [withdrawId]
      );


      if (result.rowCount === 0) {

        return c.json({
          success: false,
          message:
            '❌ Withdrawal not found or already processed'
        }, 404);

      }


      return c.json({
        success: true,
        message:
          '✅ Withdrawal approved successfully',
        data: result.rows[0]
      });


    } catch (err) {

      console.error(
        '❌ POST /api/admin/withdrawals/:id/approve:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    }

  }
);



// =====================================================
// ❌ 6. رفض سحب وإرجاع المبلغ
// =====================================================
app.post(
  '/api/admin/withdrawals/:id/reject',
  verifyAdmin,
  async (c) => {

    const client =
      await pool.connect();


    try {

      const withdrawId =
        c.req.param('id');


      const body =
        await c.req.json().catch(() => ({}));


      const reason =
        body.reason ||
        'Verification failed';


      await client.query('BEGIN');


      // 🔒 قفل طلب السحب
      const withdrawal =
        await client.query(
          `
          SELECT *
          FROM withdrawals
          WHERE id = $1
          AND status = 'pending'
          FOR UPDATE
          `,
          [withdrawId]
        );


      if (withdrawal.rowCount === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            '❌ Withdrawal not found or already processed'
        }, 404);

      }


      const {
        user_id,
        amount
      } = withdrawal.rows[0];


      /*
       * مهم:
       * هنا يتم إرجاع amount المخزن في طلب السحب.
       *
       * إذا كان amount في جدول withdrawals
       * هو المبلغ بعد خصم رسوم 5%
       * أخبرني وسنعدل منطق الخصم حسب طريقة إنشاء طلب السحب.
       */

      const netAmount = Number(amount);

const refundAmount =
  Math.round(
    (netAmount / 0.95) * 1000000
  ) / 1000000;


      if (
        !Number.isFinite(refundAmount) ||
        refundAmount <= 0
      ) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            '❌ Invalid withdrawal amount'
        }, 400);

      }


      // تحديث حالة السحب
      await client.query(
        `
        UPDATE withdrawals
        SET
          status = 'rejected',
          processed_at = NOW(),
          admin_note = $1
        WHERE id = $2
        `,
        [
          reason,
          withdrawId
        ]
      );


      // إعادة الرصيد
      const userUpdate =
        await client.query(
          `
          UPDATE users
          SET balance =
            COALESCE(balance, 0) + $1
          WHERE telegram_id = $2
          RETURNING balance
          `,
          [
            refundAmount,
            user_id
          ]
        );


      if (userUpdate.rowCount === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            '❌ User not found'
        }, 404);

      }


      // تسجيل العملية
      await client.query(
        `
        INSERT INTO earnings
        (
          user_id,
          amount,
          source,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          user_id,
          refundAmount,
          'withdrawal_refund',
          `Refund for rejected withdrawal #${withdrawId}`
        ]
      );


      await client.query('COMMIT');


      return c.json({

        success: true,

        message:
          `❌ Withdrawal rejected. $${refundAmount.toFixed(4)} refunded.`,

        refunded_amount:
          refundAmount,

        new_balance:
          userUpdate.rows[0].balance

      });


    } catch (err) {

      await client.query('ROLLBACK');

      console.error(
        '❌ POST /api/admin/withdrawals/:id/reject:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    } finally {

      client.release();

    }

  }
);



// =====================================================
// ➕ 7. إضافة رصيد للمستخدم
// =====================================================
app.post(
  '/api/admin/balance/add',
  verifyAdmin,
  async (c) => {

    const client =
      await pool.connect();


    try {

      const {
        user_id,
        amount,
        reason = 'Manual credit',
        source = 'admin_panel'
      } =
        await c.req.json();


      const numericAmount =
        Number(amount);


      if (
        !user_id ||
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
      ) {

        return c.json({
          success: false,
          message:
            '❌ Invalid input'
        }, 400);

      }


      await client.query('BEGIN');


      const userResult =
        await client.query(
          `
          UPDATE users
          SET balance =
            COALESCE(balance, 0) + $1
          WHERE telegram_id = $2
          RETURNING balance
          `,
          [
            numericAmount,
            user_id
          ]
        );


      if (userResult.rowCount === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            '❌ User not found'
        }, 404);

      }


      // تسجيل الأرباح
      await client.query(
        `
        INSERT INTO earnings
        (
          user_id,
          amount,
          source,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          user_id,
          numericAmount,
          source,
          reason
        ]
      );


      // =================================================
      // 🎁 عمولة الإحالة
      // =================================================
      let referralBonus = 0;


      const ref =
        await client.query(
          `
          SELECT referrer_id
          FROM referrals
          WHERE referee_id = $1
          LIMIT 1
          `,
          [user_id]
        );


      if (ref.rows.length > 0) {

        const referrerId =
          ref.rows[0].referrer_id;


        if (
          referrerId &&
          referrerId.toString() !==
          user_id.toString()
        ) {

          referralBonus =
            Math.round(
              numericAmount * 0.03 * 1000000
            ) / 1000000;


          await client.query(
            `
            UPDATE users
            SET balance =
              COALESCE(balance, 0) + $1
            WHERE telegram_id = $2
            `,
            [
              referralBonus,
              referrerId
            ]
          );


          await client.query(
            `
            INSERT INTO referral_earnings
            (
              referrer_id,
              referee_id,
              amount,
              created_at
            )
            VALUES ($1, $2, $3, NOW())
            `,
            [
              referrerId,
              user_id,
              referralBonus
            ]
          );

        }

      }


      await client.query('COMMIT');


      return c.json({

        success: true,

        message:
          `✅ Added $${numericAmount.toFixed(4)}`,

        new_balance:
          userResult.rows[0].balance,

        referral_bonus:
          referralBonus

      });


    } catch (err) {

      await client.query('ROLLBACK');

      console.error(
        '❌ POST /api/admin/balance/add:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    } finally {

      client.release();

    }

  }
);



// =====================================================
// ➖ 8. خصم رصيد
// =====================================================
app.post(
  '/api/admin/balance/deduct',
  verifyAdmin,
  async (c) => {

    const client =
      await pool.connect();


    try {

      const {
        user_id,
        amount,
        reason
      } =
        await c.req.json();


      const numericAmount =
        Number(amount);


      if (
        !user_id ||
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0 ||
        !reason ||
        !reason.trim()
      ) {

        return c.json({
          success: false,
          message:
            '❌ Fill all fields (Reason required)'
        }, 400);

      }


      await client.query('BEGIN');


      // قفل المستخدم
      const userCheck =
        await client.query(
          `
          SELECT telegram_id, balance
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
          `,
          [user_id]
        );


      if (userCheck.rows.length === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            '❌ User not found'
        }, 404);

      }


      const currentBalance =
        Number(
          userCheck.rows[0].balance || 0
        );


      // لا نسمح برصيد سالب
      const deductedAmount =
        Math.min(
          numericAmount,
          currentBalance
        );


      const newBalance =
        currentBalance - deductedAmount;


      await client.query(
        `
        UPDATE users
        SET balance = $1
        WHERE telegram_id = $2
        `,
        [
          newBalance,
          user_id
        ]
      );


      await client.query(
        `
        INSERT INTO earnings
        (
          user_id,
          amount,
          source,
          description
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          user_id,
          -deductedAmount,
          'admin_deduction',
          reason
        ]
      );


      await client.query('COMMIT');


      return c.json({

        success: true,

        message:
          `✅ Deducted $${deductedAmount.toFixed(4)}`,

        deducted_amount:
          deductedAmount,

        previous_balance:
          currentBalance,

        new_balance:
          newBalance

      });


    } catch (err) {

      await client.query('ROLLBACK');

      console.error(
        '❌ POST /api/admin/balance/deduct:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    } finally {

      client.release();

    }

  }
);



// =====================================================
// 📬 9. جلب رسائل المستخدمين
// =====================================================
app.get(
  '/api/admin/messages',
  verifyAdmin,
  async (c) => {

    try {

      const status =
        c.req.query('status') ||
        'unread';


      let limit =
        parseInt(
          c.req.query('limit')
        );


      if (
        !Number.isFinite(limit) ||
        limit <= 0
      ) {
        limit = 50;
      }


      // الحد الأقصى
      limit = Math.min(limit, 100);


      let query;
      let params;


      if (status === 'unread') {

        query = `
          SELECT
            id,
            user_id,
            message,
            admin_reply,
            replied,
            created_at,
            replied_at
          FROM admin_messages
          WHERE replied = false
          ORDER BY created_at DESC
          LIMIT $1
        `;

        params = [limit];

      } else if (status === 'replied') {

        query = `
          SELECT
            id,
            user_id,
            message,
            admin_reply,
            replied,
            created_at,
            replied_at
          FROM admin_messages
          WHERE replied = true
          ORDER BY created_at DESC
          LIMIT $1
        `;

        params = [limit];

      } else {

        query = `
          SELECT
            id,
            user_id,
            message,
            admin_reply,
            replied,
            created_at,
            replied_at
          FROM admin_messages
          ORDER BY created_at DESC
          LIMIT $1
        `;

        params = [limit];

      }


      const result =
        await pool.query(
          query,
          params
        );


      return c.json({

        success: true,

        data:
          result.rows,

        count:
          result.rows.length

      });


    } catch (err) {

      console.error(
        '❌ GET /api/admin/messages:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    }

  }
);



// =====================================================
// 💬 10. الرد على رسالة
// =====================================================
app.post(
  '/api/admin/messages/:id/reply',
  verifyAdmin,
  async (c) => {

    try {

      // =================================================
      // 🆔 الحصول على رقم الرسالة
      // =================================================
      const messageId =
        c.req.param('id');

      const numericMessageId =
        Number(messageId);


      if (
        !Number.isInteger(numericMessageId) ||
        numericMessageId <= 0
      ) {

        return c.json({
          success: false,
          message:
            '❌ Invalid message ID'
        }, 400);

      }


      // =================================================
      // 📝 قراءة الرد
      // =================================================
      const {
        reply
      } =
        await c.req.json();


      const cleanReply =
        typeof reply === 'string'
          ? reply.trim()
          : '';


      if (!cleanReply) {

        return c.json({
          success: false,
          message:
            '❌ Reply text is required'
        }, 400);

      }


      // =================================================
      // 💾 حفظ رد الأدمن
      // جدول: admin_messages
      //
      // id           -> رقم الرسالة
      // admin_reply  -> رد الأدمن
      // replied      -> تم الرد
      // replied_at   -> وقت الرد
      // =================================================
      const result =
        await pool.query(
          `
          UPDATE admin_messages
          SET
            admin_reply = $1,
            replied = TRUE,
            replied_at = NOW()
          WHERE id = $2
          RETURNING
            id,
            user_id,
            message,
            admin_reply,
            replied,
            created_at,
            replied_at
          `,
          [
            cleanReply,
            numericMessageId
          ]
        );


      // =================================================
      // ❌ الرسالة غير موجودة
      // =================================================
      if (result.rowCount === 0) {

        return c.json({
          success: false,
          message:
            '❌ Message not found'
        }, 404);

      }


      // =================================================
      // ✅ نجاح
      // =================================================
      return c.json({

        success: true,

        message:
          '✅ Reply saved successfully',

        data:
          result.rows[0]

      });


    } catch (err) {

      console.error(
        '❌ POST /api/admin/messages/:id/reply:',
        err.message
      );

      return c.json({
        success: false,
        message:
          'Server error'
      }, 500);

    }

  }
);



// =====================================================
// 📊 11. إحصائيات الأدمن
// =====================================================
app.get(
  '/api/admin/stats',
  verifyAdmin,
  async (c) => {

    try {

      const [
        deposits,
        withdrawals,
        messages,
        users,
        approvedToday,
        pendingProofs,
        openDisputes,
        commission
      ] =
        await Promise.all([

          pool.query(
            `
            SELECT COUNT(*) AS count
            FROM deposit_requests
            WHERE status = 'pending'
            `
          ),

          pool.query(
            `
            SELECT COUNT(*) AS count
            FROM withdrawals
            WHERE status = 'pending'
            `
          ),

          pool.query(
            `
            SELECT COUNT(*) AS count
            FROM admin_messages
            WHERE replied = false
            `
          ),

          pool.query(
            `
            SELECT COUNT(*) AS count
            FROM users
            `
          ),

          pool.query(
            `
            SELECT COUNT(*) AS count
            FROM task_executions
            WHERE status = 'approved'
            AND reviewed_at::date =
                CURRENT_DATE
            `
          ),

          pool.query(`
  SELECT COUNT(*) AS count
  FROM task_executions te
  INNER JOIN tasks t ON t.id = te.task_id
  WHERE te.status = 'pending'
    AND te.proof IS NOT NULL
    AND t.deleted_at IS NULL
`),

          pool.query(
            `
            SELECT COUNT(*) AS count
            FROM task_disputes
            WHERE status = 'open'
            `
          ),

          pool.query(
            `
            SELECT
              COALESCE(
                SUM(commission_amount),
                0
              ) AS total
            FROM task_executions
            WHERE status = 'approved'
            `
          )

        ]);


      return c.json({

        success: true,

        data: {

          pending_deposits:
            parseInt(
              deposits.rows[0].count
            ) || 0,

          pending_withdrawals:
            parseInt(
              withdrawals.rows[0].count
            ) || 0,

          unread_messages:
            parseInt(
              messages.rows[0].count
            ) || 0,

          total_users:
            parseInt(
              users.rows[0].count
            ) || 0,

          pending_proofs:
            parseInt(
              pendingProofs.rows[0].count
            ) || 0,

          open_disputes:
            parseInt(
              openDisputes.rows[0].count
            ) || 0,

          approved_today:
            parseInt(
              approvedToday.rows[0].count
            ) || 0,

          admin_commission:
            Number(
              commission.rows[0].total || 0
            )

        }

      });


    } catch (err) {

      console.error(
        '❌ GET /api/admin/stats:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    }

  }
);



// =====================================================
// 👥 12. جلب العدد الكلي للمستخدمين
// =====================================================
app.get(
  '/api/admin/stats/total-users',
  verifyAdmin,
  async (c) => {

    try {

      const result =
        await pool.query(
          `
          SELECT COUNT(*) AS total
          FROM users
          `
        );


      const totalUsers =
        parseInt(
          result.rows[0]?.total
        ) || 0;


      return c.json({

        success: true,

        data: {

          total_users:
            totalUsers

        }

      });


    } catch (err) {

      console.error(
        '❌ ERROR /api/admin/stats/total-users:',
        err.message
      );

      return c.json({
        success: false,
        message: 'Server error'
      }, 500);

    }

  }
);
// ======================= 📝 TASKS SYSTEM API - FULL COMPATIBLE =======================

// ======================= ✅ تنفيذات المستخدم TASK =======================
app.get('/api/tasks/user-executions', async (c) => {
  try {
    const user_id = c.req.query('user_id');

    // ==========================================
    // 🔐 Validate user_id
    // ==========================================
    if (
      !user_id ||
      !/^\d+$/.test(user_id.toString())
    ) {
      return c.json({
        success: false,
        message: "Valid user_id required"
      }, 400);
    }

    // ==========================================
    // 📋 Get user's task executions
    // ==========================================
    const executions = await pool.query(
      `
      SELECT
        te.id,
        te.task_id,
        te.executor_id,
        te.proof,
        te.status,
        te.submitted_at,
        te.reviewed_at,
        te.reviewed_by,
        te.payment_amount,
        te.commission_amount,
        te.rejection_reason,
        te.rejected_at,

        t.title AS task_title,
        t.description AS task_description,
        t.executor_reward,

        (
          SELECT td.resolution
          FROM task_disputes td
          WHERE td.execution_id = te.id
          ORDER BY td.created_at DESC
          LIMIT 1
        ) AS admin_resolution,

        EXISTS (
          SELECT 1
          FROM task_disputes td2
          WHERE td2.execution_id = te.id
        ) AS has_dispute

      FROM task_executions te

      INNER JOIN tasks t
        ON t.id = te.task_id

      WHERE te.executor_id = $1::bigint

      AND NOT (
        te.status = 'applied'
        AND te.submitted_at IS NOT NULL
        AND t.duration_seconds IS NOT NULL
        AND te.submitted_at +
            (t.duration_seconds || ' seconds')::interval
            < NOW()
      )

      ORDER BY te.submitted_at DESC NULLS LAST
      `,
      [user_id]
    );

    // ==========================================
    // ✅ Return executions
    // ==========================================
    return c.json({
      success: true,
      data: executions.rows
    });

  } catch (err) {

    console.error(
      '❌ /api/tasks/user-executions:',
      err
    );

    return c.json({
      success: false,
      message: "Failed to load executions",
      error: err.message
    }, 500);
  }
});

// ======================= 📊 TASKS: AVAILABLE =======================
app.get('/api/tasks/available', async (c) => {
  try {
    const user_id = c.req.query('user_id');
    
    if (!user_id || !/^\d+$/.test(user_id.toString())) {
      return c.json({ success: false, message: "Valid user_id required" }, 400);
    }
    
    const tasks = await pool.query(`
      SELECT 
        t.id, 
        t.title, 
        t.description, 
        COALESCE(t.executor_reward, t.price, 0.01) as executor_reward,
        t.duration_seconds, 
        t.budget, 
        t.spent,
        (t.budget - t.spent) as remaining_budget,
        t.created_at,
        t.settings,
        t.target_url,
        t.settings->>'category' as category,
        (
          SELECT COUNT(*) 
          FROM task_executions 
          WHERE task_id = t.id AND status = 'approved'
        ) as completed_count,
        (
          SELECT COUNT(*) 
          FROM task_executions 
          WHERE task_id = t.id AND status IN ('applied', 'pending')
        ) as pending_count
      FROM tasks t
      WHERE t.is_active = true 
        AND t.budget > t.spent 
        AND t.creator_id != $1::bigint
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 
          FROM task_executions te 
          WHERE te.task_id = t.id 
            AND te.executor_id = $1::bigint
            AND te.status IN ('applied', 'pending', 'approved', 'disputed', 'rejected')
        )
      ORDER BY t.created_at DESC
      LIMIT 50
    `, [user_id]);
    
    return c.json({ success: true, data: tasks.rows });
    
  } catch (err) {
    console.error('❌ /api/tasks/available:', err);
    return c.json({ success: false, message: "Failed to load tasks", error: err.message }, 500);
  }
});

// ======================= 📋 TASKS: MY TASKS =======================
app.get('/api/tasks/my', async (c) => {
  try {
    const userId = c.req.query('user_id');
    
    if (!userId || !/^\d+$/.test(userId.toString())) {
      return c.json({ success: false, message: 'Valid user_id is required' }, 400);
    }

    const query = `
      SELECT 
        t.id, t.title, t.description, t.budget, t.spent,
        COALESCE(t.executor_reward, t.price, 0.01) as executor_reward,
        t.is_active, t.created_at, t.duration_seconds, t.settings, t.target_url,
        COUNT(te.id) FILTER (WHERE te.id IS NOT NULL) AS total_executions,
        COUNT(te.id) FILTER (WHERE te.status = 'approved') AS approved_count,
        COUNT(te.id) FILTER (WHERE te.status = 'pending') AS pending_count,
        COUNT(te.id) FILTER (WHERE te.status = 'rejected') AS rejected_count,
        COUNT(te.id) FILTER (WHERE te.status = 'disputed') AS disputed_count
      FROM tasks t
      LEFT JOIN task_executions te ON t.id = te.task_id
      WHERE t.creator_id = $1 AND t.deleted_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);

    const tasks = result.rows.map(task => ({
      ...task,
      pending_count: parseInt(task.pending_count) || 0,
      disputed_count: parseInt(task.disputed_count) || 0,
      total_executions: parseInt(task.total_executions) || 0,
      approved_count: parseInt(task.approved_count) || 0
    }));

    return c.json({ success: true, data: tasks });

  } catch (err) {
    console.error('❌ /api/tasks/my:', err);
    return c.json({ success: false, message: 'Server error', error: err.message }, 500);
  }
});

// ======================= ➕ CREATE TASK =======================
app.post('/api/tasks/create', async (c) => {
  const client = await pool.connect();
  try {
    const { 
      creator_id, title, description, reward_per_execution,
      duration_seconds, budget, target_url,
      category, verification_method, proof_requirements,
      audience, delivery_interval, execution_type, max_completion_time,
      verification_keyword, delay_hours, delay_minutes, hourly_limits, multi_interval
    } = await c.req.json();
    
    if (!creator_id || !title || reward_per_execution === undefined || !budget) {
      return c.json({ 
        success: false, 
        message: "Missing required fields",
        required: ["creator_id", "title", "reward_per_execution", "budget"]
      }, 400);
    }
    
    const executorReward = parseFloat(reward_per_execution);
    const totalBudget = parseFloat(budget);
    
    if (isNaN(executorReward) || executorReward < 0.001) {
      return c.json({ success: false, message: "Invalid reward: min $0.001" }, 400);
    }
    if (isNaN(totalBudget) || totalBudget < 0.10) {
      return c.json({ success: false, message: "Invalid budget: min $0.10" }, 400);
    }
    
    const adminCommission = executorReward * 0.20;
const referralCommission = executorReward * 0.05;

const totalCostPerExecution =
  executorReward +
  adminCommission +
  referralCommission;
    
    const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [creator_id]);
    
    if (userRes.rows.length === 0) {
      return c.json({ success: false, message: "User not found" }, 404);
    }
    
    const userBalance = parseFloat(userRes.rows[0].balance || 0);
    if (userBalance < totalBudget) {
      return c.json({ 
        success: false, 
        message: `Insufficient balance. Need: $${totalBudget.toFixed(4)}, Have: $${userBalance.toFixed(4)}` 
      }, 400);
    }
    
    await client.query('BEGIN');
    
    try {
      await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [totalBudget, creator_id]);
      
      const settings = {
        category: category || 'other',
        verification_method: verification_method || 'manual',
        proof_requirements: proof_requirements || '',
        audience: audience || 'all',
        delivery_interval: delivery_interval || 'none',
        execution_type: execution_type || 'once',
        verification_keyword: verification_keyword || '',
        delay_hours: delay_hours || 0,
        delay_minutes: delay_minutes || 5,
        hourly_limits: hourly_limits || [],
        multi_interval: multi_interval || 0
      };
      
      const finalDuration = parseInt(duration_seconds) || parseInt(max_completion_time) || 86400;
      
      const result = await client.query(`
        INSERT INTO tasks (
          title, description, price, executor_reward, duration_seconds,
          budget, spent, creator_id, is_active, target_url, settings
        )
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7, true, $8, $9)
        RETURNING id, title, created_at, executor_reward, budget, spent, is_active, settings, target_url
      `, [
        title, description, executorReward, executorReward, finalDuration,
        totalBudget, creator_id, target_url || '', settings
      ]);
      
      await client.query('COMMIT');
      
      return c.json({ 
        success: true, 
        message: "Task created successfully", 
        task: result.rows[0],
        payment_info: {
  executor_reward: executorReward.toFixed(4),
  admin_commission: adminCommission.toFixed(4),
  referral_commission: referralCommission.toFixed(4),
  total_cost_per_execution: totalCostPerExecution.toFixed(4),
  estimated_completions:
    Math.floor(totalBudget / totalCostPerExecution)
}
      });
      
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('❌ DB Error:', dbErr);
      throw dbErr;
    }
    
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ CRITICAL /api/tasks/create:', err);
    return c.json({ 
      success: false, 
      message: "Failed to create task", 
      error: err.message // تم تبسيطها لتجنب مشاكل NODE_ENV في Workers
    }, 500);
  } finally {
    client.release();
  }
});

// ======================= 🚀 APPLY FOR TASK =======================
app.post('/api/tasks/:id/apply', async (c) => {
  const client = await pool.connect();

  try {
    const id = c.req.param('id');
    const { user_id } = await c.req.json();

    if (!id || !user_id || !/^\d+$/.test(user_id.toString())) {
      return c.json({
        success: false,
        message: "Invalid task ID or user ID"
      }, 400);
    }

    await client.query('BEGIN');

    // ==========================================
    // 🔒 Lock task row to prevent double booking
    // ==========================================
    const task = await client.query(
      `
      SELECT
        id,
        budget,
        spent,
        executor_reward,
        price,
        duration_seconds,
        is_active,
        deleted_at,
        creator_id
      FROM tasks
      WHERE id = $1::integer
      FOR UPDATE
      `,
      [id]
    );

    if (
      task.rows.length === 0 ||
      !task.rows[0].is_active ||
      task.rows[0].deleted_at
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Task not found or inactive"
      }, 404);
    }

    // ==========================================
    // 🚫 Creator cannot execute own task
    // ==========================================
    if (
      task.rows[0].creator_id !== null &&
      task.rows[0].creator_id?.toString() === user_id.toString()
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "You cannot execute your own task"
      }, 403);
    }

    // ==========================================
    // 🚫 User cannot have another execution
    // ==========================================
    const existing = await client.query(
      `
      SELECT id, status
      FROM task_executions
      WHERE task_id = $1::integer
        AND executor_id = $2::bigint
        AND status IN (
          'applied',
          'pending',
          'approved',
          'disputed'
        )
      FOR UPDATE
      `,
      [id, user_id]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "You already have an active execution for this task"
      }, 400);
    }

    // ==========================================
    // 💰 Calculate payment
    // ==========================================
    const executorReward = parseFloat(
      task.rows[0].executor_reward ||
      task.rows[0].price ||
      0.01
    );

    // ✅ Unified commission = 25%
    const adminCommission = executorReward * 0.20;

const referralCommission = executorReward * 0.05;

const totalCost =
  executorReward +
  adminCommission +
  referralCommission;

    if (
      !Number.isFinite(executorReward) ||
      executorReward <= 0 ||
      !Number.isFinite(adminCommission) ||
      adminCommission < 0 ||
      !Number.isFinite(totalCost) ||
      totalCost <= 0
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Invalid task payment configuration"
      }, 400);
    }

    // ==========================================
    // 💰 Available budget
    //
    // spent contains both:
    // - reserved amounts
    // - already consumed amounts
    //
    // Therefore:
    // available = budget - spent
    // ==========================================
    const budget = parseFloat(task.rows[0].budget || 0);
    const spent = parseFloat(task.rows[0].spent || 0);
    const remaining = budget - spent;

    if (
      !Number.isFinite(budget) ||
      !Number.isFinite(spent) ||
      remaining < totalCost
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Task has insufficient budget"
      }, 400);
    }

    // ==========================================
    // 🔒 Reserve the complete task cost
    //
    // IMPORTANT:
    // We reserve through spent.
    // We DO NOT change budget here.
    // ==========================================
    const updatedTask = await client.query(
      `
      UPDATE tasks
      SET spent = COALESCE(spent, 0) + $1
      WHERE id = $2::integer
        AND (COALESCE(budget, 0) - COALESCE(spent, 0)) >= $1
      RETURNING budget, spent
      `,
      [totalCost, id]
    );

    if (updatedTask.rows.length === 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Task budget changed. Please try again."
      }, 409);
    }

    // ==========================================
    // 📝 Create execution
    // ==========================================
    const execution = await client.query(
      `
      INSERT INTO task_executions (
        task_id,
        executor_id,
        status,
        payment_amount,
        commission_amount,
        submitted_at
      )
      VALUES (
        $1::integer,
        $2::bigint,
        'applied',
        $3,
        $4,
        NOW()
      )
      RETURNING
        id,
        task_id,
        executor_id,
        status,
        payment_amount,
        commission_amount,
        submitted_at
      `,
      [
        id,
        user_id,
        executorReward,
        adminCommission
      ]
    );

    await client.query('COMMIT');

    return c.json({
      success: true,
      message: "Applied successfully - funds reserved",
      execution: {
        id: execution.rows[0].id,
        reward: executorReward.toFixed(6),
        commission: adminCommission.toFixed(6),
        total_cost: totalCost.toFixed(6),
        duration_seconds: task.rows[0].duration_seconds,
        status: 'applied'
      }
    });

  } catch (err) {

    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error('❌ /api/tasks/:id/apply:', err);

    return c.json({
      success: false,
      message: "Failed to apply: " + err.message
    }, 500);

  } finally {
    client.release();
  }
});

// ======================= 📤 SUBMIT PROOF =======================
app.post('/api/tasks/:id/submit-proof', async (c) => {
  try {
    const id = c.req.param('id');
    const { user_id, proof, execution_id } = await c.req.json();
    
    if (!proof || proof.trim().length < 1) {
      return c.json({ success: false, message: "Proof must contain at least 1 character" }, 400);
    }
    
    let exec;
    if (execution_id) {
      exec = await pool.query(
        `SELECT id, status, submitted_at, executor_id 
         FROM task_executions 
         WHERE id = $1::integer AND task_id = $2::integer AND executor_id = $3::bigint AND status = 'applied'`,
        [execution_id, id, user_id]
      );
    } else {
      exec = await pool.query(
        `SELECT id, status, submitted_at, executor_id 
         FROM task_executions 
         WHERE task_id = $1::integer AND executor_id = $2::bigint AND status = 'applied'`,
        [id, user_id]
      );
    }
    
    if (exec.rows.length === 0) {
      return c.json({ success: false, message: "No applied execution found for this task" }, 404);
    }
    
    await pool.query(
      `UPDATE task_executions 
       SET proof = $1, status = 'pending', submitted_at = COALESCE(submitted_at, NOW()) 
       WHERE id = $2::integer`, 
      [proof, exec.rows[0].id]
    );
    
    return c.json({ 
      success: true, 
      message: "Proof submitted successfully", 
      execution_id: exec.rows[0].id 
    });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id/submit-proof:', err);
    return c.json({ success: false, message: "Failed to submit proof: " + err.message }, 500);
  }
});

// ======================= 📋 TASK PROOFS =======================
app.get('/api/tasks/:id/proofs', async (c) => {
  try {
    const id = c.req.param('id');
    const user_id = c.req.query('user_id');
    
    if (!id) {
      return c.json({ success: false, message: "Task ID required" }, 400);
    }
    
    const task = await pool.query('SELECT creator_id, deleted_at FROM tasks WHERE id = $1', [id]);
    if (task.rows.length === 0 || task.rows[0].deleted_at) {
      return c.json({ success: false, message: "Task not found" }, 404);
    }
    
    const isCreator = task.rows[0].creator_id?.toString() === user_id;
    let query, params;
    
    if (isCreator) {
      query = `
        SELECT 
          te.id, te.proof, te.status, te.submitted_at, te.payment_amount, te.commission_amount, te.executor_id,
          u.username as executor_username, u.telegram_id,
          td.resolution as admin_resolution
        FROM task_executions te
        LEFT JOIN users u ON te.executor_id = u.telegram_id
        LEFT JOIN task_disputes td ON te.id = td.execution_id
        WHERE te.task_id = $1 AND te.proof IS NOT NULL
        ORDER BY CASE WHEN te.status = 'pending' THEN 1 WHEN te.status = 'disputed' THEN 2 WHEN te.status = 'approved' THEN 3 WHEN te.status = 'rejected' THEN 4 ELSE 5 END, te.submitted_at DESC
      `;
      params = [id];
    } else if (user_id) {
      query = `
        SELECT 
          te.id, te.proof, te.status, te.submitted_at, te.payment_amount, te.executor_id,
          td.resolution as admin_resolution
        FROM task_executions te
        LEFT JOIN task_disputes td ON te.id = td.execution_id
        WHERE te.task_id = $1 AND te.executor_id = $2 AND te.proof IS NOT NULL
        ORDER BY te.submitted_at DESC
      `;
      params = [id, user_id];
    } else {
      return c.json({ success: false, message: "Authentication required" }, 401);
    }
    
    const proofs = await pool.query(query, params);
    return c.json({ success: true, data: proofs.rows });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id/proofs:', err);
    return c.json({ success: false, message: "Failed to load proofs", error: err.message }, 500);
  }
});

// ======================= ✅ APPROVE PROOF =======================
app.post('/api/tasks/:id/proofs/:proofId/approve', async (c) => {
  const client = await pool.connect();
  try {
    const taskId = c.req.param('id');
    const proofId = c.req.param('proofId');
    const { user_id } = await c.req.json();
    
    const task = await client.query(
      'SELECT creator_id, budget, spent FROM tasks WHERE id = $1 AND deleted_at IS NULL', 
      [taskId]
    );
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      return c.json({ success: false, message: "Unauthorized: You are not the task creator" }, 403);
    }
    
    const exec = await client.query(
      `SELECT id, executor_id, payment_amount, commission_amount, status 
       FROM task_executions WHERE id = $1 AND task_id = $2 AND status = 'pending'`,
      [proofId, taskId]
    );
    if (exec.rows.length === 0) {
      return c.json({ success: false, message: "Execution not found or already processed" }, 404);
    }
    
    const executorId = exec.rows[0].executor_id;
    const paymentAmount = parseFloat(exec.rows[0].payment_amount);
    const adminCommission = parseFloat(
  exec.rows[0].commission_amount || (paymentAmount * 0.20)
);

const referralCommission = paymentAmount * 0.05;

const totalCost =
  paymentAmount +
  adminCommission +
  referralCommission;
    
    await client.query('BEGIN');
    
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', 
      [paymentAmount, executorId]
    );
    
    const adminId = c.env.ADMIN_ID;
    if (adminId && adminCommission > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', 
        [adminCommission, adminId]
      );
    }
    
    await client.query(`
      UPDATE task_executions 
      SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1
      WHERE id = $2
    `, [user_id, proofId]);
    
    
    await client.query(`
      INSERT INTO earnings (user_id, source, amount, description, video_id, watched_seconds, created_at)
      VALUES ($1, 'task_execution', $2, $3, NULL, NULL, NOW())
    `, [executorId, paymentAmount, `Task #${taskId} execution reward (100%)`]);
    
    if (adminCommission > 0 && adminId) {
      await client.query(`
        INSERT INTO earnings (user_id, source, amount, description, video_id, watched_seconds, created_at)
        VALUES ($1, 'task_commission', $2, $3, NULL, NULL, NOW())
      `, [adminId, adminCommission, `Commission from task #${taskId} (20%)`]);
    }
    
    await client.query('COMMIT');

    // ملاحظة: تأكد من أن دالة distributeReferralCommission معرفة في ملفك
    await distributeReferralCommission(executorId, paymentAmount);
    
    return c.json({ 
      success: true, 
      message: "Proof approved and payment sent",
      payment_details: {
        executor_received: paymentAmount.toFixed(4),
        admin_commission: adminCommission.toFixed(4),
        total_deducted: totalCost.toFixed(4)
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Approve proof:', err);
    return c.json({ success: false, message: "Failed to approve: " + err.message }, 500);
  } finally {
    client.release();
  }
});

// ======================= ❌ REJECT PROOF =======================
app.post('/api/tasks/:id/proofs/:proofId/reject', async (c) => {
  const client = await pool.connect();

  try {
    const taskId = c.req.param('id');
    const proofId = c.req.param('proofId');

    const { user_id, reason } = await c.req.json();

    // ==========================================
    // 🔐 Validate user
    // ==========================================
    if (!user_id || !/^\d+$/.test(user_id.toString())) {
      return c.json({
        success: false,
        message: "Valid user_id required"
      }, 400);
    }

    // ==========================================
    // 📝 Validate rejection reason
    // ==========================================
    if (!reason || reason.trim().length < 20) {
      return c.json({
        success: false,
        message: "Rejection reason must be at least 20 characters"
      }, 400);
    }

    await client.query('BEGIN');

    // ==========================================
    // 🔒 Lock task
    // ==========================================
    const task = await client.query(
      `
      SELECT
        id,
        creator_id,
        budget,
        spent
      FROM tasks
      WHERE id = $1::integer
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [taskId]
    );

    if (task.rows.length === 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Task not found"
      }, 404);
    }

    const taskRow = task.rows[0];

    // ==========================================
    // 👤 Verify task creator
    // ==========================================
    if (
      taskRow.creator_id?.toString() !==
      user_id.toString()
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Unauthorized"
      }, 403);
    }

    // ==========================================
    // 🔒 Lock execution
    // ==========================================
    const exec = await client.query(
      `
      SELECT
        id,
        task_id,
        executor_id,
        payment_amount,
        commission_amount,
        status,
        rejected_at
      FROM task_executions
      WHERE id = $1::integer
        AND task_id = $2::integer
      FOR UPDATE
      `,
      [proofId, taskId]
    );

    if (exec.rows.length === 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Execution not found"
      }, 404);
    }

    const execution = exec.rows[0];

    // ==========================================
    // ✅ Only pending can be rejected
    // ==========================================
    if (execution.status !== 'pending') {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Only pending executions can be rejected"
      }, 400);
    }

    // ==========================================
    // 💰 Validate execution payment data
    // ==========================================
    const paymentAmount = parseFloat(
      execution.payment_amount || 0
    );

    const adminCommission = parseFloat(
      execution.commission_amount ??
      (paymentAmount * 0.25)
    );

    const totalCost =
      paymentAmount + adminCommission;

    if (
      !Number.isFinite(paymentAmount) ||
      paymentAmount <= 0 ||
      !Number.isFinite(adminCommission) ||
      adminCommission < 0 ||
      !Number.isFinite(totalCost) ||
      totalCost <= 0
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Invalid execution payment data"
      }, 400);
    }

    // ==========================================
    // 💰 Verify reservation still exists
    //
    // spent already contains this reservation.
    // DO NOT release it on rejection.
    // ==========================================
    if (
      !Number.isFinite(parseFloat(taskRow.spent || 0)) ||
      parseFloat(taskRow.spent || 0) < totalCost
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Reserved task funds are insufficient"
      }, 500);
    }

    // ==========================================
    // ❌ Reject execution
    //
    // IMPORTANT:
    // - Keep the reservation
    // - Record rejected_at
    // - Give executor 24 hours to dispute
    // ==========================================
    const rejected = await client.query(
      `
      UPDATE task_executions
      SET
        status = 'rejected',
        rejected_at = NOW(),
        reviewed_at = NOW(),
        reviewed_by = $1::bigint,
        rejection_reason = $2
      WHERE id = $3::integer
        AND status = 'pending'
      RETURNING
        id,
        status,
        rejected_at
      `,
      [
        user_id,
        reason.trim(),
        proofId
      ]
    );

    if (rejected.rows.length === 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Execution was already processed"
      }, 409);
    }

    // ==========================================
    // 🔒 IMPORTANT
    //
    // DO NOT modify tasks.spent here.
    //
    // The reserved amount remains locked for
    // the 24-hour dispute period.
    // ==========================================

    await client.query('COMMIT');

    return c.json({
      success: true,
      message: "Proof rejected. Reserved funds remain locked for 24 hours for possible dispute.",
      status: "rejected",
      rejected_at: rejected.rows[0].rejected_at,
      dispute_deadline: new Date(
        new Date(rejected.rows[0].rejected_at).getTime() +
        24 * 60 * 60 * 1000
      ).toISOString()
    });

  } catch (err) {

    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error(
      '❌ /api/tasks/:id/proofs/:proofId/reject:',
      err
    );

    return c.json({
      success: false,
      message: "Failed to reject proof: " + err.message
    }, 500);

  } finally {
    client.release();
  }
});

// ======================= ⚠️ DISPUTES =======================
app.post('/api/tasks/:id/proofs/:proofId/dispute', async (c) => {
  const client = await pool.connect();

  try {
    const taskId = c.req.param('id');
    const proofId = c.req.param('proofId');

    const { user_id, reason } = await c.req.json();

    // ==========================================
    // 🔐 Validate user
    // ==========================================
    if (
      !user_id ||
      !/^\d+$/.test(user_id.toString())
    ) {
      return c.json({
        success: false,
        message: "Valid user_id required"
      }, 400);
    }

    // ==========================================
    // 📝 Validate dispute reason
    // ==========================================
    if (
      !reason ||
      reason.trim().length < 20
    ) {
      return c.json({
        success: false,
        message: "Please provide a detailed reason (min 20 characters)"
      }, 400);
    }

    await client.query('BEGIN');

    // ==========================================
    // 🔒 Lock task
    // ==========================================
    const task = await client.query(
      `
      SELECT
        id,
        budget,
        spent
      FROM tasks
      WHERE id = $1::integer
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [taskId]
    );

    if (task.rows.length === 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Task not found"
      }, 404);
    }

    // ==========================================
    // 🔒 Lock execution
    // ==========================================
    const exec = await client.query(
      `
      SELECT
        id,
        task_id,
        executor_id,
        payment_amount,
        commission_amount,
        status,
        rejected_at
      FROM task_executions
      WHERE id = $1::integer
        AND task_id = $2::integer
      FOR UPDATE
      `,
      [proofId, taskId]
    );

    if (exec.rows.length === 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Execution not found"
      }, 404);
    }

    const execution = exec.rows[0];

    // ==========================================
    // 👤 Verify executor
    // ==========================================
    if (
      execution.executor_id?.toString() !==
      user_id.toString()
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Unauthorized"
      }, 403);
    }

    // ==========================================
    // ⚠️ Only rejected executions can be disputed
    // ==========================================
    if (execution.status !== 'rejected') {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Only rejected executions can be disputed"
      }, 400);
    }

    // ==========================================
    // ⏰ rejected_at must exist
    // ==========================================
    if (!execution.rejected_at) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Dispute deadline information is unavailable"
      }, 500);
    }

    // ==========================================
    // ⏰ 24-hour dispute window
    // ==========================================
    const rejectedAt = new Date(execution.rejected_at);
    const now = new Date();

    const disputeDeadline =
      new Date(
        rejectedAt.getTime() +
        24 * 60 * 60 * 1000
      );

    // ==========================================
    // ⏰ Dispute period expired
    // ==========================================
    if (now >= disputeDeadline) {

      // ==========================================
      // 💰 Calculate reserved amount
      // ==========================================
      const paymentAmount = parseFloat(
        execution.payment_amount || 0
      );

      const adminCommission = parseFloat(
        execution.commission_amount ??
        (paymentAmount * 0.25)
      );

      const totalCost =
        paymentAmount + adminCommission;

      if (
        !Number.isFinite(paymentAmount) ||
        paymentAmount <= 0 ||
        !Number.isFinite(adminCommission) ||
        adminCommission < 0 ||
        !Number.isFinite(totalCost) ||
        totalCost <= 0
      ) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: "Invalid execution payment data"
        }, 500);
      }

      // ==========================================
      // 🔓 Final rejection → release reservation
      // ==========================================
      const released = await client.query(
        `
        UPDATE tasks
        SET spent = GREATEST(
          0,
          COALESCE(spent, 0) - $1
        )
        WHERE id = $2::integer
          AND COALESCE(spent, 0) >= $1
        RETURNING
          budget,
          spent
        `,
        [
          totalCost,
          taskId
        ]
      );

      if (released.rows.length === 0) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: "Unable to release reserved task funds"
        }, 500);
      }

      // ==========================================
      // ✅ Keep execution rejected
      // ==========================================
      await client.query(
        `
        UPDATE task_executions
        SET
          status = 'rejected',
          reviewed_at = COALESCE(reviewed_at, NOW())
        WHERE id = $1::integer
          AND status = 'rejected'
        `,
        [proofId]
      );

      await client.query('COMMIT');

      return c.json({
        success: false,
        message: "The 24-hour dispute period has expired. The rejection is now final.",
        status: "rejected",
        final: true
      }, 400);
    }

    // ==========================================
    // 🚫 Prevent duplicate open dispute
    // ==========================================
    const existingDispute = await client.query(
      `
      SELECT
        id,
        status
      FROM task_disputes
      WHERE execution_id = $1
        AND status = 'open'
      FOR UPDATE
      `,
      [proofId]
    );

    if (existingDispute.rows.length > 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "This execution already has an open dispute"
      }, 400);
    }

    // ==========================================
    // 💰 Verify reservation is still present
    //
    // We DO NOT add to spent here.
    // It was already reserved at Apply.
    // ==========================================
    const paymentAmount = parseFloat(
      execution.payment_amount || 0
    );

    const adminCommission = parseFloat(
      execution.commission_amount ??
      (paymentAmount * 0.25)
    );

    const totalCost =
      paymentAmount + adminCommission;

    if (
      !Number.isFinite(paymentAmount) ||
      paymentAmount <= 0 ||
      !Number.isFinite(adminCommission) ||
      adminCommission < 0 ||
      !Number.isFinite(totalCost) ||
      totalCost <= 0
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Invalid execution payment data"
      }, 500);
    }

    const currentSpent =
      parseFloat(task.rows[0].spent || 0);

    if (
      !Number.isFinite(currentSpent) ||
      currentSpent < totalCost
    ) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Reserved task funds are insufficient for this dispute"
      }, 500);
    }

    // ==========================================
    // ⚠️ Create dispute
    //
    // IMPORTANT:
    // Funds remain reserved.
    // Do NOT change tasks.spent.
    // ==========================================
    const dispute = await client.query(
      `
      INSERT INTO task_disputes (
        execution_id,
        reason,
        status,
        created_at
      )
      VALUES (
        $1,
        $2,
        'open',
        NOW()
      )
      RETURNING id
      `,
      [
        proofId,
        reason.trim()
      ]
    );

    // ==========================================
    // 🔄 Mark execution as disputed
    // ==========================================
    const updatedExecution = await client.query(
      `
      UPDATE task_executions
      SET status = 'disputed'
      WHERE id = $1::integer
        AND status = 'rejected'
      RETURNING id, status
      `,
      [proofId]
    );

    if (updatedExecution.rows.length === 0) {
      await client.query('ROLLBACK');

      return c.json({
        success: false,
        message: "Execution status changed before dispute could be created"
      }, 409);
    }

    await client.query('COMMIT');

    // ==========================================
    // 🔔 Notify admin
    // ==========================================
    if (
      typeof bot !== 'undefined' &&
      bot?.telegram &&
      c.env.ADMIN_ID
    ) {
      try {
        await bot.telegram.sendMessage(
          c.env.ADMIN_ID,
          `⚠️ New Dispute:\n` +
          `📋 Task: #${taskId}\n` +
          `🔍 Execution: #${proofId}\n` +
          `⚖️ Dispute: #${dispute.rows[0].id}\n` +
          `👤 User: ${user_id}\n` +
          `📝 Reason:\n${reason.trim().substring(0, 500)}`
        );
      } catch (notifyErr) {
        console.error(
          '⚠️ Admin dispute notification failed:',
          notifyErr
        );
      }
    }

    return c.json({
      success: true,
      message: "Dispute created successfully. Funds remain reserved for admin review.",
      status: "disputed",
      dispute_id: dispute.rows[0].id,
      dispute_deadline: disputeDeadline.toISOString()
    });

  } catch (err) {

    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error(
      '❌ /api/tasks/:id/proofs/:proofId/dispute:',
      err
    );

    return c.json({
      success: false,
      message: "Failed to create dispute: " + err.message
    }, 500);

  } finally {
    client.release();
  }
});
// ======================= 💰 FUND & WITHDRAW =======================
app.post('/api/tasks/:id/fund', async (c) => {
  const client = await pool.connect();
  try {
    const taskId = c.req.param('id');
    const { user_id, amount } = await c.req.json();

    if (!amount || amount <= 0) {
      return c.json({ success: false, message: "Invalid amount" }, 400);
    }

    await client.query('BEGIN');

    const user = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0 || parseFloat(user.rows[0].balance || 0) < amount) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Insufficient balance" }, 400);
    }

    const task = await client.query('SELECT creator_id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [taskId]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Unauthorized" }, 403);
    }

    const activeExecutions = await client.query(
      "SELECT 1 FROM task_executions WHERE task_id = $1 AND status IN ('applied','pending')",
      [taskId]
    );
    if (activeExecutions.rows.length > 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Cannot fund task: active executions exist" }, 400);
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [amount, user_id]);
    
    const updatedTask = await client.query(
      "UPDATE tasks SET budget = budget + $1, is_active = true WHERE id = $2 RETURNING budget",
      [amount, taskId]
    );

    await client.query('COMMIT');
    return c.json({ success: true, message: "Funds added successfully and task reactivated", new_budget: parseFloat(updatedTask.rows[0].budget) });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/fund:', err);
    return c.json({ success: false, message: "Failed to add funds: " + err.message }, 500);
  } finally {
    client.release();
  }
});

app.post('/api/tasks/:id/withdraw', async (c) => {
  const client = await pool.connect();
  try {
    const taskId = c.req.param('id');
    const { user_id, amount } = await c.req.json();
    
    await client.query('BEGIN');
    
    const task = await client.query('SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL', [taskId]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Unauthorized" }, 403);
    }
    
    const pending = await client.query(
      'SELECT COUNT(*) FROM task_executions WHERE task_id = $1 AND status IN ($2, $3)',
      [taskId, 'pending', 'disputed']
    );
    if (parseInt(pending.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Cannot withdraw: pending or disputed executions exist" }, 400);
    }
    
    const remaining = parseFloat(task.rows[0].budget) - parseFloat(task.rows[0].spent);
    const withdrawAmount = amount && amount > 0 ? parseFloat(amount) : remaining;
    
    if (withdrawAmount > remaining) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Amount exceeds remaining budget" }, 400);
    }
    if (remaining <= 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "No funds to withdraw" }, 400);
    }
    
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [withdrawAmount, user_id]);
    await client.query('UPDATE tasks SET budget = budget - $1 WHERE id = $2', [withdrawAmount, taskId]);
    
    if (withdrawAmount >= remaining - 0.001) {
      await client.query('UPDATE tasks SET is_active = false WHERE id = $1', [taskId]);
    }
    
    await client.query('COMMIT');
    return c.json({ success: true, message: "Funds withdrawn successfully", amount: withdrawAmount });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/withdraw:', err);
    return c.json({ success: false, message: "Failed to withdraw: " + err.message }, 500);
  } finally {
    client.release();
  }
});

// ======================= 🗑️ DELETE TASK =======================
app.delete('/api/tasks/:id', async (c) => {
  const client = await pool.connect();
  try {
    const taskId = c.req.param('id');
    const { user_id } = await c.req.json();

    await client.query('BEGIN');

    const taskRes = await client.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskRes.rows.length === 0 || taskRes.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Unauthorized" }, 403);
    }
    const task = taskRes.rows[0];

    const pendingExec = await client.query(
      `SELECT COUNT(*) FROM task_executions WHERE task_id = $1 AND status IN ('pending','disputed')`,
      [taskId]
    );
    if (parseInt(pendingExec.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return c.json({
        success: false,
        message: `Cannot delete task: ${pendingExec.rows[0].count} pending/disputed execution(s)`
      }, 400);
    }

    const disputedExecRes = await client.query(
      'SELECT COUNT(*) FROM task_executions te JOIN task_disputes td ON te.id = td.execution_id WHERE te.task_id = $1 AND td.status = $2',
      [taskId, 'open']
    );
    if (parseInt(disputedExecRes.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return c.json({ 
        success: false, 
        message: `Cannot delete: ${disputedExecRes.rows[0].count} disputed execution(s) without admin decision` 
      }, 400);
    }

    const pendingProofsRes = await client.query(
      'SELECT COUNT(*) FROM task_proofs WHERE task_id = $1 AND status = $2',
      [taskId, 'pending']
    );
    if (parseInt(pendingProofsRes.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return c.json({ 
        success: false, 
        message: `Cannot delete: ${pendingProofsRes.rows[0].count} pending proof(s) exist` 
      }, 400);
    }

    const remaining = parseFloat(task.budget) - parseFloat(task.spent);
    if (remaining > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [remaining, user_id]
      );
    }

    await client.query('DELETE FROM task_disputes WHERE execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [taskId]);
    await client.query('DELETE FROM task_proofs WHERE task_id = $1', [taskId]);
    await client.query('DELETE FROM task_executions WHERE task_id = $1', [taskId]);
    await client.query('DELETE FROM user_tasks WHERE task_id = $1', [taskId]);
    await client.query('DELETE FROM tasks WHERE id = $1', [taskId]);

    await client.query('COMMIT');
    return c.json({ success: true, message: "Task deleted permanently", refunded: remaining });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DELETE /api/tasks/:id:', err);
    return c.json({ success: false, message: "Failed to delete: " + err.message }, 500);
  } finally {
    client.release();
  }
});

// ======================= 🔍 TASK: DETAILS =======================
app.get('/api/tasks/:id', async (c) => {
  try {
    const taskId = c.req.param('id');
    const user_id = c.req.query('user_id');
    
    if (!taskId || isNaN(taskId)) {
      return c.json({ success: false, message: "Invalid task ID" }, 400);
    }
    
    const task = await pool.query(`
      SELECT 
        t.*,
        (t.budget - t.spent) as remaining_budget,
        COUNT(te.id) FILTER (WHERE te.id IS NOT NULL) AS total_executions,
        COUNT(te.id) FILTER (WHERE te.status = 'approved') AS approved_count,
        COUNT(te.id) FILTER (WHERE te.status = 'pending') AS pending_count,
        COUNT(te.id) FILTER (WHERE te.status = 'disputed') AS disputed_count
      FROM tasks t
      LEFT JOIN task_executions te ON t.id = te.task_id
      WHERE t.id = $1 AND t.deleted_at IS NULL
      GROUP BY t.id
    `, [taskId]);
    
    if (task.rows.length === 0) {
      return c.json({ success: false, message: "Task not found" }, 404);
    }
    
    const taskData = task.rows[0];
    const isCreator = taskData.creator_id?.toString() === user_id;
    
    let myExecution = null;
    if (user_id) {
      const exec = await pool.query(
        `SELECT id, task_id, executor_id, proof, status, submitted_at, payment_amount, commission_amount
         FROM task_executions 
         WHERE task_id = $1 AND executor_id = $2 
         ORDER BY submitted_at DESC LIMIT 1`,
        [taskId, user_id]
      );
      if (exec.rows.length > 0) myExecution = exec.rows[0];
    }
    
    return c.json({ 
      success: true, 
      task: taskData, 
      is_creator: isCreator,
      my_execution: myExecution
    });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id:', err);
    return c.json({ success: false, message: "Failed to load task", error: err.message }, 500);
  }
});

// ======================= ⚙️ ADMIN PANEL ROUTES =======================


app.get('/api/admin/pending-proofs', isAdminAuthenticated, async (c) => {
  try {
    const proofs = await pool.query(`
      SELECT 
        te.id, te.task_id, te.executor_id, te.proof, te.status, te.submitted_at,
        te.payment_amount, te.commission_amount, t.title as task_title,
        t.description as task_description, t.executor_reward, t.creator_id,
        u.username as executor_username
      FROM task_executions te
      JOIN tasks t ON t.id = te.task_id
      LEFT JOIN users u ON te.executor_id = u.telegram_id
      WHERE te.status = 'pending' AND te.proof IS NOT NULL AND t.deleted_at IS NULL
      ORDER BY te.submitted_at ASC
    `);
    return c.json({ success: true, data: proofs.rows });
  } catch (err) {
    console.error('❌ /api/admin/pending-proofs:', err);
    return c.json({ success: false, message: "Failed to load pending proofs", error: err.message }, 500);
  }
});

app.get('/api/admin/disputes', isAdminAuthenticated, async (c) => {
  try {
    const disputes = await pool.query(`
      SELECT 
        td.id as dispute_id, td.reason, td.status, td.created_at as dispute_created_at,
        td.resolved_at, td.resolution, td.execution_id, te.id as exec_id, te.task_id,
        te.executor_id, te.proof as executor_proof, te.payment_amount, te.status as execution_status,
        te.submitted_at as proof_submitted_at, t.title as task_title, t.description as task_description,
        t.target_url, t.creator_id, t.executor_reward, eu.username as executor_username,
        eu.telegram_id as executor_telegram, cu.username as creator_username, cu.telegram_id as creator_telegram
      FROM task_disputes td
      INNER JOIN task_executions te ON td.execution_id = te.id
      INNER JOIN tasks t ON te.task_id = t.id
      LEFT JOIN users eu ON te.executor_id = eu.telegram_id
      LEFT JOIN users cu ON t.creator_id = cu.telegram_id
      WHERE td.status = 'open'
      ORDER BY td.created_at DESC
    `);
    return c.json({ success: true, data: disputes.rows });
  } catch (err) {
    console.error('❌ /api/admin/disputes:', err);
    return c.json({ success: false, message: "Failed to load disputes", error: err.message }, 500);
  }
});

app.get('/api/admin/commission-stats', isAdminAuthenticated, async (c) => {
  try {
    const [today, week, month, allTime] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved' AND reviewed_at::date = CURRENT_DATE`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved' AND reviewed_at >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved' AND reviewed_at >= NOW() - INTERVAL '30 days'`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved'`)
    ]);
    
    return c.json({
      success: true,
      data: {
        today: parseFloat(today.rows[0].total),
        week: parseFloat(week.rows[0].total),
        month: parseFloat(month.rows[0].total),
        all_time: parseFloat(allTime.rows[0].total)
      }
    });
  } catch (err) {
    console.error('❌ /api/admin/commission-stats:', err);
    return c.json({ success: false, message: "Failed to load commission stats", error: err.message }, 500);
  }
});

// =====================================================
// ⚖️ ADMIN - RESOLVE TASK DISPUTE
// =====================================================
app.post(
  '/api/admin/task-disputes/:id/resolve',
  verifyAdmin,
  async (c) => {

    const client = await pool.connect();

    try {
      const disputeId = c.req.param('id');

      const body = await c.req.json().catch(() => ({}));

      const {
        payout_to,
        resolution = 'Resolved by admin'
      } = body;

      const adminId =
        c.req.query('admin_id') ||
        c.req.query('user_id');

      // ==========================================
      // 🔐 Validate dispute ID
      // ==========================================
      const id = Number(disputeId);

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return c.json({
          success: false,
          message: '❌ Invalid dispute ID'
        }, 400);
      }

      // ==========================================
      // ⚖️ Validate admin decision
      // ==========================================
      if (
        payout_to !== 'executor' &&
        payout_to !== 'creator'
      ) {
        return c.json({
          success: false,
          message: '❌ Invalid payout decision'
        }, 400);
      }

      // ==========================================
      // 🔐 Validate admin ID
      // ==========================================
      if (
        !adminId ||
        !/^\d+$/.test(adminId.toString())
      ) {
        return c.json({
          success: false,
          message: '❌ Invalid admin ID'
        }, 403);
      }

      await client.query('BEGIN');

      // ==========================================
      // 🔒 Lock dispute + execution + task
      // ==========================================
      const disputeResult = await client.query(
        `
        SELECT
          td.id AS dispute_id,
          td.execution_id,
          td.status AS dispute_status,

          te.task_id,
          te.executor_id,
          te.payment_amount,
          te.commission_amount,
          te.status AS execution_status,
          te.rejected_at,

          t.creator_id,
          t.budget,
          t.spent

        FROM task_disputes td

        INNER JOIN task_executions te
          ON td.execution_id = te.id

        INNER JOIN tasks t
          ON te.task_id = t.id

        WHERE td.id = $1::integer
          AND td.status = 'open'

        FOR UPDATE OF td, te, t
        `,
        [id]
      );

      if (disputeResult.rows.length === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: '❌ Dispute not found or already resolved'
        }, 404);
      }

      const dispute = disputeResult.rows[0];

      // ==========================================
      // 🔒 Validate execution state
      // ==========================================
      if (
        dispute.execution_status !== 'disputed'
      ) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            `❌ Execution is not in disputed status: ${dispute.execution_status}`
        }, 400);
      }

      // ==========================================
      // 💰 Payment calculations
      // ==========================================
      const paymentAmount = parseFloat(
        dispute.payment_amount || 0
      );

      const commissionAmount = parseFloat(
        dispute.commission_amount ??
        (paymentAmount * 0.20)
      );

      // ==========================================
      // 🤝 Task referral = 5%
      // ==========================================
      const referralCommission =
        paymentAmount * 0.05;

      // ==========================================
      // 💰 Total reserved cost
      //
      // Executor = 100%
      // Admin    = 20%
      // Referral = 5%
      // Total    = 125%
      // ==========================================
      const totalCost =
        paymentAmount +
        commissionAmount +
        referralCommission;

      // ==========================================
      // 🔐 Validate payment data
      // ==========================================
      if (
        !Number.isFinite(paymentAmount) ||
        paymentAmount <= 0 ||

        !Number.isFinite(commissionAmount) ||
        commissionAmount < 0 ||

        !Number.isFinite(referralCommission) ||
        referralCommission < 0 ||

        !Number.isFinite(totalCost) ||
        totalCost <= 0
      ) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: '❌ Invalid payment or commission amount'
        }, 400);
      }

      // ==========================================
      // 💰 Verify reservation
      //
      // Reservation was created at APPLY:
      //
      // payment + admin commission + task referral
      //
      // Therefore spent must still include
      // the complete totalCost.
      // ==========================================
      const currentSpent = parseFloat(
        dispute.spent || 0
      );

      if (
        !Number.isFinite(currentSpent) ||
        currentSpent < totalCost
      ) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            '❌ Reserved task funds are insufficient'
        }, 400);
      }

      // =================================================
      // 🟢 DECISION 1: PAY EXECUTOR
      // =================================================
      if (payout_to === 'executor') {

        // ==========================================
        // 💰 Pay executor
        // ==========================================
        const executor = await client.query(
          `
          UPDATE users
          SET balance =
            COALESCE(balance, 0) + $1
          WHERE telegram_id = $2::bigint
          RETURNING balance
          `,
          [
            paymentAmount,
            dispute.executor_id
          ]
        );

        if (executor.rows.length === 0) {

          await client.query('ROLLBACK');

          return c.json({
            success: false,
            message: '❌ Executor user not found'
          }, 404);
        }

        // ==========================================
        // 💰 Pay admin commission
        // ==========================================
        if (commissionAmount > 0) {

          const adminUser =
            await client.query(
              `
              UPDATE users
              SET balance =
                COALESCE(balance, 0) + $1
              WHERE telegram_id = $2::bigint
              RETURNING balance
              `,
              [
                commissionAmount,
                adminId
              ]
            );

          if (adminUser.rows.length === 0) {

            await client.query('ROLLBACK');

            return c.json({
              success: false,
              message: '❌ Admin user not found'
            }, 404);
          }
        }

        // ==========================================
        // ✅ Approve execution
        //
        // Reservation is consumed.
        // DO NOT change tasks.spent.
        // ==========================================
        const approved =
          await client.query(
            `
            UPDATE task_executions
            SET
              status = 'approved',
              reviewed_at = NOW(),
              reviewed_by = $1::bigint,
              rejection_reason = NULL
            WHERE id = $2::integer
              AND status = 'disputed'
            RETURNING id, status
            `,
            [
              adminId,
              dispute.execution_id
            ]
          );

        if (approved.rows.length === 0) {

          await client.query('ROLLBACK');

          return c.json({
            success: false,
            message: '❌ Execution was already processed'
          }, 409);
        }

        // ==========================================
        // 📒 Executor earning
        // ==========================================
        await client.query(
          `
          INSERT INTO earnings (
            user_id,
            source,
            amount,
            description,
            video_id,
            watched_seconds,
            created_at
          )
          VALUES (
            $1,
            'task_execution',
            $2,
            $3,
            NULL,
            NULL,
            NOW()
          )
          `,
          [
            dispute.executor_id,
            paymentAmount,
            `Task #${dispute.task_id} execution reward (100%)`
          ]
        );

        // ==========================================
        // 📒 Admin commission earning
        // ==========================================
        if (commissionAmount > 0) {

          await client.query(
            `
            INSERT INTO earnings (
              user_id,
              source,
              amount,
              description,
              video_id,
              watched_seconds,
              created_at
            )
            VALUES (
              $1,
              'task_commission',
              $2,
              $3,
              NULL,
              NULL,
              NOW()
            )
            `,
            [
              adminId,
              commissionAmount,
              `Commission from task #${dispute.task_id} (20%)`
            ]
          );
        }

        // ==========================================
        // 💰 IMPORTANT
        //
        // DO NOT change tasks.spent.
        //
        // The reserved 1.25 is now consumed.
        // ==========================================

      }

      // =================================================
      // 🔴 DECISION 2: FAVOR CREATOR
      // =================================================
      else if (payout_to === 'creator') {

        // ==========================================
        // ❌ Final rejection
        // ==========================================
        const rejected =
          await client.query(
            `
            UPDATE task_executions
            SET
              status = 'rejected',
              rejected_at = NULL,
              reviewed_at = NOW(),
              reviewed_by = $1::bigint,
              rejection_reason = $2
            WHERE id = $3::integer
              AND status = 'disputed'
            RETURNING id, status
            `,
            [
              adminId,
              resolution,
              dispute.execution_id
            ]
          );

        if (rejected.rows.length === 0) {

          await client.query('ROLLBACK');

          return c.json({
            success: false,
            message: '❌ Execution was already processed'
          }, 409);
        }

        // ==========================================
        // 🔓 Release reserved funds
        //
        // Return the complete reservation:
        //
        // Executor  = 1.00
        // Admin     = 0.20
        // Referral  = 0.05
        // Total     = 1.25
        //
        // The amount returns to the TASK budget.
        // It does NOT return to creator balance.
        // ==========================================
        const released =
          await client.query(
            `
            UPDATE tasks
            SET spent =
              COALESCE(spent, 0) - $1
            WHERE id = $2::integer
              AND COALESCE(spent, 0) >= $1
            RETURNING
              budget,
              spent
            `,
            [
              totalCost,
              dispute.task_id
            ]
          );

        if (released.rows.length === 0) {

          await client.query('ROLLBACK');

          return c.json({
            success: false,
            message:
              '❌ Unable to release reserved task funds'
          }, 500);
        }

      }

      // ==========================================
      // ⚖️ Resolve dispute
      // ==========================================
      const resolved =
        await client.query(
          `
          UPDATE task_disputes
          SET
            status = 'resolved',
            resolved_at = NOW(),
            resolved_by = $1::bigint,
            resolution = $2
          WHERE id = $3::integer
            AND status = 'open'
          RETURNING id
          `,
          [
            adminId,
            resolution,
            id
          ]
        );

      if (resolved.rows.length === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: '❌ Dispute was already resolved'
        }, 409);
      }

      // ==========================================
      // ✅ Commit
      // ==========================================
      await client.query('COMMIT');

      // ==========================================
      // 🤝 TASK REFERRAL COMMISSION = 5%
      //
      // This is separate from deposit referral = 3%.
      // ==========================================
      if (
        payout_to === 'executor' &&
        paymentAmount > 0 &&
        typeof distributeReferralCommission === 'function'
      ) {

        try {

          await distributeReferralCommission(
            dispute.executor_id,
            paymentAmount
          );

        } catch (refErr) {

          console.error(
            '⚠️ Task referral commission failed after dispute resolution:',
            refErr
          );
        }
      }

      // ==========================================
      // ✅ Success response
      // ==========================================
      return c.json({
        success: true,

        message:
          payout_to === 'executor'
            ? '✅ Dispute resolved in favor of executor'
            : '✅ Dispute resolved in favor of creator; reserved funds returned to task budget',

        resolution: {
          dispute_id: id,

          execution_id:
            dispute.execution_id,

          payout_to,

          payment_amount:
            paymentAmount.toFixed(6),

          commission_amount:
            commissionAmount.toFixed(6),

          referral_commission:
            referralCommission.toFixed(6),

          total_cost:
            totalCost.toFixed(6)
        }
      });

    } catch (err) {

      try {
        await client.query('ROLLBACK');
      } catch (_) {}

      console.error(
        '❌ ADMIN RESOLVE DISPUTE:',
        err
      );

      return c.json({
        success: false,
        message:
          'Failed to resolve dispute: ' +
          err.message
      }, 500);

    } finally {
      client.release();
    }
  }
);
// =====================================================
// 🔐 ADMIN - APPROVE TASK EXECUTION
// =====================================================
app.post(
  '/api/admin/task-executions/:id/approve',
  verifyAdmin,
  async (c) => {

    const client = await pool.connect();

    try {
      const proofId = c.req.param('id');
      const adminId = c.get('adminId');

      if (
        !proofId ||
        !/^\d+$/.test(proofId.toString())
      ) {
        return c.json({
          success: false,
          message: 'Invalid execution ID'
        }, 400);
      }

      await client.query('BEGIN');

      // ==========================================
      // 🔒 Lock execution
      // ==========================================
      const exec = await client.query(
        `
        SELECT
          te.id,
          te.task_id,
          te.executor_id,
          te.payment_amount,
          te.commission_amount,
          te.status
        FROM task_executions te
        WHERE te.id = $1::integer
        FOR UPDATE
        `,
        [proofId]
      );

      if (exec.rows.length === 0) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: 'Execution not found'
        }, 404);
      }

      const execution = exec.rows[0];

      if (execution.status !== 'pending') {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: `Execution cannot be approved from status: ${execution.status}`
        }, 400);
      }

      // ==========================================
      // 🚫 Cannot approve execution with open dispute
      // ==========================================
      const openDispute = await client.query(
        `
        SELECT id
        FROM task_disputes
        WHERE execution_id = $1
          AND status = 'open'
        LIMIT 1
        `,
        [proofId]
      );

      if (openDispute.rows.length > 0) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: 'This execution has an open dispute and must be resolved from the dispute panel'
        }, 400);
      }

      // ==========================================
      // 🔒 Lock task
      // ==========================================
      const task = await client.query(
        `
        SELECT
          id,
          budget,
          spent
        FROM tasks
        WHERE id = $1::integer
        FOR UPDATE
        `,
        [execution.task_id]
      );

      if (task.rows.length === 0) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: 'Task not found'
        }, 404);
      }

      const paymentAmount = parseFloat(
        execution.payment_amount || 0
      );

     const adminCommission = parseFloat(
  execution.commission_amount ??
  (paymentAmount * 0.20)
);

const referralCommission =
  paymentAmount * 0.05;

const totalCost =
  paymentAmount +
  adminCommission +
  referralCommission;

if (
  !Number.isFinite(paymentAmount) ||
  paymentAmount <= 0 ||
  !Number.isFinite(adminCommission) ||
  adminCommission < 0 ||
  !Number.isFinite(referralCommission) ||
  referralCommission < 0 ||
  !Number.isFinite(totalCost)
) {
  await client.query('ROLLBACK');

  return c.json({
    success: false,
    message: 'Invalid payment or commission amount'
  }, 400);
}
      // ==========================================
      // 💰 Verify reservation exists
      // ==========================================
      const budget = parseFloat(
        task.rows[0].budget || 0
      );

      const spent = parseFloat(
        task.rows[0].spent || 0
      );

      if (
        !Number.isFinite(budget) ||
        !Number.isFinite(spent) ||
        spent < totalCost
      ) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: 'Reserved task funds are insufficient'
        }, 400);
      }

      // ==========================================
      // 👤 Pay executor
      // ==========================================
      const executor = await client.query(
        `
        UPDATE users
        SET balance = COALESCE(balance, 0) + $1
        WHERE telegram_id = $2::bigint
        RETURNING balance
        `,
        [
          paymentAmount,
          execution.executor_id
        ]
      );

      if (executor.rows.length === 0) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: 'Executor user not found'
        }, 404);
      }

      // ==========================================
      // 💰 Pay admin commission
      // ==========================================
      if (
        adminCommission > 0 &&
        adminId
      ) {

        const adminUser = await client.query(
          `
          UPDATE users
          SET balance = COALESCE(balance, 0) + $1
          WHERE telegram_id = $2::bigint
          RETURNING balance
          `,
          [
            adminCommission,
            adminId
          ]
        );

        if (adminUser.rows.length === 0) {
          await client.query('ROLLBACK');

          return c.json({
            success: false,
            message: 'Admin user not found'
          }, 404);
        }
      }

      // ==========================================
      // ✅ Approve execution
      // ==========================================
      const approved = await client.query(
        `
        UPDATE task_executions
        SET
          status = 'approved',
          reviewed_at = NOW(),
          reviewed_by = $1::bigint,
          rejection_reason = NULL
        WHERE id = $2::integer
          AND status = 'pending'
        RETURNING id
        `,
        [
          adminId,
          proofId
        ]
      );

      if (approved.rows.length === 0) {
        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message: 'Execution was already processed'
        }, 409);
      }

      // ==========================================
      // 📊 IMPORTANT:
      // DO NOT increase tasks.spent here.
      //
      // It was already increased when Apply
      // reserved the funds.
      // ==========================================

      // ==========================================
      // 📒 Executor earning
      // ==========================================
      await client.query(
        `
        INSERT INTO earnings (
          user_id,
          source,
          amount,
          description,
          video_id,
          watched_seconds,
          created_at
        )
        VALUES (
          $1,
          'task_execution',
          $2,
          $3,
          NULL,
          NULL,
          NOW()
        )
        `,
        [
          execution.executor_id,
          paymentAmount,
          `Task #${execution.task_id} execution reward (100%)`
        ]
      );

      // ==========================================
      // 📒 Admin commission earning
      // ==========================================
      if (
        adminCommission > 0 &&
        adminId
      ) {

        await client.query(
          `
          INSERT INTO earnings (
            user_id,
            source,
            amount,
            description,
            video_id,
            watched_seconds,
            created_at
          )
          VALUES (
            $1,
            'task_commission',
            $2,
            $3,
            NULL,
            NULL,
            NOW()
          )
          `,
          [
            adminId,
            adminCommission,
            `Commission from task #${execution.task_id} (20%)`
          ]
        );
      }

      await client.query('COMMIT');

      // ==========================================
      // 🤝 Referral commission
      //
      // Keep your existing function.
      // It should continue calculating the 3%.
      // ==========================================
      if (
        typeof distributeReferralCommission === 'function'
      ) {
        try {
          await distributeReferralCommission(
            execution.executor_id,
            paymentAmount
          );
        } catch (refErr) {
          console.error(
            '⚠️ Referral commission failed after approval:',
            refErr
          );
        }
      }

      return c.json({
        success: true,
        message: 'Execution approved and payment sent',
        payment_details: {
          executor_received:
            paymentAmount.toFixed(6),

          admin_commission:
            adminCommission.toFixed(6),

          total_deducted:
            totalCost.toFixed(6)
        }
      });

    } catch (err) {

      try {
        await client.query('ROLLBACK');
      } catch (_) {}

      console.error(
        '❌ ADMIN APPROVE EXECUTION:',
        err
      );

      return c.json({
        success: false,
        message: 'Failed to approve: ' + err.message
      }, 500);

    } finally {
      client.release();
    }
  }
);

// =====================================================
// 🔐 ADMIN - REJECT TASK EXECUTION
// =====================================================
app.post(
  '/api/admin/task-executions/:id/reject',
  verifyAdmin,
  async (c) => {

    const client = await pool.connect();

    try {

      const proofId =
        c.req.param('id');

      const body =
        await c.req.json().catch(() => ({}));

      const reason =
        body.reason || '';

      if (reason.length < 20) {
        return c.json({
          success: false,
          message:
            '❌ Rejection reason must be at least 20 characters'
        }, 400);
      }

      const adminId =
        c.get('adminId');

      await client.query('BEGIN');

      // =================================================
      // 🔎 التأكد من وجود التنفيذ
      // =================================================

      const exec =
        await client.query(
          `
          SELECT
            id,
            task_id,
            executor_id,
            status
          FROM task_executions
          WHERE id = $1
            AND status = 'pending'
          FOR UPDATE
          `,
          [proofId]
        );

      if (exec.rows.length === 0) {

        await client.query('ROLLBACK');

        return c.json({
          success: false,
          message:
            '❌ Execution not found or already processed'
        }, 404);
      }

      // =================================================
      // ❌ رفض التنفيذ
      // =================================================

      await client.query(
        `
        UPDATE task_executions
        SET
          status = 'rejected',
          reviewed_at = NOW(),
          reviewed_by = $1,
          rejection_reason = $2
        WHERE id = $3
        `,
        [
          adminId,
          reason,
          proofId
        ]
      );

      await client.query('COMMIT');

      return c.json({
        success: true,
        message:
          '❌ Proof rejected successfully'
      });

    } catch (err) {

      try {
        await client.query('ROLLBACK');
      } catch (_) {}

      console.error(
        '❌ /api/admin/task-executions/:id/reject:',
        err
      );

      return c.json({
        success: false,
        message:
          'Failed to reject proof',
        error:
          err.message
      }, 500);

    } finally {
      client.release();
    }
  }
);



// ======================= END TASKS SYSTEM API =======================

/* =========================
   REFERRAL - Distribute Commission (5% من الأرباح غير الإيداع)
========================= */
async function distributeReferralCommission(telegramId, earningAmount) {
  try {
    if (!telegramId || !earningAmount || earningAmount <= 0) return;
    
    const userCheck = await pool.query("SELECT telegram_id FROM users WHERE telegram_id = $1", [telegramId.toString()]);
    if (userCheck.rows.length === 0) return;
    
    const refRes = await pool.query("SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1", [telegramId.toString()]);
    if (refRes.rows.length === 0) return;
    
    const referrerTelegramId = refRes.rows[0].referrer_id;
    const commission = parseFloat((earningAmount * 0.05).toFixed(6));
    
    if (commission <= 0.000001) return;
    
    await pool.query(
      "UPDATE users SET balance = balance + $1, referral_earnings = COALESCE(referral_earnings, 0) + $1 WHERE telegram_id = $2",
      [commission, referrerTelegramId]
    );
    
    await pool.query(
      "INSERT INTO referral_earnings (referrer_id, referee_id, amount, created_at) VALUES ($1, $2, $3, NOW())",
      [referrerTelegramId, telegramId.toString(), commission]
    );
    
    await pool.query(
      "INSERT INTO earnings (user_id, amount, source, description, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [referrerTelegramId, commission, 'referral_bonus', `Commission from user ${telegramId}`]
    );
    
    console.log(`✅ Commission $${commission} paid to referrer ${referrerTelegramId} for user:${telegramId}`);
  } catch (err) {
    console.error("distributeReferralCommission error:", err);
  }
}
// =====================================================
// ⏰ CLEANUP EXPIRED TASK REJECTIONS
// Releases reserved funds after 24 hours when no dispute
// was opened.
// =====================================================
async function cleanupExpiredTaskRejections() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ==================================================
    // 🔒 Lock expired rejected executions together
    // with their tasks
    // ==================================================
    const expired = await client.query(
      `
      SELECT
        te.id,
        te.task_id,
        te.payment_amount,
        te.commission_amount,
        te.rejected_at,
        t.spent
      FROM task_executions te
      INNER JOIN tasks t
        ON t.id = te.task_id
      WHERE te.status = 'rejected'
        AND te.rejected_at IS NOT NULL
        AND te.rejected_at <= NOW() - INTERVAL '24 hours'
      FOR UPDATE OF te, t
      `
    );

    let releasedCount = 0;
    let releasedTotal = 0;

    for (const execution of expired.rows) {

      // ==============================================
      // 💰 Calculate payment + commission
      // ==============================================
      const paymentAmount = parseFloat(
        execution.payment_amount || 0
      );

      const commissionAmount = parseFloat(
  execution.commission_amount ??
  (paymentAmount * 0.20)
);

const referralCommission =
  paymentAmount * 0.05;

const totalCost =
  paymentAmount +
  commissionAmount +
  referralCommission;

      // ==============================================
      // 🔐 Validate amounts
      // ==============================================
      if (
        !Number.isFinite(paymentAmount) ||
        paymentAmount <= 0 ||
        !Number.isFinite(commissionAmount) ||
        commissionAmount < 0 ||
        !Number.isFinite(totalCost) ||
        totalCost <= 0
      ) {
        console.error(
          `❌ Invalid payment data for expired execution #${execution.id}`
        );

        continue;
      }

      // ==============================================
      // 💰 Release reserved task funds
      // ==============================================
      const released = await client.query(
        `
        UPDATE tasks
        SET spent =
          COALESCE(spent, 0) - $1
        WHERE id = $2::integer
          AND COALESCE(spent, 0) >= $1
        RETURNING spent
        `,
        [
          totalCost,
          execution.task_id
        ]
      );

      if (released.rows.length === 0) {
        console.error(
          `❌ Could not release reservation for execution #${execution.id}`
        );

        continue;
      }

      releasedCount++;
      releasedTotal += totalCost;

      // ==============================================
      // ✅ Mark rejection as finalized
      //
      // We keep status = rejected.
      // Clearing rejected_at prevents the frontend
      // from considering it inside the dispute window.
      // ==============================================
      await client.query(
        `
        UPDATE task_executions
        SET
          rejected_at = NULL
        WHERE id = $1::integer
          AND status = 'rejected'
        `,
        [execution.id]
      );

      console.log(
        `✅ Expired rejection finalized: execution #${execution.id}, released ${totalCost}`
      );
    }

    await client.query('COMMIT');

    console.log(
      `⏰ Cleanup completed: ${releasedCount} executions finalized, total released = ${releasedTotal.toFixed(6)}`
    );

    return {
      success: true,
      released_count: releasedCount,
      released_total: releasedTotal
    };

  } catch (err) {

    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error(
      '❌ cleanupExpiredTaskRejections:',
      err
    );

    throw err;

  } finally {
    client.release();
  }
}

// ======================= 🧠 QUIZ SYSTEM =======================

// ================================================================
// Quiz helpers (Optimized for CPU)
// ================================================================

function generateQuizId() {
  return crypto.randomUUID();
}

// ✅ تحسين: استبدال واحد بدلاً من 13 استبدالاً متسلسلاً
function decodeHTML(text) {
  if (!text) return '';
  return text.replace(/&(quot|#039|amp|lt|gt|rsquo|ldquo|rdquo|eacute|egrave|ecirc|aacute|agrave);/g, m => {
    switch (m) {
      case '&quot;': return '"';
      case '&#039;': return "'";
      case '&amp;': return '&';
      case '&lt;': return '<';
      case '&gt;': return '>';
      case '&rsquo;': return "'";
      case '&ldquo;': return '"';
      case '&rdquo;': return '"';
      case '&eacute;': return 'é';
      case '&egrave;': return 'è';
      case '&ecirc;': return 'ê';
      case '&aacute;': return 'á';
      case '&agrave;': return 'à';
      default: return m;
    }
  });
}

// ✅ تحسين: استخدام slice و Bitwise OR و متغير temp لسرعة أعلى في V8
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const temp = a[i];
    a[i] = a[j];
    a[j] = temp;
  }
  return a;
}

// ✅ تحسين: إضافة Cache لمدة 60 ثانية لتجنب استعلامات DB المتكررة غير الضرورية
let cachedSettings = null;
let settingsCacheExpiry = 0;

async function getQuizSettings() {
  const now = Date.now();
  if (cachedSettings && now < settingsCacheExpiry) {
    return cachedSettings;
  }

  const res = await pool.query(
    `SELECT key, value FROM quiz_settings WHERE key IN ('points_per_1000', 'min_conversion_points', 'max_questions_per_day')`
  );

  const settings = {};
  for (const row of res.rows) {
    settings[row.key] = row.value;
  }

  const pointsPer1000 = settings.points_per_1000 === undefined ? 0.10 : Number(settings.points_per_1000);
  const minConversionPoints = settings.min_conversion_points === undefined ? 1000 : Number(settings.min_conversion_points);
  const maxQuestionsPerDay = settings.max_questions_per_day === undefined ? 200 : Number(settings.max_questions_per_day);

  if (
    !Number.isFinite(pointsPer1000) || pointsPer1000 <= 0 ||
    !Number.isInteger(minConversionPoints) || minConversionPoints <= 0 ||
    !Number.isInteger(maxQuestionsPerDay) || maxQuestionsPerDay <= 0
  ) {
    throw new Error('INVALID_QUIZ_SETTINGS');
  }

  cachedSettings = {
    points_per_1000: pointsPer1000,
    min_conversion_points: minConversionPoints,
    max_questions_per_day: maxQuestionsPerDay
  };
  settingsCacheExpiry = now + 60000; // 60 ثانية

  return cachedSettings;
}

// ================================================================
// QUIZ QUESTION CACHE / SOURCES
// ================================================================

const quizQuestionCache = new Map();
const quizFetching = new Map();
const QUIZ_CACHE_DURATION = 60 * 60 * 1000; // ساعة واحدة
const QUIZ_BATCH_SIZE = 20;
const QUIZ_SUPPORTED_LANGUAGES = ['en', 'ar', 'fr', 'es', 'pt', 'de', 'ja', 'tr'];

// ================================================================
// 1️⃣ GET QUIZ QUESTION
// ================================================================

app.get('/api/quiz/question', async (c) => {
  try {
    const userId = c.req.query('user_id');
    const lang = (c.req.query('lang') || 'en').toLowerCase().trim();

    if (!userId || !/^\d+$/.test(userId)) {
      return c.json({ success: false, message: 'Invalid user_id' }, 400);
    }

    if (!QUIZ_SUPPORTED_LANGUAGES.includes(lang)) {
      return c.json({ success: false, message: 'UNSUPPORTED_LANGUAGE' }, 400);
    }

    const quizStateResult =
  await pool.query(
    `
    INSERT INTO quiz_points (
      user_id,
      points,
      total_earned,
      total_converted,
      questions_today,
      last_reset_date,
      weekly_score,
      last_weekly_reset
    )

    SELECT
      u.telegram_id,
      0,
      0,
      0,
      0,
      CURRENT_DATE,
      0,
      CURRENT_DATE

    FROM users u

    WHERE u.telegram_id = $1

    ON CONFLICT (user_id)

    DO UPDATE SET

      questions_today =
        CASE
          WHEN quiz_points.last_reset_date < CURRENT_DATE
          THEN 0
          ELSE quiz_points.questions_today
        END,

      last_reset_date =
        CASE
          WHEN quiz_points.last_reset_date < CURRENT_DATE
          THEN CURRENT_DATE
          ELSE quiz_points.last_reset_date
        END,

      weekly_score =
        CASE
          WHEN quiz_points.last_weekly_reset <
               (CURRENT_DATE - INTERVAL '7 days')
          THEN 0
          ELSE quiz_points.weekly_score
        END,

      last_weekly_reset =
        CASE
          WHEN quiz_points.last_weekly_reset <
               (CURRENT_DATE - INTERVAL '7 days')
          THEN CURRENT_DATE
          ELSE quiz_points.last_weekly_reset
        END

    RETURNING
      user_id,
      points,
      questions_today,
      weekly_score
    `,
    [userId]
  );

    if (quizStateResult.rows.length === 0) {
      return c.json({ success: false, message: 'USER_NOT_FOUND' }, 404);
    }

    const quizState = quizStateResult.rows[0];
    const quizSettings = await getQuizSettings();

const pointsPer1000 =
  quizSettings.points_per_1000;

const minConversionPoints =
  quizSettings.min_conversion_points;

const maxQuestionsPerDay =
  quizSettings.max_questions_per_day;
    const qToday = Number(quizState.questions_today);
    const points = Number(quizState.points);
    const weeklyScore = Number(quizState.weekly_score);
    

    if (!Number.isFinite(pointsPer1000) || pointsPer1000 <= 0 || !Number.isInteger(minConversionPoints) || minConversionPoints <= 0 || !Number.isInteger(maxQuestionsPerDay) || maxQuestionsPerDay <= 0) {
      throw new Error('INVALID_QUIZ_SETTINGS');
    }

    if (qToday >= maxQuestionsPerDay) {
      return c.json({ success: false, message: 'DAILY_LIMIT', points, weekly_score: weeklyScore, questionsLeft: 0 });
    }

    let difficulty = 'easy';
    if (qToday > 50) difficulty = 'medium';
    if (qToday > 100) difficulty = 'hard';

    const cacheKey = `${lang}:${difficulty}`;
    let cached = quizQuestionCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now && Array.isArray(cached.questions) && cached.questions.length > 0) {
      console.log(`✅ Quiz cache hit: ${cacheKey} (${cached.questions.length})`);
    } else {
      quizQuestionCache.delete(cacheKey);
      cached = null;

      if (quizFetching.has(cacheKey)) {
        try {
          await quizFetching.get(cacheKey);
        } catch (waitErr) {
          console.error(`❌ Waiting for quiz batch failed (${cacheKey}):`, waitErr);
        }
      } else {
        const fetchPromise = (async () => {
          if (lang === 'en') {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            try {
              console.log(`🌐 Fetching ${QUIZ_BATCH_SIZE} English questions from OpenTDB`);
              const apiRes = await fetch(`https://opentdb.com/api.php?amount=${QUIZ_BATCH_SIZE}&type=multiple&difficulty=${difficulty}&encode=url3986`, { signal: controller.signal });
              if (!apiRes.ok) throw new Error(`OpenTDB HTTP ${apiRes.status}`);
              
              const apiData = await apiRes.json();
              if (apiData.response_code !== 0) throw new Error(`OpenTDB response_code: ${apiData.response_code}`);
              if (!Array.isArray(apiData.results) || apiData.results.length === 0) throw new Error('OpenTDB returned no questions');

              const questions = [];
              for (const q of apiData.results) {
                try {
                  const question = decodeURIComponent(q.question);
                  const correctAnswer = decodeURIComponent(q.correct_answer);
                  // ✅ تحسين: استخدام مرجع الدالة مباشرة
                  const incorrectAnswers = q.incorrect_answers.map(decodeURIComponent);

                  if (!question || !correctAnswer || !Array.isArray(incorrectAnswers) || incorrectAnswers.length !== 3) continue;

                  questions.push({
                    question,
                    correctAnswer,
                    incorrectAnswers,
                    category: decodeURIComponent(q.category),
                    difficulty: q.difficulty
                  });
                } catch (decodeErr) {
                  console.error('❌ OpenTDB decode error:', decodeErr);
                }
              }
              if (questions.length === 0) throw new Error('No valid OpenTDB questions');

              quizQuestionCache.set(cacheKey, { questions, expiresAt: Date.now() + QUIZ_CACHE_DURATION });
              console.log(`✅ English batch cached: ${questions.length}`);
            } finally {
              clearTimeout(timeoutId);
            }
          } else if (['ar', 'fr', 'es', 'pt', 'de', 'ja'].includes(lang)) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            try {
              console.log(`🌐 Fetching ${QUIZ_BATCH_SIZE} ${lang} questions from PolyFact`);
              const statsRes = await fetch(`https://datasets-server.huggingface.co/statistics?dataset=jvonrad%2FPolyFact&config=${encodeURIComponent(lang)}&split=train`, { signal: controller.signal });
              if (!statsRes.ok) throw new Error(`PolyFact statistics HTTP ${statsRes.status}`);
              
              const statsData = await statsRes.json();
              const totalRows = Number(statsData.num_examples || statsData.num_rows || statsData.statistics?.num_examples || 0);
              if (!Number.isInteger(totalRows) || totalRows < QUIZ_BATCH_SIZE) throw new Error(`Invalid PolyFact row count: ${totalRows}`);

              const maxOffset = totalRows - QUIZ_BATCH_SIZE;
              const offset = (Math.random() * (maxOffset + 1)) | 0;

              const rowsRes = await fetch(`https://datasets-server.huggingface.co/rows?dataset=jvonrad%2FPolyFact&config=${encodeURIComponent(lang)}&split=train&offset=${offset}&length=${QUIZ_BATCH_SIZE}`, { signal: controller.signal });
              if (!rowsRes.ok) throw new Error(`PolyFact rows HTTP ${rowsRes.status}`);
              
              const rowsData = await rowsRes.json();
              if (!Array.isArray(rowsData.rows)) throw new Error('PolyFact returned invalid rows');

              const questions = [];
              for (const item of rowsData.rows) {
                const row = item.row;
                if (!row) continue;

                const options = [row.option_a, row.option_b, row.option_c, row.option_d];
                const answerIndex = Number(row.answer_index);

                if (!row.question || options.some(option => typeof option !== 'string' || !option.trim()) || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) continue;

                questions.push({
                  question: row.question,
                  correctAnswer: options[answerIndex],
                  incorrectAnswers: options.filter((_, index) => index !== answerIndex),
                  category: row.relation || 'General',
                  difficulty
                });
              }
              if (questions.length === 0) throw new Error(`No valid PolyFact questions for ${lang}`);

              quizQuestionCache.set(cacheKey, { questions, expiresAt: Date.now() + QUIZ_CACHE_DURATION });
              console.log(`✅ PolyFact ${lang} batch cached: ${questions.length}`);
            } finally {
              clearTimeout(timeoutId);
            }
          } else if (lang === 'tr') {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            try {
              console.log(`🌐 Fetching ${QUIZ_BATCH_SIZE} Turkish questions`);
              const statsRes = await fetch(`https://datasets-server.huggingface.co/statistics?dataset=malhajar%2Fmmlu-tr&config=global_facts&split=test`, { signal: controller.signal });
              if (!statsRes.ok) throw new Error(`Turkish statistics HTTP ${statsRes.status}`);
              
              const statsData = await statsRes.json();
              const totalRows = Number(statsData.num_examples || statsData.num_rows || statsData.statistics?.num_examples || 0);
              if (!Number.isInteger(totalRows) || totalRows < QUIZ_BATCH_SIZE) throw new Error(`Invalid Turkish row count: ${totalRows}`);

              const maxOffset = totalRows - QUIZ_BATCH_SIZE;
              const offset = (Math.random() * (maxOffset + 1)) | 0;

              const rowsRes = await fetch(`https://datasets-server.huggingface.co/rows?dataset=malhajar%2Fmmlu-tr&config=global_facts&split=test&offset=${offset}&length=${QUIZ_BATCH_SIZE}`, { signal: controller.signal });
              if (!rowsRes.ok) throw new Error(`Turkish rows HTTP ${rowsRes.status}`);
              
              const rowsData = await rowsRes.json();
              if (!Array.isArray(rowsData.rows)) throw new Error('Turkish dataset returned invalid rows');

              const questions = [];
              for (const item of rowsData.rows) {
                const row = item.row;
                if (!row) continue;

                const options = Array.isArray(row.choices) ? row.choices : [];
                const answerIndex = Number(row.answer);

                if (!row.question || options.length !== 4 || options.some(option => typeof option !== 'string' || !option.trim()) || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) continue;

                questions.push({
                  question: row.question,
                  correctAnswer: options[answerIndex],
                  incorrectAnswers: options.filter((_, index) => index !== answerIndex),
                  category: 'General',
                  difficulty
                });
              }
              if (questions.length === 0) throw new Error('No valid Turkish questions');

              quizQuestionCache.set(cacheKey, { questions, expiresAt: Date.now() + QUIZ_CACHE_DURATION });
              console.log(`✅ Turkish batch cached: ${questions.length}`);
            } finally {
              clearTimeout(timeoutId);
            }
          }
        })();

        quizFetching.set(cacheKey, fetchPromise);
        try {
          await fetchPromise;
        } catch (fetchErr) {
          console.error(`❌ Quiz batch fetch failed (${cacheKey}):`, fetchErr);
          return c.json({ success: false, message: 'API_UNAVAILABLE' }, 503);
        } finally {
          quizFetching.delete(cacheKey);
        }
      }
      cached = quizQuestionCache.get(cacheKey);
    }

    if (!cached || !Array.isArray(cached.questions) || cached.questions.length === 0) {
      return c.json({ success: false, message: 'API_UNAVAILABLE' }, 503);
    }

    const questionData = cached.questions.shift();

    if (cached.questions.length === 0) {
      quizQuestionCache.delete(cacheKey);
      console.log(`♻️ Quiz batch exhausted: ${cacheKey}`);
    } 

    if (!questionData || !questionData.question || !questionData.correctAnswer || !Array.isArray(questionData.incorrectAnswers) || questionData.incorrectAnswers.length !== 3) {
      return c.json({ success: false, message: 'API_UNAVAILABLE' }, 503);
    }

    const allAnswers = [questionData.correctAnswer, ...questionData.incorrectAnswers];
    const shuffledAnswers = shuffleArray(allAnswers);
    const correctIndex = shuffledAnswers.indexOf(questionData.correctAnswer);

    if (correctIndex === -1) {
      return c.json({ success: false, message: 'API_UNAVAILABLE' }, 503);
    }

    const questionId = generateQuizId();

    await pool.query(
      `INSERT INTO quiz_question_sessions (question_id, user_id, correct_index, is_correct, created_at, answered, skipped, retry_used, double_used)
       VALUES ($1, $2, $3, false, NOW(), false, false, false, false)`,
      [questionId, userId, correctIndex]
    );

    const questionsLeft = Math.max(0, maxQuestionsPerDay - qToday - 1);

    return c.json({
      success: true,
      questionId,
      question: questionData.question,
      answers: shuffledAnswers,
      category: questionData.category,
      difficulty: questionData.difficulty,
      points,
      weekly_score: weeklyScore,
      questionsLeft
    });

  } catch (err) {
    console.error('❌ /api/quiz/question:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// ================================================================
// 2️⃣ ANSWER QUESTION
// ================================================================

app.post('/api/quiz/answer', async (c) => {
  const client = await pool.connect();
  try {
    const { questionId, answerIndex, userId } = await c.req.json();

    if (!questionId || answerIndex === undefined || answerIndex === null || !userId) {
      return c.json({ success: false, message: 'Missing data' }, 400);
    }
    if (!/^\d+$/.test(String(userId))) {
      return c.json({ success: false, message: 'Invalid user_id' }, 400);
    }

    const numericAnswerIndex = Number(answerIndex);
    if (!Number.isInteger(numericAnswerIndex) || numericAnswerIndex < 0 || numericAnswerIndex > 3) {
      return c.json({ success: false, message: 'Invalid answer' }, 400);
    }

    await client.query('BEGIN');

    const questionRes = await client.query(
      `SELECT correct_index, created_at, answered, skipped, retry_used FROM quiz_question_sessions WHERE question_id = $1 AND user_id = $2 FOR UPDATE`,
      [questionId, userId]
    );

    if (questionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: 'EXPIRED' }, 404);
    }

    const question = questionRes.rows[0];

    if (question.answered === true || question.skipped === true) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: 'ALREADY_PROCESSED' }, 409);
    }

    const createdAt = new Date(question.created_at).getTime();
    if (!Number.isFinite(createdAt) || Date.now() - createdAt < 10000) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: 'TOO_FAST' }, 400);
    }

    const correctIndex = Number(question.correct_index);
    const isCorrect = numericAnswerIndex === correctIndex;
    const isRetryAttempt = question.retry_used === true;

    const updateResult = await client.query(
      `UPDATE quiz_question_sessions SET answered = true, is_correct = $1 WHERE question_id = $2 AND user_id = $3 AND answered = false AND skipped = false RETURNING question_id`,
      [isCorrect, questionId, userId]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: 'ALREADY_PROCESSED' }, 409);
    }

    const statsResult = await client.query(
      `UPDATE quiz_points SET
        questions_today = questions_today + CASE WHEN $2 = true THEN 1 ELSE 0 END,
        points = points + CASE WHEN $1 = true THEN 1 ELSE 0 END,
        total_earned = total_earned + CASE WHEN $1 = true THEN 1 ELSE 0 END,
        weekly_score = weekly_score + CASE WHEN $1 = true THEN 1 ELSE 0 END
       WHERE user_id = $3 RETURNING points, questions_today, weekly_score`,
      [isCorrect, !isRetryAttempt, userId]
    );

    if (statsResult.rows.length === 0) {
      throw new Error('QUIZ_POINTS_NOT_FOUND');
    }

    const stats = statsResult.rows[0];
    await client.query('COMMIT');

    return c.json({
      success: true,
      correct: isCorrect,
      correctIndex,
      pointsEarned: isCorrect ? 1 : 0,
      points: Number(stats.points || 0),
      questions_today: Number(stats.questions_today || 0),
      weekly_score: Number(stats.weekly_score || 0),
      isRetryAttempt
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ /api/quiz/answer:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  } finally {
    client.release();
  }
});

// ================================================================
// 3️⃣ CREATE REWARD SESSION
// ================================================================

app.post('/api/quiz/reward/create', async (c) => {
  const client = await pool.connect();
  try {
    const { userId, questionId, action } = await c.req.json();

    if (!userId || !questionId || !action) {
      return c.json({ success: false, message: 'Missing data' }, 400);
    }
    if (!/^\d+$/.test(userId.toString())) {
      return c.json({ success: false, message: 'Invalid user_id' }, 400);
    }
    if (!['double', 'retry', 'skip'].includes(action)) {
      return c.json({ success: false, message: 'Invalid action' }, 400);
    }

    await client.query('BEGIN');

    const questionRes = await client.query(
      `SELECT question_id, user_id, answered, is_correct, skipped, retry_used, double_used FROM quiz_question_sessions WHERE question_id = $1 AND user_id = $2 FOR UPDATE`,
      [questionId, userId]
    );

    if (questionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: 'QUESTION_NOT_FOUND' }, 404);
    }

    const question = questionRes.rows[0];

    if (action === 'double') {
      if (!question.answered || !question.is_correct || question.double_used) {
        await client.query('ROLLBACK');
        return c.json({ success: false, message: question.answered ? (question.is_correct ? 'DOUBLE_ALREADY_USED' : 'DOUBLE_REQUIRES_CORRECT_ANSWER') : 'QUESTION_NOT_ANSWERED' }, question.double_used ? 409 : 400);
      }
    } else if (action === 'retry') {
      if (!question.answered || question.retry_used) {
        await client.query('ROLLBACK');
        return c.json({ success: false, message: question.answered ? 'RETRY_ALREADY_USED' : 'QUESTION_NOT_ANSWERED' }, question.retry_used ? 409 : 400);
      }
    } else if (action === 'skip') {
      if (question.answered || question.skipped) {
        await client.query('ROLLBACK');
        return c.json({ success: false, message: 'QUESTION_ALREADY_PROCESSED' }, 409);
      }
    }

    const pendingReward = await client.query(
      `SELECT reward_id FROM quiz_reward_sessions WHERE user_id = $1 AND question_id = $2 AND action = $3 AND status = 'pending' AND expires_at > NOW() LIMIT 1`,
      [userId, questionId, action]
    );

    if (pendingReward.rows.length > 0) {
      await client.query('COMMIT');
      return c.json({ success: true, rewardId: pendingReward.rows[0].reward_id });
    }

    const rewardId = generateQuizId();
    await client.query(
      `INSERT INTO quiz_reward_sessions (reward_id, user_id, question_id, action, status, created_at, expires_at) VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW() + INTERVAL '10 minutes')`,
      [rewardId, userId, questionId, action]
    );

    await client.query('COMMIT');
    return c.json({ success: true, rewardId });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ /api/quiz/reward/create:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  } finally {
    client.release();
  }
});

// ================================================================
// 4️⃣ COMPLETE REWARD SESSION
// ================================================================

app.post('/api/quiz/reward/complete', async (c) => {
  const client = await pool.connect();
  try {
    const { rewardId, userId } = await c.req.json();

    if (!rewardId || !userId) {
      return c.json({ success: false, message: 'Missing data' }, 400);
    }
    if (!/^\d+$/.test(userId.toString())) {
      return c.json({ success: false, message: 'Invalid user_id' }, 400);
    }

    await client.query('BEGIN');

    const rewardQuestionRes = await client.query(
  `SELECT
     r.reward_id,
     r.user_id AS reward_user_id,
     r.question_id,
     r.action,
     r.status,
     r.expires_at,
     q.question_id AS q_question_id,
     q.user_id AS q_user_id,
     q.answered,
     q.is_correct,
     q.skipped,
     q.retry_used,
     q.double_used
   FROM quiz_reward_sessions r
   INNER JOIN quiz_question_sessions q
     ON q.question_id = r.question_id
    AND q.user_id = r.user_id
   WHERE r.reward_id = $1
     AND r.user_id = $2
   FOR UPDATE OF r, q`,
  [rewardId, userId]
);

if (rewardQuestionRes.rows.length === 0) {
  await client.query('ROLLBACK');
  return c.json({ success: false, message: 'REWARD_NOT_FOUND' }, 404);
}

const row = rewardQuestionRes.rows[0];

const reward = {
  reward_id: row.reward_id,
  user_id: row.reward_user_id,
  question_id: row.question_id,
  action: row.action,
  status: row.status,
  expires_at: row.expires_at
};

if (reward.status === 'completed') {
  await client.query('ROLLBACK');
  return c.json({ success: false, message: 'REWARD_ALREADY_COMPLETED' }, 409);
}

if (reward.status !== 'pending') {
  await client.query('ROLLBACK');
  return c.json({ success: false, message: 'INVALID_REWARD_STATUS' }, 400);
}

if (new Date(reward.expires_at).getTime() <= Date.now()) {
  await client.query(
    `UPDATE quiz_reward_sessions
     SET status = 'expired'
     WHERE reward_id = $1
       AND user_id = $2`,
    [rewardId, userId]
  );

  await client.query('COMMIT');

  return c.json({
    success: false,
    message: 'REWARD_EXPIRED'
  }, 400);
}

const question = {
  question_id: row.q_question_id,
  user_id: row.q_user_id,
  answered: row.answered,
  is_correct: row.is_correct,
  skipped: row.skipped,
  retry_used: row.retry_used,
  double_used: row.double_used
};
    let pointsEarned = 0;
    let updatedPoints = null;

    if (reward.action === 'double') {
      if (!question.answered || !question.is_correct || question.double_used) {
        await client.query('ROLLBACK');
        return c.json({ success: false, message: question.answered ? (question.is_correct ? 'DOUBLE_ALREADY_USED' : 'DOUBLE_REQUIRES_CORRECT_ANSWER') : 'QUESTION_NOT_ANSWERED' }, question.double_used ? 409 : 400);
      }

      const doublePointsResult = await client.query(
        `UPDATE quiz_points SET points = points + 1, total_earned = total_earned + 1, weekly_score = weekly_score + 1 WHERE user_id = $1 RETURNING points, total_earned, total_converted, questions_today, weekly_score`,
        [userId]
      );
      if (doublePointsResult.rows.length === 0) throw new Error('QUIZ_POINTS_NOT_FOUND');
      updatedPoints = doublePointsResult.rows[0];

      await client.query(`UPDATE quiz_question_sessions SET double_used = true WHERE question_id = $1 AND user_id = $2`, [reward.question_id, userId]);
      pointsEarned = 1;

    } else if (reward.action === 'retry') {
  if (!question.answered || question.retry_used) {
    await client.query('ROLLBACK');
    return c.json({ success: false, message: question.answered ? 'RETRY_ALREADY_USED' : 'QUESTION_NOT_ANSWERED' }, question.retry_used ? 409 : 400);
  }

  await client.query(`UPDATE quiz_question_sessions SET answered = false, is_correct = false, retry_used = true WHERE question_id = $1 AND user_id = $2`, [reward.question_id, userId]);
  pointsEarned = 0;
} else if (reward.action === 'skip') {
      if (question.answered || question.skipped) {
        await client.query('ROLLBACK');
        return c.json({ success: false, message: 'QUESTION_ALREADY_PROCESSED' }, 409);
      }

      await client.query(`UPDATE quiz_question_sessions SET skipped = true WHERE question_id = $1 AND user_id = $2`, [reward.question_id, userId]);

      const skipCountResult = await client.query(
        `UPDATE quiz_points SET questions_today = questions_today + 1 WHERE user_id = $1 RETURNING points, total_earned, total_converted, questions_today, weekly_score`,
        [userId]
      );
      if (skipCountResult.rows.length === 0) throw new Error('QUIZ_POINTS_NOT_FOUND');
      updatedPoints = skipCountResult.rows[0];
      pointsEarned = 0;
    }

    await client.query(`UPDATE quiz_reward_sessions SET status = 'completed', completed_at = NOW() WHERE reward_id = $1 AND user_id = $2 AND status = 'pending' RETURNING reward_id`, [rewardId, userId]);

    if (!updatedPoints) {
      const pointsRes = await client.query(`SELECT points, total_earned, total_converted, questions_today, weekly_score FROM quiz_points WHERE user_id = $1`, [userId]);
      if (pointsRes.rows.length === 0) throw new Error('QUIZ_POINTS_NOT_FOUND');
      updatedPoints = pointsRes.rows[0];
    }

    await client.query('COMMIT');

    return c.json({
      success: true,
      action: reward.action,
      earned: pointsEarned,
      total_points: Number(updatedPoints.points || 0),
      total_earned: Number(updatedPoints.total_earned || 0),
      questions_today: Number(updatedPoints.questions_today || 0),
      weekly_score: Number(updatedPoints.weekly_score || 0)
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ /api/quiz/reward/complete:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  } finally {
    client.release();
  }
});

// ================================================================
// 5️⃣ QUIZ POINTS + LEADERBOARD
// ================================================================

app.get('/api/quiz/points', async (c) => {
  try {
    const userId = c.req.query('user_id');
    if (!userId || !/^\d+$/.test(String(userId))) {
      return c.json({ success: false, message: 'Invalid user_id' }, 400);
    }

    const userResult = await pool.query(
      `INSERT INTO quiz_points (user_id, points, questions_today, last_reset_date, weekly_score, last_weekly_reset)
       VALUES ($1, 0, 0, CURRENT_DATE, 0, CURRENT_DATE)
       ON CONFLICT (user_id) DO UPDATE SET
         questions_today = CASE WHEN quiz_points.last_reset_date < CURRENT_DATE THEN 0 ELSE quiz_points.questions_today END,
         last_reset_date = CASE WHEN quiz_points.last_reset_date < CURRENT_DATE THEN CURRENT_DATE ELSE quiz_points.last_reset_date END,
         weekly_score = CASE WHEN quiz_points.last_weekly_reset < CURRENT_DATE - INTERVAL '7 days' THEN 0 ELSE quiz_points.weekly_score END,
         last_weekly_reset = CASE WHEN quiz_points.last_weekly_reset < CURRENT_DATE - INTERVAL '7 days' THEN CURRENT_DATE ELSE quiz_points.last_weekly_reset END
       RETURNING points, total_earned, total_converted, questions_today, weekly_score`,
      [userId]
    );

    const data = userResult.rows[0] || { points: 0, total_earned: 0, total_converted: 0, questions_today: 0, weekly_score: 0 };
    const settings = await getQuizSettings();

    const leaderboard = await pool.query(
      `SELECT u.username, qp.weekly_score FROM quiz_points qp JOIN users u ON qp.user_id = u.telegram_id WHERE qp.weekly_score > 0 ORDER BY qp.weekly_score DESC LIMIT 5`
    );

    return c.json({
      success: true,
      points: Number(data.points || 0),
      total_earned: Number(data.total_earned || 0),
      total_converted: Number(data.total_converted || 0),
      questions_today: Number(data.questions_today || 0),
      weekly_score: Number(data.weekly_score || 0),
      settings,
      leaderboard: leaderboard.rows
    });

  } catch (err) {
    console.error('❌ /api/quiz/points:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// ================================================================
// 6️⃣ CONVERT POINTS
// ================================================================

app.post('/api/quiz/convert', async (c) => {
  const client = await pool.connect();
  try {
    const { userId, pointsToConvert } = await c.req.json();

    if (!userId || !/^\d+$/.test(userId.toString())) {
      return c.json({ success: false, message: 'Invalid user_id' }, 400);
    }

    const requestedPoints = Number(pointsToConvert);
    if (!Number.isInteger(requestedPoints) || requestedPoints <= 0) {
      return c.json({ success: false, message: 'Invalid points' }, 400);
    }

    const settings = await getQuizSettings();
    if (requestedPoints < settings.min_conversion_points) {
      return c.json({ success: false, message: `Minimum ${settings.min_conversion_points} points required` });
    }

    await client.query('BEGIN');

    const pointsRes = await client.query(`SELECT points FROM quiz_points WHERE user_id = $1 FOR UPDATE`, [userId]);
    if (pointsRes.rows.length === 0 || Number(pointsRes.rows[0].points) < requestedPoints) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: 'Insufficient points' });
    }

    const usdAmount = (requestedPoints / 1000) * settings.points_per_1000;

    await client.query(`UPDATE quiz_points SET points = points - $1, total_converted = total_converted + $1 WHERE user_id = $2`, [requestedPoints, userId]);

    const balanceRes = await client.query(`UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE telegram_id = $2 RETURNING balance`, [usdAmount, userId]);
    if (balanceRes.rows.length === 0) throw new Error('User not found while converting quiz points');

    await client.query(`INSERT INTO quiz_conversions (user_id, points_converted, usd_amount) VALUES ($1, $2, $3)`, [userId, requestedPoints, usdAmount]);
    await client.query(`INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1, 'quiz_conversion', $2, $3, NOW())`, [userId, usdAmount, `Quiz points conversion: ${requestedPoints} points`]);

    const remainingRes = await client.query(`SELECT points FROM quiz_points WHERE user_id = $1`, [userId]);

    await client.query('COMMIT');

    return c.json({
      success: true,
      usd_added: Number(usdAmount).toFixed(6),
      points_converted: requestedPoints,
      remaining_points: Number(remainingRes.rows[0]?.points || 0)
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ /api/quiz/convert:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  } finally {
    client.release();
  }
});

// ================================================================
// 7️⃣ QUIZ SETTINGS - ADMIN
// ================================================================

app.get('/api/quiz/settings', verifyAdmin, async (c) => {
  try {
    // ✅ تحسين: إعادة تعيين الكاش عند طلب الأدمن لضمان حصوله على أحدث البيانات
    cachedSettings = null;
    const settings = await getQuizSettings();
    return c.json({ success: true, data: settings });
  } catch (err) {
    console.error('❌ /api/quiz/settings GET:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

app.post('/api/quiz/settings', verifyAdmin, async (c) => {
  try {
    const { points_per_1000, min_conversion_points, max_questions_per_day } = await c.req.json();

    if (points_per_1000 !== undefined) {
      const value = Number(points_per_1000);
      if (!Number.isFinite(value) || value <= 0) return c.json({ success: false, message: 'Invalid points_per_1000' }, 400);
      await pool.query(`UPDATE quiz_settings SET value = $1, updated_at = NOW() WHERE key = 'points_per_1000'`, [value.toString()]);
    }
    if (min_conversion_points !== undefined) {
      const value = Number(min_conversion_points);
      if (!Number.isInteger(value) || value <= 0) return c.json({ success: false, message: 'Invalid min_conversion_points' }, 400);
      await pool.query(`UPDATE quiz_settings SET value = $1, updated_at = NOW() WHERE key = 'min_conversion_points'`, [value.toString()]);
    }
    if (max_questions_per_day !== undefined) {
      const value = Number(max_questions_per_day);
      if (!Number.isInteger(value) || value <= 0) return c.json({ success: false, message: 'Invalid max_questions_per_day' }, 400);
      await pool.query(`UPDATE quiz_settings SET value = $1, updated_at = NOW() WHERE key = 'max_questions_per_day'`, [value.toString()]);
    }

    // ✅ تحسين: إعادة تعيين الكاش بعد تحديث الإعدادات
    cachedSettings = null;

    return c.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    console.error('❌ /api/quiz/settings POST:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// ======================= END QUIZ SYSTEM =======================



// =====================================================
// 🛒 MARKETING & DROP-SHIPPING SYSTEM
// 🏪 NEW SYSTEM:
// Country → Stores → Real Store → Customer Order →
// Register Order → PENDING_VERIFICATION →
// PROCESSING → DELIVERED → Add Profit
// =====================================================


// =====================================================
// 1. جلب المنصات النشطة للمستخدم
//
// بدون country:
// يعيد جميع المنصات النشطة لبناء قائمة الدول.
//
// مع country:
// يعيد المتاجر النشطة التابعة للدولة فقط.
//
// النظام الجديد لا يحتاج إلى Scraping هنا.
// base_url يستخدم لفتح المتجر الحقيقي.
// =====================================================

app.get('/api/marketing/providers', async (c) => {

  try {

    const country =
      c.req.query('country');

    let result;

    // ==================================================
    // عند اختيار دولة
    // ==================================================

    if (country) {

      const normalizedCountry =
        String(country)
          .trim()
          .toUpperCase();

      if (!/^[A-Z]{2}$/.test(normalizedCountry)) {

        return c.json({
          success: false,
          message: 'Invalid country code'
        }, 400);

      }

      result = await pool.query(`

        SELECT
          id,
          name,
          country_code,
          base_url,
          mode,
          fixed_shipping_cost

        FROM marketing_providers

        WHERE country_code = $1
          AND is_active = true

        ORDER BY name ASC

      `, [
        normalizedCountry
      ]);

    }

    // ==================================================
    // بدون دولة:
    // جميع المنصات النشطة
    // ==================================================

    else {

      result = await pool.query(`

        SELECT
          id,
          name,
          country_code,
          base_url,
          mode,
          fixed_shipping_cost

        FROM marketing_providers

        WHERE is_active = true

        ORDER BY
          country_code ASC,
          name ASC

      `);

    }

    return c.json({

      success: true,

      data: result.rows

    });

  } catch (err) {

    console.error(
      '❌ /api/marketing/providers:',
      err
    );

    return c.json({

      success: false,

      message: 'Server error'

    }, 500);

  }

});



// =====================================================
// 2. المسار القديم لإنشاء الطلب.
//
// هذا المسار يعتمد على:
// - product_url
// - جلب صفحة المنتج
// - selector_price
//
// وهو ليس جزءًا من النظام اليدوي الجديد.
//
// أبقيناه موجودًا حتى لا نحذف مسارًا قد تستخدمه أجزاء
// أخرى من المشروع.
//
// النظام الجديد يستخدم:
// /api/marketing/manual-order
// =====================================================

app.post('/api/marketing/orders', async (c) => {

  const client =
    await pool.connect();

  try {

    const {
      user_id,
      provider_id,
      product_url,
      product_name,
      customer_name,
      customer_phone,
      customer_address,
      customer_city
    } = await c.req.json();


    if (
      !user_id ||
      !provider_id ||
      !product_url ||
      !customer_name ||
      !customer_phone ||
      !customer_address
    ) {

      return c.json({

        success: false,

        message:
          'Missing required fields'

      }, 400);

    }


    await client.query('BEGIN');


    // ==================================================
    // جلب المنصة
    // ==================================================

    const providerRes =
      await client.query(`

        SELECT
          id,
          name,
          base_url,
          base_margin_percentage,
          user_profit_percentage,
          fixed_shipping_cost,
          selector_price

        FROM marketing_providers

        WHERE id = $1
          AND is_active = true

      `, [
        provider_id
      ]);


    if (
      providerRes.rows.length === 0
    ) {

      await client.query('ROLLBACK');

      return c.json({

        success: false,

        message:
          'Provider not found'

      }, 404);

    }


    const provider =
      providerRes.rows[0];


    // ==================================================
    // التحقق من رابط المنتج
    // ==================================================

    let supplierProductUrl;

    try {

      supplierProductUrl =
        new URL(product_url);

      const supplierBaseUrl =
        new URL(provider.base_url);


      if (
        supplierProductUrl.origin !==
        supplierBaseUrl.origin
      ) {

        await client.query(
          'ROLLBACK'
        );

        return c.json({

          success: false,

          message:
            'Invalid product URL for this provider.'

        }, 400);

      }

    } catch {

      await client.query(
        'ROLLBACK'
      );

      return c.json({

        success: false,

        message:
          'Invalid product URL.'

      }, 400);

    }


    // ==================================================
    // التحقق من Selector السعر
    // ==================================================

    if (!provider.selector_price) {

      await client.query(
        'ROLLBACK'
      );

      return c.json({

        success: false,

        message:
          'Provider price selector is not configured.'

      }, 500);

    }


    // ==================================================
    // جلب صفحة المنتج
    // ==================================================

    const response =
      await fetch(
        supplierProductUrl.href,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );


    if (!response.ok) {

      await client.query(
        'ROLLBACK'
      );

      return c.json({

        success: false,

        message:
          'Could not access the supplier product page.'

      }, 502);

    }


    // ==================================================
    // استخراج السعر
    // ==================================================

    let verifiedBasePrice = 0;


    const priceRewriter =
      new HTMLRewriter()

        .on(
          provider.selector_price,
          {

            text(text) {

              if (
                verifiedBasePrice > 0
              ) {
                return;
              }


              const value =
                text.text.trim();


              if (!value) {
                return;
              }


              const priceMatch =
                value.match(
                  /[\d,]+(?:\.\d+)?/
                );


              if (priceMatch) {

                const parsed =
                  parseFloat(
                    priceMatch[0]
                      .replace(/,/g, '')
                  );


                if (
                  Number.isFinite(parsed) &&
                  parsed > 0
                ) {

                  verifiedBasePrice =
                    parsed;

                }

              }

            }

          }
        );


    await priceRewriter
      .transform(response)
      .text();


    const basePrice =
      verifiedBasePrice;


    if (
      !basePrice ||
      !Number.isFinite(basePrice)
    ) {

      await client.query(
        'ROLLBACK'
      );

      return c.json({

        success: false,

        message:
          'Could not verify live product price. Please try again.'

      }, 500);

    }


    // ==================================================
    // الحسابات القديمة لهذا المسار فقط
    // ==================================================

    const marginPercent =
      parseFloat(
        provider.base_margin_percentage
      );

    const userProfitPercent =
      parseFloat(
        provider.user_profit_percentage
      );

    const shippingCost =
      parseFloat(
        provider.fixed_shipping_cost
      );


    const marginAmount =
      basePrice *
      (marginPercent / 100);


    const userExpectedProfit =
      marginAmount *
      (userProfitPercent / 100);


    const taskoraNetProfit =
      marginAmount -
      userExpectedProfit;


    const finalProductPrice =
      basePrice +
      marginAmount;


    const totalPrice =
      finalProductPrice +
      shippingCost;


    // ==================================================
    // حفظ الطلب
    // ==================================================

    const orderRes =
      await client.query(`

        INSERT INTO marketing_orders (

          user_id,
          provider_id,
          product_name,
          product_url,

          customer_name,
          customer_phone,
          customer_address,
          customer_city,

          base_price,
          margin_amount,
          final_product_price,
          shipping_cost,
          total_price,
          user_expected_profit,
          taskora_net_profit

        )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15
        )

        RETURNING id

      `, [

        user_id,
        provider_id,
        product_name,
        product_url,

        customer_name,
        customer_phone,
        customer_address,
        customer_city,

        basePrice,
        marginAmount,
        finalProductPrice,
        shippingCost,
        totalPrice,
        userExpectedProfit,
        taskoraNetProfit

      ]);


    await client.query(
      'COMMIT'
    );


    return c.json({

      success: true,

      message:
        'Order created successfully',

      order_id:
        orderRes.rows[0].id

    });


  } catch (err) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch (rollbackError) {
      console.error(
        '❌ Marketing old order rollback:',
        rollbackError
      );
    }


    console.error(
      '❌ /api/marketing/orders:',
      err
    );


    return c.json({

      success: false,

      message:
        'Failed to create order'

    }, 500);


  } finally {

    client.release();

  }

});



// =====================================================
// 3. 🛒 النظام الجديد
// MANUAL BROWSE & REPORT SYSTEM
//
// المستخدم:
// 1. يختار الدولة.
// 2. يختار المتجر.
// 3. يفتح المتجر الحقيقي.
// 4. يطلب المنتج من المتجر.
// 5. يعود إلى Taskora.
// 6. يسجل بيانات الطلب.
//
// الحالة الأولى:
// PENDING_VERIFICATION
//
// لا يتم إضافة الربح هنا.
// الربح يضاف فقط عند DELIVERED.
// =====================================================

app.post(
  '/api/marketing/manual-order',
  async (c) => {

    const client =
      await pool.connect();

    try {

      const {
        user_id,
        provider_id,
        product_name,
        declared_price,
        image_url,
        customer_name,
        customer_phone,
        customer_address,
        customer_city
      } = await c.req.json();


      // ==================================================
      // التحقق من البيانات المطلوبة
      // ==================================================

      if (
        !user_id ||
        !provider_id ||
        !product_name ||
        declared_price === undefined ||
        declared_price === null ||
        !customer_name ||
        !customer_phone ||
        !customer_address
      ) {

        return c.json({

          success: false,

          message:
            'Missing required fields'

        }, 400);

      }


      await client.query(
        'BEGIN'
      );


      // ==================================================
      // التحقق من المستخدم
      // ==================================================

      const userRes =
        await client.query(`

          SELECT
            telegram_id

          FROM users

          WHERE telegram_id = $1

          FOR SHARE

        `, [
          user_id
        ]);


      if (
        userRes.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return c.json({

          success: false,

          message:
            'User not found'

        }, 404);

      }


      // ==================================================
      // جلب المتجر النشط
      // ==================================================

      const providerRes =
        await client.query(`

          SELECT
            id,
            name,
            base_url,
            fixed_shipping_cost

          FROM marketing_providers

          WHERE id = $1
            AND is_active = true

        `, [
          provider_id
        ]);


      if (
        providerRes.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return c.json({

          success: false,

          message:
            'Provider not found or inactive'

        }, 404);

      }


      const provider =
        providerRes.rows[0];


      // ==================================================
      // السعر الذي أدخله المستخدم
      // ==================================================

      const dPrice =
        parseFloat(
          declared_price
        );


      if (
        !Number.isFinite(dPrice) ||
        dPrice <= 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return c.json({

          success: false,

          message:
            'Invalid declared price'

        }, 400);

      }


      // ==================================================
      // النظام الجديد:
      //
      // ربح المستخدم المتوقع = 5% من سعر المنتج.
      //
      // مثال:
      // سعر المنتج = $10
      // الربح المتوقع = $0.50
      //
      // لا يتم دفع الربح الآن.
      // ==================================================

      const userExpectedProfit =
        Number(
          (
            dPrice * 0.05
          ).toFixed(6)
        );


      // ==================================================
      // في النظام اليدوي لا يتم إعادة حساب سعر المنتج
      // من الموقع.
      //
      // السعر المدخل هو سعر المنتج الذي سجله المستخدم.
      // ==================================================

      const basePrice =
        dPrice;


      const marginAmount =
        0;


      const finalProductPrice =
        dPrice;


      const shippingCost =
        Number(
          provider.fixed_shipping_cost || 0
        );


      const totalPrice =
        finalProductPrice +
        shippingCost;


      // ==================================================
      // لا توجد عملية تسعير تلقائية من Taskora في
      // النظام اليدوي الجديد.
      //
      // لذلك taskora_net_profit يسجل 0 هنا.
      // ==================================================

      const taskoraNetProfit =
        0;


      // ==================================================
      // حفظ الطلب
      //
      // product_url يستخدم هنا لتخزين image_url
      // لأن جدول marketing_orders الحالي لا يحتوي
      // على image_url مستقل.
      // ==================================================

      const orderRes =
        await client.query(`

          INSERT INTO marketing_orders (

            user_id,
            provider_id,
            product_name,
            product_url,

            customer_name,
            customer_phone,
            customer_address,
            customer_city,

            base_price,
            margin_amount,
            final_product_price,
            shipping_cost,
            total_price,
            user_expected_profit,
            taskora_net_profit,

            status

          )

          VALUES (

            $1,
            $2,
            $3,
            $4,

            $5,
            $6,
            $7,
            $8,

            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,

            'PENDING_VERIFICATION'

          )

          RETURNING id

        `, [

          user_id,
          provider_id,
          String(product_name).trim(),
          image_url
            ? String(image_url).trim()
            : null,

          String(customer_name).trim(),
          String(customer_phone).trim(),
          String(customer_address).trim(),

          customer_city
            ? String(customer_city).trim()
            : null,

          basePrice,
          marginAmount,
          finalProductPrice,
          shippingCost,
          totalPrice,
          userExpectedProfit,
          taskoraNetProfit

        ]);


      await client.query(
        'COMMIT'
      );


      return c.json({

        success: true,

        message:
          'Order submitted for admin verification',

        order_id:
          orderRes.rows[0].id,

        status:
          'PENDING_VERIFICATION'

      });


    } catch (err) {

      try {

        await client.query(
          'ROLLBACK'
        );

      } catch (rollbackError) {

        console.error(
          '❌ Marketing manual order rollback error:',
          rollbackError
        );

      }


      console.error(
        '❌ /api/marketing/manual-order:',
        err
      );


      return c.json({

        success: false,

        message:
          'Failed to create order'

      }, 500);


    } finally {

      client.release();

    }

  }
);



// =====================================================
// 4. [ADMIN ONLY]
// جلب طلبات التسويق
//
// الافتراضي:
// PENDING_VERIFICATION
//
// يتم جلب:
// - بيانات الطلب
// - بيانات المستخدم
// - بيانات المتجر
// - بيانات العميل
// - بيانات المنتج
// - رابط صورة المنتج
// - البيانات المالية
// =====================================================

app.get(
  '/api/admin/marketing/orders',
  verifyAdmin,
  async (c) => {

    try {

      const status =
        String(
          c.req.query('status') ||
          'PENDING_VERIFICATION'
        )
          .trim()
          .toUpperCase();


      const allowedStatuses = [
        'PENDING_VERIFICATION',
        'PENDING',
        'PROCESSING',
        'DELIVERED',
        'CANCELLED'
      ];


      if (
        !allowedStatuses.includes(status)
      ) {

        return c.json({

          success: false,

          message:
            'Invalid order status'

        }, 400);

      }


      const result =
        await pool.query(`

          SELECT

            o.id,
            o.user_id,
            o.status,

            o.created_at,
            o.updated_at,

            o.customer_name,
            o.customer_phone,
            o.customer_city,
            o.customer_address,

            o.product_name,
            o.product_url,

            pr.id AS provider_id,
            pr.name AS provider_name,
            pr.country_code AS provider_country,
            pr.base_url AS provider_base_url,

            u.name AS user_name,
            u.username AS user_username,
            u.telegram_id AS user_telegram_id,

            o.base_price,
            o.margin_amount,
            o.final_product_price,
            o.shipping_cost,
            o.total_price,
            o.user_expected_profit,
            o.taskora_net_profit,

            o.admin_notes

          FROM marketing_orders o

          JOIN marketing_providers pr
            ON o.provider_id = pr.id

          LEFT JOIN users u
            ON o.user_id = u.telegram_id

          WHERE o.status = $1

          ORDER BY
            o.created_at DESC

        `, [
          status
        ]);


      return c.json({

        success: true,

        data:
          result.rows

      });


    } catch (err) {

      console.error(
        '❌ /api/admin/marketing/orders:',
        err
      );


      return c.json({

        success: false,

        message:
          'Server error'

      }, 500);

    }

  }
);



// =====================================================
// 5. [ADMIN ONLY]
// تحديث حالة طلب التسويق
//
// المسار:
// PENDING_VERIFICATION
//        ↓
// PROCESSING
//        ↓
// DELIVERED
//
// أو:
//
// PENDING_VERIFICATION → CANCELLED
// PROCESSING → CANCELLED
//
// لا يسمح:
// PENDING_VERIFICATION → DELIVERED
//
// عند DELIVERED:
// - إضافة ربح المستخدم
// - تسجيل earnings
// - حساب Referral Commission
// - إضافة Referral Commission
// - تسجيل referral_earnings
// - تسجيل referral earnings
//
// كل العمليات داخل Transaction.
// =====================================================

app.post(
  '/api/admin/marketing/orders/:id/status',
  verifyAdmin,
  async (c) => {

    let client = null;

    try {

      // ==================================================
      // الاتصال بقاعدة البيانات
      // ==================================================

      client =
        await pool.connect();


      // ==================================================
      // Order ID
      // ==================================================

      const orderId =
        c.req.param('id');


      if (
        !orderId ||
        !/^\d+$/.test(
          String(orderId)
        )
      ) {

        return c.json({

          success: false,

          message:
            'Invalid order ID'

        }, 400);

      }


      // ==================================================
      // قراءة البيانات
      // ==================================================

      const {
        status,
        admin_notes
      } = await c.req.json();


      // ==================================================
      // الحالة الجديدة
      // ==================================================

      const normalizedStatus =
        String(status || '')
          .trim()
          .toUpperCase();


      const allowedStatuses = [
        'PENDING_VERIFICATION',
        'PENDING',
        'PROCESSING',
        'DELIVERED',
        'CANCELLED'
      ];


      if (
        !allowedStatuses.includes(
          normalizedStatus
        )
      ) {

        return c.json({

          success: false,

          message:
            `Invalid order status: ${normalizedStatus}`

        }, 400);

      }


      // ==================================================
      // بدء Transaction
      // ==================================================

      await client.query(
        'BEGIN'
      );


      // ==================================================
      // جلب الطلب وقفل السجل
      // ==================================================

      const orderRes =
        await client.query(`

          SELECT

            id,
            user_id,
            provider_id,
            user_expected_profit,
            taskora_net_profit,
            status

          FROM marketing_orders

          WHERE id = $1

          FOR UPDATE

        `, [
          orderId
        ]);


      if (
        orderRes.rows.length === 0
      ) {

        await client.query(
          'ROLLBACK'
        );

        return c.json({

          success: false,

          message:
            'Order not found'

        }, 404);

      }


      const order =
        orderRes.rows[0];


      // ==================================================
      // الحالة الحالية
      // ==================================================

      const currentStatus =
        String(
          order.status || ''
        )
          .trim()
          .toUpperCase();


      // ==================================================
      // انتقالات الحالات المسموحة
      // ==================================================

      const validTransition =

        // PENDING_VERIFICATION → PROCESSING
        // PENDING_VERIFICATION → CANCELLED

        (
          currentStatus ===
            'PENDING_VERIFICATION' &&

          (
            normalizedStatus ===
              'PROCESSING' ||

            normalizedStatus ===
              'CANCELLED'
          )
        )

        ||

        // PENDING → PROCESSING
        // PENDING → CANCELLED
        //
        // أبقيناه للتوافق مع أي طلب قديم.

        (
          currentStatus ===
            'PENDING' &&

          (
            normalizedStatus ===
              'PROCESSING' ||

            normalizedStatus ===
              'CANCELLED'
          )
        )

        ||

        // PROCESSING → DELIVERED
        // PROCESSING → CANCELLED

        (
          currentStatus ===
            'PROCESSING' &&

          (
            normalizedStatus ===
              'DELIVERED' ||

            normalizedStatus ===
              'CANCELLED'
          )
        )

        ||

        // السماح بتحديث الملاحظات فقط
        // إذا كانت الحالة بالفعل DELIVERED
        // أو CANCELLED.

        (
          currentStatus ===
            normalizedStatus &&

          (
            normalizedStatus ===
              'DELIVERED' ||

            normalizedStatus ===
              'CANCELLED'
          )
        );


      if (!validTransition) {

        await client.query(
          'ROLLBACK'
        );


        return c.json({

          success: false,

          message:
            `Invalid status transition: ${currentStatus} → ${normalizedStatus}`

        }, 400);

      }


      // ==================================================
      // هل هذه أول عملية DELIVERED؟
      // ==================================================

      const isNewDelivery =
        normalizedStatus ===
          'DELIVERED' &&

        currentStatus !==
          'DELIVERED';


      // ==================================================
      // إذا كان DELIVERED بالفعل
      // لا نضيف الربح مرة ثانية.
      // ==================================================

      if (
        normalizedStatus ===
          'DELIVERED' &&

        currentStatus ===
          'DELIVERED'
      ) {

        await client.query(`

          UPDATE marketing_orders

          SET

            admin_notes =
              COALESCE(
                $1,
                admin_notes
              ),

            updated_at =
              NOW()

          WHERE id = $2

        `, [
          admin_notes,
          orderId
        ]);


        await client.query(
          'COMMIT'
        );


        return c.json({

          success: true,

          message:
            'Order is already DELIVERED. Profit was not added again.',

          order_id:
            orderId,

          status:
            'DELIVERED',

          profit_added:
            false

        });

      }


      // ==================================================
      // تنفيذ ربح المستخدم عند DELIVERED فقط
      // ==================================================

      if (isNewDelivery) {

        // ================================================
        // ربح المستخدم
        // ================================================

        const userProfit =
          Number(
            order.user_expected_profit
          );


        if (
          !Number.isFinite(
            userProfit
          ) ||
          userProfit <= 0
        ) {

          await client.query(
            'ROLLBACK'
          );


          return c.json({

            success: false,

            message:
              'Invalid user marketing profit for this order'

          }, 400);

        }


        // ================================================
        // التحقق من المستخدم وقفل السجل
        // ================================================

        const userRes =
          await client.query(`

            SELECT
              telegram_id

            FROM users

            WHERE telegram_id = $1

            FOR UPDATE

          `, [
            order.user_id
          ]);


        if (
          userRes.rows.length === 0
        ) {

          await client.query(
            'ROLLBACK'
          );


          return c.json({

            success: false,

            message:
              'Order user was not found'

          }, 404);

        }


        // ================================================
        // 1. إضافة ربح التسويق للمستخدم
        // ================================================

        const balanceRes =
          await client.query(`

            UPDATE users

            SET balance =
              COALESCE(
                balance,
                0
              ) + $1

            WHERE telegram_id = $2

            RETURNING telegram_id

          `, [
            userProfit,
            order.user_id
          ]);


        if (
          balanceRes.rows.length === 0
        ) {

          await client.query(
            'ROLLBACK'
          );


          return c.json({

            success: false,

            message:
              'Failed to add marketing profit to user balance'

          }, 500);

        }


        // ================================================
        // 2. تسجيل ربح المستخدم
        // ================================================

        await client.query(`

          INSERT INTO earnings (

            user_id,
            source,
            amount,
            description,
            created_at

          )

          VALUES (

            $1,
            'marketing_profit',
            $2,
            $3,
            NOW()

          )

        `, [

          order.user_id,

          userProfit,

          `Profit from Marketing Order #${orderId}`

        ]);


        // ================================================
        // 3. عمولة الإحالة
        //
        // النظام الجديد:
        //
        // Referral Commission = 20%
        // من ربح التسويق الخاص بالمستخدم.
        //
        // مثال:
        // ربح المستخدم = $0.50
        // عمولة الإحالة = $0.10
        // ================================================

        const referralCommission =
          Number(
            (
              userProfit * 0.20
            ).toFixed(6)
          );


        // ================================================
        // 4. البحث عن صاحب الإحالة
        // ================================================

        if (
          referralCommission > 0 &&
          Number.isFinite(
            referralCommission
          )
        ) {

          const referralRes =
            await client.query(`

              SELECT
                referrer_id

              FROM referrals

              WHERE referee_id = $1

              ORDER BY created_at ASC

              LIMIT 1

              FOR SHARE

            `, [
              order.user_id
            ]);


          if (
            referralRes.rows.length > 0
          ) {

            const referrerId =
              referralRes.rows[0]
                .referrer_id;


            // ==========================================
            // قفل حساب صاحب الإحالة
            // ==========================================

            const referrerRes =
              await client.query(`

                SELECT
                  telegram_id

                FROM users

                WHERE telegram_id = $1

                FOR UPDATE

              `, [
                referrerId
              ]);


            if (
              referrerRes.rows.length > 0
            ) {

              // ========================================
              // 5. إضافة عمولة الإحالة
              // ========================================

              const referralBalanceRes =
                await client.query(`

                  UPDATE users

                  SET

                    balance =
                      COALESCE(
                        balance,
                        0
                      ) + $1,

                    referral_earnings =
                      COALESCE(
                        referral_earnings,
                        0
                      ) + $1

                  WHERE telegram_id = $2

                  RETURNING telegram_id

                `, [

                  referralCommission,

                  referrerId

                ]);


              if (
                referralBalanceRes.rows.length === 0
              ) {

                throw new Error(
                  'Failed to add referral commission'
                );

              }


              // ========================================
              // 6. تسجيل referral_earnings
              // ========================================

              await client.query(`

                INSERT INTO referral_earnings (

                  referrer_id,
                  referee_id,
                  amount,
                  created_at

                )

                VALUES (

                  $1,
                  $2,
                  $3,
                  NOW()

                )

              `, [

                referrerId,

                order.user_id,

                referralCommission

              ]);


              // ========================================
              // 7. تسجيل العمولة في earnings
              // ========================================

              await client.query(`

                INSERT INTO earnings (

                  user_id,
                  source,
                  amount,
                  description,
                  created_at

                )

                VALUES (

                  $1,
                  'referral_bonus',
                  $2,
                  $3,
                  NOW()

                )

              `, [

                referrerId,

                referralCommission,

                `20% referral commission from Marketing Order #${orderId}`

              ]);

            }

          }

        }

      }


      // ==================================================
      // تحديث حالة الطلب
      // ==================================================

      await client.query(`

        UPDATE marketing_orders

        SET

          status = $1,

          admin_notes =
            COALESCE(
              $2,
              admin_notes
            ),

          updated_at =
            NOW()

        WHERE id = $3

      `, [

        normalizedStatus,

        admin_notes,

        orderId

      ]);


      // ==================================================
      // إنهاء Transaction
      // ==================================================

      await client.query(
        'COMMIT'
      );


      return c.json({

        success: true,

        message:
          `Order status updated to ${normalizedStatus}`,

        order_id:
          orderId,

        status:
          normalizedStatus,

        profit_added:
          isNewDelivery

      });


    } catch (err) {

      if (client) {

        try {

          await client.query(
            'ROLLBACK'
          );

        } catch (rollbackError) {

          console.error(
            '❌ Marketing order rollback error:',
            rollbackError
          );

        }

      }


      console.error(
        '❌ /api/admin/marketing/orders/:id/status:',
        err
      );


      return c.json({

        success: false,

        message:
          'Server error'

      }, 500);


    } finally {

      if (client) {
        client.release();
      }

    }

  }
);



// =====================================================
// 🏪 ADMIN - MANAGE MARKETING PROVIDERS
// =====================================================



// =====================================================
// 6. جلب جميع المنصات
// =====================================================

app.get(
  '/api/admin/marketing/providers',
  verifyAdmin,
  async (c) => {

    try {

      const result =
        await pool.query(`

          SELECT

            p.id,
            p.name,
            p.country_code,
            p.base_url,
            p.product_url_pattern,

            p.base_margin_percentage,
            p.user_profit_percentage,
            p.fixed_shipping_cost,

            p.selector_name,
            p.selector_price,
            p.selector_image,

            p.is_active,
            p.created_at,

            p.mode,

            p.api_endpoint,
            p.api_search_path,
            p.api_product_path,

            COUNT(o.id) AS total_orders,

            COALESCE(
              SUM(
                o.taskora_net_profit
              ),
              0
            ) AS total_profit

          FROM marketing_providers p

          LEFT JOIN marketing_orders o
            ON o.provider_id = p.id

          GROUP BY p.id

          ORDER BY
            p.created_at DESC

        `);


      return c.json({

        success: true,

        data:
          result.rows

      });


    } catch (err) {

      console.error(
        '❌ GET /api/admin/marketing/providers:',
        err
      );


      return c.json({

        success: false,

        message:
          'Server error'

      }, 500);

    }

  }
);



// =====================================================
// 7. إضافة منصة جديدة
//
// الأنماط:
// MANUAL
// API
//
// MANUAL:
// المتجر الحقيقي يفتح للمستخدم في تبويب جديد.
//
// API:
// المنصة يمكن ربطها لاحقًا عبر API.
// =====================================================

app.post(
  '/api/admin/marketing/providers',
  verifyAdmin,
  async (c) => {

    try {

      const {
        name,
        country_code,
        base_url,
        product_url_pattern,
        mode,
        api_endpoint,
        api_key,
        api_search_path,
        api_product_path,

        base_margin_percentage,
        user_profit_percentage,
        fixed_shipping_cost,

        selector_name,
        selector_price,
        selector_image,

        is_active

      } = await c.req.json();


      // ==================================================
      // البيانات الأساسية
      // ==================================================

      if (
        !name ||
        !country_code ||
        !base_url
      ) {

        return c.json({

          success: false,

          message:
            'Name, country, and Base URL are required'

        }, 400);

      }


      // ==================================================
      // Country Code
      // ==================================================

      const normalizedCountry =
        String(country_code)
          .trim()
          .toUpperCase();


      if (
        !/^[A-Z]{2}$/.test(
          normalizedCountry
        )
      ) {

        return c.json({

          success: false,

          message:
            'Country code must be exactly 2 letters'

        }, 400);

      }


      // ==================================================
      // Base URL
      // ==================================================

      let parsedBaseUrl;

      try {

        parsedBaseUrl =
          new URL(
            String(base_url).trim()
          );


        if (
          ![
            'http:',
            'https:'
          ].includes(
            parsedBaseUrl.protocol
          )
        ) {

          throw new Error(
            'Invalid protocol'
          );

        }

      } catch {

        return c.json({

          success: false,

          message:
            'Invalid Base URL'

        }, 400);

      }


      // ==================================================
      // Mode
      // ==================================================

      const normalizedMode =
        String(
          mode || 'MANUAL'
        )
          .trim()
          .toUpperCase();


      if (
        ![
          'MANUAL',
          'API'
        ].includes(
          normalizedMode
        )
      ) {

        return c.json({

          success: false,

          message:
            'Mode must be MANUAL or API'

        }, 400);

      }


      // ==================================================
      // النسب المالية
      //
      // نحتفظ بها في DB للتوافق مع schema الحالي.
      // ==================================================

      const margin =
        Number(
          base_margin_percentage ?? 20
        );


      const userProfit =
        Number(
          user_profit_percentage ?? 40
        );


      const shipping =
        Number(
          fixed_shipping_cost ?? 0
        );


      if (
        !Number.isFinite(margin) ||
        margin < 0 ||
        margin > 100
      ) {

        return c.json({

          success: false,

          message:
            'Invalid base margin percentage'

        }, 400);

      }


      if (
        !Number.isFinite(userProfit) ||
        userProfit < 0 ||
        userProfit > 100
      ) {

        return c.json({

          success: false,

          message:
            'Invalid user profit percentage'

        }, 400);

      }


      if (
        !Number.isFinite(shipping) ||
        shipping < 0
      ) {

        return c.json({

          success: false,

          message:
            'Invalid shipping cost'

        }, 400);

      }


      // ==================================================
      // API فقط يحتاج API Endpoint
      // ==================================================

      if (
        normalizedMode === 'API' &&
        !api_endpoint
      ) {

        return c.json({

          success: false,

          message:
            'API Endpoint is required when mode is API'

        }, 400);

      }


      // ==================================================
      // INSERT
      // ==================================================

      const result =
        await pool.query(`

          INSERT INTO marketing_providers (

            name,
            country_code,
            base_url,
            product_url_pattern,

            base_margin_percentage,
            user_profit_percentage,
            fixed_shipping_cost,

            selector_name,
            selector_price,
            selector_image,

            is_active,

            mode,

            api_endpoint,
            api_key,
            api_search_path,
            api_product_path

          )

          VALUES (

            $1,
            $2,
            $3,
            $4,

            $5,
            $6,
            $7,

            $8,
            $9,
            $10,

            $11,

            $12,

            $13,
            $14,
            $15,
            $16

          )

          RETURNING

            id,
            name,
            country_code,
            base_url,
            product_url_pattern,

            base_margin_percentage,
            user_profit_percentage,
            fixed_shipping_cost,

            selector_name,
            selector_price,
            selector_image,

            is_active,

            mode,

            api_endpoint,
            api_search_path,
            api_product_path,

            created_at

        `, [

          String(name).trim(),

          normalizedCountry,

          parsedBaseUrl.href,

          product_url_pattern
            ? String(
                product_url_pattern
              ).trim()
            : null,

          margin,

          userProfit,

          shipping,

          selector_name
            ? String(
                selector_name
              ).trim()
            : '.product-title',

          selector_price
            ? String(
                selector_price
              ).trim()
            : '.price',

          selector_image
            ? String(
                selector_image
              ).trim()
            : '.product-image img',

          is_active !== false,

          normalizedMode,

          api_endpoint
            ? String(
                api_endpoint
              ).trim()
            : null,

          api_key
            ? String(
                api_key
              ).trim()
            : null,

          api_search_path
            ? String(
                api_search_path
              ).trim()
            : null,

          api_product_path
            ? String(
                api_product_path
              ).trim()
            : null

        ]);


      return c.json({

        success: true,

        message:
          '✅ Provider added',

        data:
          result.rows[0]

      });


    } catch (err) {

      console.error(
        '❌ POST /api/admin/marketing/providers:',
        err
      );


      return c.json({

        success: false,

        message:
          'Failed to add provider'

      }, 500);

    }

  }
);



// =====================================================
// 8. تعديل منصة موجودة
// =====================================================

app.put(
  '/api/admin/marketing/providers/:id',
  verifyAdmin,
  async (c) => {

    try {

      const providerId =
        c.req.param('id');


      const {
        name,
        country_code,
        base_url,
        product_url_pattern,

        base_margin_percentage,
        user_profit_percentage,
        fixed_shipping_cost,

        selector_name,
        selector_price,
        selector_image,

        is_active,

        mode,

        api_endpoint,
        api_key,
        api_search_path,
        api_product_path

      } = await c.req.json();


      // ==================================================
      // Provider ID
      // ==================================================

      if (
        !providerId ||
        !/^\d+$/.test(
          String(providerId)
        )
      ) {

        return c.json({

          success: false,

          message:
            'Invalid provider ID'

        }, 400);

      }


      // ==================================================
      // Country
      // ==================================================

      let normalizedCountry =
        null;


      if (
        country_code !== undefined &&
        country_code !== null
      ) {

        normalizedCountry =
          String(country_code)
            .trim()
            .toUpperCase();


        if (
          !/^[A-Z]{2}$/.test(
            normalizedCountry
          )
        ) {

          return c.json({

            success: false,

            message:
              'Country code must be exactly 2 letters'

          }, 400);

        }

      }


      // ==================================================
      // Base URL
      // ==================================================

      let normalizedBaseUrl =
        null;


      if (
        base_url !== undefined &&
        base_url !== null
      ) {

        try {

          const parsedBaseUrl =
            new URL(
              String(base_url).trim()
            );


          if (
            ![
              'http:',
              'https:'
            ].includes(
              parsedBaseUrl.protocol
            )
          ) {

            throw new Error(
              'Invalid protocol'
            );

          }


          normalizedBaseUrl =
            parsedBaseUrl.href;

        } catch {

          return c.json({

            success: false,

            message:
              'Invalid Base URL'

          }, 400);

        }

      }


      // ==================================================
      // Mode
      // ==================================================

      let normalizedMode =
        null;


      if (
        mode !== undefined &&
        mode !== null
      ) {

        normalizedMode =
          String(mode)
            .trim()
            .toUpperCase();


        if (
          ![
            'MANUAL',
            'API'
          ].includes(
            normalizedMode
          )
        ) {

          return c.json({

            success: false,

            message:
              'Mode must be MANUAL or API'

          }, 400);

        }

      }


      // ==================================================
      // النسب
      // ==================================================

      const margin =

        base_margin_percentage !==
          undefined &&

        base_margin_percentage !==
          null

          ? Number(
              base_margin_percentage
            )

          : null;


      const userProfit =

        user_profit_percentage !==
          undefined &&

        user_profit_percentage !==
          null

          ? Number(
              user_profit_percentage
            )

          : null;


      const shipping =

        fixed_shipping_cost !==
          undefined &&

        fixed_shipping_cost !==
          null

          ? Number(
              fixed_shipping_cost
            )

          : null;


      if (
        margin !== null &&

        (
          !Number.isFinite(
            margin
          ) ||

          margin < 0 ||

          margin > 100
        )
      ) {

        return c.json({

          success: false,

          message:
            'Invalid base margin percentage'

        }, 400);

      }


      if (
        userProfit !== null &&

        (
          !Number.isFinite(
            userProfit
          ) ||

          userProfit < 0 ||

          userProfit > 100
        )
      ) {

        return c.json({

          success: false,

          message:
            'Invalid user profit percentage'

        }, 400);

      }


      if (
        shipping !== null &&

        (
          !Number.isFinite(
            shipping
          ) ||

          shipping < 0
        )
      ) {

        return c.json({

          success: false,

          message:
            'Invalid shipping cost'

        }, 400);

      }


      // ==================================================
      // تحديث المنصة
      // ==================================================

      const result =
        await pool.query(`

          UPDATE marketing_providers

          SET

            name =
              COALESCE(
                $2,
                name
              ),

            country_code =
              COALESCE(
                $3,
                country_code
              ),

            base_url =
              COALESCE(
                $4,
                base_url
              ),

            product_url_pattern =
              COALESCE(
                $5,
                product_url_pattern
              ),

            base_margin_percentage =
              COALESCE(
                $6,
                base_margin_percentage
              ),

            user_profit_percentage =
              COALESCE(
                $7,
                user_profit_percentage
              ),

            fixed_shipping_cost =
              COALESCE(
                $8,
                fixed_shipping_cost
              ),

            selector_name =
              COALESCE(
                $9,
                selector_name
              ),

            selector_price =
              COALESCE(
                $10,
                selector_price
              ),

            selector_image =
              COALESCE(
                $11,
                selector_image
              ),

            is_active =
              COALESCE(
                $12,
                is_active
              ),

            mode =
              COALESCE(
                $13,
                mode
              ),

            api_endpoint =
              COALESCE(
                $14,
                api_endpoint
              ),

            api_key =
              COALESCE(
                $15,
                api_key
              ),

            api_search_path =
              COALESCE(
                $16,
                api_search_path
              ),

            api_product_path =
              COALESCE(
                $17,
                api_product_path
              )

          WHERE id = $1

          RETURNING

            id,
            name,
            country_code,
            base_url,
            product_url_pattern,

            base_margin_percentage,
            user_profit_percentage,
            fixed_shipping_cost,

            selector_name,
            selector_price,
            selector_image,

            is_active,

            mode,

            api_endpoint,
            api_search_path,
            api_product_path,

            created_at

        `, [

          providerId,

          name !== undefined
            ? String(name).trim()
            : null,

          normalizedCountry,

          normalizedBaseUrl,

          product_url_pattern !==
            undefined

            ? (
                product_url_pattern
                  ? String(
                      product_url_pattern
                    ).trim()
                  : null
              )

            : null,

          margin,

          userProfit,

          shipping,

          selector_name !==
            undefined

            ? (
                selector_name
                  ? String(
                      selector_name
                    ).trim()
                  : null
              )

            : null,

          selector_price !==
            undefined

            ? (
                selector_price
                  ? String(
                      selector_price
                    ).trim()
                  : null
              )

            : null,

          selector_image !==
            undefined

            ? (
                selector_image
                  ? String(
                      selector_image
                    ).trim()
                  : null
              )

            : null,

          is_active !== undefined
            ? Boolean(is_active)
            : null,

          normalizedMode,

          api_endpoint !==
            undefined

            ? (
                api_endpoint
                  ? String(
                      api_endpoint
                    ).trim()
                  : null
              )

            : null,

          api_key !==
            undefined

            ? (
                api_key
                  ? String(
                      api_key
                    ).trim()
                  : null
              )

            : null,

          api_search_path !==
            undefined

            ? (
                api_search_path
                  ? String(
                      api_search_path
                    ).trim()
                  : null
              )

            : null,

          api_product_path !==
            undefined

            ? (
                api_product_path
                  ? String(
                      api_product_path
                    ).trim()
                  : null
              )

            : null

        ]);


      if (
        result.rows.length === 0
      ) {

        return c.json({

          success: false,

          message:
            'Provider not found'

        }, 404);

      }


      return c.json({

        success: true,

        message:
          '✅ Provider updated',

        data:
          result.rows[0]

      });


    } catch (err) {

      console.error(
        '❌ PUT /api/admin/marketing/providers/:id:',
        err
      );


      return c.json({

        success: false,

        message:
          'Failed to update provider'

      }, 500);

    }

  }
);



// =====================================================
// 9. حذف / تعطيل منصة
//
// إذا كانت المنصة مرتبطة بطلبات:
// تعطيل فقط.
//
// إذا لم تكن مرتبطة بطلبات:
// حذف كامل.
// =====================================================

app.delete(
  '/api/admin/marketing/providers/:id',
  verifyAdmin,
  async (c) => {

    try {

      const providerId =
        c.req.param('id');


      if (
        !providerId ||
        !/^\d+$/.test(
          String(providerId)
        )
      ) {

        return c.json({

          success: false,

          message:
            'Invalid provider ID'

        }, 400);

      }


      const ordersCheck =
        await pool.query(

          `

            SELECT
              COUNT(*) AS count

            FROM marketing_orders

            WHERE provider_id = $1

          `,

          [
            providerId
          ]

        );


      const ordersCount =
        parseInt(
          ordersCheck.rows[0].count,
          10
        );


      // ==================================================
      // توجد طلبات مرتبطة
      // ==================================================

      if (
        ordersCount > 0
      ) {

        await pool.query(`

          UPDATE marketing_providers

          SET
            is_active = false

          WHERE id = $1

        `, [
          providerId
        ]);


        return c.json({

          success: true,

          message:
            `⚠️ Provider disabled (has ${ordersCount} orders). Use "Activate" to restore.`

        });

      }


      // ==================================================
      // لا توجد طلبات
      // ==================================================

      await pool.query(`

        DELETE FROM marketing_providers

        WHERE id = $1

      `, [
        providerId
      ]);


      return c.json({

        success: true,

        message:
          '✅ Provider deleted'

      });


    } catch (err) {

      console.error(
        '❌ DELETE /api/admin/marketing/providers/:id:',
        err
      );


      return c.json({

        success: false,

        message:
          'Failed to delete provider'

      }, 500);

    }

  }
);



// =====================================================
// 10. اختبار الاتصال بالمنصة
//
// MANUAL:
// اختبار Base URL فقط.
//
// API:
// اختبار API Endpoint.
//
// لا يوجد Scraping في النظام الجديد.
// =====================================================

app.post(
  '/api/admin/marketing/providers/:id/test',
  verifyAdmin,
  async (c) => {

    try {

      const providerId =
        c.req.param('id');


      const body =
        await c.req
          .json()
          .catch(
            () => ({})
          );


      const providerRes =
        await pool.query(`

          SELECT

            id,
            name,
            base_url,
            mode,

            api_endpoint,
            api_search_path

          FROM marketing_providers

          WHERE id = $1

        `, [
          providerId
        ]);


      if (
        providerRes.rows.length === 0
      ) {

        return c.json({

          success: false,

          message:
            'Provider not found'

        }, 404);

      }


      const provider =
        providerRes.rows[0];


      const normalizedMode =
        String(
          provider.mode || 'MANUAL'
        )
          .trim()
          .toUpperCase();


      // ==================================================
      // API
      // ==================================================

      if (
        normalizedMode === 'API'
      ) {

        if (
          !provider.api_endpoint
        ) {

          return c.json({

            success: false,

            message:
              'API Endpoint is not configured'

          }, 400);

        }


        let apiUrl;

        try {

          apiUrl =
            new URL(
              provider.api_endpoint
            );


          if (
            ![
              'http:',
              'https:'
            ].includes(
              apiUrl.protocol
            )
          ) {

            throw new Error(
              'Invalid protocol'
            );

          }

        } catch {

          return c.json({

            success: false,

            message:
              'Invalid API Endpoint'

          }, 400);

        }


        const response =
          await fetch(
            apiUrl.href,
            {
              headers: {

                'User-Agent':
                  'Taskora-Provider-Test/1.0',

                'Accept':
                  'application/json,text/plain,*/*'

              }
            }
          );


        return c.json({

          success:
            response.ok,

          message:
            response.ok

              ? '✅ API Endpoint is reachable'

              : `❌ API connection failed: HTTP ${response.status}`,

          details: {

            mode:
              'API',

            status:
              response.status,

            endpoint:
              apiUrl.href

          }

        });

      }


      // ==================================================
      // MANUAL
      // ==================================================

      let testUrl;


      try {

        const baseUrl =
          new URL(
            provider.base_url
          );


        testUrl =
          baseUrl.href;


      } catch {

        return c.json({

          success: false,

          message:
            'Invalid provider Base URL'

        }, 400);

      }


      const response =
        await fetch(
          testUrl,
          {
            headers: {

              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',

              'Accept':
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

              'Accept-Language':
                'en-US,en;q=0.8'

            }

          }
        );


      if (
        !response.ok
      ) {

        return c.json({

          success: false,

          message:
            `❌ Connection failed: HTTP ${response.status}`

        });

      }


      return c.json({

        success: true,

        message:
          '✅ Store connection successful',

        details: {

          mode:
            'MANUAL',

          status:
            response.status,

          test_url:
            testUrl

        }

      });


    } catch (err) {

      console.error(
        '❌ Test provider error:',
        err
      );


      return c.json({

        success: false,

        message:
          'Test failed: ' +
          err.message

      }, 500);

    }

  }
);







// =====================================================================
// === نهاية ملف server.js ===
// =====================================================================
export default {
  fetch: async (request, env, ctx) => {
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {

    console.log(
      "⏰ تشغيل Cron: معالجة pending + rejected..."
    );

    // ================================================================
    // 🔐 Initialize database
    // ================================================================
    try {
      initDb(env);
    } catch (err) {
      console.error(
        "❌ Database initialization failed:",
        err
      );
      return;
    }

    // ================================================================
    // 👤 System reviewer ID
    //
    // reviewed_by is BIGINT in task_executions.
    // Therefore "auto" cannot be stored there.
    //
    // We use ADMIN_ID when available.
    // Fallback = 0 because reviewed_by has no FK constraint.
    // ================================================================
    const configuredAdminId =
      env?.ADMIN_ID?.toString().trim();

    const systemReviewerId =
      configuredAdminId &&
      /^\d+$/.test(configuredAdminId)
        ? configuredAdminId
        : "0";

    const client = await pool.connect();

    try {

      // ================================================================
      // ⏰ Time reference
      // ================================================================
      const now = new Date();

      const twentyFourHoursAgo = new Date(
        now.getTime() -
        (24 * 60 * 60 * 1000)
      );

      // ================================================================
      // ================================================================
      // 1️⃣ AUTO-APPROVE PENDING EXECUTIONS AFTER 24 HOURS
      // ================================================================
      // ================================================================

      const { rows: pendingExecutions } =
        await client.query(
          `
          SELECT
            te.id,
            te.task_id,
            te.executor_id,
            te.payment_amount,
            te.commission_amount,
            te.status,
            te.proof,
            te.submitted_at,

            t.budget,
            t.spent,
            t.deleted_at

          FROM task_executions te

          INNER JOIN tasks t
            ON t.id = te.task_id

          WHERE te.status = 'pending'
            AND te.proof IS NOT NULL
            AND te.submitted_at <= $1
            AND t.deleted_at IS NULL
          `,
          [twentyFourHoursAgo]
        );

      let autoApprovedCount = 0;

      for (const exec of pendingExecutions) {

        try {

          await client.query('BEGIN');

          // ============================================================
          // 🔒 Lock execution + task again
          // ============================================================
          const locked = await client.query(
            `
            SELECT
              te.id,
              te.task_id,
              te.executor_id,
              te.payment_amount,
              te.commission_amount,
              te.status,
              te.proof,
              te.submitted_at,

              t.budget,
              t.spent

            FROM task_executions te

            INNER JOIN tasks t
              ON t.id = te.task_id

            WHERE te.id = $1::integer
              AND t.deleted_at IS NULL

            FOR UPDATE OF te, t
            `,
            [exec.id]
          );

          if (locked.rows.length === 0) {
            await client.query('ROLLBACK');
            continue;
          }

          const execution = locked.rows[0];

          // ============================================================
          // 🔐 Verify status again after locking
          // ============================================================
          if (
            execution.status !== 'pending' ||
            !execution.proof
          ) {
            await client.query('ROLLBACK');
            continue;
          }

          // ============================================================
          // 💰 Payment calculation
          // ============================================================
          const paymentAmount = parseFloat(
            execution.payment_amount || 0
          );

          const commissionAmount = parseFloat(
  execution.commission_amount ??
  (paymentAmount * 0.20)
);

const referralCommission =
  paymentAmount * 0.05;

const totalCost =
  paymentAmount +
  commissionAmount +
  referralCommission;
          // ============================================================
          // 🔐 Validate financial values
          // ============================================================
          if (
            !Number.isFinite(paymentAmount) ||
            paymentAmount <= 0 ||
            !Number.isFinite(commissionAmount) ||
            commissionAmount < 0 ||
            !Number.isFinite(totalCost) ||
            totalCost <= 0
          ) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Invalid payment data for execution #${execution.id}`
            );

            continue;
          }

          // ============================================================
          // 💰 Verify reservation
          //
          // IMPORTANT:
          //
          // APPLY already reserved totalCost by increasing tasks.spent.
          //
          // Therefore AUTO-APPROVE must NOT do:
          //
          // spent = spent + totalCost
          //
          // because that would double-count the reservation.
          // ============================================================
          const currentSpent = parseFloat(
            execution.spent || 0
          );

          if (
            !Number.isFinite(currentSpent) ||
            currentSpent < totalCost
          ) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Insufficient reserved funds for auto-approval ` +
              `execution #${execution.id}`
            );

            continue;
          }

          // ============================================================
          // 👤 Pay executor
          // ============================================================
          const executor = await client.query(
            `
            UPDATE users
            SET balance =
              COALESCE(balance, 0) + $1
            WHERE telegram_id = $2::bigint
            RETURNING balance
            `,
            [
              paymentAmount,
              execution.executor_id
            ]
          );

          if (executor.rows.length === 0) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Executor user not found for execution #${execution.id}`
            );

            continue;
          }

          // ============================================================
          // 💰 Pay admin commission
          // ============================================================
          if (commissionAmount > 0) {

            const adminUser = await client.query(
              `
              UPDATE users
              SET balance =
                COALESCE(balance, 0) + $1
              WHERE telegram_id = $2::bigint
              RETURNING balance
              `,
              [
                commissionAmount,
                systemReviewerId
              ]
            );

            if (adminUser.rows.length === 0) {

              await client.query('ROLLBACK');

              console.error(
                `❌ Admin user not found for auto-approval ` +
                `execution #${execution.id} ` +
                `(admin_id=${systemReviewerId})`
              );

              continue;
            }
          }

          // ============================================================
          // ✅ Approve execution
          // ============================================================
          const approved = await client.query(
            `
            UPDATE task_executions
            SET
              status = 'approved',
              reviewed_at = NOW(),
              reviewed_by = $1::bigint,
              rejection_reason = NULL
            WHERE id = $2::integer
              AND status = 'pending'
            RETURNING id, status
            `,
            [
              systemReviewerId,
              execution.id
            ]
          );

          if (approved.rows.length === 0) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Execution #${execution.id} changed before auto-approval`
            );

            continue;
          }

          // ============================================================
          // 📒 Executor earning
          // ============================================================
          await client.query(
            `
            INSERT INTO earnings (
              user_id,
              source,
              amount,
              description,
              video_id,
              watched_seconds,
              created_at
            )
            VALUES (
              $1,
              'task_execution',
              $2,
              $3,
              NULL,
              NULL,
              NOW()
            )
            `,
            [
              execution.executor_id,
              paymentAmount,
              `Task #${execution.task_id} execution reward (100%)`
            ]
          );

          // ============================================================
          // 📒 Admin commission earning
          // ============================================================
          if (commissionAmount > 0) {

            await client.query(
              `
              INSERT INTO earnings (
                user_id,
                source,
                amount,
                description,
                video_id,
                watched_seconds,
                created_at
              )
              VALUES (
                $1,
                'task_commission',
                $2,
                $3,
                NULL,
                NULL,
                NOW()
              )
              `,
              [
                systemReviewerId,
                commissionAmount,
                `Commission from task #${execution.task_id} (25%)`
              ]
            );
          }

          // ============================================================
          // ✅ IMPORTANT:
          //
          // DO NOT UPDATE tasks.spent.
          //
          // The reservation already exists.
          // It is now consumed by the approved execution.
          // ============================================================

          await client.query('COMMIT');

          autoApprovedCount++;

          console.log(
            `✅ Auto-approved execution #${execution.id} ` +
            `for task #${execution.task_id} | ` +
            `reward=${paymentAmount.toFixed(6)} | ` +
            `commission=${commissionAmount.toFixed(6)}`
          );

          // ============================================================
          // 🤝 Referral commission 3%
          //
          // Keep your existing function.
          // ============================================================
          if (
            typeof distributeReferralCommission === 'function'
          ) {

            try {

              await distributeReferralCommission(
                execution.executor_id,
                paymentAmount
              );

            } catch (refErr) {

              console.error(
                `⚠️ Referral commission failed for auto-approved ` +
                `execution #${execution.id}:`,
                refErr.message
              );
            }
          }

        } catch (err) {

          try {
            await client.query('ROLLBACK');
          } catch (_) {}

          console.error(
            `❌ Auto-approve failed for execution #${exec.id}:`,
            err.message
          );
        }
      }

      // ================================================================
      // ================================================================
      // 2️⃣ FINALIZE REJECTED EXECUTIONS AFTER 24 HOURS
      // ================================================================
      // ================================================================
      //
      // rejected + rejected_at older than 24h
      //
      // means executor did NOT open a dispute.
      //
      // Therefore:
      //
      // 1. Release reservation from tasks.spent
      // 2. Keep execution status = rejected
      // 3. Clear rejected_at so frontend treats it as final
      //
      // ================================================================

      const { rows: expiredRejected } =
        await client.query(
          `
          SELECT
            te.id,
            te.task_id,
            te.executor_id,
            te.payment_amount,
            te.commission_amount,
            te.status,
            te.rejected_at,

            t.budget,
            t.spent

          FROM task_executions te

          INNER JOIN tasks t
            ON t.id = te.task_id

          WHERE te.status = 'rejected'
            AND te.rejected_at IS NOT NULL
            AND te.rejected_at <= NOW() - INTERVAL '24 hours'
            AND t.deleted_at IS NULL
          `
        );

      let finalizedRejectedCount = 0;
      let releasedTotal = 0;

      for (const exec of expiredRejected) {

        try {

          await client.query('BEGIN');

          // ============================================================
          // 🔒 Lock execution + task
          // ============================================================
          const locked = await client.query(
            `
            SELECT
              te.id,
              te.task_id,
              te.payment_amount,
              te.commission_amount,
              te.status,
              te.rejected_at,

              t.budget,
              t.spent

            FROM task_executions te

            INNER JOIN tasks t
              ON t.id = te.task_id

            WHERE te.id = $1::integer

            FOR UPDATE OF te, t
            `,
            [exec.id]
          );

          if (locked.rows.length === 0) {
            await client.query('ROLLBACK');
            continue;
          }

          const execution = locked.rows[0];

          // ============================================================
          // 🔐 Verify rejection is still eligible
          // ============================================================
          if (
            execution.status !== 'rejected' ||
            !execution.rejected_at
          ) {
            await client.query('ROLLBACK');
            continue;
          }

          // ============================================================
          // ⏰ Verify 24 hours again
          // ============================================================
          const rejectedAt = new Date(
            execution.rejected_at
          );

          const deadline = new Date(
            rejectedAt.getTime() +
            (24 * 60 * 60 * 1000)
          );

          if (new Date() < deadline) {
            await client.query('ROLLBACK');
            continue;
          }

          // ============================================================
          // 💰 Calculate reserved amount
          // ============================================================
          const paymentAmount = parseFloat(
            execution.payment_amount || 0
          );

         const commissionAmount = parseFloat(
  execution.commission_amount ??
  (paymentAmount * 0.20)
);

const referralCommission =
  paymentAmount * 0.05;

const totalCost =
  paymentAmount +
  commissionAmount +
  referralCommission;

          if (
            !Number.isFinite(paymentAmount) ||
            paymentAmount <= 0 ||
            !Number.isFinite(commissionAmount) ||
            commissionAmount < 0 ||
            !Number.isFinite(totalCost) ||
            totalCost <= 0
          ) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Invalid reserved amount for expired ` +
              `rejected execution #${execution.id}`
            );

            continue;
          }

          // ============================================================
          // 🔐 Verify reservation exists
          // ============================================================
          const currentSpent = parseFloat(
            execution.spent || 0
          );

          if (
            !Number.isFinite(currentSpent) ||
            currentSpent < totalCost
          ) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Reserved funds insufficient for expired ` +
              `rejected execution #${execution.id}`
            );

            continue;
          }

          // ============================================================
          // 🔓 Release reservation
          //
          // IMPORTANT:
          // The money returns to TASK AVAILABLE BUDGET.
          //
          // We do NOT:
          //
          // users.balance += totalCost
          //
          // ============================================================
          const released = await client.query(
            `
            UPDATE tasks
            SET spent =
              COALESCE(spent, 0) - $1
            WHERE id = $2::integer
              AND COALESCE(spent, 0) >= $1
            RETURNING
              id,
              budget,
              spent
            `,
            [
              totalCost,
              execution.task_id
            ]
          );

          if (released.rows.length === 0) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Failed to release reservation for ` +
              `execution #${execution.id}`
            );

            continue;
          }

          // ============================================================
          // ✅ Make rejection FINAL
          //
          // Keep:
          // status = rejected
          //
          // Clear:
          // rejected_at
          //
          // This tells frontend that the 24-hour dispute
          // window has ended.
          // ============================================================
          const finalized = await client.query(
            `
            UPDATE task_executions
            SET
              rejected_at = NULL
            WHERE id = $1::integer
              AND status = 'rejected'
            RETURNING
              id,
              status
            `,
            [execution.id]
          );

          if (finalized.rows.length === 0) {

            await client.query('ROLLBACK');

            console.error(
              `❌ Failed to finalize rejected execution #${execution.id}`
            );

            continue;
          }

          await client.query('COMMIT');

          finalizedRejectedCount++;
          releasedTotal += totalCost;

          console.log(
            `✅ Final rejected execution #${execution.id} | ` +
            `task #${execution.task_id} | ` +
            `released=${totalCost.toFixed(6)}`
          );

        } catch (err) {

          try {
            await client.query('ROLLBACK');
          } catch (_) {}

          console.error(
            `❌ Rejected cleanup failed for execution #${exec.id}:`,
            err.message
          );
        }
      }

            // ============================================================
      // 🧹 TASKORA SAFE DATABASE CLEANUP
      // إضافة مستقلة - لا تعدل نظام الموافقة التلقائية الحالي
      // ============================================================

      try {
        await client.query('BEGIN');

        // ============================================================
        // 1️⃣ إنشاء قائمة مؤقتة للمستخدمين الآمن حذفهم
        //
        // الشروط:
        // - غير نشط لمدة 60 يومًا
        // - الرصيد = صفر
        // - لا يوجد سحب pending
        // - لا يوجد إيداع pending
        // - لا يوجد بيع pending
        // - لا توجد أسهم نشطة
        // - لا توجد holdings غير مسوّاة
        // - لا توجد task execution pending
        // - لا يوجد open dispute
        // ============================================================

        await client.query(`
          CREATE TEMP TABLE cleanup_users (
            telegram_id BIGINT PRIMARY KEY
          ) ON COMMIT DROP
        `);

        await client.query(`
          INSERT INTO cleanup_users (telegram_id)
          SELECT u.telegram_id
          FROM users u
          WHERE u.telegram_id IS NOT NULL
            AND u.last_login_at < NOW() - INTERVAL '60 days'
            AND COALESCE(u.balance, 0) <= 0

            AND NOT EXISTS (
              SELECT 1
              FROM withdrawals w
              WHERE w.user_id = u.telegram_id
                AND LOWER(COALESCE(w.status, '')) = 'pending'
            )

            AND NOT EXISTS (
              SELECT 1
              FROM deposit_requests d
              WHERE d.user_id = u.telegram_id
                AND LOWER(COALESCE(d.status, '')) = 'pending'
            )

            AND NOT EXISTS (
              SELECT 1
              FROM pending_sales ps
              WHERE ps.user_id = u.telegram_id
                AND ps.status = 'pending'
            )

            AND NOT EXISTS (
              SELECT 1
              FROM user_stocks us
              WHERE us.telegram_id = u.telegram_id
                AND COALESCE(us.stocks, 0) > 0
            )

            AND NOT EXISTS (
              SELECT 1
              FROM stock_holdings sh
              WHERE sh.telegram_id = u.telegram_id
                AND COALESCE(sh.quantity, 0) > COALESCE(sh.sold, 0)
            )

            AND NOT EXISTS (
              SELECT 1
              FROM task_executions te
              WHERE te.executor_id = u.telegram_id
                AND LOWER(COALESCE(te.status, '')) = 'pending'
            )

            AND NOT EXISTS (
              SELECT 1
              FROM task_disputes td
              JOIN task_executions te
                ON te.id = td.execution_id
              WHERE te.executor_id = u.telegram_id
                AND LOWER(COALESCE(td.status, '')) = 'open'
            )
        `);

        const cleanupUserCount = await client.query(`
          SELECT COUNT(*)::int AS count
          FROM cleanup_users
        `);

        // ============================================================
        // 2️⃣ حذف task_disputes أولًا
        // مهم بسبب:
        // task_disputes.execution_id -> task_executions.id
        // ============================================================

        await client.query(`
          DELETE FROM task_disputes td
          USING task_executions te, cleanup_users cu
          WHERE td.execution_id = te.id
            AND te.executor_id = cu.telegram_id
        `);

        // ============================================================
        // 3️⃣ حذف task_executions
        // ============================================================

        await client.query(`
          DELETE FROM task_executions te
          USING cleanup_users cu
          WHERE te.executor_id = cu.telegram_id
        `);

        // ============================================================
        // 4️⃣ حذف بيانات المستخدم المرتبطة
        // ============================================================

        await client.query(`
          DELETE FROM task_proofs tp
          USING cleanup_users cu
          WHERE tp.user_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM user_tasks ut
          USING cleanup_users cu
          WHERE ut.user_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM user_videos uv
          USING cleanup_users cu
          WHERE uv.user_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM watched_videos wv
          USING cleanup_users cu
          WHERE wv.user_id::text = cu.telegram_id::text
        `);

        await client.query(`
          DELETE FROM daily_rewards dr
          USING cleanup_users cu
          WHERE dr.user_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM new_user_bonuses nb
          USING cleanup_users cu
          WHERE nb.user_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM earnings e
          USING cleanup_users cu
          WHERE e.user_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM admin_messages am
          USING cleanup_users cu
          WHERE am.user_id = cu.telegram_id
        `);

        // ============================================================
        // referrals
        // ============================================================

        await client.query(`
          DELETE FROM referral_earnings re
          USING cleanup_users cu
          WHERE re.referrer_id = cu.telegram_id
             OR re.referee_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM referrals r
          USING cleanup_users cu
          WHERE r.referrer_id = cu.telegram_id
             OR r.referee_id = cu.telegram_id
        `);

        // ============================================================
        // لا يتم حذف pending_sales
        // لأن المستخدم المؤهل للحذف تم التأكد مسبقًا أنه لا يملك pending
        //
        // أي سجل قديم غير pending سيتم الاحتفاظ به هنا
        // حتى لا نحذف عملية مالية دون سياسة مستقلة.
        // ============================================================

        // ============================================================
        // stock
        // المستخدم المؤهل لا يملك holdings نشطة أو stocks نشطة
        // لكن يتم حذف سجلاته بعد التأكد من التسوية.
        // ============================================================

        await client.query(`
          DELETE FROM stock_holdings sh
          USING cleanup_users cu
          WHERE sh.telegram_id = cu.telegram_id
            AND COALESCE(sh.quantity, 0) <= COALESCE(sh.sold, 0)
        `);

        await client.query(`
          DELETE FROM stock_transactions st
          USING cleanup_users cu
          WHERE st.telegram_id = cu.telegram_id
        `);

        await client.query(`
          DELETE FROM user_stocks us
          USING cleanup_users cu
          WHERE us.telegram_id = cu.telegram_id
            AND COALESCE(us.stocks, 0) <= 0
        `);

        // ============================================================
        // withdrawals / deposits
        //
        // لا يمكن وجود pending بسبب شرط المستخدم أعلاه.
        // لكن سنحذف فقط السجلات القديمة أكثر من 6 أشهر.
        // ============================================================

        await client.query(`
          DELETE FROM withdrawals w
          USING cleanup_users cu
          WHERE w.user_id = cu.telegram_id
            AND w.requested_at < NOW() - INTERVAL '6 months'
            AND LOWER(COALESCE(w.status, '')) <> 'pending'
        `);

        await client.query(`
          DELETE FROM deposit_requests d
          USING cleanup_users cu
          WHERE d.user_id = cu.telegram_id
            AND d.created_at < NOW() - INTERVAL '6 months'
            AND LOWER(COALESCE(d.status, '')) <> 'pending'
        `);

        // ============================================================
        // 5️⃣ حذف المستخدم نفسه
        // ============================================================

        const deletedUsers = await client.query(`
          DELETE FROM users u
          USING cleanup_users cu
          WHERE u.telegram_id = cu.telegram_id
        `);

        // ============================================================
        // 6️⃣ تنظيف watched_videos
        // الاحتفاظ لمدة 60 يومًا
        // ============================================================

        const deletedWatchedVideos = await client.query(`
          DELETE FROM watched_videos
          WHERE watched_at < NOW() - INTERVAL '60 days'
        `);

        // ============================================================
        // 7️⃣ تنظيف daily_rewards
        // الاحتفاظ لمدة 60 يومًا
        // ============================================================

        const deletedDailyRewards = await client.query(`
          DELETE FROM daily_rewards
          WHERE created_at < NOW() - INTERVAL '60 days'
        `);

        // ============================================================
        // 8️⃣ تنظيف earnings
        // الاحتفاظ لمدة 60 يومًا
        //
        // الرصيد الفعلي محفوظ في users.balance
        // ============================================================

        const deletedEarnings = await client.query(`
          DELETE FROM earnings
          WHERE created_at < NOW() - INTERVAL '60 days'
        `);

        // ============================================================
// 9️⃣ تنظيف Quiz Question Sessions
// الاحتفاظ لمدة 30 يومًا
// ============================================================

const deletedQuizQuestionSessions = await client.query(`
  DELETE FROM quiz_question_sessions
  WHERE created_at < NOW() - INTERVAL '30 days'
`);

// ============================================================
// 🔟 تنظيف Quiz Reward Sessions
// الاحتفاظ لمدة 30 يومًا
// ============================================================

const deletedQuizRewardSessions = await client.query(`
  DELETE FROM quiz_reward_sessions
  WHERE created_at < NOW() - INTERVAL '30 days'
`);
        // ============================================================
        // 9️⃣ تنظيف deposits
        // بعد 6 أشهر
        // pending لا يُحذف
        // ============================================================

        const deletedDeposits = await client.query(`
          DELETE FROM deposit_requests
          WHERE created_at < NOW() - INTERVAL '6 months'
            AND LOWER(COALESCE(status, '')) <> 'pending'
        `);

        // ============================================================
        // 🔟 تنظيف withdrawals
        // بعد 6 أشهر
        // pending لا يُحذف
        // ============================================================

        const deletedWithdrawals = await client.query(`
          DELETE FROM withdrawals
          WHERE requested_at < NOW() - INTERVAL '6 months'
            AND LOWER(COALESCE(status, '')) <> 'pending'
        `);

        // ============================================================
        // 1️⃣1️⃣ تنظيف stock_transactions
        // بعد 12 شهرًا
        // ============================================================

        const deletedStockTransactions = await client.query(`
          DELETE FROM stock_transactions
          WHERE created_at < NOW() - INTERVAL '12 months'
        `);

        // ============================================================
        // 1️⃣2️⃣ تنظيف بيانات المهام المحذوفة
        //
        // task_disputes أولًا بسبب FK
        // لا نحذف open disputes
        // ============================================================

        const deletedOldDisputes = await client.query(`
          DELETE FROM task_disputes td
          USING task_executions te, tasks t
          WHERE td.execution_id = te.id
            AND te.task_id = t.id
            AND t.deleted_at IS NOT NULL
            AND t.deleted_at < NOW() - INTERVAL '60 days'
            AND LOWER(COALESCE(td.status, '')) <> 'open'
        `);

        // ============================================================
        // task_executions
        // لا نحذف pending
        // ولا نحذف execution لديها open dispute
        // ============================================================

        const deletedOldExecutions = await client.query(`
          DELETE FROM task_executions te
          USING tasks t
          WHERE te.task_id = t.id
            AND t.deleted_at IS NOT NULL
            AND t.deleted_at < NOW() - INTERVAL '60 days'
            AND LOWER(COALESCE(te.status, '')) <> 'pending'

            AND NOT EXISTS (
              SELECT 1
              FROM task_disputes td
              WHERE td.execution_id = te.id
                AND LOWER(COALESCE(td.status, '')) = 'open'
            )
        `);

        // ============================================================
        // task_proofs للمهام المحذوفة
        // ============================================================

        const deletedOldProofs = await client.query(`
          DELETE FROM task_proofs tp
          USING tasks t
          WHERE tp.task_id = t.id
            AND t.deleted_at IS NOT NULL
            AND t.deleted_at < NOW() - INTERVAL '60 days'
        `);

        // ============================================================
        // user_tasks للمهام المحذوفة
        // ============================================================

        const deletedOldUserTasks = await client.query(`
          DELETE FROM user_tasks ut
          USING tasks t
          WHERE ut.task_id = t.id
            AND t.deleted_at IS NOT NULL
            AND t.deleted_at < NOW() - INTERVAL '60 days'
        `);

        // ============================================================
        // Commit
        // ============================================================

        await client.query('COMMIT');

        console.log('🧹 ========================================');
        console.log('🧹 TASKORA DATABASE CLEANUP COMPLETED');
        console.log('🧹 ========================================');

        console.log(
          `👤 Users deleted: ${deletedUsers.rowCount} / Safe candidates: ${cleanupUserCount.rows[0].count}`
        );

        console.log(
          `🎬 watched_videos deleted: ${deletedWatchedVideos.rowCount}`
        );

        console.log(
          `🎁 daily_rewards deleted: ${deletedDailyRewards.rowCount}`
        );

        console.log(
          `💰 earnings deleted: ${deletedEarnings.rowCount}`
        );

        console.log(
          `📥 deposits deleted: ${deletedDeposits.rowCount}`
        );

        console.log(
          `📤 withdrawals deleted: ${deletedWithdrawals.rowCount}`
        );

        console.log(
          `📈 stock_transactions deleted: ${deletedStockTransactions.rowCount}`
        );

        console.log(
          `⚖️ old resolved disputes deleted: ${deletedOldDisputes.rowCount}`
        );

        console.log(
          `📋 old task executions deleted: ${deletedOldExecutions.rowCount}`
        );

        console.log(
          `📎 old task proofs deleted: ${deletedOldProofs.rowCount}`
        );

        console.log(
          `📝 old user tasks deleted: ${deletedOldUserTasks.rowCount}`
        );

      } catch (cleanupError) {

        try {
          await client.query('ROLLBACK');
        } catch (_) {
          // لا نفعل شيئًا هنا لأن العملية قد تكون انتهت بالفعل
        }

        console.error(
          '❌ TASKORA DATABASE CLEANUP ERROR:',
          cleanupError
        );
      }

      // ============================================================
      // END SAFE DATABASE CLEANUP
      // ============================================================
      // ================================================================
      // 📊 Final Cron summary
      // ================================================================
      console.log(
        `⏰ Cron completed | ` +
        `autoApproved=${autoApprovedCount} | ` +
        `finalizedRejected=${finalizedRejectedCount} | ` +
        `released=${releasedTotal.toFixed(6)}`
      );

    } catch (err) {

      console.error(
        '❌ Scheduled task error:',
        err.message
      );

    } finally {
      client.release();
    }
  }
};
