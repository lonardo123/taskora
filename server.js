require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcrypt');

const { pool } = require('./db');

const app = express();

/* مهم جدا */

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// =======================
// معالج المبيعات المؤجلة (Pending Sales Processor)
// =======================
setInterval(async () => {
  try {
    const now = new Date();

    const { rows } = await pool.query(
      `SELECT id, user_id, amount
       FROM pending_sales
       WHERE status = 'pending'
       AND release_date <= $1`,
      [now]
    );

    for (const sale of rows) {

      // 1️⃣ نحاول تغيير الحالة أولًا
      const result = await pool.query(
        `UPDATE pending_sales
         SET status = 'done'
         WHERE id = $1 AND status = 'pending'`,
        [sale.id]
      );

      // 2️⃣ لو التغيير تم فعلاً → نضيف الرصيد
      if (result.rowCount === 1) {
        await pool.query(
          `UPDATE users
           SET balance = balance + $1
           WHERE telegram_id = $2`,
          [sale.amount, sale.user_id]
        );
      }
    }

  } catch (err) {
    console.error("Pending sales processor error:", err);
  }
}, 60 * 1000); // كل دقيقة

// التقاط أي أخطاء لاحقة في الـ pool
pool.on('error', (err) => {
  console.error('⚠️ PG pool error:', err);
});

// === السيرفر (Express)
app.use(express.static(path.join(__dirname, "public")));

// ✅ هذا هو المسار الصحيح لإضافة كروم
app.get('/worker/start', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/worker/start.html'));
});

// 🧠 لتخزين آخر رسالة سيرفر مؤقتًا
let currentMessage = null;

// 🧩 1. Endpoint لإرسال أمر من السيرفر (مثلاً عبر لوحة التحكم أو API)
app.post("/api/server/send", (req, res) => {
  const { action, data } = req.body;
  if (!action) {
    return res.status(400).json({ status: "error", message: "action required" });
  }
  currentMessage = { action, data: data || {}, time: new Date().toISOString() };
  console.log("📨 تم تعيين رسالة جديدة إلى الإضافة:", currentMessage);
  res.json({ status: "ok", message: currentMessage });
});

// 🧩 2. Endpoint تطلبه الإضافة بشكل دوري (Polling)
app.get("/api/worker/message", (req, res) => {
  if (currentMessage) {
    res.json(currentMessage);
    // إعادة تعيين الرسالة حتى لا تتكرر
    currentMessage = null;
  } else {
    res.json({ action: "NONE" });
  }
});
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

async function getOrCreateUser(client, telegram_id) {
  // جلب المستخدم
  let userQ = await client.query(
    'SELECT id, balance FROM users WHERE telegram_id = $1',
    [telegram_id]
  );

  // إذا لم يوجد، إنشاء المستخدم
  if (!userQ.rows.length) {
    userQ = await client.query(
      'INSERT INTO users (telegram_id, balance) VALUES ($1, 0) RETURNING id, balance',
      [telegram_id]
    );
  }

  return {
    userDbId: userQ.rows[0].id,
    balance: Number(userQ.rows[0].balance)
  };
}

// ======================= API: جلب بيانات الاستثمار =======================
app.get('/api/investment-data', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.json({ status: "error", message: "user_id is required" });
    }

    const settingsQ = await pool.query(`
      SELECT price, admin_fee_fixed, admin_fee_percent
      FROM stock_settings
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (!settingsQ.rows.length) {
      return res.json({ status: "error", message: "Stock price is not set" });
    }

    const userQ = await pool.query(
      `SELECT balance FROM users WHERE telegram_id = $1`,
      [user_id]
    );

    if (!userQ.rows.length) {
      await pool.query(
        `INSERT INTO users (telegram_id, balance) VALUES ($1, 0)`,
        [user_id]
      );
    }

    const stocksQ = await pool.query(
      `SELECT stocks FROM user_stocks WHERE telegram_id = $1`,
      [user_id]
    );

    res.json({
      status: "success",
      data: {
        price: Number(settingsQ.rows[0].price),
        balance: Number(userQ.rows[0]?.balance || 0),
        stocks: Number(stocksQ.rows[0]?.stocks || 0),
        admin_fee_fixed: Number(settingsQ.rows[0].admin_fee_fixed),
        admin_fee_percent: Number(settingsQ.rows[0].admin_fee_percent)
      }
    });

  } catch (err) {
    console.error(err);
    res.json({ status: "error", message: "Error loading investment data" });
  }
});

// ======================= شراء الأسهم =======================
app.post('/api/buy-stock', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, quantity } = req.body;
    if (!user_id || quantity <= 0) {
      return res.json({ status: "error", message: "Invalid data" });
    }

    await client.query('BEGIN');
    // =======================
// 1️⃣ جلب الحد الأقصى للشراء
// =======================
const maxQ = await client.query(`
  SELECT max_buy
  FROM stock_limits
  ORDER BY updated_at DESC
  LIMIT 1
`);
const maxBuy = maxQ.rows[0]?.max_buy || 0;

// =======================
// 2️⃣ جلب أسهم المستخدم الحالية
// =======================
const userStocksQ = await client.query(`
  SELECT stocks
  FROM user_stocks
  WHERE telegram_id = $1
  FOR UPDATE
`, [user_id]);

const currentStocks = userStocksQ.rows[0]?.stocks || 0;

if (currentStocks + quantity > maxBuy) {
  await client.query('ROLLBACK');
  return res.json({
    status: "error",
    message: "❌ Max limit exceeded"
  });
}

// =======================
// 3️⃣ جلب الأسهم المتاحة إجمالاً
// =======================
const globalQ = await client.query(`
  SELECT total_stocks
  FROM stock_global
  WHERE id = 1
  FOR UPDATE
`);

const availableStocks = globalQ.rows[0].total_stocks;

if (quantity > availableStocks) {
  await client.query('ROLLBACK');
  return res.json({
    status: "error",
    message: "❌ Not enough Units available"
  });
}

    const userQ = await client.query(
      `SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`,
      [user_id]
    );

    const balance = Number(userQ.rows[0]?.balance || 0);

    const priceQ = await client.query(`
      SELECT price, admin_fee_fixed, admin_fee_percent
      FROM stock_settings
      ORDER BY updated_at DESC LIMIT 1
    `);

    const price = Number(priceQ.rows[0].price);
    const fixedFee = Number(priceQ.rows[0].admin_fee_fixed);
    const percentFee = Number(priceQ.rows[0].admin_fee_percent);

    const subtotal = price * quantity;
    const fee = fixedFee + (subtotal * percentFee / 100);
    const total = subtotal + fee;

    if (balance < total) {
      await client.query('ROLLBACK');
      return res.json({ status: "error", message: "Insufficient balance" });
    }

    await client.query(
      `UPDATE users SET balance = balance - $1 WHERE telegram_id = $2`,
      [total, user_id]
    );

    await client.query(`
      INSERT INTO user_stocks (telegram_id, stocks)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id)
      DO UPDATE SET stocks = user_stocks.stocks + $2
    `, [user_id, quantity]);

    // خصم الأسهم من المخزون العام
await client.query(`
  UPDATE stock_global
  SET total_stocks = total_stocks - $1
  WHERE id = 1
`, [quantity]);

    await client.query(`
      INSERT INTO stock_transactions
      (telegram_id, type, quantity, price, fee, total)
      VALUES ($1, 'BUY', $2, $3, $4, $5)
    `, [user_id, quantity, price, fee, total]);

    // =======================
// تسجيل دفعة شراء مقفولة 15 يوم
// =======================
await client.query(`
  INSERT INTO stock_holdings
  (telegram_id, quantity, bought_at, unlock_at)
  VALUES ($1, $2, NOW(), NOW() + INTERVAL '15 days')
`, [user_id, quantity]);

    await client.query('COMMIT');

    res.json({ status: "success", message: "completed" });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ status: "error", message: "failed" });
  } finally {
    client.release();
  }
});


// ======================= بيع الأسهم =======================
app.post('/api/sell-stock', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, quantity } = req.body;
    if (!user_id || quantity <= 0) {
      return res.json({ status: "error", message: "Invalid data" });
    }

    await client.query('BEGIN');
    // =======================
// حساب الأسهم المتاحة للبيع فقط
// =======================
const unlockedQ = await client.query(`
  SELECT COALESCE(SUM(quantity - sold), 0) AS available
  FROM stock_holdings
  WHERE telegram_id = $1
    AND unlock_at <= NOW()
`, [user_id]);

const sellableStocks = Number(unlockedQ.rows[0].available);

if (sellableStocks < quantity) {
  await client.query('ROLLBACK');
  return res.json({
    status: "error",
    message: "❌ You can Release Units only after 15 days"
  });
}
// =======================
// خصم الأسهم من دفعات الشراء (FIFO)
// =======================
let remainingToSell = quantity;

// جلب الدفعات القابلة للبيع
const batchesQ = await client.query(`
  SELECT id, quantity, sold
  FROM stock_holdings
  WHERE telegram_id = $1
    AND unlock_at <= NOW()
    AND quantity > sold
  ORDER BY bought_at ASC
  FOR UPDATE
`, [user_id]);

for (const batch of batchesQ.rows) {
  if (remainingToSell <= 0) break;

  const canSell = batch.quantity - batch.sold;
  const sellNow = Math.min(canSell, remainingToSell);

  await client.query(`
    UPDATE stock_holdings
    SET sold = sold + $1
    WHERE id = $2
  `, [sellNow, batch.id]);

  remainingToSell -= sellNow;
}

    // =======================
// إعادة الأسهم للمخزون العام
// =======================
await client.query(`
  UPDATE stock_global
  SET total_stocks = total_stocks + $1
  WHERE id = 1
`, [quantity]);

    const userQ = await client.query(
      `SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`,
      [user_id]
    );

    if (!userQ.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ status: "error", message: "User not found" });
    }

    const stockQ = await client.query(
      `SELECT stocks FROM user_stocks WHERE telegram_id = $1 FOR UPDATE`,
      [user_id]
    );

    if (!stockQ.rows.length || stockQ.rows[0].stocks < quantity) {
      await client.query('ROLLBACK');
      return res.json({ status: "error", message: "Insufficient Units" });
    }

    const priceQ = await client.query(`
      SELECT price, admin_fee_fixed, admin_fee_percent
      FROM stock_settings
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    const price = Number(priceQ.rows[0].price);
    const fixedFee = Number(priceQ.rows[0].admin_fee_fixed);
    const percentFee = Number(priceQ.rows[0].admin_fee_percent);

    const gross = price * quantity;
    const fee = fixedFee + (gross * percentFee / 100);
    const total = gross - fee;

    // =======================
// حجز مبلغ البيع لمدة 5 أيام
// =======================
const sellDate = new Date();
const releaseDate = new Date(sellDate);
releaseDate.setDate(releaseDate.getDate() + 5);

await client.query(
  `INSERT INTO pending_sales
   (user_id, amount, sell_date, release_date)
   VALUES ($1, $2, $3, $4)`,
  [user_id, total, sellDate, releaseDate]
);

    await client.query(
      `UPDATE user_stocks SET stocks = stocks - $1 WHERE telegram_id = $2`,
      [quantity, user_id]
    );

    await client.query(`
      INSERT INTO stock_transactions
      (telegram_id, type, quantity, price, fee, total)
      VALUES ($1, 'SELL', $2, $3, $4, $5)
    `, [user_id, quantity, price, fee, total]);

    await client.query('COMMIT');

    res.json({ status: "success", message: "units Release successfully" });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ status: "error", message: "failed" });
  } finally {
    client.release();
  }
});

// ======================= سجل الصفقات =======================
app.get('/api/transactions', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.json({ status: "error", message: "user_id is required" });
    }

    const q = await pool.query(`
      SELECT type, quantity, price, fee, total, created_at
      FROM stock_transactions
      WHERE telegram_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [user_id]);

    res.json({
      status: "success",
      data: q.rows.map(r => ({
        type: r.type,
        quantity: Number(r.quantity),
        price: Number(r.price),
        fee: Number(r.fee),
        total: Number(r.total),
        date: r.created_at
      }))
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "Failed to load investment data" });
  }
});
// ================= الأسهم المقفولة والمتاحة للمستخدم ======================
app.get('/api/my-stock-locks', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ message: "user_id is required" });
  }

  const q = await pool.query(`
    SELECT
      quantity,
      sold,
      bought_at,
      unlock_at,
      (quantity - sold) AS remaining,
      unlock_at > NOW() AS locked
    FROM stock_holdings
    WHERE telegram_id = $1
    ORDER BY bought_at DESC
  `, [user_id]);

  res.json(q.rows);
});

// ======================= الرسم البياني =======================
app.get('/api/stock-chart', async (req, res) => {
  try {
    // 🔹 نجلب أحدث 15 سجل أولاً (من الأحدث للأقدم)
    const q = await pool.query(`
      SELECT price, updated_at
      FROM stock_settings
      ORDER BY updated_at DESC
      LIMIT 15
    `);

    // 🔹 نعكس الترتيب ليظهر في الشارت من الأقدم للأحدث (تسلسل زمني صحيح)
    const reversedRows = q.rows.reverse();

    // ✅ تم الإصلاح: إضافة مفتاح data: قبل .map
    res.json({
      status: "success",
      data: reversedRows.map(r => ({
        price: Number(r.price),
        date: r.updated_at
      }))
    });
  } catch (err) {
    console.error('❌ خطأ في /api/stock-chart:', err.message);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to load chart data"
    });
  }
});


// ======================= تحديث السعر من الادمن =======================
app.post('/api/admin/update-price', async (req, res) => {
  try {
    const { new_price, admin_fee_fixed = 0.05, admin_fee_percent = 3 } = req.body;
    
    if (!new_price || new_price <= 0) {
      return res.status(400).json({ 
        status: "error", 
        message: "Invalid price" 
      });
    }

    // ➕ إضافة السجل الجديد
    await pool.query(`
      INSERT INTO stock_settings (price, admin_fee_fixed, admin_fee_percent, updated_at)
      VALUES ($1, $2, $3, NOW())
    `, [new_price, admin_fee_fixed, admin_fee_percent]);

    // 🗑️ حذف السجلات القديمة والاحتفاظ بآخر 15 فقط
    await pool.query(`
      DELETE FROM stock_settings 
      WHERE id NOT IN (
        SELECT id FROM stock_settings 
        ORDER BY updated_at DESC 
        LIMIT 15
      )
    `);

    // ✅ تم الإصلاح: إضافة مفتاح data: قبل الكائن
    res.json({
      status: "success",
      message: "✅ Price updated successfully",
      data: { price: new_price }
    });

  } catch (err) {
    console.error('❌ خطأ في تحديث السعر:', err.message);
    res.status(500).json({ 
      status: "error", 
      message: "فشل التحديث" 
    });
  }
});
// ======================= صفحة الاستثمار =======================
app.get('/investment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'investment.html'));
}); 
  
// ======================= إجمالي الأسهم لجميع المستخدمين =======================
app.get('/api/total-stocks', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT COALESCE(SUM(stocks), 0) AS total_stocks
      FROM user_stocks
    `);

    res.json({
      status: "success",
      total_stocks: Number(q.rows[0].total_stocks)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Failed to load total stocks"
    });
  }
});


