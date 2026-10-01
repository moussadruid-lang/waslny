import React, { useState } from 'react';
import { Alert, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Divider, Header, Input, ListItem, Row, Screen, T, api, errMsg, localPhone, theme, useAuth, useToast } from '@mashawir/mobile-core';

// Optional updates the user may mute. Delivered / cancelled / failed are always sent.
const PREFS: { type: string; ar: string }[] = [
  { type: 'ORDER_DRIVER_GOING_TO_PICKUP', ar: 'المندوب في الطريق للاستلام' },
  { type: 'ORDER_DRIVER_ARRIVED_PICKUP', ar: 'وصول المندوب للاستلام' },
  { type: 'ORDER_PACKAGE_PICKED_UP', ar: 'استلام الشحنة' },
  { type: 'ORDER_IN_DELIVERY', ar: 'بدء التوصيل' },
  { type: 'ORDER_DRIVER_ARRIVED_DESTINATION', ar: 'وصول المندوب للتسليم' },
];

export default function Profile() {
  const router = useRouter();
  const toast = useToast();
  const { me, reloadMe, signOut } = useAuth();
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [prefs, setPrefs] = useState<Record<string, boolean>>(me?.notificationPrefs ?? {});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (name.trim().length < 2) return toast.show('اكتب اسمك', 'info');
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return toast.show('البريد غير صحيح', 'info');
    setBusy(true);
    try { await api('/v1/customer/me', { method: 'PATCH', body: { name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}), notificationPrefs: prefs } }); await reloadMe(); toast.show('تم حفظ البيانات'); }
    catch (e) { toast.show(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  const logoutAll = () => Alert.alert('تسجيل الخروج من كل الأجهزة', 'هيتم إنهاء كل الجلسات المفتوحة.', [{ text: 'إلغاء', style: 'cancel' }, { text: 'تأكيد', style: 'destructive', onPress: signOut }]);
  const del = () => Alert.alert('حذف الحساب', 'هيتم حذف بياناتك الشخصية نهائيًا. متأكد؟', [{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف نهائي', style: 'destructive', onPress: async () => {
    try { await api('/v1/customer/me', { method: 'DELETE' }); toast.show('تم حذف الحساب'); await signOut(); } catch (e) { toast.show(errMsg(e), 'error'); }
  } }]);

  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']}>
      <Header title="بياناتي والخصوصية" onBack={() => router.back()} />
      <Card>
        <Input label="الاسم" value={name} onChangeText={setName} maxLength={80} />
        <Input label="البريد الإلكتروني" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Input label="رقم الموبايل" value={localPhone(me?.phone)} editable={false} hint="لتغيير الرقم تواصل مع الدعم للتحقق من هويتك" />
      </Card>
      <Card>
        <T bold style={{ marginBottom: 6 }}>إشعارات الطلب</T>
        <T size={13} muted style={{ marginBottom: 8 }}>إشعارات التسليم والإلغاء والمشاكل بتوصل دايمًا</T>
        {PREFS.map((p) => (
          <Row key={p.type} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
            <T>{p.ar}</T>
            <Switch value={prefs[p.type] !== false} onValueChange={(v) => setPrefs({ ...prefs, [p.type]: v })} trackColor={{ true: theme.primary }} />
          </Row>
        ))}
      </Card>
      <Button title="حفظ" icon="checkmark" onPress={save} loading={busy} style={{ marginBottom: 12 }} />
      <Card>
        <T bold>الأمان</T>
        <T size={13} muted>الدخول بكود مؤقت على موبايلك بدل كلمة المرور، والجلسات محمية ومشفّرة على جهازك.</T>
        <Divider />
        <ListItem icon="phone-portrait-outline" title="تسجيل الخروج من كل الأجهزة" onPress={logoutAll} />
        <ListItem icon="trash-outline" danger title="حذف الحساب" subtitle="غير متاح أثناء وجود طلبات جارية" onPress={del} />
      </Card>
    </Screen>
  );
}
