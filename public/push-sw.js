/* Push notifications for Travel Companion, imported by the generated service worker.
   The message carries only { title, body, url }; the url is an in-app route. */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const url = typeof data.url === 'string' && data.url.startsWith('#/') ? data.url : '#/today';
  event.waitUntil(
    self.registration.showNotification(data.title || 'Travel Companion', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      // Android draws the badge as a silhouette from its transparency: a white mark, not the full icon.
      badge: 'icons/badge-96.png',
      tag: url,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(self.registration.scope + ((event.notification.data && event.notification.data.url) || '#/today')).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
