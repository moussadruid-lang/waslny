import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, errMsg } from './api';
import { useApi } from './hooks';
import { useOrderRoom, useSocketEvent } from './socket';
import { Header, Screen, StateView, T } from './ui';
import { theme } from './theme';
import { fmtTime } from './format';
import { currentPosition } from './location';
import { useToast } from './toast';

interface Msg { id: string; senderId: string; kind: 'TEXT' | 'LOCATION' | 'INSTRUCTION' | 'SYSTEM'; body?: string | null; lat?: number | null; lng?: number | null; createdAt: string }

/** In-order chat between customer and driver (§27). Linked to the order; realtime via the order room. */
export function ChatScreen({ orderId, myUserId, title, onBack, quickReplies = [] }: { orderId: string; myUserId: string; title: string; onBack: () => void; quickReplies?: string[] }) {
  const q = useApi(() => api<Msg[]>(`/v1/chat/${orderId}/messages`), [orderId]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList>(null);
  const toast = useToast();
  useOrderRoom(orderId);
  useSocketEvent<Msg>('chat:message', (m) => q.setData((p) => (p && !p.some((x) => x.id === m.id) ? [...p, m] : p)));
  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50); }, [q.data?.length]);

  async function send(body: Partial<Msg>) {
    setSending(true);
    try {
      const m = await api<Msg>(`/v1/chat/${orderId}/messages`, { body });
      q.setData((p) => (p && !p.some((x) => x.id === m.id) ? [...p, m] : p));
      setText('');
    } catch (e) { toast.show(errMsg(e), 'error'); } finally { setSending(false); }
  }
  async function sendLocation() {
    try { const p = await currentPosition(); await send({ kind: 'LOCATION', lat: p.lat, lng: p.lng, body: 'موقعي الحالي' }); }
    catch (e) { toast.show(errMsg(e), 'error'); }
  }

  return (
    <Screen padded={false} edges={['top', 'bottom', 'left', 'right']}>
      <Header title={title} onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {q.loading || q.error ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
          <FlatList ref={list} data={q.data ?? []} keyExtractor={(m) => m.id} contentContainerStyle={{ padding: 12, flexGrow: 1 }}
            ListEmptyComponent={<StateView empty emptyIcon="chatbubbles-outline" emptyText="ابدأ المحادثة" />}
            renderItem={({ item: m }) => {
              const mine = m.senderId === myUserId;
              return (
                <View style={{ alignSelf: mine ? 'flex-start' : 'flex-end', maxWidth: '80%', marginBottom: 8 }}>
                  <Pressable disabled={m.kind !== 'LOCATION'} onPress={() => m.lat && Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`)}
                    style={{ backgroundColor: mine ? theme.primary : '#fff', borderRadius: 14, padding: 10, borderWidth: mine ? 0 : 1, borderColor: theme.border }}>
                    {m.kind === 'LOCATION' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="location" size={18} color={mine ? '#fff' : theme.primary} />
                        <T color={mine ? '#fff' : theme.text}>موقع مُرسَل — اضغط للفتح</T>
                      </View>
                    ) : <T color={mine ? '#fff' : theme.text}>{m.kind === 'INSTRUCTION' ? `📌 ${m.body}` : m.body}</T>}
                  </Pressable>
                  <T size={11} muted style={{ marginTop: 2, alignSelf: mine ? 'flex-start' : 'flex-end' }}>{fmtTime(m.createdAt)}</T>
                </View>
              );
            }} />
        )}
        {quickReplies.length > 0 && (
          <FlatList horizontal data={quickReplies} keyExtractor={(x) => x} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingBottom: 6 }}
            renderItem={({ item }) => <Pressable onPress={() => send({ kind: 'TEXT', body: item })} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' }}><T size={13}>{item}</T></Pressable>} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: '#fff' }}>
          <Pressable onPress={sendLocation} hitSlop={8} accessibilityLabel="إرسال الموقع"><Ionicons name="location-outline" size={26} color={theme.primary} /></Pressable>
          <TextInput value={text} onChangeText={setText} placeholder="اكتب رسالة..." placeholderTextColor="#9CA3AF" multiline maxLength={1000}
            style={{ flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderColor: theme.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15, textAlign: 'right', color: theme.text }} />
          <Pressable disabled={!text.trim() || sending} onPress={() => send({ kind: 'TEXT', body: text.trim() })} hitSlop={8} accessibilityLabel="إرسال">
            <Ionicons name="send" size={26} color={text.trim() ? theme.primary : theme.border} style={{ transform: [{ scaleX: -1 }] }} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
