/**
 * Inline script that reports how each open of the app went, so slow or failed
 * opens on iPhone can be measured instead of guessed.
 *
 * It runs in <head>, before any bundle, and sends at most:
 *  - `boot`: the HTML arrived and this script ran (with the time to first byte);
 *  - `loaded`: the page finished loading (with paint and load times);
 *  - `hidden`: the user left before the page finished loading;
 *  - `resume`: the app came back from the background after more than 5 s.
 * If not even `boot` arrives, the HTML never reached the device.
 *
 * Written in ES5 on purpose: it must run on old iOS Safari before any polyfill.
 */
export const PWA_LOAD_ENDPOINT = '/api/pwa/load'

export const PWA_LOAD_BEACON_SCRIPT = `(function(){
  try {
    var endpoint = '${PWA_LOAD_ENDPOINT}';
    var id = Math.random().toString(36).slice(2, 12);
    var loaded = false, hiddenAt = 0, resumes = 0;
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    function sw() {
      if (!('serviceWorker' in navigator)) return 'none';
      return navigator.serviceWorker.controller ? 'controlled' : 'uncontrolled';
    }
    function round(n) { return typeof n === 'number' && n > 0 ? Math.round(n) : 0; }
    function timing() {
      var nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
      var fcp = 0;
      if (performance.getEntriesByType) {
        var paints = performance.getEntriesByType('paint');
        for (var i = 0; i < paints.length; i++) if (paints[i].name === 'first-contentful-paint') fcp = paints[i].startTime;
      }
      return {
        navType: nav ? String(nav.type) : 'unknown',
        response: nav ? round(nav.responseStart) : 0,
        dom: nav ? round(nav.domContentLoadedEventEnd) : 0,
        load: nav ? round(nav.loadEventEnd) : 0,
        worker: nav ? round(nav.workerStart) : 0,
        transfer: nav ? round(nav.transferSize) : 0,
        fcp: round(fcp)
      };
    }
    function send(phase, extra) {
      var t = timing();
      var record = {
        id: id, phase: phase, path: location.pathname.slice(0, 120),
        standalone: !!standalone, sw: sw(), online: navigator.onLine !== false,
        elapsed: round(performance.now()), navType: t.navType, response: t.response,
        dom: t.dom, load: t.load, worker: t.worker, transfer: t.transfer, fcp: t.fcp,
        hiddenMs: extra && extra.hiddenMs ? round(extra.hiddenMs) : 0
      };
      var body = JSON.stringify(record);
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return;
      if (window.fetch) fetch(endpoint, { method: 'POST', body: body, keepalive: true, credentials: 'same-origin' }).catch(function(){});
    }
    send('boot');
    window.addEventListener('load', function(){
      setTimeout(function(){ loaded = true; send('loaded'); }, 0);
    });
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        if (!loaded) send('hidden');
      } else if (hiddenAt && resumes < 20) {
        var away = Date.now() - hiddenAt;
        hiddenAt = 0;
        if (away > 5000) { resumes++; send('resume', { hiddenMs: away }); }
      }
    });
  } catch (e) {}
})();`
