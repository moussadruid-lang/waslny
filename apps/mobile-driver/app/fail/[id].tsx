import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Header, Screen, StateView, T, api, errMsg, pickImage, theme, useApi, useToast } from '@mashawir/mobile-core';
import { actionPosition } from '../../src/tracking';
import { persistFile, runOrQueue } from '../../src/offlineQueue';

interface Reason { code: string; nameAr: string; requiresPhoto: boolean; nextAction: 'RETRY' | 'RETURN' | 'CONTACT_SUPPORT' }
const NEXT_AR = { RETRY: 'تقدر تعيد محاولة التسليم', RETURN: 'الشحنة هترجع للراسل', CONTACT_SUPPORT: 'التشغيل هيتواصل معاك' };

/** Failed delivery (§25): reason + time + GPS + photo when required; next action is admin-configured. */
export default function FailDelivery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const cfg = useApi(() => api<{ failure: Reason[] }>('/v1/driver/config'), []);
  const [sel, setSel] = useState<Reason>();
  const [photo, setPhoto] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!sel) return toast.show('اختر السبب', 'info');
    if (sel.requiresPhoto && !photo) return toast.show('الصورة مطلوبة للسبب ده', 'info');
    setBusy(true);
    try {
      const pos = await actionPosition();
      const r = await runOrQueue({ path: `/v1/driver/orders/${id}/fail`, label: 'تعذر التسليم', body: { reasonCode: sel.code, lat: pos.lat, lng: pos.lng },
        files: photo ? [{ field: 'photoUrl', uri: photo, mime: 'image/jpeg', purpose: 'FAILURE_PROOF' }] : [] });
      toast.show(r.queued ? 'اتسجّل وهيتبعت أول ما النت يرجع' : `تم تسجيل المشكلة — ${NEXT_AR[sel.nextAction]}`, 'info');
      router.back();
    } catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }

  return (
    <Screen scroll edges={['top', 'bottom', 'left', 'right']} footer={<Button variant="danger" title="تسجيل تعذر التسليم" onPress={submit} loading={busy} />}>
      <Header title="تعذر التسليم" onBack={() => router.back()} />
      {cfg.loading || cfg.error ? <StateView loading={cfg.loading} error={cfg.error} onRetry={cfg.reload} /> : (
        <>
          <Card>
            {cfg.data!.failure.map((r) => (
              <Pressable key={r.code} onPress={() => setSel(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                <Ionicons name={sel?.code === r.code ? 'radio-button-on' : 'radio-button-off'} size={22} color={theme.primary} />
                <View style={{ flex: 1 }}><T>{r.nameAr}</T><T size={12} muted>{NEXT_AR[r.nextAction]}{r.requiresPhoto ? ' · يتطلب صورة' : ''}</T></View>
              </Pressable>
            ))}
          </Card>
          <Card>
            <T bold style={{ marginBottom: 8 }}>{`صورة${sel?.requiresPhoto ? ' *' : ' (اختياري)'}`}</T>
            {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 8 }} /> : null}
            <Button variant="secondary" icon="camera-outline" title={photo ? 'إعادة التصوير' : 'تصوير'} onPress={async () => { try { const img = await pickImage('camera'); if (img) setPhoto(await persistFile(img.uri, 'jpg')); } catch (e) { toast.show(errMsg(e), 'error'); } }} />
          </Card>
        </>
      )}
    </Screen>
  );
}
