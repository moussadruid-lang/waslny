import React from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Divider, ListItem, Row, Screen, T, api, errMsg, localPhone, theme, useAuth, useToast } from '@mashawir/mobile-core';

export default function Account() {
  const { me, signOut, reloadMe } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const becomeDriver = () => Alert.alert('اشتغل مع مشاوير', 'هنفعّل لك حساب مندوب على نفس الرقم. بعدها حمّل تطبيق "مشاوير مندوب" وارفع مستنداتك للمراجعة.', [
    { text: 'إلغاء', style: 'cancel' },
    { text: 'موافق', onPress: async () => { try { await api('/v1/customer/become-driver', { body: {} }); await reloadMe(); toast.show('تم التفعيل، افتح تطبيق المندوب لاستكمال بياناتك'); } catch (e) { toast.show(errMsg(e), 'error'); } } },
  ]);

  return (
    <Screen scroll>
      <T size={22} bold style={{ marginBottom: 12 }}>حسابي</T>
      <Card onPress={() => router.push('/profile')}>
        <Row gap={12}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person" size={28} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <T bold size={17}>{me?.name || 'أضف اسمك'}</T>
            <T muted>{localPhone(me?.phone)}</T>
            {me?.email ? <T muted size={13}>{me.email}</T> : null}
          </View>
          <Ionicons name="create-outline" size={22} color={theme.muted} />
        </Row>
      </Card>

      <Card>
        <ListItem icon="person-outline" title="تعديل البيانات" onPress={() => router.push('/profile')} />
        <ListItem icon="location-outline" title="عناويني" subtitle="البيت، الشغل، المفضلة" onPress={() => router.push('/addresses')} />
        <ListItem icon="notifications-outline" title="الإشعارات" onPress={() => router.push('/notifications')} />
        <ListItem icon="pricetag-outline" title="الكوبونات ودعوة صديق" subtitle={me?.referralCode ? `كودك: ${me.referralCode}` : undefined} onPress={() => router.push('/invite')} />
        <ListItem icon="headset-outline" title="الدعم الفني" onPress={() => router.push('/support')} />
      </Card>

      <Card>
        <ListItem icon="shield-checkmark-outline" title="الخصوصية والأمان" subtitle="الإشعارات، الجلسات، حذف الحساب" onPress={() => router.push('/profile')} />
        {!me?.driver && <ListItem icon="bicycle-outline" title="اشتغل مندوب مع مشاوير" onPress={becomeDriver} />}
        {me?.driver && <ListItem icon="bicycle-outline" title="حساب المندوب" subtitle={{ PENDING: 'قيد المراجعة', APPROVED: 'مفعّل', REJECTED: 'مرفوض', SUSPENDED: 'موقوف' }[me.driver.status] ?? me.driver.status} />}
        <Divider />
        <ListItem icon="log-out-outline" danger title="تسجيل الخروج" onPress={() => Alert.alert('تسجيل الخروج', 'متأكد؟', [{ text: 'إلغاء', style: 'cancel' }, { text: 'خروج', style: 'destructive', onPress: signOut }])} />
      </Card>
      <T center muted size={12}>مشاوير — نوصلها لك · الإصدار 1.0.0</T>
    </Screen>
  );
}
