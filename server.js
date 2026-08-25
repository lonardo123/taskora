import { Hono } from 'hono';
import { cors } from 'hono/cors';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const app = new Hono();
app.use('*', cors());

pool.on('error', (err) => console.error('⚠️ PG pool error:', err));

async function getOrCreateUser(client, telegramId) {
  let q = await client.query('SELECT id, balance FROM users WHERE telegram_id = $1', [telegramId]);
  if (q.rows.length === 0) {
    q = await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0) RETURNING id, balance', [telegramId]);
  }
  return { userDbId: q.rows[0].id, balance: Number(q.rows[0].balance) };
}

let currentMessage = null;

app.post("/api/server/send", async (c) => {
  const { action, data } = await c.req.json();
  if (!action) return c.json({ status: "error", message: "action required" }, 400);
  currentMessage = { action, data: data || {}, time: new Date().toISOString() };
  return c.json({ status: "ok", message: currentMessage });
});

app.get("/api/worker/message", (c) => {
  if (currentMessage) {
    const msg = currentMessage;
    currentMessage = null;
    return c.json(msg);
  }
  return c.json({ action: "NONE" });
});

app.get('/api/investment-data', async (c) => {
  const user_id = c.req.query('user_id');
  if (!user_id) return c.json({ status: "error", message: "user_id is required" });
  try {
    const settingsQ = await pool.query(`SELECT price, admin_fee_fixed, admin_fee_percent FROM stock_settings ORDER BY updated_at DESC LIMIT 1`);
    if (!settingsQ.rows.length) return c.json({ status: "error", message: "Stock price is not set" });
    const userQ = await pool.query(`SELECT balance FROM users WHERE telegram_id = $1`, [user_id]);
    if (!userQ.rows.length) await pool.query(`INSERT INTO users (telegram_id, balance) VALUES ($1, 0)`, [user_id]);
    const stocksQ = await pool.query(`SELECT stocks FROM user_stocks WHERE telegram_id = $1`, [user_id]);
    return c.json({ status: "success", data: { price: Number(settingsQ.rows[0].price), balance: Number(userQ.rows[0]?.balance || 0), stocks: Number(stocksQ.rows[0]?.stocks || 0), admin_fee_fixed: Number(settingsQ.rows[0].admin_fee_fixed), admin_fee_percent: Number(settingsQ.rows[0].admin_fee_percent) } });
  } catch (err) {
    console.error(err);
    return c.json({ status: "error", message: "Error loading investment data" }, 500);
  }
});

app.post('/api/buy-stock', async (c) => {
  const client = await pool.connect();
  try {
    const { user_id, quantity } = await c.req.json();
    if (!user_id || quantity <= 0) return c.json({ status: "error", message: "Invalid data" }, 400);
    await client.query('BEGIN');
    const maxQ = await client.query(`SELECT max_buy FROM stock_limits ORDER BY updated_at DESC LIMIT 1`);
    const maxBuy = maxQ.rows[0]?.max_buy || 0;
    const userStocksQ = await client.query(`SELECT stocks FROM user_stocks WHERE telegram_id = $1 FOR UPDATE`, [user_id]);
    const currentStocks = userStocksQ.rows[0]?.stocks || 0;
    if (currentStocks + quantity > maxBuy) { await client.query('ROLLBACK'); return c.json({ status: "error", message: "❌ Max limit exceeded" }); }
    const globalQ = await client.query(`SELECT total_stocks FROM stock_global WHERE id = 1 FOR UPDATE`);
    if (quantity > globalQ.rows[0].total_stocks) { await client.query('ROLLBACK'); return c.json({ status: "error", message: "❌ Not enough Units available" }); }
    const userQ = await client.query(`SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`, [user_id]);
    const balance = Number(userQ.rows[0]?.balance || 0);
    const priceQ = await client.query(`SELECT price, admin_fee_fixed, admin_fee_percent FROM stock_settings ORDER BY updated_at DESC LIMIT 1`);
    const price = Number(priceQ.rows[0].price);
    const fixedFee = Number(priceQ.rows[0].admin_fee_fixed);
    const percentFee = Number(priceQ.rows[0].admin_fee_percent);
    const subtotal = price * quantity;
    const fee = fixedFee + (subtotal * percentFee / 100);
    const total = subtotal + fee;
    if (balance < total) { await client.query('ROLLBACK'); return c.json({ status: "error", message: "Insufficient balance" }); }
    await client.query(`UPDATE users SET balance = balance - $1 WHERE telegram_id = $2`, [total, user_id]);
    await client.query(`INSERT INTO user_stocks (telegram_id, stocks) VALUES ($1, $2) ON CONFLICT (telegram_id) DO UPDATE SET stocks = user_stocks.stocks + $2`, [user_id, quantity]);
    await client.query(`UPDATE stock_global SET total_stocks = total_stocks - $1 WHERE id = 1`, [quantity]);
    await client.query(`INSERT INTO stock_transactions (telegram_id, type, quantity, price, fee, total) VALUES ($1, 'BUY', $2, $3, $4, $5)`, [user_id, quantity, price, fee, total]);
    await client.query(`INSERT INTO stock_holdings (telegram_id, quantity, bought_at, unlock_at) VALUES ($1, $2, NOW(), NOW() + INTERVAL '15 days')`, [user_id, quantity]);
    await client.query('COMMIT');
    return c.json({ status: "success", message: "completed" });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return c.json({ status: "error", message: "failed" }, 500);
  } finally { client.release(); }
});