// ===========================================
// ✅ مسار التحقق من العامل (Worker Verification)
// ===========================================
app.all("/api/worker/verification/", (req, res) => {
  // دعم GET و POST مع رد ثابت يطمئن الإضافة
  res.status(200).json({
    ok: true,
    status: "verified",
    method: req.method,
    server_time: new Date().toISOString()
  });
});

app.get('/api/user/profile', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({
      status: "error",
      message: "user_id is required"
    });
  }
  try {
    const result = await pool.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );
    if (result.rows.length > 0) {
      const user = result.rows[0];
      return res.json({
        status: "success",
        data: {
          user_id: user.telegram_id.toString(),
          fullname: `User ${user.telegram_id}`,
          balance: parseFloat(user.balance),
          membership: "Free"
        }
      });
    } else {
      // إنشاء مستخدم جديد برصيد 0
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, 0]
      );
      return res.json({
        status: "success",
        data: {
          user_id: user_id.toString(),
          fullname: `User ${user_id}`,
          balance: 0.0,
          membership: "Free"
        }
      });
    }
  } catch (err) {
    console.error('Error in /api/user/profile:', err);
    return res.status(500).json({
      status: "error",
      message: "Server error"
    });
  }
});



app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! Postback جاهز.');
});

app.post('/api/add-video', async (req, res) => {
  const { user_id, title, video_url, duration_seconds, keywords } = req.body;
  if (!user_id || !title || !video_url || !duration_seconds) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const duration = parseInt(duration_seconds, 10);
  if (isNaN(duration) || duration < 50) {
    return res.status(400).json({ error: 'المدة يجب أن تكون 50 ثانية على الأقل' });
  }
  // تكلفة نشر الفيديو
  const cost = duration * 0.00002;
  try {
    // تحقق عدد فيديوهات المستخدم (حد أقصى 4)
    const countRes = await pool.query('SELECT COUNT(*) AS cnt FROM user_videos WHERE user_id = $1', [user_id]);
    const existingCount = parseInt(countRes.rows[0].cnt, 10);
    if (existingCount >= 4) {
      return res.status(400).json({ error: 'وصلت للحد الأقصى (4) من الفيديوهات. احذف فيديوًا قبل إضافة آخر.' });
    }
    // جلب رصيد المستخدم
    const user = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }
    if (parseFloat(user.rows[0].balance) < cost) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    // نحول keywords إلى JSON string للتخزين (نتأكد أنها مصفوفة أو نستخدم [])
    const keywordsArray = Array.isArray(keywords) ? keywords : [];
    const keywordsJson = JSON.stringify(keywordsArray);
    await pool.query('BEGIN');
    await pool.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [cost, user_id]);
    await pool.query(
      'INSERT INTO user_videos (user_id, title, video_url, duration_seconds, keywords) VALUES ($1, $2, $3, $4, $5)',
      [user_id, title, video_url, duration, keywordsJson]
    );
    await pool.query('COMMIT');
    return res.json({ success: true, cost });
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
    console.error('Error in /api/add-video:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ✅ جلب فيديوهات المستخدم
app.get('/api/my-videos', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id مطلوب' });
  }
  try {
    const result = await pool.query(`
      SELECT id, title, video_url, duration_seconds, views_count, created_at,
      COALESCE(keywords, '[]'::jsonb) AS keywords
      FROM user_videos
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [user_id]);
    const videos = result.rows.map(v => ({
      id: v.id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count,
      created_at: v.created_at,
      keywords: Array.isArray(v.keywords) ? v.keywords : []   // نتأكد إنها Array
    }));
    return res.json(videos);
  } catch (err) {
    console.error('Error in /api/my-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/admin/set-price', async (req, res) => {
  const { price } = req.body;
  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0) {
    return res.json({ success: false, message: "❌ Invalid price" });
  }
  await pool.query(
    'INSERT INTO stock_settings (price, updated_at) VALUES ($1, NOW())',
    [parsedPrice]
  );
  res.json({
    success: true,
    message: `✅ Price updated to ${parsedPrice}`
  });
});

app.post('/admin/set-max', async (req, res) => {
  const { max } = req.body;
  try {
    await pool.query(
      'INSERT INTO stock_limits(max_buy) VALUES($1)',
      [max]
    );
    res.json({ message: "تم تحديث الحد الأقصى" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "فشل تحديث الحد الأقصى" });
  }
});
// =======================
// تحديث إجمالي الأسهم (ADMIN)
// =======================
app.post('/admin/set-total-stocks', async (req, res) => {
  try {
    const { total } = req.body;

    if (total === undefined || total < 0) {
      return res.json({
        success: false,
        message: "Invalid total stocks"
      });
    }

    await pool.query(`
      UPDATE stock_global
      SET total_stocks = $1,
          updated_at = NOW()
      WHERE id = 1
    `, [total]);

    res.json({
      success: true,
      message: "Total stocks updated"
    });

  } catch (err) {
    console.error('❌ set-total-stocks:', err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
// =======================
// الأسهم المتاحة للشراء (GLOBAL)
// =======================
app.get('/api/available-stocks', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT total_stocks
      FROM stock_global
      WHERE id = 1
    `);

    res.json({
      status: "success",
      available: Number(r.rows[0].total_stocks)
    });

  } catch (err) {
    console.error('❌ available-stocks:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to load available stocks"
    });
  }
});

// ======================= لعرض الأسهم المحجوزة للبيع المستخدمين =======================

app.get('/api/pending-sales', async (req, res) => {
  const { user_id } = req.query;

  const { rows } = await pool.query(
    `SELECT amount, sell_date, release_date, status
     FROM pending_sales
     WHERE user_id = $1
     ORDER BY sell_date DESC`,
    [user_id]
  );

  res.json(rows);
});

// مثال endpoint في السيرفر
app.get('/admin/users-stocks', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.telegram_id AS user,
        u.balance,
        COALESCE(s.stocks, 0) AS total_stocks
      FROM users u
      LEFT JOIN user_stocks s
        ON u.telegram_id = s.telegram_id
      ORDER BY u.telegram_id ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('❌ users-stocks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


app.post('/api/delete-video', async (req, res) => {
  const { user_id, video_id } = req.body;
  if (!user_id || !video_id) return res.status(400).json({ error: 'user_id و video_id مطلوبان' });
  try {
    const result = await pool.query(
      'DELETE FROM user_videos WHERE id = $1 AND user_id = $2',
      [video_id, user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود أو لا تملك صلاحية الحذف' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/delete-video:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/public-videos', async (req, res) => {
  try {
    const user_id = req.query.user_id; // *** مهم لجلب المعرف المرسل
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    const videos = await pool.query(
      `
      SELECT
      uv.id, uv.title, uv.video_url, uv.duration_seconds, uv.user_id, uv.keywords,
      u.balance >= (uv.duration_seconds * 0.00002) AS has_enough_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE
      u.balance >= (uv.duration_seconds * 0.00002)
      AND uv.user_id::text != $1::text
      AND NOT EXISTS (
        SELECT 1 FROM watched_videos w
        WHERE
        w.video_id = uv.id
        AND w.user_id::text = $1::text
        AND w.watched_at > (NOW() - INTERVAL '28 hours')
      )
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 50
      `,
      [user_id]
    );
    const available = videos.rows.filter(v => v.has_enough_balance);
    const mapped = available.map(v => {
      let keywords = [];
      if (v.keywords) {
        try {
          if (typeof v.keywords === "string") {
            keywords = JSON.parse(v.keywords);
          } else if (Array.isArray(v.keywords)) {
            keywords = v.keywords;
          }
        } catch {
          keywords = [];
        }
      }
      return {
        id: v.id,
        title: v.title,
        video_url: v.video_url,
        duration_seconds: v.duration_seconds,
        user_id: v.user_id,
        keywords: keywords.length > 0 ? keywords : [v.video_url?.split('v=')[1] || '']
      };
    });
    return res.json(mapped);
  } catch (err) {
    console.error('Error in /api/public-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ============================================================
Existing callbacks and other endpoints (kept & slightly improved)
============================================================ */
app.get('/callback', async (req, res) => {
  const { user_id, amount, transaction_id, secret, network } = req.query;
  // ✅ التحقق من السر
  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden: Invalid Secret');
  }
  // ✅ التحقق من وجود transaction_id
  if (!transaction_id) {
    return res.status(400).send('Missing transaction_id');
  }
  // ✅ التحقق من المبلغ
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).send('Invalid amount');
  }
  // نسبة العمولة (60%)
  const percentage = 0.60;
  const finalAmount = parsedAmount * percentage;
  // ✅ تحديد الشبكة (bitcotasks أو offer)
  const source = network === 'bitcotasks' ? 'bitcotasks' : 'offer';
  try {
    await pool.query('BEGIN');
    // ✅ التحقق من عدم تكرار العملية
    const existing = await pool.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );
    if (existing.rows.length > 0) {
      await pool.query('ROLLBACK');
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return res.status(200).send('Duplicate transaction ignored');
    }
    // ✅ تأكد أن المستخدم موجود أو أضفه
    const userCheck = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [user_id]
    );
    if (userCheck.rows.length === 0) {
      // لو المستخدم مش موجود → إنشاؤه برصيد أولي
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, finalAmount]
      );
    } else {
      // لو موجود → تحديث رصيده
      await pool.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [finalAmount, user_id]
      );
    }
    // ✅ إضافة سجل الأرباح
    await pool.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at)
      VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );
    console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${parsedAmount}$) للمستخدم ${user_id} (Transaction: ${transaction_id})`);
    // ✅ التحقق من وجود محيل
    const ref = await pool.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1',
      [user_id]
    );
    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03; // 3% للمحيل
      // تحديث رصيد المحيل
      const refCheck = await pool.query(
        'SELECT balance FROM users WHERE telegram_id = $1',
        [referrerId]
      );
      if (refCheck.rows.length === 0) {
        // لو المحيل مش موجود → إنشاؤه برصيد أولي
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
      // إضافة سجل أرباح للمحيل
      await pool.query(
        `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at)
        VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
        [referrerId, 'referral', bonus, `Referral bonus from ${user_id} (Transaction: ${transaction_id})`]
      );
        // ✅ ✅ ✅ إضافة سجل في جدول referral_earnings (هذا هو المطلوب) ✅ ✅ ✅
      await pool.query(
    `INSERT INTO referral_earnings (referrer_id, referee_id, amount, created_at)
    VALUES ($1, $2, $3, NOW())`,
    [referrerId, user_id, bonus]  // ← كلاهما telegram_id
  );
  
  console.log(`👥 تم إضافة ${bonus}$ (3%) للمحيل ${referrerId} من ربح المستخدم ${user_id}`);
  console.log(`📊 سجل في referral_earnings: referrer=${referrerId}, referee=${user_id}, amount=${bonus}`);
}
    await pool.query('COMMIT');
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});

// === Unity Ads S2S Callback (كما كان، مع بعض الحماية البسيطة)
app.get('/unity-callback', async (req, res) => {
  try {
    const params = { ...req.query };
    const hmac = params.hmac;
    if (!hmac) return res.status(400).send('Missing hmac');
    const secret = process.env.UNITYADS_SECRET || '';
    if (!secret) {
      console.error('UNITYADS_SECRET not set');
      return res.status(500).send('Server not configured');
    }
    const paramsToSign = { ...params };
    delete paramsToSign.hmac;
    const keys = Object.keys(paramsToSign).sort();
    const paramString = keys.map(k => `${k}=${paramsToSign[k] === null ? '' : paramsToSign[k]}`).join(',');
    const computed = crypto.createHmac('md5', secret).update(paramString).digest('hex');
    if (computed !== hmac) {
      console.warn('Unity callback signature mismatch', { paramString, computed, hmac });
      return res.sendStatus(403);
    }
    const sid = params.sid;
    const oid = params.oid;
    const productid = params.productid || params.product || params.placement || null;
    if (!sid || !oid) {
      return res.status(400).send('Missing sid or oid');
    }
    const reward = 0.0005;
    const dup = await pool.query('SELECT 1 FROM earnings WHERE source=$1 AND description=$2 LIMIT 1', ['unity', `oid:${oid}`]);
    if (dup.rows.length > 0) {
      console.log('🔁 Unity callback duplicate oid ignored', oid);
      return res.status(200).send('Duplicate order ignored');
    }
    await pool.query('BEGIN');
    const uRes = await pool.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [sid]);
    if (uRes.rowCount === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [sid, 0]);
    }
    await pool.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [reward, sid]);
    await pool.query('INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1,$2,$3,$4,NOW())',
      [sid, 'unity', reward, `oid:${oid}`]);
    await pool.query('COMMIT');
    console.log(`🎬 Unity S2S: credited ${reward}$ to ${sid} (oid=${oid})`);
    res.status(200).send('1');
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
    console.error('Error on /unity-callback', err);
    res.status(500).send('Server Error');
  }
});

