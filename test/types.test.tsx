// Compiled with tsc --noEmit only: checks the .d.ts files fit together.
import {
  HibiraProvider,
  useChannel,
  useChunkedEvent,
  useChunkedTrigger,
  useConnectionState,
  useEvent,
  usePresence,
  useStream,
  chunkPayload,
  createChunkAssembler,
  type ConnectionState,
} from '@hibira-io/react-native';
import { HibiraPush, TokenProvider, useHibiraPush, RegistrationState, type RegistrationStateValue } from '@hibira-io/react-native/push';
import { createExpoPush } from '@hibira-io/react-native/expo';
import { streamToChannel, triggerChunked } from '@hibira-io/react-native/server';

const push = createExpoPush({ instanceId: 'x', bundleIdentifier: 'io.hibira.demo' });
const manual = new HibiraPush({ instanceId: 'x', getToken: async () => ({ platform: 'fcm', token: 't' }) });
const provider = new TokenProvider({ url: 'https://app/push-auth', headers: () => ({ Authorization: 'Bearer x' }) });

function Screen() {
  const state: ConnectionState = useConnectionState();
  const channel = useChannel('orders');
  useEvent<{ id: number }>(channel, 'created', (o) => o.id.toFixed());
  useChunkedEvent<{ rows: number[] }>('private-sync', 'client-rows', (d, meta) => d.rows.length + (meta?.user_id ?? ''));
  const send = useChunkedTrigger('private-sync', { interval: 120 });
  const { count } = usePresence<{ name: string }>('presence-room');
  const { text } = useStream('private-ai');
  const { ready, error } = useHibiraPush(push, { interests: ['news'], userId: 'u1', tokenProvider: provider });
  send('client-rows', { rows: [1] }).then((ok: boolean) => ok);
  return `${state}${count}${text}${ready}${error?.message}` as unknown as null;
}

export const app = (
  <HibiraProvider appKey="key" backgroundTimeout={null} options={{ wsHost: 'localhost' }}>
    <Screen />
  </HibiraProvider>
);

async function server(pusher: { trigger(c: string, e: string, d: any, p?: { socket_id?: string }): Promise<any> }) {
  const n: number = await triggerChunked(pusher, 'private-sync', 'rows', { big: true }, { socketId: '1.2' });
  await streamToChannel(pusher, 'private-ai', ['a', 'b']);
  const s: RegistrationStateValue = await manual.getRegistrationState();
  return n + s + RegistrationState.PERMISSION_DENIED + chunkPayload({}).length + createChunkAssembler().pending;
}
void server;

import {
  createChatClient,
  messageText,
  useChatClient,
  useChatConversation,
  useChatConversations,
  type ChatMessage,
} from '@hibira-io/react-native/chat';

const chat = createChatClient({ appId: 'a', token: async () => 'jwt' });
chat.on((event, data) => event + data);

function ChatScreen() {
  const client = useChatClient({ appId: 'a', tokenUrl: 'https://app/chat-token' });
  const room = useChatConversation(client, 'trip-1');
  const list = useChatConversations(chat);
  const first: ChatMessage | undefined = room.messages[0];
  room.typing();
  void room.send({ text: 'hi', metadata: { reply_to: 1 } });
  void room.loadOlder();
  return [messageText(first, 'ja'), room.typingUsers.join(','), list.unread.toFixed(), room.hasOlder];
}
void ChatScreen;
