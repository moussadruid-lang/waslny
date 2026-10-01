import React, { useState } from 'react';
import { FlatList, Image, TextInput, View, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Header, Row, Screen, StateView, T, api, errMsg, fmtDate, theme, useApi, useAuth, useToast } from '@mashawir/mobile-core';
import { CATS, TICKET_STATUS } from './index';

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const q = useApi(() => api<any>(`/v1/support/tickets/${id}`), [id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try { const m = await api(`/v1/support/tickets/${id}/messages`, { body: { body: text.trim() } }); q.setData((t: any) => ({ ...t, messages: [...t.messages, m] })); setText(''); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  const t = q.data;
  const st = t ? TICKET_STATUS[t.status] ?? TICKET_STATUS.OPEN : null;
  return (
    <Screen padded={false} keyboard edges={['top', 'bottom', 'left', 'right']}>
      <Header title={t?.code ?? 'التذكرة'} onBack={() => router.back()} />
      {q.loading || q.error ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
        <>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}><T bold size={17}>{t.subject}</T>{st && <Badge label={st.ar} fg={st.fg} bg={st.bg} />}</Row>
            <T size={13} muted>{CATS[t.category]}</T>
          </View>
          <FlatList data={t.messages} keyExtractor={(m: any) => m.id} contentContainerStyle={{ padding: 16 }}
            renderItem={({ item: m }: any) => {
              const mine = m.senderId === me?.id;
              return (
                <View style={{ alignSelf: mine ? 'flex-start' : 'flex-end', maxWidth: '85%', marginBottom: 10 }}>
                  <View style={{ backgroundColor: mine ? theme.primary : '#fff', borderRadius: 14, padding: 12, borderWidth: mine ? 0 : 1, borderColor: theme.border }}>
                    {!mine && <T size={12} bold color={theme.primary}>فريق مشاوير</T>}
                    <T color={mine ? '#fff' : theme.text}>{m.body}</T>
                    {m.attachments?.map((u: string) => <Image key={u} source={{ uri: u }} style={{ width: 160, height: 120, borderRadius: 8, marginTop: 6 }} />)}
                  </View>
                  <T size={11} muted>{fmtDate(m.createdAt)}</T>
                </View>
              );
            }} />
          {t.status !== 'CLOSED' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: '#fff' }}>
              <TextInput value={text} onChangeText={setText} placeholder="اكتب ردك..." placeholderTextColor="#9CA3AF" multiline maxLength={3000}
                style={{ flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderColor: theme.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 15, color: theme.text }} />
              <Pressable disabled={busy || !text.trim()} onPress={send} hitSlop={8} accessibilityLabel="إرسال"><Ionicons name="send" size={26} color={text.trim() ? theme.primary : theme.border} style={{ transform: [{ scaleX: -1 }] }} /></Pressable>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