app.get('/video-callback', async (req, res) => {
  let { user_id, video_id, watched_seconds, secret } = req.query;
  if (!user_id || !video_id) {
    return res.status(400).send('Missing user_id or video_id');
  }
  try {
    // التحقق من السر
    if (secret !== process.env.CALLBACK_SECRET) {
      return res.status(403).send('Forbidden: Invalid Secret');
    }
    // جلب بيانات الفيديو
    const videoRes = await pool.query(
      'SELECT user_id AS owner_id, duration_seconds FROM user_videos WHERE id = $1',
      [video_id]
    );
    if (videoRes.rows.length === 0) {
      return res.status(400).send('الفيديو غير موجود');
    }
    const { owner_id, duration_seconds } = videoRes.rows[0];
    const reward = duration_seconds * 0.00001;
    const cost = duration_seconds * 0.00002;
    await pool.query('BEGIN');
    // تحقق من رصيد صاحب الفيديو
    const ownerBalanceRes = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [owner_id]
    );
    if (
      ownerBalanceRes.rows.length === 0 ||
      parseFloat(ownerBalanceRes.rows[0].balance) < cost
    ) {
      await pool.query('ROLLBACK');
      return res.status(400).send('رصيد صاحب الفيديو غير كافٍ');
    }
    // خصم تكلفة المشاهدة من صاحب الفيديو
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [cost, owner_id]
    );
    // تأكد إذا المشاهد موجود أو أضفه
    const viewerExists = await pool.query(
      'SELECT 1 FROM users WHERE telegram_id = $1',
      [user_id]
    );
    if (viewerExists.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, 0]
      );
    }
    // إضافة المكافأة للمشاهد
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [reward, user_id]
    );
    // إضافة سجل للأرباح
    await pool.query(
      `INSERT INTO earnings
      (user_id, source, amount, description, watched_seconds, video_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        user_id,
        'user_video',
        reward,
        `user_video:${video_id}`,
        watched_seconds ? parseInt(watched_seconds) : null,
        video_id
      ]
    );
    // تحديث عداد المشاهدات للفيديو
    await pool.query(
      'UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1',
      [video_id]
    );
    // ✅ تسجيل المشاهدة في جدول watched_videos
    await pool.query(
      `INSERT INTO watched_videos (user_id, video_id, watched_at)
      VALUES ($1, $2, NOW())`,
      [user_id, video_id]
    );
    await pool.query('COMMIT');
    console.log(
      `✅ فيديو ${video_id}: ${reward}$ للمشاهد ${user_id} — watched_seconds=${watched_seconds}`
    );
    return res.status(200).send({ "status": "success" });
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch (_) {}
    console.error('Error in /video-callback:', err);
    return res.status(500).send('Server Error');
  }
});

// ✅ /api/auth — يتحقق فقط من وجود المستخدم بدون إنشائه
app.get('/api/auth', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id مطلوب' });
    }
    // 🔎 تحقق من وجود المستخدم
    const result = await pool.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );
    if (result.rows.length === 0) {
      // ❌ المستخدم غير موجود
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    const user = result.rows[0];
    // ✅ المستخدم موجود → أعد بياناته للامتداد
    const response = {
      fullname: `User ${user.telegram_id}`,
      uniqueID: user.telegram_id.toString(),
      coins: parseFloat(user.balance),
      balance: parseFloat(user.balance),
      membership: 'Free'
    };
    return res.json(response);
  } catch (err) {
    console.error('Error in /api/auth:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ============================
🔹 /api/check — فحص حالة المستخدم
============================ */
app.get('/api/check', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });
    const userRes = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
      return res.json({ success: true, message: 'تم إنشاء المستخدم الجديد', balance: 0 });
    }
    const user = userRes.rows[0];
    res.json({
      success: true,
      user_id,
      balance: parseFloat(user.balance || 0),
      message: 'User is ready'
    });
  } catch (err) {
    console.error('❌ /api/check:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================
🔹 /api/worker — جلب فيديوهات للمشاهدة
============================ */
app.post('/api/worker/start', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });
    // 🧩 تأكد من وجود المستخدم (العامل)
    const userCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }
    // 🎥 جلب الفيديوهات المتاحة من المعلنين فقط (ليست للعامل نفسه)
    const videosRes = await pool.query(`
      SELECT
      uv.id,
      uv.user_id,
      uv.title,
      uv.video_url,
      uv.duration_seconds,
      uv.views_count,
      uv.keywords,
      uv.viewing_method,
      uv.like,
      uv.subscribe,
      uv.comment,
      uv.comment_like,
      uv.filtering,
      uv.daily_budget,
      uv.total_budget,
      u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.user_id != $1
      AND u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 20;
    `, [user_id]);
    // 🧠 تنسيق النتائج المرسلة للعامل
    const videos = videosRes.rows.map(v => ({
      id: v.id,
      user_id: v.user_id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count || 0,
      keywords: (() => {
        try {
          return Array.isArray(v.keywords) ? v.keywords : JSON.parse(v.keywords || '[]');
        } catch {
          return [];
        }
      })(),
      viewing_method: v.viewing_method || 'keyword',
      like: v.like || 'no',
      subscribe: v.subscribe || 'no',
      comment: v.comment || 'no',
      comment_like: v.comment_like || 'no',
      filtering: v.filtering || 'no',
      daily_budget: v.daily_budget || 0,
      total_budget: v.total_budget || 0,
      // 💰 المكافأة للعامل تُحسب بناءً على مدة الفيديو
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),
      // 💸 تكلفة المعلن
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));
    // 🚀 إرسال النتيجة
    return res.json({
      success: true,
      videos,
      count: videos.length
    });
  } catch (err) {
    console.error('❌ خطأ في /api/worker:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/worker', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });
    // 🧩 تأكد من وجود المستخدم (العامل)
    const userCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }
    // 🎥 جلب الفيديوهات المتاحة من المعلنين فقط (ليست للعامل نفسه)
    const videosRes = await pool.query(`
      SELECT
      uv.id,
      uv.user_id,
      uv.title,
      uv.video_url,
      uv.duration_seconds,
      uv.views_count,
      uv.keywords,
      uv.viewing_method,
      uv.like,
      uv.subscribe,
      uv.comment,
      uv.comment_like,
      uv.filtering,
      uv.daily_budget,
      uv.total_budget,
      u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.user_id != $1
      AND u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 20;
    `, [user_id]);
    // 🧠 تنسيق النتائج المرسلة للعامل
    const videos = videosRes.rows.map(v => ({
      id: v.id,
      user_id: v.user_id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count || 0,
      keywords: (() => {
        try {
          return Array.isArray(v.keywords) ? v.keywords : JSON.parse(v.keywords || '[]');
        } catch {
          return [];
        }
      })(),
      viewing_method: v.viewing_method || 'keyword',
      like: v.like || 'no',
      subscribe: v.subscribe || 'no',
      comment: v.comment || 'no',
      comment_like: v.comment_like || 'no',
      filtering: v.filtering || 'no',
      daily_budget: v.daily_budget || 0,
      total_budget: v.total_budget || 0,
      // 💰 المكافأة للعامل تُحسب بناءً على مدة الفيديو
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),
      // 💸 تكلفة المعلن
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));
    // 🚀 إرسال النتيجة
    return res.json({
      success: true,
      videos,
      count: videos.length
    });
  } catch (err) {
    console.error('❌ خطأ في /api/worker:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================
🔹 /api/report — تسجيل مشاهدة وتحديث الرصيد
============================ */
app.post('/api/report', async (req, res) => {
  try {
    const { user_id, video_id, watched_seconds } = req.body;
    if (!user_id || !video_id || !watched_seconds)
      return res.status(400).json({ error: 'user_id, video_id, watched_seconds مطلوبة' });
    const videoRes = await pool.query(`
      SELECT uv.*, u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.id = $1
    `, [video_id]);
    if (videoRes.rows.length === 0)
      return res.status(404).json({ error: 'الفيديو غير موجود' });
    const video = videoRes.rows[0];
    const owner_id = video.user_id;
    const duration = Math.min(video.duration_seconds, watched_seconds);
    const advertiserCost = duration * 0.00002;
    const workerReward = duration * 0.00001;
    if (parseFloat(video.owner_balance) < advertiserCost)
      return res.status(400).json({ error: 'رصيد المعلن غير كافٍ لدفع تكلفة المشاهدة' });
    await pool.query('BEGIN');
    await pool.query(`UPDATE users SET balance = balance - $1 WHERE telegram_id = $2`, [advertiserCost, owner_id]);
    await pool.query(`UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`, [workerReward, user_id]);
    await pool.query(`UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1`, [video_id]);
    await pool.query(`
      INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [user_id, 'watch', workerReward, 'Watching video', duration, video_id]);
    await pool.query('COMMIT');
    res.json({
      success: true,
      duration,
      advertiserCost,
      workerReward,
      message: 'تم تسجيل المشاهدة وتحديث الأرصدة بنجاح'
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ /api/report:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ============================
🔹 /api/lang/full — ترجمة واجهة الإضافة
============================ */
app.get('/api/lang/full', async (req, res) => {
    try {
        // ✅ 1. اكتشاف اللغة من الطلب (افتراضي عربي)
        const lang = req.query.lang || 'ar'; 
        
        // ✅ 2. قاموس الترجمة
        const translations = lang === 'en' ? {
            start_button: "Start Watching",
            stop_button: "Stop",
            balance_label: "Your Balance",
            coins_label: "Coins",
            membership_label: "Membership",
            loading_text: "Loading tasks...",
            error_text: "Connection error occurred"
        } : {
            start_button: "ابدأ المشاهدة",
            stop_button: "إيقاف",
            balance_label: "رصيدك",
            coins_label: "العملات",
            membership_label: "العضوية",
            loading_text: "جارٍ تحميل المهام...",
            error_text: "حدث خطأ أثناء الاتصال بالخادم"
        };

        const payload = {
            lang: translations,
            server_time: new Date().toISOString()
        };
        const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
        res.json({ langData: encoded });
    } catch (err) {
        console.error('❌ /api/lang/full:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/* ============================
🔹 /api/notify — إشعار بسيط للعميل
============================ */
app.get('/api/notify', (req, res) => {
  res.json({
    success: true,
    message: "📢 لا توجد إشعارات جديدة حاليًا. استمر في المشاهدة لزيادة أرباحك!",
    timestamp: new Date().toISOString()
  });
});

/* ============================================
🔹 /worker/ — فحص جاهزية العامل (GET)
يستخدمه المتصفح أو الإضافة للتحقق من أن السيرفر يعمل
============================================ */
app.get('/worker/', (req, res) => {
  res.status(200).json({
    ok: true,
    status: 'ready',
    message: 'Worker endpoint is active and ready 🚀',
    server_time: new Date().toISOString()
  });
});

/* =========================
   REGISTER - مع دعم الريفيرال (مصحح لاستخدام telegram_id)
========================= */
app.post("/register", async (req, res) => {
  try {
    const { name, username, password, referral_code } = req.body;
    
    // التحقق من البيانات
    if (!name || !username || !password) {
      return res.json({ success: false, message: "Missing data" });
    }
    
    // التحقق من عدم وجود username مسبقًا
    const checkUser = await pool.query(
      "SELECT id FROM users WHERE username=$1",
      [username]
    );
    if (checkUser.rows.length > 0) {
      return res.json({ success: false, message: "Username already exists" });
    }
    
    // توليد كود ريفيرال فريد للمستخدم الجديد
    const generateReferralCode = () => {
      return 'REF' + Math.random().toString(36).substr(2, 6).toUpperCase();
    };
    let newReferralCode = generateReferralCode();
    
    // التأكد من تفرد الكود
    let codeExists = true;
    while (codeExists) {
      const checkCode = await pool.query(
        "SELECT id FROM users WHERE referral_code=$1",
        [newReferralCode]
      );
      if (checkCode.rows.length === 0) codeExists = false;
      else newReferralCode = generateReferralCode();
    }
    
    // إنشاء telegram_id عشوائي كبير
    let telegram_id;
    while (true) {
      telegram_id = Math.floor(900000000000 + Math.random() * 100000000000);
      const checkId = await pool.query(
        "SELECT id FROM users WHERE telegram_id=$1",
        [telegram_id]
      );
      if (checkId.rows.length === 0) break;
    }
    
    // تشفير كلمة المرور
    const hash = await bcrypt.hash(password, 10);
    
    // بدء معاملة قاعدة البيانات
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // 1️⃣ إنشاء المستخدم الجديد مع كود الريفيرال
      await client.query(
        `INSERT INTO users (name, username, password, telegram_id, balance, referral_code)
         VALUES ($1,$2,$3,$4,0,$5)`,
        [name, username, hash, telegram_id, newReferralCode]
      );
      
      // 2️⃣ معالجة كود الريفيرال المدخل (إذا وُجد)
      if (referral_code && referral_code.trim() !== '') {
        // البحث عن الريفيرر باستخدام كود الريفيرال
        const referrer = await client.query(
          "SELECT telegram_id FROM users WHERE referral_code=$1",
          [referral_code.trim().toUpperCase()]
        );
        
        if (referrer.rows.length > 0) {
          const referrerTelegramId = referrer.rows[0].telegram_id;  // ✅ استخدام telegram_id
          
          // ✅ تسجيل العلاقة في جدول referrals باستخدام telegram_id (وليس users.id)
          await client.query(
            "INSERT INTO referrals (referrer_id, referee_id, created_at) VALUES ($1, $2, NOW())",
            [referrerTelegramId, telegram_id]  // ← كلاهما telegram_id
          );
          
          console.log(`👥 Referral link created: referrer_id=${referrerTelegramId}, referee_id=${telegram_id}`);
        }
      }
      // ✅ ✅ ✅ [إضافة جديدة] منح مكافأة الترحيب $0.10 للمستخدم الجديد ✅ ✅ ✅
      try {
        // أ) إضافة $0.10 إلى رصيد المستخدم
        await client.query(
          `UPDATE users SET balance = balance + 0.10 WHERE telegram_id = $1`,
          [telegram_id]
        );
        
        // ب) تسجيل المكافأة في جدول المكافآت (UNIQUE يمنع التكرار تلقائياً)
        await client.query(
          `INSERT INTO new_user_bonuses (user_id, bonus_amount) VALUES ($1, 0.10)`,
          [telegram_id]
        );
        
        console.log(`🎁 Welcome bonus $0.10 awarded to user: ${telegram_id}`);
      } catch (bonusErr) {
        // إذا فشل إضافة المكافأة (مثلاً: تكرار)، نسجل التحذير ونكمل (لا نوقف التسجيل)
        if (bonusErr.code !== '23505') { // 23505 = unique_violation
          console.error("⚠️ Bonus insertion error:", bonusErr);
          // يمكن اختيار: throw bonusErr; إذا أردت إيقاف التسجيل عند فشل المكافأة
        }
      }
      // ✅ ✅ ✅ نهاية إضافة مكافأة الترحيب ✅ ✅ ✅
       await client.query('COMMIT');
      
      // ✅ إرسال الرد مع تفاصيل المكافأة
      res.json({ 
        success: true, 
        message: "✅ Account created! +$0.10 welcome bonus added!",
        referral_code: newReferralCode, 
        telegram_id: telegram_id,
        bonus: 0.10  // ← إضافة جديدة لإعلام الواجهة بالمكافأة
      });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error("Register error:", err);
    res.json({ success: false, message: "Registration failed" });
  }
});
/* =========================
   LOGIN
========================= */

app.post("/login", async (req, res) => {

  try {

    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT id, telegram_id, username, password, balance, name FROM users WHERE username=$1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false });
    }

    const user = result.rows[0];

    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return res.json({ success: false });
    }

    // إرسال telegram_id لاستخدامه في التطبيق
    res.json({
      success: true,
      telegram_id: user.telegram_id,
      username: user.username,
      name: user.name,
      balance: user.balance
    });

  } catch (err) {

    console.error(err);
    res.json({ success: false });

  }

});



/* =========================
   USER DASHBOARD - مع حساب Total Withdrawn
========================= */
app.get("/user/dashboard", async (req, res) => {
    try {
        const idParam = req.query.id;
        
        // 🔎 تحقق صارم: يجب أن يكون رقم صحيح
        if(!idParam || typeof idParam !== 'string' || !/^\d+$/.test(idParam.trim())){
            return res.json({success:false, message:"Invalid user id"});
        }
        
        const telegramId = Number(idParam.trim());
        
    // 1️⃣ جلب المستخدم أولاً
const userQuery = await pool.query(
  `SELECT telegram_id, username, name, balance, payeer_wallet 
   FROM users 
   WHERE telegram_id = $1`,
  [telegramId]
);

if (userQuery.rows.length === 0) {
  return res.json({ success: false, message: "User not found" });
}

// 2️⃣ تحديث وقت الدخول (بدون شرط 24 ساعة)
await pool.query(
  `UPDATE users 
   SET last_login_at = now() 
   WHERE telegram_id = $1
     AND last_login_at < now() - interval '24 hours'`,
  [telegramId]
);
        
        const user = userQuery.rows[0];
        
        // ✅ ✅ ✅ حساب إجمالي المسحوبات المكتملة فقط ← هذا هو المطلوب ✅ ✅ ✅
        // نجمع فقط الطلبات التي حالتها 'paid' أو 'done' (تم تنفيذها بنجاح)
        const withdrawQuery = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawals WHERE user_id=$1 AND (status='paid' OR status='done')",
            [telegramId]
        );
        
        const totalWithdrawn = parseFloat(withdrawQuery.rows[0].total) || 0;
        
        // ✅ إرسال الاستجابة مع totalWithdrawn
        res.json({
            success: true,
            telegram_id: user.telegram_id,
            username: user.username,
            name: user.name,
            balance: parseFloat(user.balance) || 0,
            payeer_wallet: user.payeer_wallet,
            totalWithdrawn: totalWithdrawn,  // ← ✅ هذا هو الحقل الذي يعرض في الداشبورد
            timestamp: new Date().toISOString()
        });
        
    } catch(err) {
        console.error("❌ Server error /user/dashboard:", err);
        res.json({success:false, message:"Server error"});
    }
});


// 2️⃣ نقطة حالة المكافأة اليومية
app.get('/api/daily-rewards/status', async (req, res) => {
    const userId = req.query.id;
    const today = new Date().toISOString().split('T')[0];
    
    // جلب أرباح اليوم من جدول earnings
    const earnings = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total 
         FROM earnings 
         WHERE user_id = $1 AND DATE(created_at) = $2`,
        [userId, today]
    );
    
    // التحقق مما إذا تم المطالبة اليوم
    const claimed = await pool.query(
        `SELECT claimed FROM daily_rewards 
         WHERE user_id = $1 AND claim_date = $2`,
        [userId, today]
    );
    
    res.json({
        success: true,
        today_earnings: earnings.rows[0].total,
        already_claimed: claimed.rows[0]?.claimed || false
    });
});

// 3️⃣ نقطة المطالبة بالمكافأة
app.post('/api/daily-rewards/claim', async (req, res) => {
    const { user_id } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    // التحقق من الأرباح اليومية
    const earnings = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total 
         FROM earnings 
         WHERE user_id = $1 AND DATE(created_at) = $2`,
        [user_id, today]
    );
    
    if(earnings.rows[0].total < 0.03){
        return res.json({ success: false, message: "❌ Need $0.03+ earnings to claim" });
    }
    
    // التحقق من المطالبة السابقة اليوم
    const alreadyClaimed = await pool.query(
        `SELECT id FROM daily_rewards WHERE user_id = $1 AND claim_date = $2`,
        [user_id, today]
    );
    
    if(alreadyClaimed.rows.length > 0){
        return res.json({ success: false, message: "❌ Already claimed today" });
    }
    
    // إضافة المكافأة وتحديث الرصيد
    await pool.query(`BEGIN`);
    try{
        await pool.query(
            `UPDATE users SET balance = balance + 0.002 WHERE telegram_id = $1`,
            [user_id]
        );
        await pool.query(
            `INSERT INTO daily_rewards (user_id, today_earnings, reward_amount, claimed, claim_date) 
             VALUES ($1, $2, 0.002, true, $3)`,
            [user_id, earnings.rows[0].total, today]
        );
        await pool.query(`COMMIT`);
        
        res.json({ success: true, message: "✅ Reward claimed!", new_balance: true });
    } catch(e){
        await pool.query(`ROLLBACK`);
        res.json({ success: false, message: "❌ Database error" });
    }
});

