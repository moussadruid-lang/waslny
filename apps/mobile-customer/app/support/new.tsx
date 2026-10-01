import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Chip, Header, Input, Row, Screen, T, api, errMsg, pickAndUpload, theme, useToast } from '@mashawir/mobile-core';
import { CATS } from './index';

export default function NewTicket() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const router = useRouter();
  const toast = useToast();
  const [category, setCategory] = useState(orderId ? 'ORDER' : 'OTHER');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (subject.trim().length < 3 || body.trim().length < 3) return toast.show('اكتب العنوان وتفاصيل المشكلة', 'info');
    setBusy(true);
    try {
      const r = await api('/v1/support/tickets', { body: { orderId, category, subject: subject.trim(), body: body.trim(), attachments: files } });
      toast.show(r.messageAr ?? 'تم استلام طلب الدعم'); router.replace(`/support/${r.id}`);
    } catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']} footer={<Button title="إرسال" icon="send" onPress={submit} loading={busy} />}>
      <Header title="طلب دعم جديد" onBack={() => router.back()} />
      <Card>
        {orderId ? <T size={13} color={theme.info} style={{ marginBottom: 8 }}>مرتبط بالطلب الحالي</T> : null}
        <T bold style={{ marginBottom: 8 }}>نوع المشكلة</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Object.entries(CATS).map(([k, v]) => <Chip key={k} label={v} selected={category === k} onPress={() => setCategory(k)} />)}</View>
        <Input label="العنوان" value={subject} onChangeText={setSubject} maxLength={150} />
        <Input label="التفاصيل" value={body} onChangeText={setBody} multiline maxLength={3000} placeholder="احكي لنا حصل إيه..." />
        <Row style={{ flexWrap: 'wrap' }}>
          {files.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 56, height: 56, borderRadius: 8 }} />)}
          {files.length < 3 && <Button small variant="ghost" icon="attach" title="إرفاق صورة" onPress={async () => { try { const r = await pickAndUpload('library', 'TICKET'); if (r) setFiles((f) => [...f, r.url]); } catch (e) { toast.show(errMsg(e), 'error'); } }} />}
        </Row>
      </Card>
    </Screen>
  );
}
