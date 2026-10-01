import React, { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Chip, Header, Input, Row, Screen, StateView, T, api, errMsg, localPhone, pickAndUpload, theme, useToast } from '@mashawir/mobile-core';
import { LocationPicker } from '../../components/LocationPicker';
import { LABELS } from './index';

const norm = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^\d]/g, '');

export default function EditAddress() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(!!id);
  const [picker, setPicker] = useState(false);
  const [f, setF] = useState<any>({ label: 'HOME' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    api<any[]>('/v1/customer/addresses').then((l) => { const a = l.find((x) => x.id === id); if (a) setF({ ...a, contactPhone: localPhone(a.contactPhone) }); }).catch((e) => toast.show(errMsg(e), 'error')).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    const e: Record<string, string> = {};
    if (f.lat == null) e.loc = 'حدد الموقع على الخريطة';
    const phone = f.contactPhone ? norm(f.contactPhone) : '';
    if (phone && !/^01[0125]\d{8}$/.test(phone)) e.phone = 'رقم غير صحيح';
    setErr(e); if (Object.keys(e).length) return;
    const body = { label: f.label, title: f.title?.trim() || undefined, lat: f.lat, lng: f.lng, formatted: f.formatted || undefined, description: f.description?.trim() || undefined, landmark: f.landmark?.trim() || undefined, contactPhone: phone || undefined, photoUrl: f.photoUrl || undefined };
    setBusy(true);
    try {
      if (id) await api(`/v1/customer/addresses/${id}`, { method: 'PUT', body }); else await api('/v1/customer/addresses', { body });
      toast.show('تم حفظ العنوان'); router.back();
    } catch (x) { toast.show(errMsg(x), 'error'); } finally { setBusy(false); }
  }

  if (loading) return <Screen edges={['top', 'bottom', 'left', 'right']}><Header title="العنوان" onBack={() => router.back()} /><StateView loading /></Screen>;
  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']} footer={<Button title="حفظ" icon="checkmark" onPress={save} loading={busy} />}>
      <Header title={id ? 'تعديل العنوان' : 'عنوان جديد'} onBack={() => router.back()} />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{Object.entries(LABELS).map(([k, v]) => <Chip key={k} icon={v.icon} label={v.ar} selected={f.label === k} onPress={() => setF({ ...f, label: k })} />)}</View>
        <Input label="اسم العنوان" value={f.title ?? ''} onChangeText={(t) => setF({ ...f, title: t })} placeholder="مثال: بيت ماما" maxLength={60} />
        <Pressable onPress={() => setPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: err.loc ? theme.danger : theme.border, marginBottom: 12 }}>
          <Ionicons name="map-outline" size={20} color={theme.primary} />
          <T style={{ flex: 1 }} muted={f.lat == null}>{f.lat != null ? f.formatted || 'تم تحديد الموقع' : 'حدد الموقع على الخريطة / GPS'}</T>
        </Pressable>
        {err.loc ? <T size={12} color={theme.danger} style={{ marginTop: -6, marginBottom: 8 }}>{err.loc}</T> : null}
        <Input label="وصف العنوان" value={f.description ?? ''} onChangeText={(t) => setF({ ...f, description: t })} placeholder="البيت التالت بعد المسجد، الدور التاني" multiline maxLength={500} />
        <Input label="علامة مميزة" value={f.landmark ?? ''} onChangeText={(t) => setF({ ...f, landmark: t })} maxLength={200} />
        <Input label="رقم تليفون للعنوان" value={f.contactPhone ?? ''} onChangeText={(t) => setF({ ...f, contactPhone: t })} keyboardType="phone-pad" maxLength={14} error={err.phone} />
        <Row>
          <Button small variant="ghost" icon="camera-outline" title={f.photoUrl ? 'تغيير الصورة' : 'صورة للمكان'} onPress={async () => { try { const r = await pickAndUpload('camera', 'PLACE'); if (r) setF((x: any) => ({ ...x, photoUrl: r.url })); } catch (e) { toast.show(errMsg(e), 'error'); } }} />
          {f.photoUrl ? <Image source={{ uri: f.photoUrl }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : null}
        </Row>
      </Card>
      <LocationPicker visible={picker} title="موقع العنوان" initial={f.lat != null ? { lat: f.lat, lng: f.lng } : null} onClose={() => setPicker(false)}
        onPick={(p) => { setF((x: any) => ({ ...x, lat: p.lat, lng: p.lng, formatted: p.formatted ?? x.formatted })); setPicker(false); }} />
    </Screen>
  );
}