// 4️⃣ نقطة سجل المكافآت
app.get('/api/daily-rewards/history', async (req, res) => {
    const userId = req.query.id;
    const history = await pool.query(
        `SELECT claim_date, reward_amount, created_at 
         FROM daily_rewards 
         WHERE user_id = $1 AND claimed = true 
         ORDER BY claim_date DESC LIMIT 30`,
        [userId]
    );
    
    res.json({ success: true, data: history.rows });
});

/* =========================
   WITHDRAWALS - Pending
========================= */
app.get("/api/withdrawals/pending", async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id || !/^\d+$/.test(id)) {
      return res.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    // جلب السحب التي حالتها 'pending'
    const result = await pool.query(
      `SELECT id, amount, payeer_wallet, status, requested_at 
       FROM withdrawals 
       WHERE user_id = $1 AND status = 'pending' 
       ORDER BY requested_at DESC`,
      [telegramId]
    );
    
    res.json({ 
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
    res.json({ success: false, message: "Failed to load pending withdrawals" });
  }
});

/* =========================
   WITHDRAWALS - Completed
========================= */
app.get("/api/withdrawals/completed", async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id || !/^\d+$/.test(id)) {
      return res.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    // جلب السحب التي حالتها 'done' (مكتملة)
    const result = await pool.query(
      `SELECT id, amount, payeer_wallet, status, requested_at, processed_at 
       FROM withdrawals 
       WHERE user_id = $1 AND status = 'done' 
       ORDER BY processed_at DESC 
       LIMIT 10`,
      [telegramId]
    );
    
    res.json({ 
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
    res.json({ success: false, message: "Failed to load completed withdrawals" });
  }
});

/* =========================
   REFERRAL - Statistics (مصحح نهائيًا)
========================= */
app.get("/api/referral/stats", async (req, res) => {
  try {
    const { id } = req.query;
    
    console.log("🔍 Referral stats request for telegram_id:", id);
    
    if (!id || !/^\d+$/.test(id)) {
      return res.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = id.toString().trim();
    
    // 1️⃣ جلب كود الريفيرال للمستخدم
    const userRes = await pool.query(
      "SELECT referral_code FROM users WHERE telegram_id = $1",
      [telegramId]
    );
    
    if (userRes.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }
    
    const referralCode = userRes.rows[0].referral_code || "N/A";
    console.log("✅ Found user - referral_code:", referralCode);
    
    // 2️⃣ جلب إحصائيات الريفيرال
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
    
    // 3️⃣ جلب قائمة الأشخاص الذين سجلوا عبر هذا المستخدم
    // ✅ تم إزالة التعليق العربي من داخل الاستعلام
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
    
    // ✅ إرسال الرد بالهيكل الصحيح
    res.json({
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
    res.json({ 
      success: false, 
      message: "Failed to load referral stats: " + err.message 
    });
  }
});
// =========================
// ✅ أولاً: المسار المحدد /user/units
// =========================
app.get("/user/units", async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.json({ success: false, message: "user_id is required", total_units: 0 });
    }
    
    const telegramId = id.toString().trim();
    let totalUnits = 0;
    
    try {
      const stocksQ = await pool.query(
        `SELECT stocks FROM user_stocks WHERE telegram_id = $1`,
        [telegramId]
      );
      totalUnits = Number(stocksQ.rows[0]?.stocks || 0);
      console.log(`📦 Found ${totalUnits} units in user_stocks for user ${telegramId}`);
    } catch (err) {
      console.warn(`⚠️ user_stocks query error: ${err.message}`);
    }
    
    console.log(`📦 Final result for user ${telegramId}: ${totalUnits} units`);
    
    res.json({ 
      success: true, 
      total_units: totalUnits,
      message: totalUnits > 0 ? "Units loaded" : "No units found for this user"
    });
    
  } catch (err) {
    console.error("❌ User units endpoint error:", err);
    res.json({ 
      success: true, 
      message: "Query error, returning 0", 
      total_units: 0 
    });
  }
});


