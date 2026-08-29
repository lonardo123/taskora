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

// 3. التقاط أي أخطاء لاحقة في الـ pool (الآن أصبح آمناً 100% بسبب الخدعة في db.js)
pool.on('error', (err) => {
  console.error('⚠️ PG pool error:', err);
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
// صفحة لوحة تحكم الأدمن (Admin Tasks Panel)
// ==========================================
app.get('/admin-tasks.html', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>⚙️ Admin Tasks Panel</title>
      <style>
/* === Base Styles === */
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0f172a;color:#fff;min-height:100vh;line-height:1.6}
.container{max-width:1400px;margin:0 auto;padding:20px}
.card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #334155}
.card h3{color:#60a5fa;margin-bottom:15px;font-size:18px}
.btn{padding:10px 20px;border:none;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.2s}
.btn-primary{background:#3b82f6;color:white}.btn-primary:hover{background:#2563eb}
.btn-success{background:#22c55e;color:white}.btn-success:hover{background:#16a34a}
.btn-danger{background:#ef4444;color:white}.btn-danger:hover{background:#dc2626}
.btn-warning{background:#f59e0b;color:white}.btn-warning:hover{background:#d97706}
.btn-secondary{background:#64748b;color:white}.btn-secondary:hover{background:#475569}
.btn-sm{padding:6px 12px;font-size:13px}
.btn-group{display:flex;gap:10px;flex-wrap:wrap}
.input-group{margin-bottom:15px}
.input-group label{display:block;margin-bottom:5px;color:#94a3b8;font-size:14px}
.input-group input,.input-group textarea,.input-group select{
  width:100%;padding:12px;border:1px solid #475569;border-radius:8px;
  background:#1e293b;color:white;font-size:14px
}
.input-group input:focus,.input-group textarea:focus{outline:none;border-color:#3b82f6}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:12px;border-bottom:1px solid #334151;text-align:left}
th{background:#1e293b;color:#94a3b8;font-weight:600}
tr:hover{background:#1e293b/50}
.status-badge{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}
.status-pending{background:#f59e0b20;color:#f59e0b}
.status-approved{background:#22c55e20;color:#22c55e}
.status-rejected{background:#ef444420;color:#ef4444}
.status-paid{background:#3b82f620;color:#3b82f6}
.alert{padding:12px;border-radius:8px;margin-bottom:15px;font-size:14px}
.alert-success{background:#22c55e20;color:#22c55e;border:1px solid #22c55e40}
.alert-error{background:#ef444420;color:#ef4444;border:1px solid #ef444440}
.alert-info{background:#3b82f620;color:#60a5fa;border:1px solid #3b82f640}
.proof-item{background:#1e293b;border-radius:8px;padding:15px;margin-bottom:10px;border:1px solid #334155}
.proof-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.proof-content{color:#cbd5e1;font-size:14px;white-space:pre-wrap;background:#0f172a;padding:12px;border-radius:6px}
.proof-actions{display:flex;gap:10px;margin-top:10px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px}
.stat-card{background:#1e293b;padding:20px;border-radius:12px;text-align:center;border:1px solid #334155}
.stat-card h4{color:#94a3b8;font-size:14px;margin-bottom:5px}
.stat-card .value{font-size:24px;font-weight:600;color:#22c55e}
.stat-card .value.warning{color:#facc15}
.stat-card .value.danger{color:#ef4444}
.loading{text-align:center;padding:40px;color:#94a3b8}
.hidden{display:none!important}
.tabs{display:flex;gap:5px;margin-bottom:20px;border-bottom:1px solid #334155;padding-bottom:10px;flex-wrap:wrap}
.tab{padding:10px 20px;border-radius:8px 8px 0 0;cursor:pointer;background:#1e293b;color:#94a3b8;transition:all 0.2s}
.tab:hover{background:#334155}
.tab.active{background:#3b82f6;color:white}
.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:none;align-items:center;justify-content:center;z-index:1000}
.modal.active{display:flex}
.modal-content{background:#1e293b;border-radius:12px;padding:25px;width:90%;max-width:800px;max-height:90vh;overflow-y:auto}
.modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:15px;border-bottom:1px solid #334155}
.modal-close{background:none;border:none;color:#94a3b8;font-size:24px;cursor:pointer}
.modal-close:hover{color:white}
.section-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}
.request-item{background:#1e293b;border-radius:8px;padding:15px;margin-bottom:10px;border:1px solid #334155}
.request-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;gap:10px}
.request-info{flex:1}
.request-info p{margin:3px 0;font-size:13px;color:#cbd5e1}
.request-info strong{color:#fff}
.request-actions{display:flex;gap:8px;flex-wrap:wrap}
.txid-box{background:#0f172a;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:12px;color:#60a5fa;word-break:break-all}
.message-item{background:#1e293b;border-radius:8px;padding:15px;margin-bottom:10px;border-left:4px solid #3b82f6}
.message-header{display:flex;justify-content:space-between;margin-bottom:10px}
.message-user{font-weight:600;color:#60a5fa}
.message-time{color:#94a3b8;font-size:12px}
.message-text{color:#cbd5e1;margin:10px 0;white-space:pre-wrap}
.reply-box{margin-top:10px}
.balance-form{display:grid;grid-template-columns:1fr 1fr;gap:15px}
@media(max-width:768px){
  .btn-group{flex-direction:column}
  th,td{padding:8px;font-size:13px}
  .stats-grid{grid-template-columns:1fr 1fr}
  .balance-form{grid-template-columns:1fr}
  .tabs{overflow-x:auto;flex-wrap:nowrap}
  .tab{white-space:nowrap}
}
/* === Access Denied Page Styles === */
.access-denied{
  display:flex;justify-content:center;align-items:center;min-height:100vh;
  background:#0f172a;color:white;padding:20px
}
.access-denied-content{
  text-align:center;padding:40px;background:#1e293b;border-radius:12px;
  border:2px solid #ef4444;max-width:500px;box-shadow:0 10px 40px rgba(239,68,68,0.3)
}
.access-denied h2{color:#ef4444;margin-bottom:15px;font-size:24px}
.access-denied p{color:#94a3b8;margin:10px 0}
.access-denied .admin-id{
  background:#334155;padding:8px 12px;border-radius:6px;font-family:monospace;
  font-size:14px;color:#facc15;margin:10px 0;display:inline-block
}
.access-denied .btn{margin-top:20px;width:auto;padding:10px 30px}
/* === Quick Actions Bar === */
.quick-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:20px}
.quick-btn{
  padding:15px;border-radius:10px;border:none;cursor:pointer;
  font-weight:600;display:flex;flex-direction:column;align-items:center;
  gap:8px;transition:all 0.2s;text-align:center
}
.quick-btn:hover{transform:translateY(-2px);box-shadow:0 4px 20px rgba(0,0,0,0.3)}
.quick-btn.deposits{background:linear-gradient(135deg,#22c55e,#16a34a);color:white}
.quick-btn.withdrawals{background:linear-gradient(135deg,#3b82f6,#2563eb);color:white}
.quick-btn.add-balance{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:white}
.quick-btn.deduct-balance{background:linear-gradient(135deg,#ef4444,#dc2626);color:white}
.quick-btn.messages{background:linear-gradient(135deg,#f59e0b,#d97706);color:white}
.quick-btn.investment{background:linear-gradient(135deg,#06b6d4,#0891b2);color:white}
.quick-btn .icon{font-size:24px}
.quick-btn .label{font-size:13px}
 /* ✅ تنسيق مودال الرفض */
#rejectModal .modal-content {
  border-left: 4px solid #ef4444;
}
#rejectModal textarea {
  background: #0f172a;
  border: 1px solid #475569;
  color: #fff;
  resize: vertical;
}
#rejectModal textarea:focus {
  border-color: #ef4444;
  outline: none;
} 
/* ✅ مربع الرسالة أسفل كل طلب سحب */
.action-message {
  display: none;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.action-message.show {
  display: block !important;
  animation: fadeInDown 0.3s ease;
}
.action-message.success {
  background: #22c55e20;
  color: #22c55e;
  border: 1px solid #22c55e40;
}
.action-message.error {
  background: #ef444420;
  color: #ef4444;
  border: 1px solid #ef444440;
}
@keyframes fadeInDown {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

 /* ✅ رسائل داخل نماذج الرصيد */
.balance-message {
  display: none;
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  animation: slideIn 0.2s ease;
}
.balance-message.success {
  background: #dcfce7;
  color: #166534;
  border-left: 4px solid #22c55e;
  display: block;
}
.balance-message.error {
  background: #fef2f2;
  color: #991b1b;
  border-left: 4px solid #ef4444;
  display: block;
}

/* ✅ رسائل داخل قائمة الرسائل */
.message-action-result {
  display: none;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}
.message-action-result.success {
  background: #dcfce7;
  color: #166534;
  border-left: 4px solid #22c55e;
  display: block;
}
.message-action-result.error {
  background: #fef2f2;
  color: #991b1b;
  border-left: 4px solid #ef4444;
  display: block;
}


/* ✅ شارات الحالة */
.status-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.status-pending { background: #fef3c7; color: #92400e; }
.status-paid { background: #dcfce7; color: #166534; }
.status-rejected { background: #fee2e2; color: #991b1b; }

.done-badge {
  padding: 6px 14px;
  background: #f1f5f9;
  color: #64748b;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

/* ✅ تحديث العداد */
#pendingWithdrawalsCount {
  transition: all 0.3s ease;
}  
</style>
    </head>
    <body>

<!-- 🔐 Access Denied Page (Shown by default, hidden if access granted) -->
<div id="accessDenied" class="access-denied">
  <div class="access-denied-content">
    <h2>🔐 Access Denied</h2>
    <p>This page is restricted to admin only.</p>
    <p>Required parameter:</p>
    <p class="admin-id"></p>
    <p style="font-size:13px;color:#64748b;margin-top:15px">
      ❌ Invalid or missing admin_id parameter
    </p>
  </div>
</div>

<!-- ✅ Main Admin Content (Hidden by default, shown if access granted) -->
<div id="adminContent" class="hidden">
  <div class="container">
    
    <!-- Admin Header -->
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <h2>⚙️ Admin Tasks Management</h2>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="refreshAll()">🔄 Refresh All</button>
        <button class="btn btn-danger" onclick="logout()">🚪 Logout</button>
      </div>
    </div>

    <!-- Alert Messages -->
    <div id="alertBox" class="alert hidden"></div>

    <!-- Quick Actions Bar -->
    <div class="quick-actions">
      <button class="quick-btn deposits" onclick="showSection('deposits')">
        <span class="icon">📥</span>
        <span class="label">User Deposits</span>
      </button>
      <button class="quick-btn withdrawals" onclick="showSection('withdrawals')">
        <span class="icon">📤</span>
        <span class="label">User Withdrawals</span>
      </button>
      <button class="quick-btn add-balance" onclick="showSection('addBalance')">
        <span class="icon">➕</span>
        <span class="label">Add Balance</span>
      </button>
      <button class="quick-btn deduct-balance" onclick="showSection('deductBalance')">
        <span class="icon">➖</span>
        <span class="label">Deduct Balance</span>
      </button>
      <button class="quick-btn messages" onclick="showSection('messages')">
        <span class="icon">📬</span>
        <span class="label">User Messages</span>
      </button>
      <button class="quick-btn investment" onclick="openInvestmentPanel()">
        <span class="icon">📈</span>
        <span class="label">Investment Admin</span>
      </button>
    </div>

    <!-- Stats Dashboard -->
    <div class="stats-grid">
      <div class="stat-card">
        <h4>📋 Pending Proofs</h4>
        <div class="value warning" id="pendingProofsCount">0</div>
      </div>
      <div class="stat-card">
        <h4>⚠️ Open Disputes</h4>
        <div class="value danger" id="openDisputesCount">0</div>
      </div>
      <div class="stat-card">
        <h4>✅ Approved Today</h4>
        <div class="value" id="approvedTodayCount">0</div>
      </div>
      <div class="stat-card">
        <h4>💰 Admin Commission</h4>
        <div class="value" id="adminCommissionTotal">$0.00</div>
      </div>
      <div class="stat-card">
        <h4>📥 Pending Deposits</h4>
        <div class="value warning" id="pendingDepositsCount">0</div>
      </div>
      <div class="stat-card">
        <h4>📤 Pending Withdrawals</h4>
        <div class="value danger" id="pendingWithdrawalsCount">0</div>
      </div>
      <div class="stat-card">
        <h4>📬 Unread Messages</h4>
        <div class="value" id="unreadMessagesCount">0</div>
      </div>
      <div class="stat-card">
        <h4>👥 Total Users</h4>
        <div class="value" id="totalUsersCount">0</div>
      </div>
    </div>

    <!-- Tabs Navigation -->
    <div class="tabs">
      <div class="tab active" data-tab="deposits" onclick="switchTab('deposits')">📥 Deposits</div>
      <div class="tab" data-tab="withdrawals" onclick="switchTab('withdrawals')">📤 Withdrawals</div>
      <div class="tab" data-tab="balance" onclick="switchTab('balance')">💰 Balance</div>
      <div class="tab" data-tab="messages" onclick="switchTab('messages')">📬 Messages</div>
      <div class="tab" data-tab="proofs" onclick="switchTab('proofs')">📋 Pending Proofs</div>
      <div class="tab" data-tab="disputes" onclick="switchTab('disputes')">⚠️ Disputes</div>
      <div class="tab" data-tab="stats" onclick="switchTab('stats')">📊 Statistics</div>
    </div>

    <!-- 📥 Deposits Section -->
    <div id="depositsSection" class="card">
      <div class="section-title">
        <h3>📥 Pending Deposit Requests</h3>
        <button class="btn btn-sm btn-secondary" onclick="loadDeposits()">🔄 Refresh</button>
      </div>
      <div id="depositsList"></div>
    </div>

    <!-- ✅ Modal: Confirm Deposit Amount -->
<div id="approveDepositModal" class="modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; justify-content:center; align-items:center;">
  <div style="background:#fff; padding:20px; border-radius:12px; min-width:320px; max-width:90%;">
    <h3 style="margin:0 0 15px; color:#2c3e50;">✅ تأكيد مبلغ الإيداع</h3>
    <p style="margin:5px 0; font-size:14px;"><strong>User ID:</strong> <span id="modalUserId"></span></p>
    <p style="margin:5px 0; font-size:14px;"><strong>TXID:</strong> <span id="modalTxid" style="word-break:break-all;"></span></p>
    <p style="margin:5px 0; font-size:14px;"><strong>المبلغ المطلوب:</strong> $<span id="modalRequestedAmount"></span></p>
    
    <label style="display:block; margin:15px 0 5px; font-weight:600;">💰 المبلغ المراد إضافته للحساب ($):</label>
    <input type="number" id="modalFinalAmount" step="0.01" min="0" style="width:100%; padding:10px; border:2px solid #3498db; border-radius:6px; font-size:16px;">
    
    <div style="margin-top:20px; display:flex; gap:10px; justify-content:flex-end;">
      <button onclick="closeApproveModal()" style="padding:10px 20px; background:#95a5a6; color:#fff; border:none; border-radius:6px; cursor:pointer;">❌ إلغاء</button>
      <button onclick="confirmApproveDeposit()" style="padding:10px 20px; background:#27ae60; color:#fff; border:none; border-radius:6px; cursor:pointer;">✅ تأكيد وإضافة</button>
    </div>
  </div>
</div>
    
    <!-- ✅ Modal للرفض داخل الصفحة -->
<div id="rejectModal" class="modal">
  <div class="modal-content" style="max-width:500px">
    <div class="modal-header">
      <h3>❌ Reject Deposit #<span id="rejectDepositId"></span></h3>
      <button class="modal-close" onclick="closeModal('rejectModal')">&times;</button>
    </div>
    <p style="color:#94a3b8;margin-bottom:15px">
      User ID: <strong id="rejectUserId"></strong><br>
      Reason is optional. Leave empty for default reason.
    </p>
    <div class="input-group">
      <label>Reason for rejection (optional):</label>
      <textarea id="rejectReason" rows="3" placeholder="e.g., Invalid TxID, Not received, etc."></textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-secondary" onclick="closeModal('rejectModal')">Cancel</button>
      <button class="btn btn-danger" onclick="confirmReject()">❌ Confirm Reject</button>
    </div>
  </div>
</div>
    <!-- 📤 Withdrawals Section -->
    <div id="withdrawalsSection" class="card hidden">
      <div class="section-title">
        <h3>📤 Pending Withdrawal Requests</h3>
        <button class="btn btn-sm btn-secondary" onclick="loadWithdrawals()">🔄 Refresh</button>
      </div>
      <div id="withdrawalsList"></div>
    </div>

    <!-- ✅ مودال الموافقة/الرفض على السحب (بنفس نمط الايداع) -->
<div id="withdrawalModal" class="modal">
  <div class="modal-content" style="max-width:450px; border-top:4px solid #3b82f6;">
    <div class="modal-header">
      <h3 id="wModalTitle" style="margin:0;">Confirm Action</h3>
      <button class="modal-close" onclick="closeWithdrawalModal()">&times;</button>
    </div>
    <div style="background:#0f172a;padding:12px;border-radius:8px;margin:15px 0;">
      <p style="margin:5px 0;color:#94a3b8;font-size:13px;">👤 <strong>User ID:</strong> <span id="wModalUserId" style="color:#fff;"></span></p>
      <p style="margin:5px 0;color:#94a3b8;font-size:13px;">💰 <strong>Amount:</strong> <span id="wModalAmount" style="color:#f59e0b;"></span></p>
    </div>
    
    <div id="wModalReasonBox" class="input-group" style="display:none;">
      <label>Reason for rejection (optional):</label>
      <textarea id="wModalReason" rows="3" placeholder="e.g., Verification failed..."></textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeWithdrawalModal()">Cancel</button>
      <button id="wModalBtn" class="btn btn-primary" onclick="confirmWithdrawalAction()">Confirm</button>
    </div>
  </div>
</div>
    <!-- 💰 Balance Management Section -->
    <div id="balanceSection" class="card hidden">
      <h3>💰 User Balance Management</h3>
      
      <!-- ➕ Add Balance Form - مع منطقة رسالة -->
<div class="card" style="margin-bottom:15px">
  <h4 style="color:#22c55e;margin-bottom:15px">➕ Add Balance to User</h4>
  <div class="balance-form">
    <div class="input-group">
      <label>User Telegram ID</label>
      <input type="text" id="addBalanceUserId" placeholder="e.g., 7171208519">
    </div>
    <div class="input-group">
      <label>Amount ($)</label>
      <input type="number" id="addBalanceAmount" step="0.01" min="0.01" placeholder="e.g., 5.50">
    </div>
  </div>
  <div class="input-group">
    <label>Reason (optional)</label>
    <input type="text" id="addBalanceReason" placeholder="e.g., Bonus, Manual credit">
  </div>
  <!-- ✅ منطقة عرض الرسالة داخل النموذج -->
  <div class="balance-message" id="addBalanceMsg"></div>
  <button class="btn btn-success" onclick="openBalanceModal('add', document.getElementById('addBalanceUserId').value, document.getElementById('addBalanceAmount').value, 'Bonus, Manual credit...')">✅ Add Balance</button>
</div>

<!-- ➖ Deduct Balance Form - مع منطقة رسالة -->
<div class="card">
  <h4 style="color:#ef4444;margin-bottom:15px">➖ Deduct Balance from User</h4>
  <div class="balance-form">
    <div class="input-group">
      <label>User Telegram ID</label>
      <input type="text" id="deductBalanceUserId" placeholder="e.g., 7171208519">
    </div>
    <div class="input-group">
      <label>Amount ($)</label>
      <input type="number" id="deductBalanceAmount" step="0.01" min="0.01" placeholder="e.g., 2.00">
    </div>
  </div>
  <div class="input-group">
    <label>Reason (required)</label>
    <input type="text" id="deductBalanceReason" placeholder="e.g., Violation, Refund">
  </div>
  <!-- ✅ منطقة عرض الرسالة داخل النموذج -->
  <div class="balance-message" id="deductBalanceMsg"></div>
<button class="btn btn-danger" onclick="openBalanceModal('deduct', document.getElementById('deductBalanceUserId').value, document.getElementById('deductBalanceAmount').value, 'Violation, Refund...')">⚠️ Deduct Balance</button></div>
</div>    

    <!-- 💰 مودال إدارة الرصيد -->
<div id="balanceModal" class="modal">
  <div class="modal-content" style="max-width:450px; border-top:4px solid #3b82f6;">
    <div class="modal-header">
      <h3 id="bModalTitle" style="margin:0;">Confirm Action</h3>
      <button class="modal-close" onclick="closeBalanceModal()">&times;</button>
    </div>
    <div style="background:#0f172a;padding:12px;border-radius:8px;margin:15px 0;">
      <p style="margin:5px 0;color:#94a3b8;font-size:13px;">👤 <strong>User ID:</strong> <span id="bModalUserId" style="color:#fff;"></span></p>
      <p style="margin:5px 0;color:#94a3b8;font-size:13px;">💰 <strong>Amount:</strong> <span id="bModalAmount" style="color:#f59e0b;"></span></p>
    </div>
    <div id="bModalReasonBox" class="input-group">
      <label id="bModalReasonLabel">Reason:</label>
      <input type="text" id="bModalReason" placeholder="e.g., Bonus, Violation...">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeBalanceModal()">Cancel</button>
      <button id="bModalBtn" class="btn btn-primary" onclick="confirmBalanceAction()">Confirm</button>
    </div>
  </div>
</div>
    <!-- 📬 Messages Section -->
    <div id="messagesSection" class="card hidden">
      <div class="section-title">
        <h3>📬 User Messages</h3>
        <button class="btn btn-sm btn-secondary" onclick="loadMessages()">🔄 Refresh</button>
      </div>
      <div id="messagesList"></div>
    </div>

    <!-- 📬 مودال الرد على رسالة (بنمط الإيداع) -->
<div id="replyMessageModal" class="modal">
  <div class="modal-content" style="max-width:500px;">
    <div class="modal-header">
      <h3>📩 Reply to User #<span id="rModalUserId"></span></h3>
      <button class="modal-close" onclick="closeReplyMessageModal()">&times;</button>
    </div>
    
    <div style="background:#0f172a;padding:12px;border-radius:8px;margin:15px 0;">
      <p style="margin:5px 0;color:#94a3b8;font-size:13px;">👤 <strong>User:</strong> <span id="rModalUsername" style="color:#fff;"></span></p>
      <p style="margin:10px 0 5px;color:#94a3b8;font-size:13px;">💬 <strong>Original Message:</strong></p>
      <p id="rModalOriginalMsg" style="color:#cbd5e1;font-size:14px;white-space:pre-wrap;background:#1e293b;padding:10px;border-radius:6px;"></p>
    </div>
    
    <div class="input-group">
      <label>Your Reply:</label>
      <textarea id="rModalReply" rows="4" placeholder="Type your reply here..."></textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
      <button class="btn btn-secondary" onclick="closeReplyMessageModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmSendReply()">📤 Send Reply</button>
    </div>
  </div>
</div>
     <!-- Pending Proofs Section -->
    <div id="proofsSection" class="card hidden">
      <h3>📋 Pending Proofs Review</h3>
      <div id="pendingProofsList"></div>
    </div>

    <!-- Disputes Section -->
    <div id="disputesSection" class="card hidden">
      <h3>⚠️ Open Disputes</h3>
      <div id="disputesList"></div>
    </div>

    <!-- Statistics Section -->
    <div id="statsSection" class="card hidden">
      <h3>📊 Commission Statistics</h3>
      <div id="statsContent"></div>
    </div>

  </div>
</div>

 <!-- Resolve Dispute Modal -->
<div id="resolveModal" class="modal">
  <div class="modal-content">
    <div class="modal-header">
      <h3>⚖️ Resolve Dispute #<span id="resolveDisputeId"></span></h3>
      <button class="modal-close" onclick="closeModal('resolveModal')">&times;</button>
    </div>
    <div class="alert alert-info">Review the proof and decide the outcome.</div>
    
    <!-- ✅ هذا العنصر مطلوب لعرض الإثبات -->
    <div id="resolveProofContent" style="margin:15px 0"></div>
    
    <div class="input-group">
      <label>Decision:</label>
      <select id="resolveDecision">
        <option value="executor">✅ Pay executor (full amount)</option>
        <option value="none">❌ No payment (refund to creator)</option>
      </select>
    </div>
    <div class="input-group">
      <label>Resolution Note:</label>
      <textarea id="resolveNote" rows="3" placeholder="Add a note about this decision..."></textarea>
    </div>
    <!-- ✅ تأكد أن onclick يستدعي submitResolution() -->
    <button class="btn btn-success" onclick="submitResolution()">✅ Submit Decision</button>
  </div>
</div>

<script>
// ================= CONFIG =================
const API = "https://taskora.taskora.workers.dev";
const REQUIRED_ADMIN_ID = "7171208519";
const BOT_USERNAME = "TasksRewardBot";

// ================= 🔐 ACCESS CONTROL =================
function checkAdminAccess() {
  const url = window.location.href;
  let adminIdFromUrl = null;
  
  try {
    const urlObj = new URL(url);
    adminIdFromUrl = urlObj.searchParams.get('admin_id');
  } catch (e) {
    const match = url.match(/[?&]admin_id=([^&]+)/);
    if (match && match[1]) {
      adminIdFromUrl = decodeURIComponent(match[1].trim());
    }
  }
  
  if (!adminIdFromUrl || adminIdFromUrl.toString().trim() !== REQUIRED_ADMIN_ID) {
    console.error('🔐 Access denied. Required: admin_id=' + REQUIRED_ADMIN_ID);
    document.getElementById('accessDenied').style.display = 'flex';
    document.getElementById('adminContent').classList.add('hidden');
    return false;
  }
  
  console.log('✅ Admin access granted');
  document.getElementById('accessDenied').style.display = 'none';
  document.getElementById('adminContent').classList.remove('hidden');
  localStorage.setItem('admin_verified', 'true');
  localStorage.setItem('admin_id', REQUIRED_ADMIN_ID);
  return true;
}

// ================= INIT =================
window.addEventListener('load', async () => {
  const hasAccess = checkAdminAccess();
  if (!hasAccess) return;
  await loadDashboardStats();
  await loadTotalUsers(); 
  await loadDeposits();
  await loadMessages();
  await loadPendingProofs();
  await loadDisputes();
  await loadCommissionStats();
});

// ================= UTILS =================
function showAlert(msg, type) {
  const el = document.getElementById('alertBox');
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add('active');
  
  const sections = ['deposits', 'withdrawals', 'balance', 'messages', 'proofs', 'disputes', 'stats'];
  sections.forEach(s => {
    const sec = document.getElementById(s + 'Section');
    if (sec) sec.classList.add('hidden');
  });
  
  const section = document.getElementById(tab + 'Section');
  if (section) {
    section.classList.remove('hidden');
    switch(tab) {
      case 'deposits': loadDeposits(); break;
      case 'withdrawals': loadWithdrawals(); break;
      case 'messages': loadMessages(); break;
      case 'proofs': loadPendingProofs(); break;
      case 'disputes': loadDisputes(); break;
      case 'stats': loadCommissionStats(); break;
      // balance section has manual forms, no auto-load
    }
  }
}

function showSection(section) {
  const tabMap = {
    'deposits': 'deposits', 'withdrawals': 'withdrawals',
    'addBalance': 'balance', 'deductBalance': 'balance',
    'messages': 'messages', 'proofs': 'proofs',
    'disputes': 'disputes', 'stats': 'stats'
  };
  switchTab(tabMap[section] || section);
}

function formatPrice(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '$0.0000';
  return '$' + parseFloat(amount).toFixed(4);
}

function formatDate(date) {
  if (!date) return 'N/A';
  try {
    return new Date(date).toLocaleString('en-US', { 
      year:'numeric', month:'short', day:'numeric', 
      hour:'2-digit', minute:'2-digit' 
    });
  } catch (e) { return 'Invalid Date'; }
}

function truncate(text, len = 50) {
  if (!text) return '';
  return text.length > len ? text.substring(0, len) + '...' : text;
}

function logout() {
  localStorage.removeItem('admin_verified');
  localStorage.removeItem('admin_id');
  window.location.href = window.location.pathname;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showAlert('📋 Copied to clipboard', 'success');
    return true;
  } catch (err) {
    showAlert('⚠️ Failed to copy', 'error');
    return false;
  }
}

// ================= 📈 INVESTMENT PANEL =================
function openInvestmentPanel() {
  const url = `${API}/admin-investment.html?admin_id=${REQUIRED_ADMIN_ID}`;
  window.open(url, '_blank', 'width=1200,height=800');
}

// ================= 🚀 TELEGRAM DEEP LINKS (Fallback) =================
function openTelegramSection(command, hint) {
  const url = `https://t.me/${BOT_USERNAME}?start=admin`;
  showAlert(`📱 Opening bot...\n⚙️ Tap: "${hint}"`, 'info');
  const win = window.open(url, '_blank');
  if (!win || win.closed) {
    copyToClipboard(`/${command}`).then(() => {
      showAlert(`📋 Copied /${command} - paste in Telegram bot`, 'success');
    });
  }
  setTimeout(() => {
    showAlert(`💡 If bot didn't open, paste this in Telegram:\n\`/${command}\``, 'info');
  }, 3000);
}

 // ================= 👥 Total Users =================
async function loadTotalUsers() {
  const element = document.getElementById('totalUsersCount');
  if (!element) return;
  
  try {
    const res = await fetch(`${API}/api/admin/stats/total-users?admin_id=${REQUIRED_ADMIN_ID}`);
    
    if (!res.ok) throw new Error('Failed to fetch total users');
    
    const data = await res.json();
    
    if (data.success) {
      // ✅ تحديث العدد مع تأثير عدّاد بسيط
      animateNumber(element, data.data.total_users);
    } else {
      element.textContent = '0';
      console.warn('⚠️ Could not load total users:', data.message);
    }
    
  } catch (err) {
    console.error('❌ loadTotalUsers:', err);
    element.textContent = '0';
  }
}

// 🎬 دالة مساعدة: تأثير عدّاد الأرقام
function animateNumber(element, target, duration = 500) {
  const start = parseInt(element.textContent) || 0;
  const increment = target > start ? Math.ceil((target - start) / (duration / 16)) : -Math.ceil((start - target) / (duration / 16));
  let current = start;
  
  const timer = setInterval(() => {
    current += increment;
    if ((increment > 0 && current >= target) || (increment < 0 && current <= target)) {
      element.textContent = target.toLocaleString();
      clearInterval(timer);
    } else {
      element.textContent = current.toLocaleString();
    }
  }, 16);
} 
// ================= DASHBOARD STATS =================
async function loadDashboardStats() {
  try {
    const res = await fetch(`${API}/api/admin/stats?admin_id=${REQUIRED_ADMIN_ID}`);

    if (!res.ok) {
      console.error('Stats error:', res.status);
      return;
    }

    const data = await res.json();
    
    if (data.success) {
      document.getElementById('pendingProofsCount').textContent = data.data.pending_proofs ?? 0;
      document.getElementById('openDisputesCount').textContent = data.data.open_disputes ?? 0;
      document.getElementById('approvedTodayCount').textContent = data.data.approved_today ?? 0;
      document.getElementById('adminCommissionTotal').textContent = formatPrice(data.data.admin_commission ?? 0);

      // ✅ إضافة ربط باقي الإحصائيات (موجودة عندك في HTML)
      document.getElementById('pendingDepositsCount').textContent = data.data.pending_deposits ?? 0;
      document.getElementById('pendingWithdrawalsCount').textContent = data.data.pending_withdrawals ?? 0;
      document.getElementById('unreadMessagesCount').textContent = data.data.unread_messages ?? 0;
      
    }
  } catch (err) {
    console.error('❌ loadDashboardStats:', err);
  }
}

// ================= 📥 DEPOSITS =================
async function loadDeposits() {
  const list = document.getElementById('depositsList');
  list.innerHTML = '<div class="loading">Loading deposit requests...</div>';
  
  try {
    // ✅ جلب الإيداعات المعلقة من السيرفر مباشرة
    const res = await fetch(`${API}/api/admin/deposits?admin_id=${REQUIRED_ADMIN_ID}&status=pending`);
    
    if (!res.ok) throw new Error('Failed to fetch deposits');
    
    const data = await res.json();
    
    // ✅ التعامل مع حالة عدم وجود إيداعات معلقة
    if (!data.success || !data.data?.length) {
      list.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:20px">✅ No pending deposit requests</p>';
      document.getElementById('pendingDepositsCount').textContent = '0';
      return;
    }
    
    // ✅ تحديث عداد الإيداعات المعلقة
    document.getElementById('pendingDepositsCount').textContent = data.data.length;
    
    // ✅ عرض قائمة الإيداعات
    list.innerHTML = data.data.map(dep => `
      <div class="request-item">
        <div class="request-header">
          <div class="request-info">
            <p><strong>👤 User:</strong> @${dep.username || dep.user_id} <span style="color:#64748b">(ID: ${dep.user_id})</span></p>
            <p><strong>🔗 TxID:</strong> <span class="txid-box">${dep.txid}</span></p>
            <p><strong>📅 Submitted:</strong> ${formatDate(dep.created_at)}</p>
            <p><strong>💰 Amount:</strong> <span style="color:#22c55e">$${parseFloat(dep.amount).toFixed(2)}</span></p>
          </div>
          <div class="request-actions">
            <!-- ✅ زر الموافقة مع البيانات الصحيحة -->
            <button class="btn-approve" 
                    onclick="openApproveModal(this)" 
                    data-deposit-id="${dep.id}" 
                    data-user-id="${dep.user_id}" 
                    data-txid="${dep.txid || ''}" 
                    data-amount="${dep.amount}"
                    style="padding:8px 16px; background:#27ae60; color:#fff; border:none; border-radius:6px; cursor:pointer;">
              ✅ Approve
            </button>
            <!-- زر الرفض -->
            <button class="btn btn-danger btn-sm" onclick="rejectDeposit(${dep.id}, ${dep.user_id})">❌ Reject</button>
          </div>
        </div>
      </div>
    `).join('');
    
  } catch (err) {
    console.error('❌ loadDeposits:', err);
    // ✅ رسالة خطأ بديلة بدون إشارة للبوت
    list.innerHTML = `
      <div class="alert alert-warning" style="padding:15px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;margin:10px 0;">
        ⚠️ Failed to load deposits. Please refresh or check server connection.<br>
        <button class="btn btn-primary btn-sm" onclick="loadDeposits()" style="margin-top:10px;padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">
          🔄 Retry
        </button>
      </div>`;
  }
}
// ========================
// 📦 متغير مؤقت لبيانات الموافقة
// ========================
let pendingApproveData = null;

// 🔓 فتح مودال إدخال المبلغ
function openApproveModal(btn) {
  const depositId = btn.dataset.depositId;
  const userId = btn.dataset.userId;
  const txid = btn.dataset.txid;
  const requestedAmount = parseFloat(btn.dataset.amount) || 0;
  
  // تعبئة بيانات المودال
  document.getElementById('modalUserId').textContent = userId;
  document.getElementById('modalTxid').textContent = txid || 'N/A';
  document.getElementById('modalRequestedAmount').textContent = requestedAmount.toFixed(2);
  document.getElementById('modalFinalAmount').value = requestedAmount.toFixed(2);
  
  // تخزين البيانات للمعالجة
  pendingApproveData = { depositId, userId, requestedAmount };
  
  // إظهار المودال
  document.getElementById('approveDepositModal').style.display = 'flex';
}

// ❌ إغلاق المودال
function closeApproveModal() {
  document.getElementById('approveDepositModal').style.display = 'none';
  pendingApproveData = null;
}

// ✅ تأكيد الموافقة وإرسال الطلب للسيرفر
async function confirmApproveDeposit() {
  if (!pendingApproveData) return;
  
  const finalAmount = parseFloat(document.getElementById('modalFinalAmount').value);
  if (isNaN(finalAmount) || finalAmount <= 0) {
    showAlert('⚠️ يرجى إدخال مبلغ صحيح أكبر من 0', 'error');
    return;
  }
  
  const btn = event.target;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Processing...';
  
  try {
    const response = await fetch(`${API}/api/admin/deposits/${pendingApproveData.depositId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_id: REQUIRED_ADMIN_ID,
        user_id: pendingApproveData.userId,
        final_amount: finalAmount  // 🆕 المبلغ الجديد
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showAlert('✅ ' + data.message, 'success');
      closeApproveModal();
      loadDeposits();
      loadDashboardStats();
    } else {
      showAlert('❌ ' + (data.message || 'Failed'), 'error');
    }
  } catch (err) {
    console.error('❌ Error:', err);
    showAlert('⚠️ Connection error', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// متغير عالمي لتخزين بيانات الرفض المؤقت
let pendingReject = null;

// ✅ دالة فتح نموذج الرفض (بدون prompt)
function openRejectModal(depositId, userId) {
  pendingReject = { depositId, userId };
  document.getElementById('rejectDepositId').textContent = depositId;
  document.getElementById('rejectUserId').textContent = userId;
  document.getElementById('rejectReason').value = ''; // مسح أي نص سابق
  openModal('rejectModal');
}

// ✅ دالة تأكيد الرفض (تُستدعى عند الضغط على الزر داخل المودال)
async function confirmReject() {
  if (!pendingReject) return;
  
  const { depositId, userId } = pendingReject;
  const reason = document.getElementById('rejectReason').value.trim() || 'Does not meet requirements';
  
  try {
    const res = await fetch(`${API}/api/admin/deposits/${depositId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        admin_id: REQUIRED_ADMIN_ID, 
        reason: reason 
      })
    });
    const data = await res.json();
    
    if (data.success) {
      showAlert('❌ Deposit rejected', 'success');
      closeModal('rejectModal');
      loadDeposits();      // تحديث القائمة
      loadDashboardStats(); // تحديث الإحصائيات
    } else {
      showAlert('❌ ' + (data.message || 'Failed to reject'), 'error');
    }
  } catch (err) {
    console.error('❌ confirmReject:', err);
    showAlert('⚠️ Connection error. Please try again.', 'error');
  }
  
  // مسح البيانات المؤقتة
  pendingReject = null;
}

// ✅ دالة رفض الإيداع (تُستدعى من زر الرفض في القائمة)
async function rejectDeposit(depositId, userId) {
  // فتح المودال بدلاً من prompt
  openRejectModal(depositId, userId);
}
// ================= 📤 WITHDRAWALS =================

let currentWithdrawalId = null;  
  
  async function loadWithdrawals() {
  const list = document.getElementById('withdrawalsList');
  const countEl = document.getElementById('pendingWithdrawalsCount');
  
  if (!list) return;
  list.innerHTML = '<div class="loading">Loading withdrawal requests...</div>';
  
  try {
    const res = await fetch(`${API}/api/admin/withdrawals?status=pending&admin_id=${REQUIRED_ADMIN_ID}`);
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    
    if (!data.success || !data.data?.length) {
      list.innerHTML = '<p class="empty-state">✅ No pending withdrawal requests</p>';
      if (countEl) countEl.textContent = '0';
      return;
    }
    
    if (countEl) countEl.textContent = data.data.length;
    
    // ✅ عرض القائمة مع عنصر الرسالة الداخلي
    list.innerHTML = data.data.map(wd => `
  <div class="request-item" id="withdrawal-${wd.id}">
    <div class="request-header">
      <div class="request-info">
        <p><strong>👤 User:</strong> <span style="color:#64748b">(ID: ${wd.user_id})</span></p>
        <p><strong>💳 Payeer:</strong> <span class="txid-box">${wd.payeer_wallet || 'N/A'}</span></p>
        <p><strong>📅 Requested:</strong> ${formatDate(wd.requested_at)}</p>
        <p><strong>💰 Amount:</strong> <span style="color:#f59e0b">$${parseFloat(wd.amount).toFixed(2)}</span></p>
        <p><strong>📊 Status:</strong> <span class="status-badge status-pending">⏳ Pending</span></p>
      </div>
      <div class="request-actions">
  <button class="btn btn-success btn-sm" onclick="openWithdrawalModal('approve', ${wd.id}, ${wd.user_id}, ${wd.amount})">✅ Approve</button>
  <button class="btn btn-danger btn-sm" onclick="openWithdrawalModal('reject', ${wd.id}, ${wd.user_id}, ${wd.amount})">❌ Reject</button>
</div>
    </div>
    <!-- ✅ الحاوية التي ستظهر فيها الرسالة أسفل الطلب مباشرة -->
    <div class="action-message" id="msg-${wd.id}"></div>
  </div>
`).join('');
    
  } catch (err) {
    console.error('❌ loadWithdrawals:', err);
    list.innerHTML = `<div class="alert alert-error">⚠️ Failed to load withdrawals.<br><button onclick="loadWithdrawals()">🔄 Retry</button></div>`;
  }
}

// ================= 🪟 مودال السحب (موافقة/رفض) =================
let pendingWithdrawal = null;

function openWithdrawalModal(type, wdId, userId, amount) {
  // ✅ التأكد من إغلاق أي مودال مفتوح مسبقاً
  closeWithdrawalModal();
  
  // ✅ إنشاء كائن جديد تماماً (ليس مرجعاً)
  pendingWithdrawal = { 
    type: String(type), 
    wdId: Number(wdId), 
    userId: Number(userId), 
    amount: Number(amount) 
  };
  
  console.log('🪟 Opening modal for:', pendingWithdrawal);
  
  // ✅ تحديث عناصر المودال
  const userIdEl = document.getElementById('wModalUserId');
  const amountEl = document.getElementById('wModalAmount');
  const reasonBox = document.getElementById('wModalReasonBox');
  const btn = document.getElementById('wModalBtn');
  
  if (userIdEl) userIdEl.textContent = userId;
  if (amountEl) amountEl.textContent = '$' + parseFloat(amount).toFixed(2);
  
  const reasonInput = document.getElementById('wModalReason');
  if (reasonInput) reasonInput.value = '';
  
  if (type === 'approve') {
    document.getElementById('wModalTitle').textContent = '✅ Approve Withdrawal';
    if (reasonBox) reasonBox.style.display = 'none';
    if (btn) {
      btn.textContent = '✅ Approve';
      btn.className = 'btn btn-success';
      btn.onclick = () => confirmWithdrawalAction();
    }
  } else {
    document.getElementById('wModalTitle').textContent = '❌ Reject Withdrawal';
    if (reasonBox) reasonBox.style.display = 'block';
    if (btn) {
      btn.textContent = '❌ Reject';
      btn.className = 'btn btn-danger';
      btn.onclick = () => confirmWithdrawalAction();
    }
  }
  
  // ✅ عرض المودال
  const modal = document.getElementById('withdrawalModal');
  if (modal) modal.classList.add('active');
}

function closeWithdrawalModal() {
  const modal = document.getElementById('withdrawalModal');
  if (modal) modal.classList.remove('active');
  
  // ✅ إعادة تعيين المتغيرات بشكل كامل
  pendingWithdrawal = null;
  currentWithdrawalId = null;
  
  // ✅ تفريغ حقول المودال
  const reasonInput = document.getElementById('wModalReason');
  if (reasonInput) reasonInput.value = '';
  
  // ✅ إعادة زر التأكيد لحالته الأصلية
  const btn = document.getElementById('wModalBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Confirm';
  }
  
  console.log('🔄 Modal closed and reset');
}

async function confirmWithdrawalAction() {
  // ✅ التأكد من وجود بيانات السحب الحالي
  if (!pendingWithdrawal || !pendingWithdrawal.wdId) {
    console.error('❌ No pending withdrawal data');
    showAlert('⚠️ Error: No withdrawal selected', 'error');
    return;
  }
  
  const { type, wdId, userId, amount } = pendingWithdrawal;
  const btn = document.getElementById('wModalBtn');
  const originalText = btn.textContent;
  
  // ✅ منع النقر المتكرر
  if (btn.disabled) return;
  
  btn.disabled = true;
  btn.textContent = '⏳ Processing...';
  
  try {
    const action = type === 'approve' ? 'approve' : 'reject';
    
    // ✅ بناء الرابط مع admin_id لضمان التوافق
    const baseUrl = `${API || ''}/api/admin/withdrawals/${wdId}/${action}`;
    const fetchUrl = `${baseUrl}?admin_id=${REQUIRED_ADMIN_ID}`;
    
    // ✅ إرسال admin_id في الجسم أيضاً
    const body = { admin_id: REQUIRED_ADMIN_ID };
    if (type === 'reject') {
      body.reason = document.getElementById('wModalReason')?.value?.trim() || 'Verification failed';
    }
    
    console.log(`📤 Sending ${action} request for withdrawal #${wdId}`);
    
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    const data = await res.json();
    console.log('📥 Server response:', data);
    
    if (data.success) {
      // ✅ إغلاق المودال وإعادة تعيينه فوراً
      closeWithdrawalModal();
      showAlert(data.message, 'success');
      
      // ✅ إزالة العنصر من القائمة فوراً (بدلاً من مجرد تغيير الشكل)
      const itemEl = document.getElementById(`withdrawal-${wdId}`);
      if (itemEl) {
        itemEl.style.transition = 'opacity 0.3s, transform 0.3s';
        itemEl.style.opacity = '0';
        itemEl.style.transform = 'translateX(20px)';
        setTimeout(() => {
          if (itemEl.parentNode) itemEl.parentNode.removeChild(itemEl);
          updatePendingWithdrawalsCount(-1);
        }, 300);
      }
      
      // ✅ تحديث الإحصائيات
      if (typeof loadDashboardStats === 'function') {
        loadDashboardStats();
      }
      
      // ✅ إعادة تحميل القائمة بعد ثانية لضمان التحديث الكامل
      setTimeout(() => {
        if (document.getElementById('withdrawalsSection')?.classList.contains('hidden') === false) {
          loadWithdrawals();
        }
      }, 1000);
      
    } else {
      showAlert(data.message || 'Operation failed', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch (err) {
    console.error(`❌ ${type} action failed:`, err);
    showAlert('⚠️ Connection error: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
// إغلاق المودال عند النقر خارجه
document.getElementById('withdrawalModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeWithdrawalModal();
});
  
// 📊 تحديث عداد الطلبات المعلقة
function updatePendingWithdrawalsCount(change) {
  const el = document.getElementById('pendingWithdrawalsCount');
  if (!el) return;
  let current = parseInt(el.textContent) || 0;
  let newValue = Math.max(0, current + change);
  el.textContent = newValue;
  // تأثير بسيط
  el.style.transform = 'scale(1.2)';
  setTimeout(() => el.style.transform = 'scale(1)', 200);
}

 // ================= 🪟 مربع نتيجة السحب المنبثق =================
function showWithdrawalResult(type, message) {
  const modal = document.getElementById('withdrawalResultModal');
  const icon = document.getElementById('wResultIcon');
  const title = document.getElementById('wResultTitle');
  const msg = document.getElementById('wResultMsg');
  
  if (type === 'success') {
    icon.textContent = '✅';
    title.textContent = 'تمت العملية بنجاح';
    title.style.color = '#22c55e';
    modal.querySelector('.modal-content').style.borderTopColor = '#22c55e';
  } else {
    icon.textContent = '❌';
    title.textContent = 'فشل أو تم الرفض';
    title.style.color = '#ef4444';
    modal.querySelector('.modal-content').style.borderTopColor = '#ef4444';
  }
  
  msg.textContent = message;
  modal.classList.add('active');
}

function closeWithdrawalResultModal() {
  document.getElementById('withdrawalResultModal').classList.remove('active');
}

// إغلاق المودال عند النقر خارجه
document.getElementById('withdrawalResultModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeWithdrawalResultModal();
}); 
// ================= 💰 مودال إدارة الرصيد =================
let pendingBalanceAction = null;

function openBalanceModal(type, userId, amount, reasonPlaceholder) {
  // التحقق من ID والمبلغ فقط قبل فتح المودال
  if (!userId || !amount || parseFloat(amount) <= 0) {
    showAlert('❌ Fill all fields (User ID and valid Amount required)', 'error');
    return;
  }
  
  pendingBalanceAction = { type, userId, amount };
  
  document.getElementById('bModalUserId').textContent = userId;
  document.getElementById('bModalAmount').textContent = '$' + parseFloat(amount).toFixed(2);
  document.getElementById('bModalReason').value = '';
  document.getElementById('bModalReasonLabel').textContent = type === 'add' ? 'Reason (optional):' : 'Reason (required):';
  document.getElementById('bModalReason').placeholder = reasonPlaceholder;
  
  const btn = document.getElementById('bModalBtn');
  const modal = document.getElementById('balanceModal');
  
  if (type === 'add') {
    modal.querySelector('.modal-content').style.borderTopColor = '#22c55e';
    btn.textContent = '✅ Add Balance';
    btn.className = 'btn btn-success';
  } else {
    modal.querySelector('.modal-content').style.borderTopColor = '#ef4444';
    btn.textContent = '⚠️ Deduct Balance';
    btn.className = 'btn btn-danger';
  }
  
  modal.classList.add('active');
}

function closeBalanceModal() {
  document.getElementById('balanceModal').classList.remove('active');
  pendingBalanceAction = null;
}

async function confirmBalanceAction() {
  if (!pendingBalanceAction) return;
  
  const { type, userId, amount } = pendingBalanceAction;
  const reason = document.getElementById('bModalReason').value.trim();
  const btn = document.getElementById('bModalBtn');
  
 // ✅ الجديد (أكثر وضوحاً للمستخدم)
if (type === 'deduct' && (!reason || reason.trim().length < 1)) {
  showAlert('❌ Reason is required (min 1 character)', 'error');
  return;
}
  
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Processing...';
  
  try {
    const endpoint = type === 'add' ? '/api/admin/balance/add' : '/api/admin/balance/deduct';
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        admin_id: REQUIRED_ADMIN_ID, 
        user_id: userId,
        amount: parseFloat(amount),
        reason: reason || (type === 'add' ? 'Manual credit' : ''),
        source: 'admin_panel'
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      showAlert(data.message, 'success');
      closeBalanceModal();
      // تفريغ الحقول
      ['addBalanceUserId','addBalanceAmount','addBalanceReason','deductBalanceUserId','deductBalanceAmount','deductBalanceReason'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = '';
      });
      loadDashboardStats();
    } else {
      showAlert(data.message || 'Failed', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch (err) {
    console.error('❌ balance action:', err);
    showAlert('⚠️ Connection error', 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// إغلاق المودال عند النقر خارجه
document.getElementById('balanceModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeBalanceModal();
});
// ================= 📬 MESSAGES =================
async function loadMessages() {
  const list = document.getElementById('messagesList');
  if (!list) return;
  
  list.innerHTML = '<div class="loading">Loading user messages...</div>';
  
  try {
    // ✅ جلب الرسائل غير المُجاب عليها فقط (حسب السيرفر)
    const res = await fetch(`${API}/api/admin/messages?admin_id=${REQUIRED_ADMIN_ID}&status=unread`);
    
    if (!res.ok) throw new Error('Failed to fetch messages');
    
    const data = await res.json();
    
    // ✅ عرض رسالة عند عدم وجود رسائل غير مقروءة
    if (!data.success || !data.data?.length) {
      list.innerHTML = '<p style="text-align:center;color:#22c55e;padding:20px">✅ All messages have been replied</p>';
      document.getElementById('unreadMessagesCount').textContent = '0';
      return;
    }
    
    // ✅ تحديث عداد الرسائل غير المقروءة
    document.getElementById('unreadMessagesCount').textContent = data.data.length;
    
    // ✅ عرض القائمة (فقط الرسائل غير المُجاب عليها)
    list.innerHTML = data.data.map(msg => `
      <div class="message-item" id="msg-item-${msg.id}" style="border-left:4px solid #f59e0b;">
        <div class="message-header">
          <span class="message-user">@${msg.username || msg.user_id} (ID: ${msg.user_id})</span>
          <span class="message-time">${formatDate(msg.created_at)}</span>
          <span style="padding:2px 8px;background:#f59e0b;color:#fff;border-radius:12px;font-size:11px;">🔴 Unread</span>
        </div>
        <div class="message-text" style="margin:10px 0;padding:10px;background:#1e293b;border-radius:6px;">${msg.message || 'No content'}</div>
        
        <div class="reply-box" style="margin-top:10px;">
          <button class="btn btn-primary btn-sm" onclick="openReplyMessageModal(${msg.id}, '${(msg.username || msg.user_id).replace(/'/g, "\\'")}', '${(msg.message || '').replace(/'/g, "\\'").replace(/\n/g, '\\n')}')">
  📩 Reply Now
</button>
        </div>
      </div>
    `).join('');
    
  } catch (err) {
    console.error('❌ loadMessages:', err);
    list.innerHTML = `
      <div class="alert alert-warning" style="padding:15px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;margin:10px 0;">
        ⚠️ Failed to load messages.<br>
        <button class="btn btn-primary btn-sm" onclick="loadMessages()" style="margin-top:10px;padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">
          🔄 Retry
        </button>
      </div>`;
  }
}

// ================= 📬 مودال الرد على الرسائل =================
let pendingReplyMsg = null;

function openReplyMessageModal(msgId, username, originalMsg) {
  pendingReplyMsg = { msgId, username, originalMsg };
  
  // ✅ حماية من أخطاء null
  const uidEl = document.getElementById('rModalUserId');
  const unameEl = document.getElementById('rModalUsername');
  const origEl = document.getElementById('rModalOriginalMsg');
  const replyEl = document.getElementById('rModalReply');
  const modal = document.getElementById('replyMessageModal');
  
  if(uidEl) uidEl.textContent = msgId;
  if(unameEl) unameEl.textContent = '@' + username;
  if(origEl) origEl.textContent = originalMsg || 'No content';
  if(replyEl) replyEl.value = '';
  
  if(modal) modal.classList.add('active');
}

function closeReplyMessageModal() {
  const modal = document.getElementById('replyMessageModal');
  if(modal) modal.classList.remove('active');
  pendingReplyMsg = null;
}

async function confirmSendReply() {
  if (!pendingReplyMsg) return showAlert('⚠️ No message selected', 'error');

  // ✅ حفظ msgId لتجنب null بعد إغلاق المودال
  const msgId = pendingReplyMsg.msgId;

  const reply = document.getElementById('rModalReply')?.value?.trim();
  const btn = document.querySelector('#replyMessageModal .btn-primary');

  if (!reply) return showAlert('❌ Please enter a reply message', 'error');

  const originalText = btn ? btn.textContent : '📤 Send Reply';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending...'; }

  try {
    const res = await fetch(`${API}/api/admin/messages/${msgId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_id: REQUIRED_ADMIN_ID, reply })
    });

    // ✅ التأكد من أن الرد ناجح
    if (!res.ok) {
      throw new Error('Server error');
    }

    // ✅ قراءة JSON بشكل صحيح
    const data = await res.json();

    // ✅ نجاح العملية
    if (data.success) {
      showAlert('✅ Reply sent successfully', 'success');

      // إزالة الرسالة من القائمة
      const item = document.getElementById(`msg-item-${msgId}`);
      if (item) item.remove();

      // تحديث العداد
      const countEl = document.getElementById('unreadMessagesCount');
      if (countEl) {
        countEl.textContent = Math.max(0, (parseInt(countEl.textContent) || 0) - 1);
      }

      closeReplyMessageModal();
      loadDashboardStats();

    } else {
      showAlert('❌ ' + (data.message || 'Failed to send reply'), 'error');
    }

  } catch (err) {
    console.error('❌ Reply Error:', err);
    showAlert('⚠️ ' + (err.message || 'Connection error'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}  


// إغلاق المودال عند النقر خارجه
document.getElementById('replyMessageModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeReplyMessageModal();
});
// ================= PENDING PROOFS =================
async function loadPendingProofs() {
  const list = document.getElementById('pendingProofsList');
  list.innerHTML = '<div class="loading">Loading pending proofs...</div>';
  
  try {
    const res = await fetch(`${API}/api/admin/pending-proofs?user_id=${REQUIRED_ADMIN_ID}`);
    const data = await res.json();
    
    if (!data.success || !data.data?.length) {
      list.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:20px">✅ No pending proofs to review</p>';
      document.getElementById('pendingProofsCount').textContent = '0';
      return;
    }
    
    document.getElementById('pendingProofsCount').textContent = data.data.length;
    
    list.innerHTML = data.data.map(proof => `
      <div class="proof-item">
        <div class="proof-header">
          <div>
            <strong>📋 ${proof.task_title}</strong>
            <span style="color:#94a3b8;font-size:12px;margin-left:10px">#${proof.task_id}</span>
          </div>
          <span class="status-badge status-pending">⏳ Pending</span>
        </div>
        <p style="color:#94a3b8;font-size:13px;margin:5px 0">
          👤 Executor: @${proof.executor_username || proof.executor_id} | 
          📅 ${formatDate(proof.submitted_at)}
        </p>
        <p style="color:#94a3b8;font-size:13px;margin:5px 0">
          💰 Payment: <strong style="color:#22c55e">${formatPrice(proof.payment_amount)}</strong>
        </p>
        <p style="color:#cbd5e1;font-size:13px;margin:5px 0">
          📝 Task: ${proof.task_description?.substring(0, 100)}${proof.task_description?.length > 100 ? '...' : ''}
        </p>
        ${proof.proof ? `<div class="proof-content" style="margin:10px 0"><strong>Executor's Proof:</strong><br>${proof.proof}</div>` : ''}
        <div class="proof-actions">
          <button class="btn btn-success btn-sm" onclick="approveProof(${proof.task_id}, ${proof.id})">✅ Approve & Pay ${formatPrice(proof.payment_amount)}</button>
          <button class="btn btn-danger btn-sm" onclick="rejectProof(${proof.task_id}, ${proof.id})">❌ Reject</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="alert alert-error">Failed to load proofs</p>';
  }
}

async function approveProof(taskId, proofId) {
  if (!confirm('✅ Confirm approving this proof and sending payment?')) return;
  
  try {
    const res = await fetch(`${API}/api/tasks/${taskId}/proofs/${proofId}/approve`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ user_id: REQUIRED_ADMIN_ID })
    });
    const data = await res.json();
    showAlert(data.success ? '✅ Approved and paid' : '❌ ' + data.message, data.success ? 'success' : 'error');
    if (data.success) {
      loadPendingProofs();
      loadDashboardStats(); // ✅ تحديث الإحصائيات
    }
  } catch (err) {
    showAlert('⚠️ Connection error', 'error');
  }
}

async function rejectProof(taskId, proofId) {
  const reason = prompt('Reason for rejection (optional):') || 'Does not meet requirements';
  
  try {
    const res = await fetch(`${API}/api/tasks/${taskId}/proofs/${proofId}/reject`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ user_id: REQUIRED_ADMIN_ID, reason })
    });
    const data = await res.json();
    showAlert(data.success ? '❌ Proof rejected' : '❌ ' + data.message, data.success ? 'success' : 'error');
    if (data.success) {
      loadPendingProofs();
      loadDashboardStats();
    }
  } catch (err) {
    showAlert('⚠️ Connection error', 'error');
  }
}


// ================= DISPUTES =================
let currentDispute = null;

async function loadDisputes() {
  const list = document.getElementById('disputesList');
  list.innerHTML = '<div class="loading">Loading disputes...</div>';
  
  try {
    const res = await fetch(`${API}/api/admin/disputes?user_id=${REQUIRED_ADMIN_ID}`);
    const data = await res.json();
    
    const count = data.success && data.data ? data.data.length : 0;
    document.getElementById('openDisputesCount').textContent = count;
    
    if (!data.success || !data.data?.length) {
      list.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:20px">✅ No open disputes</p>';
      return;
    }
    
    list.innerHTML = data.data.map(d => `
      <div class="proof-item" style="border-left:4px solid #8b5cf6">
        <div class="proof-header" style="border-bottom:1px solid #334155;padding-bottom:10px;margin-bottom:15px">
          <strong>⚠️ Dispute #${d.dispute_id}</strong>
          <span class="status-badge status-disputed">Open</span>
        </div>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px">
          <div style="background:#0f172a;padding:12px;border-radius:8px">
            <h4 style="color:#60a5fa;font-size:14px;margin-bottom:10px">📋 Task Details</h4>
            <p style="font-size:13px"><strong>Title:</strong> ${d.task_title} <span style="color:#94a3b8">#${d.task_id}</span></p>
            <p style="font-size:13px"><strong>Creator:</strong> @${d.creator_username || d.creator_telegram}</p>
            <p style="font-size:13px"><strong>Reward:</strong> <span style="color:#22c55e">${formatPrice(d.executor_reward)}</span></p>
            ${d.target_url ? `<p style="font-size:13px"><strong>URL:</strong> <a href="${d.target_url}" target="_blank" style="color:#60a5fa">Open Link ↗</a></p>` : ''}
          </div>
          
          <div style="background:#0f172a;padding:12px;border-radius:8px">
            <h4 style="color:#60a5fa;font-size:14px;margin-bottom:10px">👤 Executor Details</h4>
            <p style="font-size:13px"><strong>Executor:</strong> @${d.executor_username || d.executor_telegram}</p>
            <p style="font-size:13px"><strong>Submitted:</strong> ${formatDate(d.proof_submitted_at)}</p>
            <p style="font-size:13px"><strong>Amount:</strong> <span style="color:#22c55e">${formatPrice(d.payment_amount)}</span></p>
          </div>
        </div>
        
        <div style="margin-bottom:15px">
          <h4 style="color:#94a3b8;font-size:13px;margin-bottom:5px">📄 Task Description:</h4>
          <div style="background:#0f172a;padding:12px;border-radius:6px;color:#cbd5e1;font-size:13px;white-space:pre-wrap">${d.task_description || 'No description'}</div>
        </div>
        
        <div style="margin-bottom:15px">
          <h4 style="color:#94a3b8;font-size:13px;margin-bottom:5px">📤 Executor's Proof:</h4>
          <div class="proof-content" style="margin:0;background:#0f172a;border:1px solid #475569">${d.executor_proof || '<span style="color:#ef4444">No proof</span>'}</div>
        </div>
        
        <div style="margin-bottom:15px">
          <h4 style="color:#facc15;font-size:13px;margin-bottom:5px">⚠️ Dispute Reason:</h4>
          <div style="background:#fef3c720;padding:12px;border-radius:6px;color:#facc15;font-size:13px;white-space:pre-wrap;border:1px solid #facc1540">${d.reason}</div>
        </div>
        
        <div class="proof-actions" style="border-top:1px solid #334155;padding-top:15px">
          <button class="btn btn-primary btn-sm" onclick="openResolveModal(${d.dispute_id}, ${d.execution_id}, '${d.executor_proof?.replace(/'/g, "\\'") || ''}')">⚖️ Review & Resolve</button>
        </div>
      </div>
    `).join('');
    
  } catch (err) {
    console.error('❌ loadDisputes:', err);
    list.innerHTML = '<p class="alert alert-error">Failed to load disputes</p>';
  }
}

function openResolveModal(disputeId, executionId, proof = '') {
  currentDispute = { id: disputeId, executionId, proof };
  
  document.getElementById('resolveDisputeId').textContent = disputeId;
  document.getElementById('resolveDecision').value = 'executor';
  document.getElementById('resolveNote').value = '';
  
  const proofContent = document.getElementById('resolveProofContent');
  if (proofContent) {
    if (proof && proof.trim()) {
      proofContent.innerHTML = `
        <div style="background:#0f172a;padding:12px;border-radius:6px;margin-bottom:15px">
          <strong style="color:#94a3b8;font-size:13px">📤 Executor's Proof:</strong>
          <p style="color:#cbd5e1;font-size:13px;white-space:pre-wrap;margin-top:5px">${proof}</p>
        </div>
      `;
    } else {
      proofContent.innerHTML = '<p style="color:#ef4444">⚠️ No proof available</p>';
    }
  }
  
  openModal('resolveModal');
}

async function submitResolution() {
  const payout = document.getElementById('resolveDecision').value;
  const resolution = document.getElementById('resolveNote').value || 'Resolved by admin';
  
  if (!currentDispute) {
    showAlert('⚠️ No dispute selected', 'error');
    return;
  }
  
  try {
    const res = await fetch(`${API}/api/admin/task-disputes/${currentDispute.id}/resolve`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        admin_id: REQUIRED_ADMIN_ID,
        payout_to: payout,
        resolution
      })
    });
    const data = await res.json();
    
    if (data.success) {
      showAlert('✅ Dispute resolved', 'success');
      closeModal('resolveModal');
      loadDisputes();
      loadDashboardStats();
    } else {
      showAlert('❌ ' + data.message, 'error');
    }
  } catch (err) {
    showAlert('⚠️ Connection error', 'error');
    console.error('❌ submitResolution:', err);
  }
}
// ✅ دالة مساعدة لعرض تفاصيل المهمة الكاملة
function viewTaskDetail(taskId) {
  window.open(`/tasks.html?user_id=${REQUIRED_ADMIN_ID}#task-${taskId}`, '_blank');
}

// ================= RESOLVE MODAL =================

function openResolveModal(disputeId, executionId, proof = '') {
  currentDispute = { id: disputeId, executionId, proof };
  
  document.getElementById('resolveDisputeId').textContent = disputeId;
  document.getElementById('resolveDecision').value = 'executor';
  document.getElementById('resolveNote').value = '';
  
  // ✅ عرض الإثبات داخل المودال
  const proofContent = document.getElementById('resolveProofContent');
  if (proofContent) {
    if (proof && proof.trim()) {
      proofContent.innerHTML = `
        <div style="background:#0f172a;padding:12px;border-radius:6px;margin-bottom:15px">
          <strong style="color:#94a3b8;font-size:13px">📤 Executor's Proof:</strong>
          <p style="color:#cbd5e1;font-size:13px;white-space:pre-wrap;margin-top:5px">${proof}</p>
        </div>
      `;
    } else {
      proofContent.innerHTML = '<p style="color:#ef4444">⚠️ No proof available</p>';
    }
  }
  
  openModal('resolveModal');
}
// ================= COMMISSION STATS =================
async function loadCommissionStats() {
  const content = document.getElementById('statsContent');
  content.innerHTML = '<div class="loading">Loading statistics...</div>';
  
  try {
    const res = await fetch(`${API}/api/admin/commission-stats?user_id=${REQUIRED_ADMIN_ID}`);
    const data = await res.json();
    
    if (!data.success) {
      content.innerHTML = '<p class="alert alert-error">Failed to load statistics</p>';
      return;
    }
    
    const stats = data.data;
    
    content.innerHTML = `
      <div style="display:grid;gap:15px">
        <div class="card">
          <h4>💰 Today's Commission</h4>
          <p class="value" style="font-size:28px;color:#22c55e">${formatPrice(stats.today)}</p>
          <p style="color:#94a3b8;font-size:13px;margin-top:5px">From task completions</p>
        </div>
        <div class="card">
          <h4>📊 This Week</h4>
          <p class="value" style="font-size:28px;color:#22c55e">${formatPrice(stats.week)}</p>
          <p style="color:#94a3b8;font-size:13px;margin-top:5px">Total admin commission</p>
        </div>
        <div class="card">
          <h4>📈 This Month</h4>
          <p class="value" style="font-size:28px;color:#22c55e">${formatPrice(stats.month)}</p>
          <p style="color:#94a3b8;font-size:13px;margin-top:5px">Total admin commission</p>
        </div>
        <div class="card">
          <h4>🏆 All Time</h4>
          <p class="value" style="font-size:28px;color:#22c55e">${formatPrice(stats.all_time)}</p>
          <p style="color:#94a3b8;font-size:13px;margin-top:5px">Total admin commission earned</p>
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
    content.innerHTML = '<p class="alert alert-error">Failed to load statistics</p>';
  }
}


  
// ================= REFRESH ALL =================
async function refreshAll() {
  await loadDashboardStats();
  await loadTotalUsers();
  await loadDeposits();
  await loadWithdrawals();
  await loadMessages();
  await loadPendingProofs();
  await loadDisputes();
  await loadCommissionStats();
  showAlert('🔄 All data refreshed', 'success');
}

// ================= KEYBOARD SHORTCUTS =================
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key==='1') { e.preventDefault(); switchTab('deposits'); }
    if (e.key==='2') { e.preventDefault(); switchTab('withdrawals'); }
    if (e.key==='3') { e.preventDefault(); switchTab('balance'); }
    if (e.key==='4') { e.preventDefault(); switchTab('messages'); }
    if (e.key==='5') { e.preventDefault(); switchTab('proofs'); }
    if (e.key==='6') { e.preventDefault(); switchTab('disputes'); }
    if (e.key==='7') { e.preventDefault(); switchTab('stats'); }
    if (e.key==='r') { e.preventDefault(); refreshAll(); }
  }
});
</script>
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
     WHERE user_id = $1 AND DATE(created_at) = $2`,
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
  
  const earnings = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) as total 
     FROM earnings 
     WHERE user_id = $1 AND DATE(created_at) = $2`,
    [user_id, today]
  );
  
  if(earnings.rows[0].total < 0.03){
    return c.json({ success: false, message: "❌ Need $0.03+ earnings to claim" });
  }
  
  const alreadyClaimed = await pool.query(
    `SELECT id FROM daily_rewards WHERE user_id = $1 AND claim_date = $2`,
    [user_id, today]
  );
  
  if(alreadyClaimed.rows.length > 0){
    return c.json({ success: false, message: "❌ Already claimed today" });
  }
  
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
    
    return c.json({ success: true, message: "✅ Reward claimed!", new_balance: true });
  } catch(e){
    await pool.query(`ROLLBACK`);
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
// 🔐 Middleware: التحقق من الأدمن (محول إلى Hono)
// =========================
const verifyAdmin = async (c, next) => {
  try {
    const queryId = c.req.query('admin_id')?.toString()?.trim();
    let bodyId = '';
    
    // محاولة قراءة الجسم بأمان (Hono يخزن النتيجة لذا يمكن للمسار قراءتها لاحقاً)
    try {
      const body = await c.req.json();
      bodyId = body?.admin_id?.toString()?.trim();
    } catch (e) { /* تجاهل إذا لم يكن الطلب JSON */ }
    
    const adminId = queryId || bodyId;
    const REQUIRED_ADMIN_ID = c.env.ADMIN_ID || '7171208519';
    
    if (!adminId || adminId !== String(REQUIRED_ADMIN_ID).trim()) {
      console.warn(`❌ Access denied: received="${adminId}", required="${REQUIRED_ADMIN_ID}"`);
      return c.json({ success: false, message: '❌ Access denied: Invalid admin_id' }, 403);
    }

    await pool.query(
      `UPDATE users 
       SET last_login_at = now()
       WHERE telegram_id = $1
         AND last_login_at < now() - interval '24 hours'`,
      [adminId]
    );
    
    // تمرير التحكم للمسار التالي
    await next();
  } catch (err) {
    console.error('❌ verifyAdmin error:', err);
    return c.json({ success: false, message: 'Server error in admin verification' }, 500);
  }
};

// =========================
// 📥 1. جلب طلبات الإيداع
// =========================
app.get('/api/admin/deposits', verifyAdmin, async (c) => {
  try {
    const status = c.req.query('status') || 'pending';
    const result = await pool.query(
      `SELECT id, user_id, username, txid, amount, status, created_at FROM deposit_requests WHERE status = $1 ORDER BY created_at DESC LIMIT 50`,
      [status]
    );
    return c.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ GET /api/admin/deposits:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// ✅ 2. الموافقة على إيداع
// =========================
app.post('/api/admin/deposits/:id/approve', verifyAdmin, async (c) => {
  const client = await pool.connect();
  try {
    const depositId = c.req.param('id');
    const { user_id, admin_id, final_amount } = await c.req.json();
    
    const check = await client.query(
      'SELECT * FROM deposit_requests WHERE id = $1 AND status = $2', 
      [depositId, 'pending']
    );
    
    if (check.rows.length === 0) {
      return c.json({ success: false, message: '❌ Deposit not found or already processed' }, 404);
    }
    
    const deposit = check.rows[0];
    const amountToAdd = final_amount !== undefined ? parseFloat(final_amount) : deposit.amount;
    
    if (isNaN(amountToAdd) || amountToAdd <= 0) {
      return c.json({ success: false, message: '❌ Invalid amount' }, 400);
    }
    
    await client.query('BEGIN');
    
    await client.query(
      `UPDATE deposit_requests 
       SET status = 'approved', processed_at = NOW(), processed_by = $1, amount = $2
       WHERE id = $3`, 
      [admin_id, amountToAdd, depositId]
    );
    
    await client.query(
      `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE telegram_id = $2`, 
      [amountToAdd, user_id]
    );
    
    const referrerCheck = await client.query(
      `SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1`,
      [user_id]
    );
    
    if (referrerCheck.rows.length > 0) {
      const referrer_id = referrerCheck.rows[0].referrer_id;
      const commission = amountToAdd * 0.03;
      const roundedCommission = Math.round(commission * 100) / 100;
      
      await client.query(
        `UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE telegram_id = $2`, 
        [roundedCommission, referrer_id]
      );
      
      await client.query(
        `INSERT INTO referral_earnings (referrer_id, referee_id, amount, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [referrer_id, user_id, roundedCommission]
      );
      
      console.log(`🎁 Referral commission: $${roundedCommission} added to referrer ${referrer_id}`);
    }
    
    await client.query('COMMIT');
    
    let responseMessage = `✅ Deposit approved and $${amountToAdd.toFixed(2)} added to user balance`;
    if (referrerCheck.rows.length > 0) {
      const commission = Math.round((amountToAdd * 0.03) * 100) / 100;
      responseMessage += ` | 🎁 $${commission.toFixed(2)} commission added to referrer`;
    }
    
    return c.json({ 
      success: true, 
      message: responseMessage,
      commission_added: referrerCheck.rows.length > 0 ? Math.round((amountToAdd * 0.03) * 100) / 100 : 0
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ POST /api/admin/deposits/:id/approve:', err);
    return c.json({ success: false, message: 'Server error: ' + err.message }, 500);
  } finally {
    client.release();
  }
});

// =========================
// ❌ 3. رفض إيداع
// =========================
app.post('/api/admin/deposits/:id/reject', verifyAdmin, async (c) => {
  try {
    const depositId = c.req.param('id');
    const { reason = 'Does not meet requirements', admin_id } = await c.req.json();
    
    const result = await pool.query(
      `UPDATE deposit_requests SET status = 'rejected', processed_at = NOW(), processed_by = $1, admin_note = $2 WHERE id = $3 AND status = 'pending' RETURNING *`, 
      [admin_id, reason, depositId]
    );
    
    if (result.rowCount === 0) {
      return c.json({ success: false, message: '❌ Deposit not found' }, 404);
    }
    
    return c.json({ success: true, message: '❌ Deposit rejected' });
  } catch (err) {
    console.error('❌ POST /api/admin/deposits/:id/reject:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// 📤 4. جلب طلبات السحب
// =========================
app.get('/api/admin/withdrawals', verifyAdmin, async (c) => {
  try {
    const status = c.req.query('status') || 'pending';
    const result = await pool.query(
      `SELECT id, user_id, amount, payeer_wallet, status, requested_at FROM withdrawals WHERE status = $1 ORDER BY requested_at DESC LIMIT 50`, 
      [status]
    );
    return c.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ GET /api/admin/withdrawals:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// ✅ 5. الموافقة على سحب
// =========================
app.post('/api/admin/withdrawals/:id/approve', verifyAdmin, async (c) => {
  try {
    const withdrawId = c.req.param('id');
    const result = await pool.query(
      `UPDATE withdrawals SET status = 'paid', processed_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`, 
      [withdrawId]
    );
    if (result.rowCount === 0) {
      return c.json({ success: false, message: '❌ Withdrawal not found' }, 404);
    }
    return c.json({ success: true, message: '✅ Withdrawal approved' });
  } catch (err) {
    console.error('❌ POST /approve:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// ❌ 6. رفض سحب (مع إرجاع المبلغ الأصلي)
// =========================
app.post('/api/admin/withdrawals/:id/reject', verifyAdmin, async (c) => {
  try {
    const withdrawId = c.req.param('id');
    const { reason = 'Verification failed', admin_id } = await c.req.json();
    
    const withdrawal = await pool.query(
      'SELECT * FROM withdrawals WHERE id = $1 AND status = $2', 
      [withdrawId, 'pending']
    );
    
    if (withdrawal.rowCount === 0) {
      return c.json({ success: false, message: '❌ Withdrawal not found' }, 404);
    }
    
    const { user_id, amount } = withdrawal.rows[0];
    const WITHDRAW_FEE_RATE = 0.05;
    const originalAmount = parseFloat(amount) / (1 - WITHDRAW_FEE_RATE);
    
    await pool.query(
      'UPDATE withdrawals SET status = $1, processed_at = NOW(), admin_note = $2 WHERE id = $3', 
      ['rejected', reason, withdrawId]
    );
    
    await pool.query(
      'UPDATE users SET balance = COALESCE(balance, 0) + $1 WHERE telegram_id = $2', 
      [originalAmount, user_id]
    );
    
    await pool.query(
      'INSERT INTO earnings (user_id, amount, source, description) VALUES ($1, $2, $3, $4)', 
      [user_id, originalAmount, 'withdrawal_refund', `Refund: Rejected withdrawal #${withdrawId}`]
    );
    
    return c.json({ 
      success: true, 
      message: `❌ Withdrawal rejected. Original amount $${originalAmount.toFixed(2)} refunded.` 
    });
  } catch (err) {
    console.error('❌ POST /reject:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// ➕ 7. إضافة رصيد
// =========================
app.post('/api/admin/balance/add', verifyAdmin, async (c) => {
  try {
    const { user_id, amount, reason = 'Manual credit', source = 'admin_panel' } = await c.req.json();
    if (!user_id || isNaN(amount) || amount <= 0) {
      return c.json({ success: false, message: '❌ Invalid input' }, 400);
    }
    
    const userCheck = await pool.query('SELECT telegram_id, balance FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return c.json({ success: false, message: '❌ User not found' }, 404);
    }
    
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
    
    return c.json({ success: true, message: `✅ Added $${amount}`, new_balance: newBalance.toFixed(4), referral_bonus: referralBonus.toFixed(4) });
  } catch (err) {
    console.error('❌ POST /api/admin/balance/add:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// ➖ 8. خصم رصيد
// =========================
app.post('/api/admin/balance/deduct', verifyAdmin, async (c) => {
  try {
    const { user_id, amount, reason } = await c.req.json();
    
    if (!user_id || isNaN(amount) || amount <= 0 || !reason) {
      return c.json({ success: false, message: '❌ Fill all fields (Reason required)' }, 400);
    }
    
    const userCheck = await pool.query('SELECT telegram_id, balance FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      return c.json({ success: false, message: '❌ User not found' }, 404);
    }
    
    const currentBalance = parseFloat(userCheck.rows[0].balance || 0);
    const newBalance = Math.max(0, currentBalance - parseFloat(amount));
    
    await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, user_id]);
    await pool.query('INSERT INTO earnings (user_id, amount, source, description) VALUES ($1, $2, $3, $4)', [user_id, -Math.abs(amount), 'admin_deduction', reason]);
    
    return c.json({ 
      success: true, 
      message: `✅ Deducted $${amount}`, 
      previous_balance: currentBalance.toFixed(4), 
      new_balance: newBalance.toFixed(4) 
    });
  } catch (err) {
    console.error('❌ POST /api/admin/balance/deduct:', err);
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// 📬 9. جلب رسائل المستخدمين
// =========================
app.get('/api/admin/messages', verifyAdmin, async (c) => {
  try {
    const status = c.req.query('status') || 'unread';
    const limit = parseInt(c.req.query('limit')) || 50;
    const whereClause = status === 'unread' ? 'replied = false' : '1=1';
    
    const result = await pool.query(
      `SELECT id, user_id, message, admin_reply, replied, created_at 
       FROM admin_messages 
       WHERE ${whereClause} 
       ORDER BY created_at DESC 
       LIMIT $1`, 
      [limit]
    );
    
    return c.json({ 
      success: true, 
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('❌ GET /api/admin/messages:', err);
    return c.json({ success: false, message: 'Server error', error: err.message }, 500);
  }
});

// =========================
// 💬 10. الرد على رسالة
// =========================
app.post('/api/admin/messages/:id/reply', verifyAdmin, async (c) => {
  try {
    const messageId = c.req.param('id');
    const { reply } = await c.req.json();
    
    if (!reply || reply.trim() === '') {
      return c.json({ success: false, message: '❌ Reply text is required' }, 400);
    }
    
    const msgCheck = await pool.query(
      'SELECT id, user_id, message, replied FROM admin_messages WHERE id = $1', 
      [messageId]
    );
    
    if (msgCheck.rows.length === 0) {
      return c.json({ success: false, message: '❌ Message not found' }, 404);
    }
    
    const message = msgCheck.rows[0];
    
    await pool.query(
      `UPDATE admin_messages 
       SET admin_reply = $1, 
           replied = true,
           replied_at = now()
       WHERE id = $2`, 
      [reply, messageId]
    );
    
    console.log(`✅ Reply saved to DB for message #${messageId} (user: ${message.user_id})`);
    
    return c.json({ 
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
    return c.json({ success: false, message: 'Server error', error: err.message }, 500);
  }
});

// =========================
// 📊 Bonus: إحصائيات
// =========================
app.get('/api/admin/stats', verifyAdmin, async (c) => {
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
    
    return c.json({
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
    return c.json({ success: false, message: 'Server error' }, 500);
  }
});

// =========================
// 👥 جلب عدد المستخدمين الكلي
// =========================
app.get('/api/admin/stats/total-users', async (c) => {
  try {
    const admin_id = c.req.query('admin_id');
    const REQUIRED_ADMIN_ID = '7171208519';
    
    if (admin_id != REQUIRED_ADMIN_ID) {
      return c.json({ success: false, message: '❌ Access denied' }, 403);
    }
    
    const result = await pool.query('SELECT COUNT(*) as total FROM users');
    const totalUsers = parseInt(result.rows[0]?.total) || 0;
    
    return c.json({ 
      success: true, 
      data: { total_users: totalUsers }
    });
  } catch (err) {
    console.error('❌ ERROR /total-users:', err.message);
    return c.json({ success: false, message: 'Server error: ' + err.message }, 500);
  }
});

// ======================= 📝 TASKS SYSTEM API - FULL COMPATIBLE =======================

// ======================= ✅ تنفيذات المستخدم TASK =======================
app.get('/api/tasks/user-executions', async (c) => {
  try {
    const user_id = c.req.query('user_id');
    
    if (!user_id || !/^\d+$/.test(user_id.toString())) {
      return c.json({ success: false, message: "Valid user_id required" }, 400);
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
        )
      ORDER BY te.submitted_at DESC
    `, [user_id]);
    
    const executionsWithDispute = await Promise.all(
      executions.rows.map(async (exec) => {
        const dispute = await pool.query('SELECT id FROM task_disputes WHERE execution_id = $1', [exec.id]);
        return { ...exec, has_dispute: dispute.rows.length > 0 };
      })
    );
    
    return c.json({ success: true, data: executionsWithDispute });
    
  } catch (err) {
    console.error('❌ /api/tasks/user-executions:', err);
    return c.json({ success: false, message: "Failed to load executions", error: err.message }, 500);
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
    
    const adminCommission = executorReward * 0.25;
    const totalCostPerExecution = executorReward + adminCommission;
    
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
      return c.json({ success: false, message: "Invalid task ID or user ID" }, 400);
    }
    
    await client.query('BEGIN');
    
    const existing = await client.query(
      `SELECT id, status FROM task_executions 
       WHERE task_id = $1::integer AND executor_id = $2::bigint AND status IN ('applied', 'pending', 'approved')`,
      [id, user_id]
    );
    
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "You already have an active execution for this task" }, 400);
    }
    
    const task = await client.query(
      `SELECT budget, spent, executor_reward, duration_seconds, is_active, deleted_at FROM tasks WHERE id = $1::integer`, 
      [id]
    );
    
    if (task.rows.length === 0 || !task.rows[0].is_active || task.rows[0].deleted_at) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Task not found or inactive" }, 404);
    }
    
    const executorReward = parseFloat(task.rows[0].executor_reward || task.rows[0].price || 0.01);
    const adminCommission = executorReward * 0.20;
    const totalCost = executorReward + adminCommission;
    const remaining = parseFloat(task.rows[0].budget) - parseFloat(task.rows[0].spent);
    
    if (remaining < totalCost) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Task has insufficient budget" }, 400);
    }
    
    await client.query(
      `INSERT INTO task_executions (task_id, executor_id, status, payment_amount, commission_amount, submitted_at)
       VALUES ($1::integer, $2::bigint, 'applied', $3, $4, NOW())`,
      [id, user_id, executorReward, adminCommission]
    );
    
    await client.query('COMMIT');
    return c.json({ 
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
    return c.json({ success: false, message: "Failed to apply: " + err.message }, 500);
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
    const adminCommission = parseFloat(exec.rows[0].commission_amount || (paymentAmount * 0.25));
    const totalCost = paymentAmount + adminCommission;
    
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
    
    if (!reason || reason.length < 20) {
      return c.json({ success: false, message: "Rejection reason must be at least 20 characters" }, 400);
    }
    
    await client.query('BEGIN');
    
    const task = await client.query('SELECT creator_id FROM tasks WHERE id = $1', [taskId]);
    if (task.rows.length === 0 || task.rows[0].creator_id?.toString() !== user_id) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Unauthorized" }, 403);
    }
    
    await client.query(
      `UPDATE task_executions 
       SET status = 'rejected', 
           reviewed_at = NOW(), 
           reviewed_by = $1::bigint, 
           rejection_reason = $2
       WHERE id = $3::integer AND task_id = $4::integer`,
      [user_id, reason, proofId, taskId]
    );
    
    await client.query('COMMIT');
    
    return c.json({ success: true, message: "Proof rejected" });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/tasks/:id/proofs/:proofId/reject:', err);
    return c.json({ success: false, message: "Failed to reject proof", error: err.message }, 500);
  } finally {
    client.release();
  }
});

// ======================= ⚠️ DISPUTES =======================
app.post('/api/tasks/:id/proofs/:proofId/dispute', async (c) => {
  try {
    const taskId = c.req.param('id');
    const proofId = c.req.param('proofId');
    const { user_id, reason } = await c.req.json();
    
    if (!reason || reason.trim().length < 20) {
      return c.json({ success: false, message: "Please provide a detailed reason (min 20 characters)" }, 400);
    }
    
    const exec = await pool.query(
      'SELECT id, status FROM task_executions WHERE id = $1', 
      [proofId]
    );
    if (exec.rows.length === 0) {
      return c.json({ success: false, message: "Execution not found" }, 404);
    }
    
    await pool.query(`
      INSERT INTO task_disputes (execution_id, reason, status, created_at)
      VALUES ($1, $2, 'open', NOW())
    `, [proofId, reason]);
    
    await pool.query(
      'UPDATE task_executions SET status = $1 WHERE id = $2', 
      ['disputed', proofId]
    );
    
    if (typeof bot !== 'undefined' && bot?.telegram && c.env.ADMIN_ID) {
      try {
        await bot.telegram.sendMessage(
          c.env.ADMIN_ID,
          `⚠️ New Dispute:\n📋 Task: #${taskId}\n🔍 Execution: #${proofId}\n👤 User: ${user_id}\n📝 Reason:\n${reason.substring(0, 200)}...`
        );
      } catch (_) {}
    }
    
    return c.json({ success: true, message: "Dispute created - Admin will review" });
    
  } catch (err) {
    console.error('❌ Create dispute:', err);
    return c.json({ success: false, message: "Failed to create dispute: " + err.message }, 500);
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

// ✅ Middleware للتحقق من صلاحية الأدمن (محول إلى Hono)
const isAdminAuthenticated = async (c, next) => {
  const queryId = c.req.query('user_id') || c.req.query('admin_id');
  let bodyId = '';
  try {
    const body = await c.req.json();
    bodyId = body?.user_id || body?.admin_id;
  } catch (e) {
    // تجاهل إذا لم يكن الطلب JSON
  }
  
  const adminId = (queryId || bodyId)?.toString()?.trim();
  const REQUIRED_ADMIN_ID = c.env.ADMIN_ID || "7171208519";
  
  if (adminId === REQUIRED_ADMIN_ID) {
    await next();
  } else {
    return c.json({ success: false, message: "Admin access required" }, 403);
  }
};

// ✅ GET /api/admin/stats
app.get('/api/admin/stats', isAdminAuthenticated, async (c) => {
  try {
    const [pendingProofs, openDisputes, approvedToday, commissionStats] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM task_executions WHERE status = 'pending' AND proof IS NOT NULL`),
      pool.query(`SELECT COUNT(*) as count FROM task_disputes WHERE status = 'open'`),
      pool.query(`SELECT COUNT(*) as count FROM task_executions WHERE status = 'approved' AND reviewed_at::date = CURRENT_DATE`),
      pool.query(`SELECT COALESCE(SUM(commission_amount), 0) as total FROM task_executions WHERE status = 'approved'`)
    ]);
    
    return c.json({
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
    return c.json({ success: false, message: "Failed to load stats", error: err.message }, 500);
  }
});


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

app.post('/api/admin/task-disputes/:id/resolve', isAdminAuthenticated, async (c) => {
  const client = await pool.connect();
  try {
    const id = c.req.param('id');
    const { payout_to, resolution, admin_id } = await c.req.json();
    
    console.log('🔍 Resolve dispute:', { id, payout_to, admin_id });
    await client.query('BEGIN');
    
    const dispute = await client.query(`
      SELECT td.id, td.execution_id, te.task_id, te.executor_id, te.payment_amount, t.creator_id
      FROM task_disputes td
      INNER JOIN task_executions te ON td.execution_id = te.id
      INNER JOIN tasks t ON te.task_id = t.id
      WHERE td.id = $1::integer
    `, [id]);
    
    if (dispute.rows.length === 0) {
      await client.query('ROLLBACK');
      return c.json({ success: false, message: "Dispute not found" }, 404);
    }
    
    const d = dispute.rows[0];
    const executorId = d.executor_id;
    const paymentAmount = parseFloat(d.payment_amount);
    const adminCommission = parseFloat(d.commission_amount || (paymentAmount * 0.25));
    const totalCost = paymentAmount + adminCommission;
    
    await client.query(
      `UPDATE task_disputes SET status = 'resolved', resolved_at = NOW(), resolved_by = $1::bigint, resolution = $2 WHERE id = $3::integer`,
      [admin_id, resolution, id]
    );
    
    if (payout_to === 'executor') {
      await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2::bigint', [d.payment_amount, d.executor_id]);
      await client.query('UPDATE task_executions SET status = \'approved\', reviewed_at = NOW() WHERE id = $1::integer', [d.execution_id]);
      await client.query('UPDATE tasks SET spent = spent + $1 WHERE id = $2::integer', [totalCost, d.task_id]);
    } else {
      await client.query('UPDATE task_executions SET status = \'rejected\', reviewed_at = NOW() WHERE id = $1::integer', [d.execution_id]);
    }
    
    await client.query('COMMIT');
    
    if (payout_to === 'executor' && typeof distributeReferralCommission === 'function') {
      await distributeReferralCommission(d.executor_id, d.payment_amount);
    }
    
    console.log('✅ Dispute resolved:', id);
    return c.json({ success: true, message: "Dispute resolved successfully" });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/admin/task-disputes/:id/resolve:', err);
    return c.json({ success: false, message: "Failed to resolve dispute", error: err.message }, 500);
  } finally {
    client.release();
  }
});

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

// =====================================================================
// === نهاية ملف server.js (هذا هو الكود الصحيح تماماً) ===
// =====================================================================
export default {
  // 1. استقبال طلبات HTTP (بديل app.listen)
  fetch: app.fetch,

  // 2. المعالج المجدول (بديل setInterval)
  async scheduled(controller, env, ctx) {
    console.log("⏰ تشغيل مهمة الموافقة التلقائية على الإثباتات (Cron)...");
    const client = await pool.connect();
    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      
      const { rows } = await client.query(`
        SELECT te.id, te.task_id, te.executor_id, te.payment_amount, te.commission_amount, t.creator_id, t.title as task_title
        FROM task_executions te
        JOIN tasks t ON t.id = te.task_id
        WHERE te.status = 'pending' AND te.proof IS NOT NULL AND te.submitted_at < $1 AND t.deleted_at IS NULL
      `, [twentyFourHoursAgo]);
      
      for (const exec of rows) {
        try {
          await client.query('BEGIN');
          await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [exec.payment_amount, exec.executor_id]);
          
          const totalCost = parseFloat(exec.payment_amount) + parseFloat(exec.commission_amount || 0);
          await client.query('UPDATE tasks SET spent = spent + $1 WHERE id = $2', [totalCost, exec.task_id]);
          await client.query(`UPDATE task_executions SET status = 'approved', reviewed_at = NOW(), reviewed_by = 'auto' WHERE id = $1`, [exec.id]);
          
          await client.query('COMMIT');
          console.log(`✅ Auto-approved execution ${exec.id} for task ${exec.task_id}`);
          await distributeReferralCommission(exec.executor_id, exec.payment_amount);
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
  }
};
