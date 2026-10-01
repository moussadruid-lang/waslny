import React, { useState } from 'react';
import { Image, Modal, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import SignatureScreen from 'react-native-signature-canvas';
import { Button, Card, Header, Input, Row, Screen, Stars, StateView, T, api, errMsg, pickImage, theme, useApi, useToast } from '@mashawir/mobile-core';
import { actionPosition } from '../../src/tracking';
import { newClientId, persistBase64, persistFile, runOrQueue, type QueuedFile } from '../../src/offlineQueue';

interface ProofRules { requireOtp: boolean; requirePhoto: boolean; requireSignature: boolean; requireRecipientName: boolean; maxDistanceMeters?: number | null }
const norm = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^\d]/g, '');

/** Proof of delivery (§24): only the requirements configured by admin are enforced, server-side. */
export default function Deliver() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const cfg = useApi(() => api<{ proof: ProofRules }>('/v1/driver/config'), []);
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [signature, setSignature] = useState<string>();
  const [sigOpen, setSigOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'online' | 'queued' | null>(null);
  const [stars, setStars] = useState(0);

  if (cfg.loading || cfg.error) return <Screen edges={['top', 'bottom', 'left', 'right']}><Header title="تسليم الطلب" onBack={() => router.back()} /><StateView loading={cfg.loading} error={cfg.error} onRetry={cfg.reload} /></Screen>;
  const rules = cfg.data!.proof;

  async function submit() {
    if (rules.requireOtp && norm(otp).length < 4) return toast.show('اكتب كود التسليم من المستلم', 'info');
    if (rules.requireRecipientName && name.trim().length < 2) return toast.show('اكتب اسم المستلم', 'info');
    if (rules.requirePhoto && !photo) return toast.show('صورة التسليم مطلوبة', 'info');
    if (rules.requireSignature && !signature) return toast.show('توقيع المستلم مطلوب', 'info');
    setBusy(true);
    try {
      const pos = await actionPosition();
      const files: QueuedFile[] = [];
      if (photo) files.push({ field: 'photoUrl', uri: photo, mime: 'image/jpeg', purpose: 'DELIVERY_PROOF' });
      if (signature) files.push({ field: 'signatureUrl', uri: signature, mime: 'image/png', purpose: 'SIGNATURE' });
      const r = await runOrQueue({
        path: `/v1/driver/orders/${id}/deliver`, label: 'تسليم الطلب', files,
        body: { otp: norm(otp) || undefined, recipientName: name.trim() || undefined, lat: pos.lat, lng: pos.lng, capturedAt: new Date().toISOString(), clientId: newClientId() },
      });
      setDone(r.queued ? 'queued' : 'online');
      toast.show(r.queued ? 'التسليم اتسجّل وهيتأكد أول ما النت يرجع' : 'تم تسليم الطلب بنجاح', r.queued ? 'info' : 'success');
    } catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  async function rateCustomer() {
    if (stars) await api(`/v1/driver/orders/${id}/rate-customer`, { body: { stars } }).catch(() => {});
    router.replace('/');
  }

  if (done) return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <Card style={{ marginTop: 40, alignItems: 'center' }}>
        <T size={44}>✅</T>
        <T bold size={20} center>{done === 'online' ? 'تم تسليم الطلب بنجاح' : 'التسليم متسجّل'}</T>
        <T muted center style={{ marginVertical: 8 }}>{done === 'online' ? 'أرباحك اتضافت للمحفظة.' : 'هنبعته تلقائيًا أول ما النت يرجع.'}</T>
        {done === 'online' && <><T>قيّم تجربة الطلب</T><Stars value={stars} onChange={setStars} /></>}
        <Button title="تم" onPress={rateCustomer} style={{ alignSelf: 'stretch', marginTop: 16 }} />
      </Card>
    </Screen>
  );

  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']} footer={<Button title="تأكيد التسليم" icon="checkmark-done" variant="success" onPress={submit} loading={busy} />}>
      <Header title="تسليم الطلب" onBack={() => router.back()} />
      <Card>
        <Input label={`كود التسليم من المستلم${rules.requireOtp ? ' *' : ''}`} value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} hint="الكود وصل للمستلم برسالة من مشاوير" />
        <Input label={`اسم المستلم${rules.requireRecipientName ? ' *' : ''}`} value={name} onChangeText={setName} maxLength={80} />
      </Card>
      <Card>
        <T bold style={{ marginBottom: 8 }}>{`صورة التسليم${rules.requirePhoto ? ' *' : ''}`}</T>
        {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 180, borderRadius: 10, marginBottom: 8 }} /> : null}
        <Button variant="secondary" icon="camera-outline" title={photo ? 'إعادة التصوير' : 'صوّر الشحنة مع المستلم'} onPress={async () => { try { const img = await pickImage('camera'); if (img) setPhoto(await persistFile(img.uri, 'jpg')); } catch (e) { toast.show(errMsg(e), 'error'); } }} />
      </Card>
      <Card>
        <T bold style={{ marginBottom: 8 }}>{`توقيع المستلم${rules.requireSignature ? ' *' : ''}`}</T>
        {signature ? <Image source={{ uri: signature }} style={{ width: '100%', height: 120, borderRadius: 10, marginBottom: 8, backgroundColor: '#fff' }} resizeMode="contain" /> : null}
        <Button variant="secondary" icon="create-outline" title={signature ? 'إعادة التوقيع' : 'خلّي المستلم يوقّع'} onPress={() => setSigOpen(true)} />
      </Card>
      <Row gap={6} style={{ paddingHorizontal: 4 }}><T size={12} muted>موقعك ووقت التسليم بيتسجلوا تلقائيًا كجزء من إثبات التسليم.</T></Row>

      <Modal visible={sigOpen} animationType="slide" onRequestClose={() => setSigOpen(false)}>
        <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.bg }}>
          <Header title="توقيع المستلم" onBack={() => setSigOpen(false)} />
          <View style={{ flex: 1 }}>
            <SignatureScreen
              descriptionText="وقّع في المساحة" clearText="مسح" confirmText="حفظ" imageType="image/png" autoClear={false}
              webStyle=".m-signature-pad--footer{direction:rtl}.m-signature-pad{box-shadow:none;border:none}"
              onOK={async (dataUrl: string) => { try { setSignature(await persistBase64(dataUrl.replace(/^data:image\/png;base64,/, ''), 'png')); setSigOpen(false); } catch (e) { toast.show(errMsg(e), 'error'); } }}
              onEmpty={() => toast.show('التوقيع فاضي', 'info')} />
          </View>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}