// =========================
// ✅ ثانياً: المسار العام /user/:id (يجب أن يكون في النهاية)
// =========================
app.get("/user/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, telegram_id, username, name, balance, payeer_wallet FROM users WHERE telegram_id=$1",
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.json({ success: false });
    }
    
    res.json({
      success: true,
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});
/* =========================
   DEPOSIT - Submit TxID (مصحح)
========================= */
app.post("/api/deposit/submit", async (req, res) => {
  try {
    const { user_id, txid, network } = req.body;
    
    if (!user_id || !txid || txid.length < 10) {
      return res.json({ success: false, message: "Invalid data" });
    }
    
    const username = `user_${user_id}`;
    
    // حفظ الطلب في قاعدة البيانات
    const result = await pool.query(
      `INSERT INTO deposit_requests (user_id, username, txid, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING id, txid`,
      [user_id, username, txid]
    );
    
    const requestId = result.rows[0].id;
    const fullTxid = result.rows[0].txid; // ✅ حفظ TxID كامل للعرض
    
    // ✅ إرسال إشعار للإدمن مع أزرار الموافقة/الرفض (بنفس نمط البوت)
    const ADMIN_ID = process.env.ADMIN_ID;
    
    if (ADMIN_ID && typeof bot !== 'undefined' && bot?.telegram) {
      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `📥 طلب إيداع جديد #${requestId}
من التطبيق
👤 @${username} (ID: ${user_id})
🔗 TxID:
<code>${fullTxid}</code>`,  // ✅ عرض TxID كامل
          {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  // ✅ تم الإصلاح: "callback_data:" بدلاً من "callback_"
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
        // لا نوقف العملية، الطلب محفوظ في القاعدة
      }
    } else {
      console.warn(`⚠️ Bot not available or ADMIN_ID not set, deposit #${requestId} saved but no notification sent`);
    }
    
    res.json({ 
      success: true, 
      message: "Deposit request submitted",
      request_id: requestId 
    });
    
  } catch (err) {
    console.error("❌ Deposit submit error:", err.message);
    res.json({ 
      success: false, 
      message: "Failed to submit deposit: " + err.message 
    });
  }
});
/* =========================
   DEPOSIT - History (معدلة لإرجاع المبلغ)
========================= */
app.get("/api/deposit/history", async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id || !/^\d+$/.test(id)) {
      return res.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    // ✅ جلب سجل الإيداعات مع المبلغ والحالة
    const result = await pool.query(
      `SELECT id, txid, amount, status, created_at, processed_at, admin_note
       FROM deposit_requests 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [telegramId]
    );
    
    res.json({ 
      success: true, 
      data: result.rows.map(row => ({
        id: row.id,
        txid: row.txid,
        amount: parseFloat(row.amount || 0),  // ✅ إرجاع المبلغ
        status: row.status,
        created_at: row.created_at,
        processed_at: row.processed_at,
        admin_note: row.admin_note
      }))
    });
    
  } catch (err) {
    console.error("Deposit history error:", err);
    res.json({ success: false, message: "Failed to load history" });
  }
});

function cleanTRC20Address(address) {
  if (!address) return '';
  return address
    .trim()                 // حذف المسافات من البداية والنهاية
    .replace(/\s/g, '')     // حذف أي مسافات داخلية
    .replace(/[^\x20-\x7E]/g, ''); // حذف أي رموز مخفية
}
/* =========================
   WITHDRAW - Submit Request (مصحح)
========================= */
app.post("/api/withdraw/submit", async (req, res) => {
  try {
    const { user_id, wallet, network, amount: requestedAmount } = req.body;
    
    if (!user_id || !wallet) {
      return res.json({ success: false, message: "Invalid data" });
    }

     // ✅ ✅ ✅ تنظيف العنوان أولاً (هذا هو الإصلاح الجوهري)
    const cleanWallet = cleanTRC20Address(wallet);
    
    // ✅ التحقق من صحة عنوان TRC20
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(cleanWallet)) {
      return res.json({ success: false, message: "Invalid TRC20 address" });
    }
    
    // ✅ التحقق من المبلغ المطلوب
    const requested = parseFloat(requestedAmount);
    if (!requested || isNaN(requested) || requested < 1.00) {
      return res.json({ success: false, message: `Minimum withdraw is $${MIN_WITHDRAW}` });
    }
    
    // جلب رصيد المستخدم
    const userRes = await pool.query(
      "SELECT telegram_id, balance FROM users WHERE telegram_id = $1",
      [user_id]
    );
    
    if (userRes.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }
    
    let balance = parseFloat(userRes.rows[0].balance) || 0;
    
    // ✅ التحقق من أن الرصيد يكفي للمبلغ المطلوب
    if (balance < requested) {
      return res.json({ 
        success: false, 
        message: `Insufficient balance. Required: $${requested.toFixed(4)}, Available: $${balance.toFixed(4)}` 
      });
    }
    
    // ✅ حساب عمولة السحب 5%
    const withdrawalFee = requested * 0.05;
    const netAmount = requested - withdrawalFee;
    const remaining = balance - requested;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // حفظ طلب السحب مع تفاصيل العمولة
      await client.query(
        `INSERT INTO withdrawals (user_id, amount, payeer_wallet, status, requested_at, admin_note)
         VALUES ($1, $2, $3, 'pending', NOW(), $4)`,
        [user_id, netAmount, cleanWallet, `Requested: ${requested.toFixed(4)}$, Fee: ${withdrawalFee.toFixed(4)}$ (5%)`]
      );
      
      // خصم المبلغ المطلوب من رصيد المستخدم فوراً
      await client.query(
        "UPDATE users SET balance = $1 WHERE telegram_id = $2",
        [remaining, user_id]
      );
      
      await client.query('COMMIT');
      
      res.json({
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
    res.json({ success: false, message: "Failed to submit withdrawal: " + err.message });
  }
});
/* =========================
   WITHDRAW - History (مصحح)
========================= */
app.get("/api/withdraw/history", async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id || !/^\d+$/.test(id)) {
      return res.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    // جلب سجل السحب للمستخدم مع الحالة الصحيحة
    const result = await pool.query(
      `SELECT amount, payeer_wallet, status, requested_at, processed_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY requested_at DESC
       LIMIT 20`,
      [telegramId]
    );
    
    res.json({
      success: true,
      data: result.rows.map(row => ({
        amount: parseFloat(row.amount),
        wallet: row.payeer_wallet,
        status: row.status,  // ✅ ترجع: 'pending' أو 'paid' أو 'rejected'
        requested_at: row.requested_at,
        processed_at: row.processed_at
      }))
    });
    
  } catch (err) {
    console.error("Withdraw history error:", err);
    res.json({ success: false, message: "Failed to load history" });
  }
});

/* =========================
   CONTACT - Submit Message (من التطبيق)
========================= */
app.post("/api/contact/submit", async (req, res) => {
  try {
    const { user_id, message } = req.body;
    
    if (!user_id || !message || message.trim().length < 5) {
      return res.json({ success: false, message: "Invalid message" });
    }
    
    // حفظ الرسالة في قاعدة البيانات
    const result = await pool.query(
      `INSERT INTO admin_messages (user_id, message, replied, created_at)
       VALUES ($1, $2, false, NOW())
       RETURNING id`,
      [user_id, message.trim()]
    );
    
    const messageId = result.rows[0].id;
    
    // إرسال إشعار للأدمن في البوت
    const ADMIN_ID = process.env.ADMIN_ID;
    if (ADMIN_ID && typeof bot !== 'undefined' && bot?.telegram) {
      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `📩 رسالة جديدة #${messageId} من التطبيق
👤 المستخدم: ${user_id}
📝 الرسالة:
${message.trim()}`
        );
      } catch (notifyErr) {
        console.error(`❌ Failed to send contact notification: ${notifyErr.message}`);
      }
    }
    
    res.json({
      success: true,
      message: "Message submitted",
      message_id: messageId
    });
    
  } catch (err) {
    console.error("Contact submit error:", err);
    res.json({ success: false, message: "Failed to submit message" });
  }
});

/* =========================
   CONTACT - User History (جلب سجل رسائل المستخدم)
========================= */
app.get("/api/contact/history", async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id || !/^\d+$/.test(id)) {
      return res.json({ success: false, message: "Invalid user id" });
    }
    
    const telegramId = Number(id);
    
    // جلب سجل رسائل المستخدم
    const result = await pool.query(
      `SELECT id, message, admin_reply, replied, created_at
       FROM admin_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [telegramId]
    );
    
    res.json({
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
    res.json({ success: false, message: "Failed to load history" });
  }
});

// ==================== 🔐 4. Middleware: التحقق من الأدمن (مهم جداً) ====================
async function verifyAdmin(req, res, next) {
  try {
    // قراءة admin_id من الرابط (query) أو الجسم (body) مع التعامل مع القيم غير المعرفة
    const queryId = req.query?.admin_id?.toString()?.trim();
    const bodyId = req.body?.admin_id?.toString()?.trim();
    const adminId = queryId || bodyId;
    
    // الحصول على الـ ID المطلوب من متغيرات البيئة أو القيمة الافتراضية
    const REQUIRED_ADMIN_ID = process.env.ADMIN_ID || '7171208519';
    
    // التحقق من وجود admin_id ومطابقته للقيمة المطلوبة
    if (!adminId || adminId !== String(REQUIRED_ADMIN_ID).trim()) {
      console.warn(`❌ Access denied: received="${adminId}", required="${REQUIRED_ADMIN_ID}"`);
      return res.status(403).json({ 
        success: false, 
        message: '❌ Access denied: Invalid admin_id' 
      });
    }

     // 🔥 تسجيل نشاط الأدمن داخل جدول users
    const userQuery = await pool.query(
  `UPDATE users 
   SET last_login_at = now()
   WHERE telegram_id = $1
     AND last_login_at < now() - interval '24 hours'
   RETURNING telegram_id, username, name, balance, payeer_wallet`,
  [adminId]
);
    // ✅ تمرير الصلاحية للدالة التالية
    req.admin_id = adminId;
    next();
    
  } catch (err) {
    console.error('❌ verifyAdmin error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error in admin verification' 
    });
  }
}
// ================= 📥 1. جلب طلبات الإيداع =================
app.get('/api/admin/deposits', verifyAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const result = await pool.query(
      `SELECT id, user_id, username, txid, amount, status, created_at FROM deposit_requests WHERE status = $1 ORDER BY created_at DESC LIMIT 50`,
      [status]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ GET /api/admin/deposits:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ 2. الموافقة على إيداع
app.post('/api/admin/deposits/:id/approve', verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const depositId = req.params.id;
    const { user_id, admin_id, final_amount } = req.body;
    
    // 🔍 التحقق من وجود الإيداع وحالته
    const check = await client.query(
      'SELECT * FROM deposit_requests WHERE id = $1 AND status = $2', 
      [depositId, 'pending']
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: '❌ Deposit not found or already processed' });
    }
    
    const deposit = check.rows[0];
    const amountToAdd = final_amount !== undefined ? parseFloat(final_amount) : deposit.amount;
    
    if (isNaN(amountToAdd) || amountToAdd <= 0) {
      return res.status(400).json({ success: false, message: '❌ Invalid amount' });
    }
    
    // 🔄 بدء معاملة قاعدة بيانات (Transaction)
    await client.query('BEGIN');
    
    // 1️⃣ تحديث حالة الإيداع
    await client.query(
      `UPDATE deposit_requests 
       SET status = 'approved', 
           processed_at = NOW(), 
           processed_by = $1,
           amount = $2
       WHERE id = $3`, 
      [admin_id, amountToAdd, depositId]
    );
    
    // 2️⃣ إضافة المبلغ لرصيد المستخدم
    await client.query(
      `UPDATE users 
       SET balance = COALESCE(balance, 0) + $1 
       WHERE telegram_id = $2`, 
      [amountToAdd, user_id]
    );
    
    // 🎁 3️⃣ إضافة عمولة 3% للمحيل إذا وُجد
    const referrerCheck = await client.query(
      `SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1`,
      [user_id]
    );
    
    if (referrerCheck.rows.length > 0) {
      const referrer_id = referrerCheck.rows[0].referrer_id;
      const commission = amountToAdd * 0.03; // 3% عمولة
      const roundedCommission = Math.round(commission * 100) / 100; // تقريب لـ منزلتين عشريتين
      
      // ➕ إضافة العمولة لرصيد المحيل
      await client.query(
        `UPDATE users 
         SET balance = COALESCE(balance, 0) + $1 
         WHERE telegram_id = $2`, 
        [roundedCommission, referrer_id]
      );
      
      // 📝 تسجيل العمولة في جدول referral_earnings
      await client.query(
        `INSERT INTO referral_earnings (referrer_id, referee_id, amount, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [referrer_id, user_id, roundedCommission]
      );
      
      console.log(`🎁 Referral commission: $${roundedCommission} added to referrer ${referrer_id}`);
    }
    
    // ✅ تأكيد المعاملة
    await client.query('COMMIT');
    
    // 📦 تحضير رسالة الرد
    let responseMessage = `✅ Deposit approved and $${amountToAdd.toFixed(2)} added to user balance`;
    if (referrerCheck.rows.length > 0) {
      const commission = Math.round((amountToAdd * 0.03) * 100) / 100;
      responseMessage += ` | 🎁 $${commission.toFixed(2)} commission added to referrer`;
    }
    
    res.json({ 
      success: true, 
      message: responseMessage,
      commission_added: referrerCheck.rows.length > 0 ? Math.round((amountToAdd * 0.03) * 100) / 100 : 0
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ POST /api/admin/deposits/:id/approve:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  } finally {
    client.release();
  }
});

// ❌ 3. رفض إيداع
app.post('/api/admin/deposits/:id/reject', verifyAdmin, async (req, res) => {
  try {
    const depositId = req.params.id;
    const { reason = 'Does not meet requirements' } = req.body;
    const result = await pool.query(`UPDATE deposit_requests SET status = 'rejected', processed_at = NOW(), processed_by = $1, admin_note = $2 WHERE id = $3 AND status = 'pending' RETURNING *`, [req.body.admin_id, reason, depositId]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: '❌ Deposit not found' });
    res.json({ success: true, message: '❌ Deposit rejected' });
  } catch (err) {
    console.error('❌ POST /api/admin/deposits/:id/reject:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 📤 4. جلب طلبات السحب
app.get('/api/admin/withdrawals', verifyAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const result = await pool.query(`SELECT id, user_id, amount, payeer_wallet, status, requested_at FROM withdrawals WHERE status = $1 ORDER BY requested_at DESC LIMIT 50`, [status]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ GET /api/admin/withdrawals:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ 5. الموافقة على سحب (لا يغير الرصيد - الخصم تم مسبقاً)
app.post('/api/admin/withdrawals/:id/approve', verifyAdmin, async (req, res) => {
  try {
    const withdrawId = req.params.id;
    const result = await pool.query(
      `UPDATE withdrawals SET status = 'paid', processed_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`, 
      [withdrawId]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: '❌ Withdrawal not found' });
    res.json({ success: true, message: '✅ Withdrawal approved' });
  } catch (err) {
    console.error('❌ POST /approve:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ❌ 6. رفض سحب (مع إرجاع المبلغ الأصلي قبل خصم 5%)
app.post('/api/admin/withdrawals/:id/reject', verifyAdmin, async (req, res) => {
  try {
    const withdrawId = req.params.id;
    const { reason = 'Verification failed', admin_id } = req.body; // ✅ قراءة admin_id
    
    const withdrawal = await pool.query(
      'SELECT * FROM withdrawals WHERE id = $1 AND status = $2', 
      [withdrawId, 'pending']
    );
    
    if (withdrawal.rowCount === 0) {
      return res.status(404).json({ success: false, message: '❌ Withdrawal not found' });
    }
    
    const { user_id, amount } = withdrawal.rows[0];
    
    // 💡 حساب المبلغ الأصلي قبل خصم 5%: الأصل = المسحوب ÷ 0.95
    const WITHDRAW_FEE_RATE = 0.05;
    const originalAmount = parseFloat(amount) / (1 - WITHDRAW_FEE_RATE);
    
    await pool.query(
      'UPDATE withdrawals SET status = $1, processed_at = NOW(), admin_note = $2 WHERE id = $3', 
      ['rejected', reason, withdrawId]
    );
    
    // ✅ إرجاع المبلغ الأصلي (100$) وليس بعد الخصم (95$)
    // ملاحظة: withdrawals.user_id = users.telegram_id (bigint)
    await pool.query(
      'UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE telegram_id = $2', 
      [originalAmount, user_id]
    );
    
    await pool.query(
      'INSERT INTO earnings (user_id, amount, source, description) VALUES ($1, $2, $3, $4)', 
      [user_id, originalAmount, 'withdrawal_refund', `Refund: Rejected withdrawal #${withdrawId}`]
    );
    
    res.json({ 
      success: true, 
      message: `❌ Withdrawal rejected. Original amount $${originalAmount.toFixed(2)} refunded.` 
    });
    
  } catch (err) {
    console.error('❌ POST /reject:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ➕ 7. إضافة رصيد
app.post('/api/admin/balance/add', verifyAdmin, async (req, res) => {
  try {
    const { user_id, amount, reason = 'Manual credit', source = 'admin_panel' } = req.body;
    if (!user_id || isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, message: '❌ Invalid input' });
    
    const userCheck = await pool.query('SELECT telegram_id, balance FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) return res.status(404).json({ success: false, message: '❌ User not found' });
    
    const newBalance = parseFloat(userCheck.rows[0].balance || 0) + parseFloat(amount);
    await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, user_id]);
    await pool.query('INSERT INTO earnings (user_id, amount, source, description) VALUES ($1, $2, $3, $4)', [user_id, amount, source, reason]);
    
    const referralBonus = parseFloat(amount) * 0.03;
    if (referralBonus > 0) {
      const ref = await pool.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [user_id]);
      if (ref.rows.length > 0) {
        const referrerId = ref.rows[0].referrer_id;
        if (referrerId && referrerId !== user_id) {
          await pool.query('UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE telegram_id = $2', [referralBonus, referrerId]);
          await pool.query('INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1, $2, $3)', [referrerId, user_id, referralBonus]);
          await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1, $2, $3)', [referrerId, referralBonus, 'referral_deposit']);
        }
      }
    }
    
    res.json({ success: true, message: `✅ Added $${amount}`, new_balance: newBalance.toFixed(4), referral_bonus: referralBonus.toFixed(4) });
  } catch (err) {
    console.error('❌ POST /api/admin/balance/add:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ➖ 8. خصم رصيد - نسخة مُصحَّحة
app.post('/api/admin/balance/deduct', verifyAdmin, async (req, res) => {
  try {
    const { user_id, amount, reason } = req.body;
    
    // ✅ تصحيح: إضافة قوس الإغلاق في رسالة الخطأ
    if (!user_id || isNaN(amount) || amount <= 0 || !reason) {
      return res.status(400).json({ 
        success: false, 
        message: '❌ Fill all fields (Reason required)'  // ✅ الآن صحيح
      });
    }
    
    const userCheck = await pool.query('SELECT telegram_id, balance FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) return res.status(404).json({ success: false, message: '❌ User not found' });
    
    const currentBalance = parseFloat(userCheck.rows[0].balance || 0);
    const newBalance = Math.max(0, currentBalance - parseFloat(amount));
    
    await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, user_id]);
    await pool.query('INSERT INTO earnings (user_id, amount, source, description) VALUES ($1, $2, $3, $4)', [user_id, -Math.abs(amount), 'admin_deduction', reason]);
    
    res.json({ 
      success: true, 
      message: `✅ Deducted $${amount}`, 
      previous_balance: currentBalance.toFixed(4), 
      new_balance: newBalance.toFixed(4) 
    });
    
  } catch (err) {
    console.error('❌ POST /api/admin/balance/deduct:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 📬 9. جلب رسائل المستخدمين
app.get('/api/admin/messages', verifyAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'unread';
    const limit = parseInt(req.query.limit) || 50;
    const whereClause = status === 'unread' ? 'replied = false' : '1=1';
    
    const result = await pool.query(
      `SELECT id, user_id, message, admin_reply, replied, created_at 
       FROM admin_messages 
       WHERE ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT $1`, 
      [limit]
    );
    
    res.json({ 
      success: true, 
      data: result.rows,
      count: result.rows.length
    });
    
  } catch (err) {
    console.error('❌ GET /api/admin/messages:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: err.message 
    });
  }
});

// 💬 10. الرد على رسالة (قاعدة البيانات فقط - بدون بوت)
app.post('/api/admin/messages/:id/reply', verifyAdmin, async (req, res) => {
  try {
    const messageId = req.params.id;
    const { reply } = req.body;
    
    // ✅ التحقق من وجود نص الرد
    if (!reply || reply.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: '❌ Reply text is required' 
      });
    }
    
    // ✅ التحقق من وجود الرسالة
    const msgCheck = await pool.query(
      'SELECT id, user_id, message, replied FROM admin_messages WHERE id = $1', 
      [messageId]
    );
    
    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '❌ Message not found' 
      });
    }
    
    const message = msgCheck.rows[0];
    
    // ✅ حفظ الرد في قاعدة البيانات - تصحيح: حذف updated_at لأنه غير موجود في الجدول
    await pool.query(
      `UPDATE admin_messages 
       SET admin_reply = $1, 
           replied = true,
          replied_at = now()
       WHERE id = $2`, 
      [reply, messageId]
    );
    
    console.log(`✅ Reply saved to DB for message #${messageId} (user: ${message.user_id})`);
    
    res.json({ 
      success: true, 
      message: '✅ Reply saved successfully in database',
      data: {
        message_id: messageId,
        user_id: message.user_id,
        original_message: message.message.substring(0, 200) + (message.message.length > 200 ? '...' : ''),
        admin_reply: reply.substring(0, 200) + (reply.length > 200 ? '...' : ''),
        replied: true,
        replied_at: new Date().toISOString()
      }
    });
    
  } catch (err) {
    console.error('❌ POST /api/admin/messages/:id/reply:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: err.message 
    });
  }
});

