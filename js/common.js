// Shared by the sign-up and menu pages: config, API calls, fonts, iOS input zoom.
(function () {
  var cfg = window.FG_CONFIG || {};

  // Reveal the page once both faces are loaded (or after 3s, whichever first).
  var root = document.documentElement;
  root.classList.add('fonts-loading');
  var reveal = function () { root.classList.remove('fonts-loading'); };
  if (document.fonts && document.fonts.load) {
    Promise.race([
      Promise.all([document.fonts.load("12px 'Whimsical Sans'"), document.fonts.load("12px 'Whimsical Script'")]),
      new Promise(function (r) { setTimeout(r, 3000); })
    ]).then(reveal, reveal);
  } else {
    reveal();
  }

  // iOS Safari zooms into inputs under 16px on focus. These faces draw ~1.6x
  // larger, so the inputs look right at 11–12px; stop the zoom on iOS only
  // (pinch-zoom still works there).
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    var vp = document.querySelector('meta[name=viewport]');
    if (vp && !/maximum-scale/.test(vp.content)) vp.content += ', maximum-scale=1';
  }

  var configured = /^https?:\/\//.test(cfg.apiUrl || '') || /^\//.test(cfg.apiUrl || '');

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })]);
  }

  function get(params) {
    if (!configured) return Promise.reject(new Error('not_configured'));
    var qs = Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var url = cfg.apiUrl + (cfg.apiUrl.indexOf('?') >= 0 ? '&' : '?') + qs + '&t=' + Date.now();
    return withTimeout(fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' }), 20000).then(parse);
  }

  // text/plain keeps this a "simple" request, so there is no CORS preflight.
  function post(body) {
    if (!configured) return Promise.reject(new Error('not_configured'));
    return withTimeout(fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    }), 30000).then(parse);
  }

  function parse(res) {
    if (!res.ok) throw new Error('http_' + res.status);
    return res.json();
  }

  var CLAIM_KEY = 'fg.claimId';
  var store = {
    getClaim: function () { try { return localStorage.getItem(CLAIM_KEY) || ''; } catch (e) { return ''; } },
    setClaim: function (id) { try { localStorage.setItem(CLAIM_KEY, id); } catch (e) { /* private mode */ } }
  };

  // Fill [data-config] elements from the config object.
  function fillEvent() {
    var when = (cfg.date || '[Date]') + ' | at ' + (cfg.time || '[Time]');
    document.querySelectorAll('[data-config]').forEach(function (el) {
      var k = el.getAttribute('data-config');
      el.textContent = k === 'when' ? when : k === 'hosts' ? 'Hosted by ' + (cfg.hosts || 'Carly & Max') : (cfg[k] || '');
    });
  }
  document.addEventListener('DOMContentLoaded', fillEvent);

  window.FG = { config: cfg, configured: configured, get: get, post: post, store: store };
})();
