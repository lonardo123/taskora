// ======================================================
//  التقاط user_id من الرابط
// ======================================================
const params = new URLSearchParams(window.location.search);
const USER_ID = params.get("user_id");

// ======================================================
//  روابط الـ API
// ======================================================
const API_BASE = "https://perceptive-victory-production.up.railway.app";
const API_PUBLIC = `${API_BASE}/api/videos/all`;
const API_MYVIDEOS = `${API_BASE}/api/videos/user`;
const API_CALLBACK = `${API_BASE}/callback`;
const SECRET_KEY = "MySuperSecretKey123ForCallbackOnly";

// ======================================================
//  عناصر الواجهة
// ======================================================
const msgDiv = document.getElementById("message");
const loaderDiv = document.getElementById("loader-wrapper");
const videoDiv = document.getElementById("video-container");
const iframe = document.getElementById("video-frame");
const progressBar = document.getElementById("progress");
const statusText = document.getElementById("status-text");
const consoleMsg = document.getElementById("TextMessage");

// ======================================================
//  التحقق من user_id
// ======================================================
if (!USER_ID) {
  msgDiv.textContent = "⚠️ لم يتم العثور على user_id في الرابط.";
  consoleMsg.textContent = "Missing user_id in URL.";
  throw new Error("user_id parameter is missing from URL.");
}

// ======================================================
//  تهيئة العامل
// ======================================================
async function initWorker() {
  consoleMsg.textContent = `Initializing for user_id=${USER_ID}`;
  msgDiv.textContent = "جارٍ جلب الفيديوهات...";

  try {
    const [allResp, myResp] = await Promise.all([
      fetch(API_PUBLIC),
      fetch(`${API_MYVIDEOS}?user_id=${USER_ID}`)
    ]);

    const allVideos = await allResp.json();
    const myVideos = await myResp.json();

    const myIds = new Set(myVideos.map(v => v.id));
    const videos = allVideos.filter(v => !myIds.has(v.id));

    if (!videos.length) {
      msgDiv.textContent = "🎬 لا توجد فيديوهات متاحة حالياً.";
      consoleMsg.textContent = "No videos available.";
      return;
    }

    loaderDiv.style.display = "none";
    videoDiv.style.display = "flex";

    await startWatchingLoop(videos);
  } catch (err) {
    console.error("❌ خطأ أثناء جلب الفيديوهات:", err);
    msgDiv.textContent = "حدث خطأ أثناء الاتصال بالخادم.";
    consoleMsg.textContent = "Network or API error.";
  }
}

// ======================================================
//  الحلقة الأساسية للمشاهدة
// ======================================================
async function startWatchingLoop(videos) {
  while (true) {
    const video = videos[Math.floor(Math.random() * videos.length)];
    const wrappedUrl = wrapUrl(video.url);
    const duration = video.duration || 30;

    iframe.src = wrappedUrl;
    statusText.textContent = "جارٍ تشغيل الفيديو...";
    consoleMsg.textContent = `▶️ Watching video ID ${video.id}`;

    await wait(3);
    monitorAds(iframe);

    await progress(duration);
    await sendReward(video.id, duration);

    statusText.textContent = "✅ تمت إضافة المكافأة إلى رصيدك";
    consoleMsg.textContent = `💰 Reward sent for video ${video.id}`;
    await wait(3);

    statusText.textContent = "جارٍ البحث عن فيديو جديد...";
    await wait(2);
  }
}

// ======================================================
//  تغليف الروابط (Facebook / Google / Instagram)
// ======================================================
function wrapUrl(url) {
  const encoded = encodeURIComponent(url);
  const sources = [
    `https://l.facebook.com/l.php?u=${encoded}`,
    `https://l.instagram.com/?u=${encoded}`,
    `https://www.google.com.eg/url?sa=t&url=${encoded}`
  ];
  return sources[Math.floor(Math.random() * sources.length)];
}

// ======================================================
//  شريط التقدم
// ======================================================
async function progress(duration) {
  for (let i = 0; i <= duration; i++) {
    progressBar.style.width = `${(i / duration) * 100}%`;
    if (i % 10 === 0) simulateScroll();
    await wait(1);
  }
}

// ======================================================
//  إرسال المكافأة
// ======================================================
async function sendReward(video_id, watched_seconds) {
  try {
    const url = `${API_CALLBACK}?user_id=${USER_ID}&video_id=${video_id}&watched_seconds=${watched_seconds}&secret=${SECRET_KEY}`;
    await fetch(url);
  } catch (err) {
    console.warn("⚠️ فشل إرسال المكافأة:", err);
  }
}

// ======================================================
//  محاكاة التمرير داخل iframe
// ======================================================
function simulateScroll() {
  try {
    iframe.contentWindow.scrollBy({ top: Math.random() * 400, behavior: 'smooth' });
  } catch {}
}

// ======================================================
//  مراقبة الإعلانات وتخطيها تلقائيًا
// ======================================================
function monitorAds(iframe) {
  const interval = setInterval(() => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) return;
      const buttons = doc.querySelectorAll('button, div');
      for (const btn of buttons) {
        const txt = btn.innerText?.trim();
        if (/تخطي|Skip/i.test(txt)) {
          btn.click();
          statusText.textContent = "⏩ تم تخطي إعلان تلقائيًا";
          clearInterval(interval);
          break;
        }
      }
    } catch {}
  }, 2000);
}

// ======================================================
//  مساعدات
// ======================================================
function wait(sec) {
  return new Promise(res => setTimeout(res, sec * 1000));
}

// ======================================================
window.addEventListener("load", initWorker);