// 📊 Bonus: إحصائيات
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const [deposits, withdrawals, messages, users, proofs, disputes, commission] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM deposit_requests WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) FROM admin_messages WHERE replied = false"),
      pool.query("SELECT COUNT(*) FROM users"),
      pool.query("SELECT COUNT(*) FROM task_proofs WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) FROM task_disputes WHERE status = 'open'"),
      pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM earnings WHERE source IN ('admin_fee', 'referral_deposit')")
    ]);
    
    res.json({
      success: true,
      data: {
        pending_deposits: parseInt(deposits.rows[0].count),
        pending_withdrawals: parseInt(withdrawals.rows[0].count),
        unread_messages: parseInt(messages.rows[0].count),
        total_users: parseInt(users.rows[0].count),
        pending_proofs: parseInt(proofs.rows[0].count),
        open_disputes: parseInt(disputes.rows[0].count),
        admin_commission: parseFloat(commission.rows[0].total).toFixed(4)
      }
    });
  } catch (err) {
    console.error('❌ GET /api/admin/stats:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 👥 جلب عدد المستخدمين الكلي - كود مُصحح
app.get('/api/admin/stats/total-users', async (req, res) => {
  try {
    console.log('📥 GET /total-users query:', req.query);
    
    const admin_id = req.query.admin_id;
    const REQUIRED_ADMIN_ID = '7171208519';
    
    if (admin_id != REQUIRED_ADMIN_ID) {
      return res.status(403).json({ success: false, message: '❌ Access denied' });
    }
    
    const result = await pool.query('SELECT COUNT(*) as total FROM users');
    const totalUsers = parseInt(result.rows[0]?.total) || 0;
    
    console.log('✅ Total users:', totalUsers);
    
    // ✅ التصحيح: إضافة مفتاح "data:" قبل الكائن
    res.json({ 
      success: true, 
      data: { total_users: totalUsers }  // ✅ صحيح الآن
    });
    
  } catch (err) {
    console.error('❌ ERROR /total-users:', err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error: ' + err.message 
    });
  }
});

// ======================= 📝 TASKS SYSTEM API - FULL COMPATIBLE =======================

// ======================= ✅ تنفيذات المستخدم TASK =======================

app.get('/api/tasks/user-executions', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id || !/^\d+$/.test(user_id.toString())) {
      return res.status(400).json({ success: false, message: "Valid user_id required" });
    }
    
    const executions = await pool.query(`
      SELECT 
        te.id, te.task_id, te.executor_id, te.proof, te.status, te.submitted_at, 
        te.reviewed_at, te.reviewed_by, te.payment_amount, te.rejection_reason,
        t.title as task_title, t.description as task_description, t.executor_reward,
        td.resolution as admin_resolution
      FROM task_executions te
      JOIN tasks t ON t.id = te.task_id
      LEFT JOIN task_disputes td ON te.id = td.execution_id
      WHERE te.executor_id = $1::bigint
      AND NOT (
          te.status = 'applied' 
          AND te.submitted_at + (t.duration_seconds || ' seconds')::interval < NOW()
        )  -- ✅ استبعاد الحالات المنتهية
      ORDER BY te.submitted_at DESC
    `, [user_id]);
    
    const executionsWithDispute = await Promise.all(
      executions.rows.map(async (exec) => {
        const dispute = await pool.query('SELECT id FROM task_disputes WHERE execution_id = $1', [exec.id]);
        return { ...exec, has_dispute: dispute.rows.length > 0 };
      })
    );
    
    const dataToSend = executionsWithDispute;
    res.json({ success: true, data: dataToSend });
    
  } catch (err) {
    console.error('❌ /api/tasks/user-executions:', err);
    res.status(500).json({ success: false, message: "Failed to load executions", error: err.message });
  }
});

// ======================= 📊 TASKS: AVAILABLE =======================

app.get('/api/tasks/available', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id || !/^\d+$/.test(user_id.toString())) {
      return res.status(400).json({ success: false, message: "Valid user_id required" });
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
    
    // ✅ التصحيح: أضف "data:" قبل tasks.rows
    res.json({ success: true,  data: tasks.rows });
    
  } catch (err) {
    console.error('❌ /api/tasks/available:', err);
    res.status(500).json({ success: false, message: "Failed to load tasks", error: err.message });
  }
});
// ======================= 📋 TASKS: MY TASKS =======================

