/**
 * Dynamic API URL resolver and robust JSON fetch wrapper.
 * Supports running fullstack on same origin, or decoupled with Netlify / Vercel frontend + Render / Railway backend.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function getApiUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE}${cleanEndpoint}`;
}

export async function fetchJson<T = any>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const url = typeof input === 'string' ? getApiUrl(input) : input;
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await res.text();
    if (text.includes('<!DOCTYPE') || text.includes('<html') || res.status === 404) {
      throw new Error(
        `تعذر الاتصال بخادم المعالجة. يرجى التأكد من استمرار تشغيل الخادم والاتصال بالإنترنت.`
      );
    }
    if (!res.ok) {
      throw new Error(`خطأ من الخادم (${res.status}): ${text.slice(0, 120) || 'استجابة غير صالحة'}`);
    }
    throw new Error(`استجابة غير متوقعة من الخادم: ${text.slice(0, 100)}`);
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `فشل الطلب برمز ${res.status}`);
  }
  return data;
}
