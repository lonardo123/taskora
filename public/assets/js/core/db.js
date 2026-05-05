export const API_BASE = import.meta?.env?.VITE_API_BASE || 'https://perceptive-victory-production.up.railway.app';

export const API_PUBLIC   = `${API_BASE}/api/public-videos`;
export const API_MYVIDEOS = `${API_BASE}/api/my-videos`;
export const API_CALLBACK = `${API_BASE}/video-callback`;

// المفتاح السري من البيئة
export const SECRET_KEY = import.meta?.env?.VITE_SECRET_KEY || 'MySuperSecretKey123ForCallbackOnly';