app.get('/api/tasks/my', async (req, res) => {
  try {
    const userId = req.query.user_id;
    
    if (!userId || !/^\d+$/.test(userId.toString())) {
      return res.status(400).json({ success: false, message: 'Valid user_id is required' });
    }

    const query = `
      SELECT 
        t.id,
        t.title,
        t.description,
        t.budget,
        t.spent,
        COALESCE(t.executor_reward, t.price, 0.01) as executor_reward,
        t.is_active,
        t.created_at,
        t.duration_seconds,
        t.settings,
        t.target_url,
        COUNT(te.id) FILTER (WHERE te.id IS NOT NULL) AS total_executions,
        COUNT(te.id) FILTER (WHERE te.status = 'approved') AS approved_count,
        COUNT(te.id) FILTER (WHERE te.status = 'pending') AS pending_count,
        COUNT(te.id) FILTER (WHERE te.status = 'rejected') AS rejected_count,
        COUNT(te.id) FILTER (WHERE te.status = 'disputed') AS disputed_count
      FROM tasks t
      LEFT JOIN task_executions te ON t.id = te.task_id
      WHERE t.creator_id = $1 
        AND t.deleted_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);

    // ✅ تحويل القيم المحتملة لـ NULL إلى 0 لضمان عمل الـ frontend
    const tasks = result.rows.map(task => ({
      ...task,
      pending_count: parseInt(task.pending_count) || 0,
      disputed_count: parseInt(task.disputed_count) || 0,
      total_executions: parseInt(task.total_executions) || 0,
      approved_count: parseInt(task.approved_count) || 0
    }));

    res.json({ success: true, data: tasks });

  } catch (err) {
    console.error('❌ /api/tasks/my:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});


// ======================= ➕ CREATE TASK =======================

app.post('/api/tasks/create', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      creator_id, title, description, reward_per_execution,
      duration_seconds, budget, target_url,
      category, verification_method, proof_requirements,
      audience, delivery_interval, execution_type, max_completion_time,
      verification_keyword, delay_hours, delay_minutes, hourly_limits, multi_interval
    } = req.body;
    
    if (!creator_id || !title || reward_per_execution === undefined || !budget) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields",
        required: ["creator_id", "title", "reward_per_execution", "budget"]
      });
    }
    
    const executorReward = parseFloat(reward_per_execution);
    const totalBudget = parseFloat(budget);
    
    if (isNaN(executorReward) || executorReward < 0.001) {
      return res.status(400).json({ success: false, message: "Invalid reward: min $0.001" });
    }
    if (isNaN(totalBudget) || totalBudget < 0.10) {
      return res.status(400).json({ success: false, message: "Invalid budget: min $0.10" });
    }
    
    const adminCommission = executorReward * 0.25;
    const totalCostPerExecution = executorReward + adminCommission;
    
    const userRes = await client.query(
      'SELECT balance FROM users WHERE telegram_id = $1', 
      [creator_id]
    );
    
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    const userBalance = parseFloat(userRes.rows[0].balance || 0);
    if (userBalance < totalBudget) {
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient balance. Need: $${totalBudget.toFixed(4)}, Have: $${userBalance.toFixed(4)}` 
      });
    }
    
    await client.query('BEGIN');
    
    try {
      await client.query(
        'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', 
        [totalBudget, creator_id]
      );
      
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
        title,
        description,
        executorReward,
        executorReward,
        finalDuration,
        totalBudget,
        creator_id,
        target_url || '',
        settings
      ]);
      
      await client.query('COMMIT');
      
      res.json({ 
        success: true, 
        message: "Task created successfully", 
        task: result.rows[0],
        payment_info: {
          executor_reward: executorReward.toFixed(4),
          admin_commission: adminCommission.toFixed(4),
          total_cost_per_execution: totalCostPerExecution.toFixed(4),
          estimated_completions: Math.floor(totalBudget / totalCostPerExecution)
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
    res.status(500).json({ 
      success: false, 
      message: "Failed to create task", 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
});

// ======================= 🚀 APPLY FOR TASK =======================

app.post('/api/tasks/:id/apply', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    
    if (!id || !user_id || !/^\d+$/.test(user_id.toString())) {
      return res.status(400).json({ success: false, message: "Invalid task ID or user ID" });
    }
    
    await client.query('BEGIN');
    
    // ✅ التحقق من وجود تنفيذ سابق (مع 'applied' و 'pending')
    const existing = await client.query(
      `SELECT id, status FROM task_executions 
       WHERE task_id = $1::integer AND executor_id = $2::bigint AND status IN ('applied', 'pending', 'approved')`,
      [id, user_id]
    );
    
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "You already have an active execution for this task" });
    }
    
    const task = await client.query(
      `SELECT budget, spent, executor_reward, duration_seconds, is_active, deleted_at 
       FROM tasks WHERE id = $1::integer`, 
      [id]
    );
    
    if (task.rows.length === 0 || !task.rows[0].is_active || task.rows[0].deleted_at) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Task not found or inactive" });
    }
    
    const executorReward = parseFloat(task.rows[0].executor_reward || task.rows[0].price || 0.01);
    const adminCommission = executorReward * 0.20;
    const totalCost = executorReward + adminCommission;
    const remaining = parseFloat(task.rows[0].budget) - parseFloat(task.rows[0].spent);
    
    if (remaining < totalCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Task has insufficient budget" });
    }
    
    // ✅ استخدام 'applied' للحجز (بدلاً من 'pending')
    await client.query(
      `INSERT INTO task_executions (
         task_id, executor_id, status, payment_amount, commission_amount, submitted_at
       ) VALUES ($1::integer, $2::bigint, 'applied', $3, $4, NOW())`,
      [id, user_id, executorReward, adminCommission]
    );
    
    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: "Applied successfully - slot reserved",
      execution: {
        reward: executorReward.toFixed(4),
        commission: adminCommission.toFixed(4),
        total_cost: totalCost.toFixed(4),
        duration_seconds: task.rows[0].duration_seconds
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/apply:', err);
    res.status(500).json({ success: false, message: "Failed to apply: " + err.message });
  } finally {
    client.release();
  }
});

// ======================= 📤 SUBMIT PROOF =======================

app.post('/api/tasks/:id/submit-proof', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, proof, execution_id } = req.body;
    
    // ✅ قبول أي إثبات بطول 1+ حرف
    if (!proof || proof.trim().length < 1) {
      return res.status(400).json({ 
        success: false, 
        message: "Proof must contain at least 1 character" 
      });
    }
    
    // ✅ البحث عن التنفيذ بحالة 'applied' (الحجز)
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
      return res.status(404).json({ 
        success: false, 
        message: "No applied execution found for this task" 
      });
    }
    
    // ✅ تحديث الحالة من 'applied' إلى 'pending' بعد تقديم الإثبات
    await pool.query(
      `UPDATE task_executions 
       SET proof = $1, status = 'pending', submitted_at = COALESCE(submitted_at, NOW()) 
       WHERE id = $2::integer`, 
      [proof, exec.rows[0].id]
    );
    
    res.json({ 
      success: true, 
      message: "Proof submitted successfully", 
      execution_id: exec.rows[0].id 
    });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id/submit-proof:', err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to submit proof: " + err.message 
    });
  }
});

// ======================= 📋 TASK PROOFS =======================

app.get('/api/tasks/:id/proofs', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    
    if (!id) {
      return res.status(400).json({ success: false, message: "Task ID required" });
    }
    
    const task = await pool.query('SELECT creator_id, deleted_at FROM tasks WHERE id = $1', [id]);
    if (task.rows.length === 0 || task.rows[0].deleted_at) {
      return res.status(404).json({ success: false, message: "Task not found" });
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
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    
    const proofs = await pool.query(query, params);
    const dataToSend = proofs.rows;
    res.json({ success: true, data: dataToSend });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id/proofs:', err);
    res.status(500).json({ success: false, message: "Failed to load proofs", error: err.message });
  }
});

// ======================= ✅ APPROVE PROOF =======================

app.post('/api/tasks/:id/proofs/:proofId/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id: taskId, proofId } = req.params;
    const { user_id } = req.body;
    
    const task = await client.query(
      'SELECT creator_id, budget, spent FROM tasks WHERE id = $1 AND deleted_at IS NULL', 
      [taskId]
    );
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Unauthorized: You are not the task creator" });
    }
    
    const exec = await client.query(
      `SELECT id, executor_id, payment_amount, commission_amount, status 
       FROM task_executions WHERE id = $1 AND task_id = $2 AND status = 'pending'`,
      [proofId, taskId]
    );
    if (exec.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Execution not found or already processed" });
    }
    
    const executorId = exec.rows[0].executor_id;
    const paymentAmount = parseFloat(exec.rows[0].payment_amount);
    const adminCommission = parseFloat(exec.rows[0].commission_amount || (paymentAmount * 0.25));
    const totalCost = paymentAmount + adminCommission;
    
    await client.query('BEGIN');
    
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', 
      [paymentAmount, executorId]
    );
    
    const adminId = process.env.ADMIN_ID;
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
    
    await client.query(
      'UPDATE tasks SET spent = spent + $1 WHERE id = $2', 
      [totalCost, taskId]
    );
    
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

    await distributeReferralCommission(executorId, paymentAmount);
    
    res.json({ 
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
    res.status(500).json({ success: false, message: "Failed to approve: " + err.message });
  } finally {
    client.release();
  }
});

// ======================= ❌ REJECT PROOF =======================

app.post('/api/tasks/:id/proofs/:proofId/reject', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { proofId } = req.params;
    const { user_id, reason } = req.body;
    
    if (!reason || reason.length < 20) {
      return res.status(400).json({ success: false, message: "Rejection reason must be at least 20 characters" });
    }
    
    await client.query('BEGIN');
    
    // ✅ التحقق من ملكية المهمة
    const task = await client.query('SELECT creator_id FROM tasks WHERE id = $1', [id]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    
    // ✅ التصحيح: ترتيب المعاملات الصحيح
    // $1 = user_id (reviewed_by)
    // $2 = reason (rejection_reason) ← النص وليس الرقم
    // $3 = proofId (WHERE id)
    // $4 = id (WHERE task_id)
    await client.query(
      `UPDATE task_executions 
       SET status = 'rejected', 
           reviewed_at = NOW(), 
           reviewed_by = $1::bigint, 
           rejection_reason = $2
       WHERE id = $3::integer AND task_id = $4::integer`,
      [user_id, reason, proofId, id]  // ← الترتيب الصحيح
    );
    
    await client.query('COMMIT');
    
    res.json({ success: true, message: "Proof rejected" });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/proofs/:proofId/reject:', err);
    res.status(500).json({ success: false, message: "Failed to reject proof", error: err.message });
  } finally {
    client.release();
  }
});

// ======================= ⚠️ DISPUTES =======================

app.post('/api/tasks/:id/proofs/:proofId/dispute', async (req, res) => {
  try {
    const { id: taskId, proofId } = req.params;
    const { user_id, reason } = req.body;
    
    if (!reason || reason.trim().length < 20) {
      return res.status(400).json({ success: false, message: "Please provide a detailed reason (min 20 characters)" });
    }
    
    const exec = await pool.query(
      'SELECT id, status FROM task_executions WHERE id = $1', 
      [proofId]
    );
    if (exec.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Execution not found" });
    }
    
    await pool.query(`
      INSERT INTO task_disputes (execution_id, reason, status, created_at)
      VALUES ($1, $2, 'open', NOW())
    `, [proofId, reason]);
    
    await pool.query(
      'UPDATE task_executions SET status = $1 WHERE id = $2', 
      ['disputed', proofId]
    );
    
    if (typeof bot !== 'undefined' && bot?.telegram && process.env.ADMIN_ID) {
      try {
        await bot.telegram.sendMessage(
          process.env.ADMIN_ID,
          `⚠️ New Dispute:\n📋 Task: #${taskId}\n🔍 Execution: #${proofId}\n👤 User: ${user_id}\n📝 Reason:\n${reason.substring(0, 200)}...`
        );
      } catch (_) {}
    }
    
    res.json({ success: true, message: "Dispute created - Admin will review" });
    
  } catch (err) {
    console.error('❌ Create dispute:', err);
    res.status(500).json({ success: false, message: "Failed to create dispute: " + err.message });
  }
});

// ======================= 💰 FUND & WITHDRAW =======================

app.post('/api/tasks/:id/fund', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    await client.query('BEGIN');

    const user = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0 || parseFloat(user.rows[0].balance || 0) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    const task = await client.query('SELECT creator_id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // التحقق من وجود تطبيقات قائمة
    const activeExecutions = await client.query(
      "SELECT 1 FROM task_executions WHERE task_id = $1 AND status IN ('applied','pending')",
      [id]
    );
    if (activeExecutions.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Cannot fund task: active executions exist" });
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [amount, user_id]);
    
    const updatedTask = await client.query(
      "UPDATE tasks SET budget = budget + $1, is_active = true WHERE id = $2 RETURNING budget",
      [amount, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: "Funds added successfully and task reactivated", new_budget: parseFloat(updatedTask.rows[0].budget) });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/fund:', err);
    res.status(500).json({ success: false, message: "Failed to add funds: " + err.message });
  } finally {
    client.release();
  }
});

app.post('/api/tasks/:id/withdraw', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id, amount } = req.body;
    
    await client.query('BEGIN');
    
    const task = await client.query('SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    
    // ✅ التحقق من pending و disputed
    const pending = await client.query(
      'SELECT COUNT(*) FROM task_executions WHERE task_id = $1 AND status IN ($2, $3)',
      [id, 'pending', 'disputed']
    );
    if (parseInt(pending.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Cannot withdraw: pending or disputed executions exist" });
    }
    
    const remaining = parseFloat(task.rows[0].budget) - parseFloat(task.rows[0].spent);
    const withdrawAmount = amount && amount > 0 ? parseFloat(amount) : remaining;
    
    if (withdrawAmount > remaining) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Amount exceeds remaining budget" });
    }
    if (remaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "No funds to withdraw" });
    }
    
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [withdrawAmount, user_id]);
    await client.query('UPDATE tasks SET budget = budget - $1 WHERE id = $2', [withdrawAmount, id]);
    
    if (withdrawAmount >= remaining - 0.001) {
      await client.query('UPDATE tasks SET is_active = false WHERE id = $1', [id]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true, message: "Funds withdrawn successfully", amount: withdrawAmount });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/withdraw:', err);
    res.status(500).json({ success: false, message: "Failed to withdraw: " + err.message });
  } finally {
    client.release();
  }
});


// ======================= 🗑️ DELETE TASK =======================

app.delete('/api/tasks/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    await client.query('BEGIN');

    // 1️⃣ التحقق من وجود المهمة وملكية المستخدم
    const taskRes = await client.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskRes.rows.length === 0 || taskRes.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }
    const task = taskRes.rows[0];

    // 2️⃣ التحقق من وجود تطبيقات pending أو disputed
    const pendingExec = await client.query(
  `SELECT COUNT(*) FROM task_executions
   WHERE task_id = $1 AND status IN ('pending','disputed')`,
  [id]
);

if (parseInt(pendingExec.rows[0].count) > 0) {
  await client.query('ROLLBACK');
  return res.status(400).json({
    success: false,
    message: `Cannot delete task: ${pendingExec.rows[0].count} pending/disputed execution(s)`
  });
}

    const disputedExecRes = await client.query(
      'SELECT COUNT(*) FROM task_executions te JOIN task_disputes td ON te.id = td.execution_id WHERE te.task_id = $1 AND td.status = $2',
      [id, 'open']
    );
    if (parseInt(disputedExecRes.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete: ${disputedExecRes.rows[0].count} disputed execution(s) without admin decision` 
      });
    }

    // 3️⃣ التحقق من وجود إثباتات pending
    const pendingProofsRes = await client.query(
      'SELECT COUNT(*) FROM task_proofs WHERE task_id = $1 AND status = $2',
      [id, 'pending']
    );
    if (parseInt(pendingProofsRes.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete: ${pendingProofsRes.rows[0].count} pending proof(s) exist` 
      });
    }

    // 4️⃣ استرداد الميزانية المتبقية
    const remaining = parseFloat(task.budget) - parseFloat(task.spent);
    if (remaining > 0) {
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [remaining, user_id]
      );
    }

    // 5️⃣ الحذف النهائي لكل السجلات المرتبطة
    await client.query('DELETE FROM task_disputes WHERE execution_id IN (SELECT id FROM task_executions WHERE task_id = $1)', [id]);
    await client.query('DELETE FROM task_proofs WHERE task_id = $1', [id]);
    await client.query('DELETE FROM task_executions WHERE task_id = $1', [id]);
    await client.query('DELETE FROM user_tasks WHERE task_id = $1', [id]);
    await client.query('DELETE FROM tasks WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ success: true, message: "Task deleted permanently", refunded: remaining });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DELETE /api/tasks/:id:', err);
    res.status(500).json({ success: false, message: "Failed to delete: " + err.message });
  } finally {
    client.release();
  }
});

