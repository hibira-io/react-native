// Hibira on React Native / Expo: a live order feed (Channels), who else is
// looking (presence), a catalogue bigger than one 4 KB message (chunked),
// and push notifications through Hibira Push.
import { useState } from 'react';
import { Button, FlatList, Platform, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as Application from 'expo-application';
import {
  HibiraProvider,
  useChunkedEvent,
  useConnectionState,
  useEvent,
  usePresence,
} from '@hibira-io/react-native';
import { createExpoPush, useHibiraPush } from '@hibira-io/react-native/expo';

const APP_KEY = process.env.EXPO_PUBLIC_HIBIRA_KEY;
const PUSH_INSTANCE = process.env.EXPO_PUBLIC_HIBIRA_PUSH_INSTANCE;
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL; // your server: /hibira/auth signs channels

const push = PUSH_INSTANCE
  ? createExpoPush({
      instanceId: PUSH_INSTANCE,
      bundleIdentifier: Platform.OS === 'ios' ? Application.applicationId ?? undefined : undefined,
    })
  : null;

export default function App() {
  return (
    <HibiraProvider
      appKey={APP_KEY}
      options={{
        channelAuthorization: { endpoint: `${BACKEND}/hibira/auth`, transport: 'ajax' },
      }}
    >
      <SafeAreaView style={styles.page}>
        <Status />
        <Orders />
        <Catalogue />
        <Notifications />
      </SafeAreaView>
    </HibiraProvider>
  );
}

function Status() {
  const state = useConnectionState();
  const { count } = usePresence('presence-shop');
  return (
    <Text style={styles.status}>
      {state} · {count} online
    </Text>
  );
}

function Orders() {
  const [orders, setOrders] = useState([]);
  useEvent('orders', 'order.created', (order) => setOrders((list) => [order, ...list].slice(0, 20)));
  return (
    <FlatList
      style={styles.list}
      data={orders}
      keyExtractor={(o) => String(o.id)}
      renderItem={({ item }) => <Text>#{item.id} {item.total}</Text>}
      ListEmptyComponent={<Text>Waiting for orders…</Text>}
    />
  );
}

// The backend sends it with triggerChunked(); it is often bigger than 4 KB.
function Catalogue() {
  const [items, setItems] = useState(null);
  useChunkedEvent('catalogue', 'catalogue.updated', (data) => setItems(data.items));
  return <Text>{items ? `${items.length} products` : 'No catalogue yet'}</Text>;
}

function Notifications() {
  const [on, setOn] = useState(false);
  const { ready, error } = useHibiraPush(push, { enabled: on, interests: ['orders'] });
  if (!push) return null;
  return (
    <View>
      <Button title={ready ? 'Notifications on' : 'Turn on notifications'} onPress={() => setOn(true)} disabled={ready} />
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12 },
  status: { fontWeight: '600' },
  list: { flexGrow: 0, maxHeight: 240 },
  error: { color: '#c00' },
});
