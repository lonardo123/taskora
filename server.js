import { Hono } from 'hono';
import { cors } from 'hono/cors';
import crypto from 'node:crypto'; // مهم جداً: إضافة node: لحل خطأ البناء
import bcrypt from 'bcryptjs';    // استخدم bcryptjs بدلاً من bcrypt الأصلي
import { pool } from './db.js';

const app = new Hono();

/* إعدادات عامة (Middleware) */
app.use('*', cors());

// التقاط أي أخطاء لاحقة في الـ pool
pool.on('error', (err) => console.error('⚠️ PG pool error:', err));

// دالة مساعدة (موجودة لاستخدامها في المسارات لاحقاً)
async function getOrCreateUser(client, telegramId) {
  let q = await client.query('SELECT id, balance FROM users WHERE telegram_id = $1', [telegramId]);
  if (q.rows.length === 0) {
    q = await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0) RETURNING id, balance', [telegramId]);
  }
  return { userDbId: q.rows[0].id, balance: Number(q.rows[0].balance) };
}

// 🧠 لتخزين آخر رسالة سيرفر مؤقتًا
let currentMessage = null;

// ✅ استبدال express.static و path بـ رد HTML بسيط 
// (لأن Cloudflare Workers لا يدعم نظام الملفات fs أو path)
app.get('/worker/start', (c) => {
  // ملاحظة: إذا كان لديك كود HTML كامل، يفضل رفعه على Cloudflare Pages، 
  // أو يمكنك لصق محتوى HTML هنا مباشرة داخل c.html('...')
  return c.html(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head><title>Worker Started</title></head>
    <body style="text-align:center; font-family:Arial; margin-top:50px;">
      <h1>✅ تم تشغيل العامل بنجاح!</h1>
      <p>السيرفر يعمل ويستقبل الطلبات.</p>
    </body>
    </html>
  `);
});

// 🧩 1. Endpoint لإرسال أمر من السيرفر (مثلاً عبر لوحة التحكم أو API)
app.post("/api/server/send", async (c) => {
  // في Hono نستخدم await c.req.json() بدلاً من req.body
  const { action, data } = await c.req.json(); 
  
  if (!action) {
    // في Hono نمرر كود الحالة (400) كعامل ثاني في c.json
    return c.json({ status: "error", message: "action required" }, 400);
  }
  
  currentMessage = { action, data: data || {}, time: new Date().toISOString() };
  console.log("📨 تم تعيين رسالة جديدة إلى الإضافة:", currentMessage);
  
  return c.json({ status: "ok", message: currentMessage });
});

// 🧩 2. Endpoint تطلبه الإضافة بشكل دوري (Polling)
app.get("/api/worker/message", (c) => {
  if (currentMessage) {
    const msg = currentMessage;
    currentMessage = null; // إعادة تعيين الرسالة حتى لا تتكرر
    return c.json(msg);
  }
  return c.json({ action: "NONE" });
});

// ==========================================
// دالة مساعدة واحدة فقط (تم إصلاح الكود المكسور وإزالة التكرار)
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

// =======================
// مسار الملف الشخصي للمستخدم (محول إلى Hono)
// =======================
app.get('/api/user/profile', async (c) => {
  // في Hono نستخدم c.req.query('اسم_المتغير') بدلاً من req.query
  const user_id = c.req.query('user_id');
  
  if (!user_id) {
    return c.json({
      status: "error",
      message: "user_id is required"
    }, 400); // إضافة كود الحالة 400 بشكل صحيح في Hono
  }

  try {
    const result = await pool.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      return c.json({
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
      return c.json({
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
    return c.json({
      status: "error",
      message: "Server error"
    }, 500);
  }
});

// =======================
// المسار الرئيسي للتحقق من عمل السيرفر
// =======================
app.get('/', (c) => {
  return c.text('✅ السيرفر يعمل! Postback جاهز.');
});




// =====================================================================
export default {
  // 1. استقبال طلبات HTTP (هذا هو البديل المباشر لـ app.listen)
  fetch: app.fetch,

  // 2. المعالج المجدول (هذا هو البديل المباشر لـ setInterval)
  // سيعمل تلقائياً كل دقيقة بناءً على إعدادات crons في ملف wrangler.toml
  async scheduled(controller, env, ctx) {
    console.log("⏰ تشغيل المهام المجدولة (Cron)...");
    try {
      // --- مثال: معالج المبيعات المؤجلة ---
      const now = new Date();
      const { rows } = await pool.query(
        `SELECT id, user_id, amount FROM pending_sales WHERE status = 'pending' AND release_date <= $1`,
        [now]
      );

      for (const sale of rows) {
        const result = await pool.query(
          `UPDATE pending_sales SET status = 'done' WHERE id = $1 AND status = 'pending'`,
          [sale.id]
        );

        if (result.rowCount === 1) {
          await pool.query(
            `UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`,
            [sale.amount, sale.user_id]
          );
        }
      }
      
      // 💡 ملاحظة: إذا كان لديك أي setInterval آخر في الكود الأصلي، 
      // قم بنسخ محتواه الداخلي ووضعه هنا مباشرة.

    } catch (err) {
      console.error("Scheduled task error:", err);
    }
  }
};