// ======================= 🔍 TASK: DETAILS =======================

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID" });
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
    `, [id]);
    
    if (task.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }
    
    const taskData = task.rows[0];
    const isCreator = taskData.creator_id?.toString() === user_id;
    
    let myExecution = null;
    if (user_id) {
      // ✅ استخدام submitted_at بدلاً من created_at
      const exec = await pool.query(
        `SELECT id, task_id, executor_id, proof, status, submitted_at, payment_amount, commission_amount
         FROM task_executions 
         WHERE task_id = $1 AND executor_id = $2 
         ORDER BY submitted_at DESC LIMIT 1`,
        [id, user_id]
      );
      if (exec.rows.length > 0) myExecution = exec.rows[0];
    }
    
    res.json({ 
      success: true, 
      task: taskData, 
      is_creator: isCreator,
      my_execution: myExecution
    });
    
  } catch (err) {
    console.error('❌ /api/tasks/:id:', err);
    res.status(500).json({ success: false, message: "Failed to load task", error: err.message });
  }
});

// ======================= ⚙️ ADMIN PANEL ROUTES =======================

// ✅ Middleware للتحقق من صلاحية الأدمن
function isAdminAuthenticated(req, res, next) {
  const adminId = req.query.user_id || req.body.user_id || req.body.admin_id;
  const REQUIRED_ADMIN_ID = process.env.ADMIN_ID || "7171208519";
  
  if (adminId?.toString().trim() === REQUIRED_ADMIN_ID) {
    next();
  } else {
    res.status(403).json({ success: false, message: "Admin access required" });
  }
}

// ✅ GET /api/admin/stats
app.get('/api/admin/stats', isAdminAuthenticated, async (req, res) => {
  try {
    const [pendingProofs, openDisputes, approvedToday, commissionStats] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM task_executions WHERE status = 'pending' AND proof IS NOT NULL`),
      pool.query(`SELECT COUNT(*) as count FROM task_disputes WHERE status = 'open'`),
      pool.query(`SELECT COUNT(*) as count FROM task_executions WHERE status = 'approved' AND reviewed_at::date = CURRENT_DATE`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved'`)
    ]);
    
    res.json({
      success: true,
      data: {
        pending_proofs: parseInt(pendingProofs.rows[0].count),
        open_disputes: parseInt(openDisputes.rows[0].count),
        approved_today: parseInt(approvedToday.rows[0].count),
        admin_commission: parseFloat(commissionStats.rows[0].total)
      }
    });
    
  } catch (err) {
    console.error('❌ /api/admin/stats:', err);
    res.status(500).json({ success: false, message: "Failed to load stats", error: err.message });
  }
});

// ✅ GET /api/admin/pending-proofs
app.get('/api/admin/pending-proofs', isAdminAuthenticated, async (req, res) => {
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
    
    res.json({ success: true, data: proofs.rows });
    
  } catch (err) {
    console.error('❌ /api/admin/pending-proofs:', err);
    res.status(500).json({ success: false, message: "Failed to load pending proofs", error: err.message });
  }
});

// ✅ GET /api/admin/disputes - استعلام مصحح مع الأعمدة الحقيقية
app.get('/api/admin/disputes', isAdminAuthenticated, async (req, res) => {
  try {
    const disputes = await pool.query(`
      SELECT 
        td.id as dispute_id,
        td.reason,
        td.status,
        td.created_at as dispute_created_at,
        td.resolved_at,
        td.resolution,
        td.execution_id,
        te.id as exec_id,
        te.task_id,
        te.executor_id,
        te.proof as executor_proof,
        te.payment_amount,
        te.status as execution_status,
        te.submitted_at as proof_submitted_at,
        t.title as task_title,
        t.description as task_description,
        t.target_url,
        t.creator_id,
        t.executor_reward,
        eu.username as executor_username,
        eu.telegram_id as executor_telegram,
        cu.username as creator_username,
        cu.telegram_id as creator_telegram
      FROM task_disputes td
      INNER JOIN task_executions te ON td.execution_id = te.id
      INNER JOIN tasks t ON te.task_id = t.id
      LEFT JOIN users eu ON te.executor_id = eu.telegram_id
      LEFT JOIN users cu ON t.creator_id = cu.telegram_id
      WHERE td.status = 'open'
      ORDER BY td.created_at DESC
    `);
    
    // ✅ الحل المضمون: استخدم متغيراً مؤقتاً
    const responseData = { success: true, data: disputes.rows };
    res.json(responseData);
    
  } catch (err) {
    console.error('❌ /api/admin/disputes:', err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load disputes", 
      error: err.message 
    });
  }
});

// ✅ GET /api/admin/commission-stats
app.get('/api/admin/commission-stats', isAdminAuthenticated, async (req, res) => {
  try {
    const [today, week, month, allTime] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved' AND reviewed_at::date = CURRENT_DATE`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved' AND reviewed_at >= NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved' AND reviewed_at >= NOW() - INTERVAL '30 days'`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved'`)
    ]);
    
    res.json({
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
    res.status(500).json({ success: false, message: "Failed to load commission stats", error: err.message });
  }
});

// ✅ POST /api/admin/task-disputes/:id/resolve - حل النزاع
app.post('/api/admin/task-disputes/:id/resolve', isAdminAuthenticated, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { payout_to, resolution, admin_id } = req.body;
    
    console.log('🔍 Resolve dispute:', { id, payout_to, admin_id });
    
    await client.query('BEGIN');
    
    // ✅ جلب تفاصيل النزاع مع جميع الحقول المطلوبة
    const dispute = await client.query(`
      SELECT 
        td.id,
        td.execution_id,
        te.task_id,
        te.executor_id,
        te.payment_amount,
        t.creator_id
      FROM task_disputes td
      INNER JOIN task_executions te ON td.execution_id = te.id
      INNER JOIN tasks t ON te.task_id = t.id
      WHERE td.id = $1::integer
    `, [id]);
    
    if (dispute.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Dispute not found" });
    }
    
    const d = dispute.rows[0];
    const executorId = d.executor_id;
    const paymentAmount = parseFloat(d.payment_amount);
    const adminCommission = parseFloat(d.commission_amount || (paymentAmount * 0.25));
    const totalCost = paymentAmount + adminCommission;
    
    // ✅ تحديث حالة النزاع إلى "محل"
    await client.query(
      `UPDATE task_disputes 
       SET status = 'resolved', resolved_at = NOW(), resolved_by = $1::bigint, resolution = $2
       WHERE id = $3::integer`,
      [admin_id, resolution, id]
    );
    
    // ✅ تنفيذ قرار الدفع
    if (payout_to === 'executor') {
      // دفع للمنفيذ
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2::bigint',
        [d.payment_amount, d.executor_id]
      );
      // تحديث حالة التنفيذ إلى approved
      await client.query(
        'UPDATE task_executions SET status = \'approved\', reviewed_at = NOW() WHERE id = $1::integer',
        [d.execution_id]
      );
      // تحديث الميزانية المستهلكة في المهمة
      await client.query(
        'UPDATE tasks SET spent = spent + $1 WHERE id = $2::integer',
         [totalCost, d.task_id]
      );
    } else {
      // لا دفع - تحديث الحالة إلى rejected
      await client.query(
        'UPDATE task_executions SET status = \'rejected\', reviewed_at = NOW() WHERE id = $1::integer',
        [d.execution_id]
      );
    }
    
    await client.query('COMMIT');
    
    // ✅ توزيع عمولة الريفيرال إذا دُفع للمنفذ
    if (payout_to === 'executor' && typeof distributeReferralCommission === 'function') {
      await distributeReferralCommission(d.executor_id, d.payment_amount);
    }
    
    console.log('✅ Dispute resolved:', id);
    res.json({ success: true, message: "Dispute resolved successfully" });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/admin/task-disputes/:id/resolve:', err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to resolve dispute", 
      error: err.message 
    });
  } finally {
    client.release();
  }
});
// ======================= END TASKS SYSTEM API =======================


/* =========================
   REFERRAL - Distribute Commission (5% من الأرباح غير الإيداع)
   ✅ مصحح لاستخدام telegram_id بشكل متسق
========================= */
async function distributeReferralCommission(telegramId, earningAmount) {
  try {
    // ✅ 1. التحقق من المدخلات
    if (!telegramId || !earningAmount || earningAmount <= 0) return;
    
    // ✅ 2. التأكد من وجود المستخدم
    const userCheck = await pool.query(
      "SELECT telegram_id FROM users WHERE telegram_id = $1",
      [telegramId.toString()]  // ✅ تمرير كنص
    );
    
    if (userCheck.rows.length === 0) return; // مستخدم غير موجود
    
    // ✅ 3. البحث عن الريفيرر لهذا المستخدم (باستخدام telegram_id في جدول referrals)
    const refRes = await pool.query(
      "SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1",
      [telegramId.toString()]  // ✅ استخدام telegram_id مباشرة (وليس users.id)
    );
    
    if (refRes.rows.length === 0) return; // لا يوجد ريفيرر
    
    const referrerTelegramId = refRes.rows[0].referrer_id;  // ✅ هذا هو telegram_id للريفيرر
    
    // ✅ 4. حساب العمولة: 5% من الأرباح الأخرى
    const commission = parseFloat((earningAmount * 0.05).toFixed(6));
    
    if (commission <= 0.000001) return; // تجاهل المبالغ الضئيلة جداً
    
    // ✅ 5. إضافة العمولة لرصيد الريفيرر (باستخدام telegram_id)
    await pool.query(
      "UPDATE users SET balance = balance + $1, referral_earnings = referral_earnings + $1 WHERE telegram_id = $2",
      [commission, referrerTelegramId]  // ✅ استخدام telegram_id
    );
    
    // ✅ 6. تسجيل العمولة في جدول referral_earnings
    await pool.query(
      "INSERT INTO referral_earnings (referrer_id, referee_id, amount, created_at) VALUES ($1, $2, $3, NOW())",
      [referrerTelegramId, telegramId.toString(), commission]  // ✅ كلاهما telegram_id
    );
    
    // ✅ 7. تسجيل الكسب في جدول earnings
    await pool.query(
      "INSERT INTO earnings (user_id, amount, source, description, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [referrerTelegramId, commission, 'referral_bonus', `Commission from user ${telegramId}`]
    );
    
    console.log(`✅ Commission $${commission} paid to referrer ${referrerTelegramId} for user:${telegramId}`);
    
  } catch (err) {
    console.error("distributeReferralCommission error:", err);
  }
}


// ======================= 🔄 CRON: AUTO-APPROVE PROOFS =======================

// ✅ التحقق من الإثباتات المعلقة وقبولها تلقائياً بعد 24 ساعة
setInterval(async () => {
  const client = await pool.connect();
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    
    // ✅ جلب الإثباتات المعلقة منذ أكثر من 24 ساعة
    const { rows } = await client.query(`
      SELECT 
        te.id,
        te.task_id,
        te.executor_id,
        te.payment_amount,
        te.commission_amount,
        t.creator_id,
        t.title as task_title
      FROM task_executions te
      JOIN tasks t ON t.id = te.task_id
      WHERE te.status = 'pending'
        AND te.proof IS NOT NULL
        AND te.submitted_at < $1
        AND t.deleted_at IS NULL
    `, [twentyFourHoursAgo]);
    
    for (const exec of rows) {
      try {
        await client.query('BEGIN');
        
        // ✅ دفع المكافأة للمنفيذ
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [exec.payment_amount, exec.executor_id]
        );
        
        // ✅ خصم التكلفة الكاملة من المهمة (مكافأة + عمولة)
        const totalCost = parseFloat(exec.payment_amount) + parseFloat(exec.commission_amount || 0);
        await client.query(
          'UPDATE tasks SET spent = spent + $1 WHERE id = $2',
          [totalCost, exec.task_id]
        );
        
        // ✅ تحديث حالة التنفيذ إلى approved
        await client.query(
          `UPDATE task_executions 
           SET status = 'approved', reviewed_at = NOW(), reviewed_by = 'auto'
           WHERE id = $1`,
          [exec.id]
        );
        
        await client.query('COMMIT');
        
        console.log(`✅ Auto-approved execution ${exec.id} for task ${exec.task_id}`);

          // ✅ توزيع عمولة الريفيرال 5% ← أضف هذا السطر هنا
        await distributeReferralCommission(exec.executor_id, exec.payment_amount);
        
        // ✅ إرسال إشعار للأدمن (اختياري)
        if (typeof bot !== 'undefined' && bot?.telegram && process.env.ADMIN_ID) {
          try {
            await bot.telegram.sendMessage(
              process.env.ADMIN_ID,
              `✅ Auto-Approved Proof:\n📋 Task: ${exec.task_title} (#${exec.task_id})\n👤 Executor: ${exec.executor_id}\n💰 Paid: $${exec.payment_amount}`
            );
          } catch (_) {}
        }
        
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Auto-approve failed for execution ${exec.id}:`, err);
      }
    }
    
    if (rows.length > 0) {
      console.log(`✅ Auto-approved ${rows.length} pending proof(s) after 24 hours`);
    }
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Auto-approve cron error:', err);
  } finally {
    client.release();
  }
}, 12 * 60 * 60 * 1000); // كل 3 ساعات


// === بدء التشغيل ===
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
