import React from 'react';
import { Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Header, Row, Screen, StateView, T, api, theme, useApi } from '@mashawir/mobile-core';

export default function Invite() {
  const router = useRouter();
  const q = useApi(() => api<{ code: string; invited: number; rewarded: number; rules: any }>('/v1/customer/referral'), []);
  const share = () => q.data && Share.share({ message: `جرّب مشاوير للتوصيل 🛵 سجّل بكود الدعوة ${q.data.code} واتمتع بمكافأة على أول طلب.` });
  return (
    <Screen scroll edges={['top', 'bottom', 'left', 'right']}>
      <Header title="الكوبونات ودعوة صديق" onBack={() => router.back()} />
      {q.loading || q.error ? <StateView loading={q.loading} error={q.error} onRetry={q.reload} /> : (
        <>
          <Card style={{ alignItems: 'center' }}>
            <Ionicons name="gift-outline" size={44} color={theme.primary} />
            <T bold size={18} center style={{ marginTop: 8 }}>ادعُ صحابك واكسب</T>
            <T muted center>شارك كودك، ولما صاحبك يكمّل أول طلب المكافأة بتنزل في محفظتك.</T>
            <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: theme.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10, marginVertical: 16 }}>
              <T size={24} bold color={theme.primary}>{q.data!.code}</T>
            </View>
            <Button title="مشاركة الكود" icon="share-social-outline" onPress={share} style={{ alignSelf: 'stretch' }} />
          </Card>
          <Card>
            <Row style={{ justifyContent: 'space-around' }}>
              <View style={{ alignItems: 'center' }}><T size={22} bold>{q.data!.invited}</T><T muted>سجّلوا بكودك</T></View>
              <View style={{ alignItems: 'center' }}><T size={22} bold>{q.data!.rewarded}</T><T muted>مكافآت اتصرفت</T></View>
            </Row>
          </Card>
          <Card>
            <Row gap={10}><Ionicons name="pricetag-outline" size={22} color={theme.primary} /><T bold>عندك كود خصم؟</T></Row>
            <T muted style={{ marginTop: 6 }}>اكتبه في خطوة "المراجعة" قبل تأكيد الطلب، وهنحسبلك الخصم فورًا من السيرفر.</T>
            <Button small variant="secondary" title="اطلب دلوقتي" icon="add" onPress={() => router.push('/new-order')} style={{ marginTop: 10 }} />
          </Card>
        </>
      )}
    </Screen>
  );
}