app.post('/api/sell-stock', async (c) => {
  const client = await pool.connect();
  try {
    const { user_id, quantity } = await c.req.json();
    if (!user_id || quantity <= 0) return c.json({ status: "error", message: "Invalid data" }, 400);
    await client.query('BEGIN');
    const unlockedQ = await client.query(`SELECT COALESCE(SUM(quantity - sold), 0) AS available FROM stock_holdings WHERE telegram_id = $1 AND unlock_at <= NOW()`, [user_id]);
    if (Number(unlockedQ.rows[0].available) < quantity) { await client.query('ROLLBACK'); return c.json({ status: "error", message: "❌ You can Release Units only after 15 days" }); }
    let remainingToSell = quantity;
    const batchesQ = await client.query(`SELECT id, quantity, sold FROM stock_holdings WHERE telegram_id = $1 AND unlock_at <= NOW() AND quantity > sold ORDER BY bought_at ASC FOR UPDATE`, [user_id]);
    for (const batch of batchesQ.rows) {
      if (remainingToSell <= 0) break;
      const sellNow = Math.min(batch.quantity - batch.sold, remainingToSell);
      await client.query(`UPDATE stock_holdings SET sold = sold + $1 WHERE id = $2`, [sellNow, batch.id]);
      remainingToSell -= sellNow;
    }
    await client.query(`UPDATE stock_global SET total_stocks = total_stocks + $1 WHERE id = 1`, [quantity]);
    const userQ = await client.query(`SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`, [user_id]);
    if (!userQ.rows.length) { await client.query('ROLLBACK'); return c.json({ status: "error", message: "User not found" }); }
    const stockQ = await client.query(`SELECT stocks FROM user_stocks WHERE telegram_id = $1 FOR UPDATE`, [user_id]);
    if (!stockQ.rows.length || stockQ.rows[0].stocks < quantity) { await client.query('ROLLBACK'); return c.json({ status: "error", message: "Insufficient Units" }); }
    const priceQ = await client.query(`SELECT price, admin_fee_fixed, admin_fee_percent FROM stock_settings ORDER BY updated_at DESC LIMIT 1`);
    const price = Number(priceQ.rows[0].price);
    const fixedFee = Number(priceQ.rows[0].admin_fee_fixed);
    const percentFee = Number(priceQ.rows[0].admin_fee_percent);
    const gross = price * quantity;
    const fee = fixedFee + (gross * percentFee / 100);
    const total = gross - fee;
    const sellDate = new Date();
    const releaseDate = new Date(sellDate);
    releaseDate.setDate(releaseDate.getDate() + 5);
    await client.query(`INSERT INTO pending_sales (user_id, amount, sell_date, release_date) VALUES ($1, $2, $3, $4)`, [user_id, total, sellDate, releaseDate]);
    await client.query(`UPDATE user_stocks SET stocks = stocks - $1 WHERE telegram_id = $2`, [quantity, user_id]);
    await client.query(`INSERT INTO stock_transactions (telegram_id, type, quantity, price, fee, total) VALUES ($1, 'SELL', $2, $3, $4, $5)`, [user_id, quantity, price, fee, total]);
    await client.query('COMMIT');
    return c.json({ status: "success", message: "units Release successfully" });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return c.json({ status: "error", message: "failed" }, 500);
  } finally { client.release(); }
});

app.get('/api/transactions', async (c) => {
  const user_id = c.req.query('user_id');
  if (!user_id) return c.json({ status: "error", message: "user_id is required" });
  try {
    const q = await pool.query(`SELECT type, quantity, price, fee, total, created_at FROM stock_transactions WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT 50`, [user_id]);
    return c.json({ status: "success", data: q.rows.map(r => ({ type: r.type, quantity: Number(r.quantity), price: Number(r.price), fee: Number(r.fee), total: Number(r.total), date: r.created_at })) });
  } catch (err) {
    return c.json({ status: "error", message: "Failed to load investment data" }, 500);
  }
});

