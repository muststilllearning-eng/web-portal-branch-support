/**
 * Cloudflare Pages Function: /status-check
 *
 * Pengganti endpoint Node milik Dashy, supaya indikator status (up/down)
 * tetap jalan saat Dashy di-host sebagai static site di Cloudflare Pages.
 *
 * Dipanggil oleh Dashy dengan query seperti:
 *   /status-check/?&url=<encoded>&acceptCodes=403&headers=<encoded-json>
 *
 * Balasannya JSON dengan bentuk yang diharapkan Dashy:
 *   { successStatus, statusCode, statusText, timeTaken, message }
 */

const ALLOWED_HOSTS = [
  'cinema21.co.id',
  'inventory-support.pages.dev',
  'notion.com',
];

const REQUEST_TIMEOUT_MS = 10000;

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function isAllowedHost(hostname) {
  return ALLOWED_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function parseAcceptCodes(raw) {
  if (!raw || raw === 'null') return [];
  return String(raw).split(',').map((code) => code.trim()).filter(Boolean);
}

function parseHeaders(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isSuccess(statusCode, acceptedCodes) {
  if (acceptedCodes.includes(String(statusCode))) return true;
  return statusCode >= 200 && statusCode <= 302;
}

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const target = searchParams.get('url');
  const acceptedCodes = parseAcceptCodes(searchParams.get('acceptCodes'));
  const headers = parseHeaders(searchParams.get('headers'));

  if (!target || target === 'undefined') {
    return jsonResponse({ successStatus: false, message: '❌ Missing or Malformed URL' });
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    return jsonResponse({ successStatus: false, message: '❌ Missing or Malformed URL' });
  }

  if (!isAllowedHost(url.hostname)) {
    return jsonResponse({
      successStatus: false,
      message: `❌ Domain not allowed: ${url.hostname}`,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startTime = Date.now();

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: controller.signal,
      cf: { cacheTtl: 0 },
    });

    const statusCode = response.status;
    const statusText = response.statusText || '';
    const timeTaken = Date.now() - startTime;
    const successStatus = isSuccess(statusCode, acceptedCodes);

    return jsonResponse({
      statusCode,
      statusText,
      serverName: url.hostname,
      successStatus,
      timeTaken,
      message: `${successStatus ? '✅' : '⚠️'} ${url.hostname} responded with ${statusCode} - ${statusText}.`
        + `\n⏱️ Took ${timeTaken} ms`,
    });
  } catch (error) {
    const reason = error && error.name === 'AbortError' ? 'request timed out' : (error && error.message) || 'fatal error';
    return jsonResponse({
      successStatus: false,
      message: `❌ Service Unavailable: ${url.hostname} resulted in ${reason}`,
    });
  } finally {
    clearTimeout(timer);
  }
}
