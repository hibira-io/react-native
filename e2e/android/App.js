// Runs on the emulator against backend.mjs on the host. Each step is sent to
// the backend, which decides pass or fail; the screen only mirrors them.
import { useEffect, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  HibiraProvider,
  useChunkedEvent,
  useChunkedTrigger,
  useConnectionState,
  useEvent,
  usePresence,
} from '@hibira-io/react-native';
import { HibiraPush } from '@hibira-io/react-native/push';
import { createExpoPush } from '@hibira-io/react-native/expo';

const BACKEND = 'http://10.0.2.2:3000';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Same rows as backend.mjs: multi-byte text so chunks split inside characters.
function payload(kb) {
  return { rows: Array.from({ length: kb * 20 }, (_, i) => ({ i, text: `行 ${i} 🎉 "${'x'.repeat(20)}"` })) };
}

function report(step, detail = {}) {
  console.log('[e2e]', step, JSON.stringify(detail));
  return fetch(`${BACKEND}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step, ...detail }),
  }).catch((e) => console.log('[e2e] report failed', String(e)));
}

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch(`${BACKEND}/config`)
      .then((r) => r.json())
      .then(setCfg)
      .catch((e) => setError(String(e)));
  }, []);
  if (!cfg) return <Text style={{ margin: 40 }}>{error ?? 'Loading config…'}</Text>;
  return (
    <HibiraProvider
      appKey={cfg.key}
      options={{ ...cfg.options, channelAuthorization: { endpoint: `${BACKEND}/auth`, transport: 'ajax' } }}
    >
      <Runner cfg={cfg} />
    </HibiraProvider>
  );
}

function Runner({ cfg }) {
  const [lines, setLines] = useState([]);
  const done = useRef(new Set());
  const note = (step, detail) => {
    setLines((l) => [...l, `${step} ${detail ? JSON.stringify(detail) : ''}`]);
    return report(step, detail);
  };
  const once = (key, fn) => {
    if (done.current.has(key)) return;
    done.current.add(key);
    fn();
  };

  const state = useConnectionState();
  useEffect(() => {
    note('state', { state });
  }, [state]);

  const privateName = `private-e2e-${cfg.run}`;
  const trigger = useChunkedTrigger(privateName);
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  const channel = useChunkedEvent(privateName, 'server.big', (data) => {
    const ok = JSON.stringify(data) === JSON.stringify(payload(cfg.serverKb));
    note('server-chunked', { ok });
    once('client', () =>
      triggerRef.current('client-big', payload(cfg.clientKb)).then(
        (sent) => note('client-sent', { ok: sent }),
        (e) => note('client-sent', { ok: false, error: String(e?.message ?? e) }),
      ),
    );
  });
  useEvent(privateName, 'server.small', (data) => note('server-small', { ok: data?.n === 1 }));

  useEffect(() => {
    if (!channel) return undefined;
    const t = setInterval(() => {
      if (channel.subscribed) {
        clearInterval(t);
        once('subscribed', () => note('subscribed'));
      }
    }, 100);
    return () => clearInterval(t);
  }, [channel]);

  const { count } = usePresence(`presence-e2e-${cfg.run}`);

  useEffect(() => {
    if (!cfg.push) return undefined;
    let received;
    (async () => {
      const { instanceId, endpoint, interest, fcm, title } = cfg.push;
      try {
        const push = fcm
          ? createExpoPush({ instanceId, endpoint })
          : new HibiraPush({
              instanceId,
              endpoint,
              storage: AsyncStorage,
              getToken: async () => ({ platform: 'fcm', token: `e2e-token-${cfg.run}` }),
            });
        const got = fcm
          ? new Promise((resolve) => {
              received = Notifications.addNotificationReceivedListener((n) => resolve(n.request.content.title));
            })
          : null;
        const deviceId = await push.start();
        await push.addDeviceInterest(interest);
        const interests = await push.getDeviceInterests();
        const stored = await AsyncStorage.getAllKeys();
        await note('push-registered', {
          ok: interests.includes(interest) && (await push.getDeviceId()) === deviceId && stored.length > 0,
          deviceId,
        });
        if (got) {
          const t = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 90_000))]);
          note('push-received', { ok: t === title, title: t });
        }
        await push.stop();
        note('push-stopped', { ok: (await push.getDeviceId()) === null, deviceId });
      } catch (e) {
        note('push-error', { ok: false, error: String(e?.message ?? e) });
      } finally {
        received?.remove();
      }
    })();
    return () => received?.remove();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, padding: 24 }}>
      <Text>
        {cfg.mode} · {state} · {count} in presence
      </Text>
      <ScrollView>
        {lines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