app.get('/api/my-stock-locks', async (c) => {
  const user_id = c.req.query('user_id');
  if (!user_id) return c.json({ message: "user_id is required" }, 400);
  const q = await pool.query(`SELECT quantity, sold, bought_at, unlock_at, (quantity - sold) AS remaining, unlock_at > NOW() AS locked FROM stock_holdings WHERE telegram_id = $1 ORDER BY bought_at DESC`, [user_id]);
  return c.json(q.rows);
});

app.get('/api/stock-chart', async (c) => {
  try {
    const q = await pool.query(`SELECT price, updated_at FROM stock_settings ORDER BY updated_at DESC LIMIT 15`);
    return c.json({ status: "success", data: q.rows.reverse().map(r => ({ price: Number(r.price), date: r.updated_at })) });
  } catch (err) {
    return c.json({ status: "error", message: "Failed to load chart data" }, 500);
  }
});

app.post('/api/admin/update-price', async (c) => {
  try {
    const { new_price, admin_fee_fixed = 0.05, admin_fee_percent = 3 } = await c.req.json();
    if (!new_price || new_price <= 0) return c.json({ status: "error", message: "Invalid price" }, 400);
    await pool.query(`INSERT INTO stock_settings (price, admin_fee_fixed, admin_fee_percent, updated_at) VALUES ($1, $2, $3, NOW())`, [new_price, admin_fee_fixed, admin_fee_percent]);
    await pool.query(`DELETE FROM stock_settings WHERE id NOT IN (SELECT id FROM stock_settings ORDER BY updated_at DESC LIMIT 15)`);
    return c.json({ status: "success", message: "✅ Price updated successfully", data: { price: new_price } });
  } catch (err) {
    return c.json({ status: "error", message: "فشل التحديث" }, 500);
  }
});

app.get('/investment', (c) => {
  return c.html('<h1>Investment Page (Please use Cloudflare Pages for static files)</h1>');
});

app.get('/api/total-stocks', async (c) => {
  try {
    const q = await pool.query(`SELECT COALESCE(SUM(stocks), 0) AS total_stocks FROM user_stocks`);
    return c.json({ status: "success", total_stocks: Number(q.rows[0].total_stocks) });
  } catch (err) {
    return c.json({ status: "error", message: "Failed to load total stocks" }, 500);
  }
});

app.all("/api/worker/verification/", (c) => {
  return c.json({ ok: true, status: "verified", method: c.req.method, server_time: new Date().toISOString() });
});

app.get('/api/user/profile', async (c) => {
  const user_id = c.req.query('user_id');
  if (!user_id) return c.json({ status: "error", message: "user_id is required" }, 400);
  try {
    const result = await pool.query('SELECT telegram_id, balance FROM users WHERE telegram_id = $1', [user_id]);
    if (result.rows.length > 0) {
      return c.json({ status: "success", data: { user_id: result.rows[0].telegram_id.toString(), fullname: `User ${result.rows[0].telegram_id}`, balance: parseFloat(result.rows[0].balance), membership: "Free" } });
    } else {
      await pool.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [user_id, 0]);
      return c.json({ status: "success", data: { user_id: user_id.toString(), fullname: `User ${user_id}`, balance: 0.0, membership: "Free" } });
    }
  } catch (err) {
    return c.json({ status: "error", message: "Server error" }, 500);
  }
});

app.get('/', (c) => c.text('✅ السيرفر يعمل! Postback جاهز.'));

// ... (تم اختصار بعض المسارات الطويلة للحفاظ على حجم الرد، لكن الكود أعلاه يغطي الأساسيات. إذا كنت تحتاج المسارات الأخرى مثل Tasks أو Withdraw، أخبرني وسأرسلها في رد منفصل، أو يمكنك استخدام نفس نمط التحويل: `req` -> `c.req`, `res.json` -> `return c.json`)

// ==========================================
// === تصدير التطبيق ليعمل كـ Cloudflare Worker ===
// ==========================================
export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    console.log("⏰ تشغيل معالج المبيعات المؤجلة (Cron)...");
    try {
      const now = new Date();
      const { rows } = await pool.query(`SELECT id, user_id, amount FROM pending_sales WHERE status = 'pending' AND release_date <= $1`, [now]);
      for (const sale of rows) {
        const result = await pool.query(`UPDATE pending_sales SET status = 'done' WHERE id = $1 AND status = 'pending'`, [sale.id]);
        if (result.rowCount === 1) {
          await pool.query(`UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`, [sale.amount, sale.user_id]);
        }
      }
    } catch (err) {
      console.error("Pending sales processor error:", err);
    }
  }
};
