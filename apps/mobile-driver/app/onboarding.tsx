import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Chip, Header, Input, Row, Screen, StateView, T, api, errMsg, pickAndUpload, theme, useApi, useAuth, useToast } from '@mashawir/mobile-core';
import { DOC_AR } from './(tabs)/index';

const DOCS: { type: string; required: boolean }[] = [
  { type: 'NATIONAL_ID_FRONT', required: true }, { type: 'NATIONAL_ID_BACK', required: true }, { type: 'LICENSE', required: true },
  { type: 'VEHICLE_LICENSE', required: false }, { type: 'PHOTO', required: false }, { type: 'CRIMINAL_RECORD', required: false },
];
const norm = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^\d]/g, '');

export default function Onboarding() {
  const router = useRouter();
  const toast = useToast();
  const { me, reloadMe } = useAuth();
  const cat = useApi(() => api<{ vehicles: { code: string; nameAr: string; maxKg: number }[] }>('/v1/customer/catalog'), []);
  const [name, setName] = useState(me?.name ?? '');
  const [nid, setNid] = useState('');
  const [vehicle, setVehicle] = useState<string>();
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  async function upload(type: string) {
    setUploading(type);
    try { const r = await pickAndUpload('camera', 'DRIVER_DOCUMENT'); if (r) setDocs((d) => ({ ...d, [type]: r.url })); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setUploading(undefined); }
  }
  async function submit() {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'اكتب اسمك بالكامل';
    if (!/^\d{14}$/.test(norm(nid))) e.nid = 'الرقم القومي 14 رقم';
    if (!vehicle) e.vehicle = 'اختر نوع المركبة';
    if (!model.trim()) e.model = 'اكتب الموديل';
    if (!plate.trim()) e.plate = 'اكتب رقم اللوحة';
    const missing = DOCS.filter((x) => x.required && !docs[x.type]);
    if (missing.length) e.docs = `مطلوب: ${missing.map((x) => DOC_AR[x.type]).join('، ')}`;
    setErr(e); if (Object.keys(e).length) return toast.show('راجع البيانات الناقصة', 'info');
    setBusy(true);
    try {
      if (name.trim() !== me?.name) await api('/v1/customer/me', { method: 'PATCH', body: { name: name.trim() } });
      const r = await api('/v1/driver/profile', { method: 'PUT', body: { nationalIdNo: norm(nid), vehicleTypeCode: vehicle, model: model.trim(), plate: plate.trim(), color: color.trim() || undefined, documents: Object.entries(docs).map(([type, fileUrl]) => ({ type, fileUrl })) } });
      await reloadMe(); toast.show(r.messageAr ?? 'تم إرسال بياناتك للمراجعة'); router.back();
    } catch (x) { toast.show(errMsg(x), 'error'); } finally { setBusy(false); }
  }

  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']} footer={<Button title="إرسال للمراجعة" icon="send" onPress={submit} loading={busy} />}>
      <Header title="تسجيل المندوب" onBack={() => router.back()} />
      <Card>
        <T bold style={{ marginBottom: 8 }}>البيانات الشخصية</T>
        <Input label="الاسم بالكامل" value={name} onChangeText={setName} maxLength={80} error={err.name} />
        <Input label="الرقم القومي" value={nid} onChangeText={setNid} keyboardType="number-pad" maxLength={14} error={err.nid} hint="بياناتك محمية ولا تظهر لأي عميل" />
      </Card>
      <Card>
        <T bold style={{ marginBottom: 8 }}>المركبة</T>
        {cat.loading || cat.error ? <StateView loading={cat.loading} error={cat.error} onRetry={cat.reload} /> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{cat.data!.vehicles.map((v) => <Chip key={v.code} label={v.nameAr} selected={vehicle === v.code} onPress={() => setVehicle(v.code)} />)}</View>
        )}
        {err.vehicle ? <T size={12} color={theme.danger}>{err.vehicle}</T> : null}
        <Input label="الموديل" value={model} onChangeText={setModel} placeholder="مثال: باجاج بوكسر 2022" maxLength={60} error={err.model} />
        <Input label="رقم اللوحة" value={plate} onChangeText={setPlate} placeholder="مثال: أ ب ج 1234" maxLength={20} error={err.plate} />
        <Input label="اللون" value={color} onChangeText={setColor} maxLength={30} />
      </Card>
      <Card>
        <T bold style={{ marginBottom: 8 }}>المستندات</T>
        {DOCS.map((x) => (
          <Pressable key={x.type} onPress={() => upload(x.type)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
            {docs[x.type] ? <Image source={{ uri: docs[x.type] }} style={{ width: 44, height: 44, borderRadius: 8 }} /> : <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="camera-outline" size={22} color={theme.primary} /></View>}
            <T style={{ flex: 1 }}>{`${DOC_AR[x.type]}${x.required ? ' *' : ''}`}</T>
            {uploading === x.type ? <T muted size={13}>جارٍ الرفع...</T> : docs[x.type] ? <Ionicons name="checkmark-circle" size={22} color={theme.success} /> : <T size={13} color={theme.primary}>تصوير</T>}
          </Pressable>
        ))}
        {err.docs ? <T size={12} color={theme.danger} style={{ marginTop: 6 }}>{err.docs}</T> : null}
      </Card>
    </Screen>
  );
}
