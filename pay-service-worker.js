// Migration stub — superseded by service-worker.js in v6.52.
// paycalc.html now registers ./service-worker.js which already handles
// paycalc.html and paycalc.js. This file is kept on the server so that
// any browser still running the old pay SW receives an update that cleanly
// removes the old caches and hands control to service-worker.js.
// Safe to delete once a month has passed with no users on a pre-v6.52 install.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k.startsWith('myb-pay-calc-')).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});
