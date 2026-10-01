import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Badge, Button, Card, Chip, Header, Input, Row, Screen, StateView, T, api, errMsg, fmtDate, theme, useApi, useToast } from '@mashawir/mobile-core';

const CATS: Record<string, string> = { ORDER: 'مشكلة في طلب', PAYMENT: 'مستحقات وتسويات', ADDRESS: 'عنوان غلط', OTHER: 'أخرى' };

export default function DriverSupport() {
  const router = useRouter();
  const toast = useToast();
  const list = useApi(() => api<any[]>('/v1/support/tickets'), []);
  const [category, setCategory] = useState('ORDER');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (subject.trim().length < 3 || body.trim().length < 3) return toast.show('اكتب العنوان والتفاصيل', 'info');
    setBusy(true);
    try { const r = await api('/v1/support/tickets', { body: { category, subject: subject.trim(), body: body.trim() } }); toast.show(r.messageAr); setSubject(''); setBody(''); list.refresh(); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']}>
      <Header title="الدعم والتشغيل" onBack={() => router.back()} />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Object.entries(CATS).map(([k, v]) => <Chip key={k} label={v} selected={category === k} onPress={() => setCategory(k)} />)}</View>
        <Input label="العنوان" value={subject} onChangeText={setSubject} maxLength={150} />
        <Input label="التفاصيل" value={body} onChangeText={setBody} multiline maxLength={3000} />
        <Button title="إرسال" icon="send" onPress={send} loading={busy} />
      </Card>
      <T bold style={{ marginVertical: 8 }}>طلباتي السابقة</T>
      {list.loading || list.error ? <StateView loading={list.loading} error={list.error} onRetry={list.reload} /> : list.data!.length === 0 ? <T muted>مفيش</T> : list.data!.map((t) => (
        <Card key={t.id}><Row style={{ justifyContent: 'space-between' }}><T bold>{t.subject}</T><Badge label={t.status} fg={theme.info} bg={theme.infoSoft} /></Row><T size={12} muted>{`${t.code} · ${fmtDate(t.createdAt)}`}</T></Card>
      ))}
    </Screen>
  );
}
