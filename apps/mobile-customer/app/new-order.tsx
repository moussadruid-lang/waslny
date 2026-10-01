import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, Pressable, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  Button, Card, Chip, Divider, Header, Input, KV, Row, Screen, StateView, T, api, egp, errMsg, fmtDate, km, mins, pickAndUpload, theme, useApi, useToast,
} from '@mashawir/mobile-core';
import { LocationPicker, type PickedPlace } from '../components/LocationPicker';

interface Catalog { vehicles: { code: string; nameAr: string; maxKg: number; allowedSizes: string[] }[]; sizes: { code: string; nameAr: string; maxKg: number }[]; categories: { code: string; nameAr: string }[] }
interface Quote { distanceKm: number; etaMinutes: number; lines: { code: string; labelAr: string; amount: number }[]; subtotal: number; discount: number; total: number }
interface StopForm extends Partial<PickedPlace> { contactName?: string; contactPhone?: string | null; instructions?: string; photoUrl?: string }

const STEPS = ['العناوين', 'الشحنة', 'الموعد', 'المراجعة'];
const normPhone = (s?: string | null) => (s ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^\d]/g, '').replace(/^20/, '0');
const validPhone = (p: string) => /^01[0125]\d{8}$/.test(p);
const VEHICLE_ICON: Record<string, any> = { MOTORCYCLE: 'bicycle', CAR: 'car-outline', VAN: 'bus-outline', TRUCK: 'cube-outline', TUKTUK: 'car-sport-outline' };

export default function NewOrder() {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ pickupId?: string; dropoffId?: string }>();
  const cat = useApi(() => api<Catalog>('/v1/customer/catalog'), []);
  const [step, setStep] = useState(0);
  const [picker, setPicker] = useState<null | 'pickup' | 'dropoff'>(null);
  const [pickup, setPickup] = useState<StopForm>({});
  const [drop, setDrop] = useState<StopForm>({});
  const [category, setCategory] = useState<string>();
  const [size, setSize] = useState<string>();
  const [weight, setWeight] = useState('1');
  const [vehicle, setVehicle] = useState<string>();
  const [notes, setNotes] = useState('');
  const [packagePhoto, setPackagePhoto] = useState<string>();
  const [scheduled, setScheduled] = useState(false);
  const [when, setWhen] = useState<Date>(() => new Date(Date.now() + 60 * 60_000));
  const [urgent, setUrgent] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string>();
  const [couponErr, setCouponErr] = useState<string>();
  const [payment, setPayment] = useState<'CASH' | 'WALLET'>('CASH');
  const [quote, setQuote] = useState<Quote>();
  const [quoteErr, setQuoteErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Prefill from saved address shortcuts on Home / Addresses
  useEffect(() => {
    if (!params.pickupId && !params.dropoffId) return;
    api<any[]>('/v1/customer/addresses').then((list) => {
      const f = (id?: string) => list.find((a) => a.id === id);
      const p = f(params.pickupId); const d = f(params.dropoffId);
      if (p) setPickup({ lat: p.lat, lng: p.lng, formatted: p.formatted ?? p.title, description: p.description, landmark: p.landmark });
      if (d) setDrop({ lat: d.lat, lng: d.lng, formatted: d.formatted ?? d.title, description: d.description, landmark: d.landmark, contactPhone: d.contactPhone ? normPhone(d.contactPhone) : undefined });
    }).catch(() => {});
  }, [params.pickupId, params.dropoffId]);

  useEffect(() => {
    if (!cat.data) return;
    setCategory((c) => c ?? cat.data!.categories[0]?.code);
    setSize((s) => s ?? cat.data!.sizes.find((x) => x.code === 'SMALL')?.code ?? cat.data!.sizes[0]?.code);
  }, [cat.data]);

  const w = Number(weight.replace(',', '.')) || 0;
  const vehicles = useMemo(() => (cat.data?.vehicles ?? []).filter((v) => (!size || v.allowedSizes.includes(size)) && v.maxKg >= w), [cat.data, size, w]);
  useEffect(() => { if (vehicle && !vehicles.some((v) => v.code === vehicle)) setVehicle(undefined); else if (!vehicle && vehicles[0]) setVehicle(vehicles[0].code); }, [vehicles, vehicle]);

  const stop = (s: StopForm) => ({
    lat: s.lat!, lng: s.lng!, formatted: s.formatted || undefined, description: s.description || undefined, landmark: s.landmark || undefined,
    contactName: s.contactName?.trim() || undefined, contactPhone: s.contactPhone ? normPhone(s.contactPhone) : undefined, instructions: s.instructions?.trim() || undefined, photoUrl: s.photoUrl,
  });
  const body = (couponCode?: string) => ({
    pickup: stop(pickup), dropoffs: [stop(drop)], vehicleTypeCode: vehicle, packageSizeCode: size, categoryCode: category, weightKg: w,
    notes: notes.trim() || undefined, packagePhotoUrl: packagePhoto, urgent: !scheduled && urgent, scheduledAt: scheduled ? when.toISOString() : undefined,
    couponCode: couponCode || undefined, paymentMethod: payment,
  });

  function validate(n: number) {
    const e: Record<string, string> = {};
    if (n === 0) {
      if (pickup.lat == null) e.pickup = 'حدد نقطة الاستلام';
      if (drop.lat == null) e.drop = 'حدد نقطة التسليم';
      if (!drop.contactName?.trim()) e.contactName = 'اكتب اسم المستلم';
      if (!validPhone(normPhone(drop.contactPhone))) e.contactPhone = 'رقم موبايل مصري صحيح مطلوب';
      if (pickup.lat != null && drop.lat != null && Math.abs(pickup.lat - drop.lat) < 1e-5 && Math.abs(pickup.lng! - drop.lng!) < 1e-5) e.drop = 'نقطة التسليم نفس نقطة الاستلام';
    }
    if (n === 1) {
      if (!category) e.category = 'اختر نوع الشحنة';
      if (!size) e.size = 'اختر حجم الشحنة';
      if (!(w > 0)) e.weight = 'اكتب وزن تقريبي';
      if (!vehicle) e.vehicle = 'مفيش مركبة تناسب الحجم/الوزن ده';
    }
    if (n === 2 && scheduled && when.getTime() < Date.now() + 15 * 60_000) e.when = 'الموعد يجب أن يكون بعد 15 دقيقة على الأقل';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /** Server is the only source of truth for price (§12). Returns an error message or null. */
  async function fetchQuote(couponCode?: string): Promise<string | null> {
    setBusy(true);
    try { const q = await api<Quote>('/v1/customer/quote', { body: body(couponCode) }); setQuote(q); setAppliedCoupon(couponCode); setQuoteErr(undefined); return null; }
    catch (e) { return errMsg(e); }
    finally { setBusy(false); }
  }

  async function next() {
    if (!validate(step)) return;
    if (step === 2) {
      setQuote(undefined); setStep(3);
      let err = await fetchQuote(appliedCoupon);
      if (err && appliedCoupon) { setCouponErr(err); setAppliedCoupon(undefined); err = await fetchQuote(undefined); }
      if (err) setQuoteErr(err);
      return;
    }
    setStep(step + 1);
  }

  async function applyCoupon() {
    const c = coupon.trim().toUpperCase();
    if (!c) return;
    setCouponErr(undefined);
    const err = await fetchQuote(c); // on failure the previous quote stays as-is
    if (err) setCouponErr(err); else toast.show('تم تطبيق كود الخصم');
  }
  async function removeCoupon() {
    setCoupon(''); setCouponErr(undefined);
    const err = await fetchQuote(undefined);
    if (err) setQuoteErr(err);
  }

  async function confirm() {
    setBusy(true);
    try {
      const r = await api<{ id: string; deliveryOtp?: string; messageAr: string }>('/v1/customer/orders', { body: body(appliedCoupon) });
      toast.show(r.messageAr || 'تم إنشاء طلبك بنجاح');
      router.replace({ pathname: '/orders/[id]', params: { id: r.id, ...(r.deliveryOtp ? { otp: r.deliveryOtp } : {}) } });
      if (r.deliveryOtp) setTimeout(() => Alert.alert('كود التسليم', `${r.deliveryOtp}\n\nشارك كود التسليم مع المستلم فقط. المندوب هيطلبه عند التسليم.`), 400);
    } catch (e) { toast.show(errMsg(e), 'error'); }
    finally { setBusy(false); }
  }

  function openWhen() {
    if (Platform.OS !== 'android') return;
    DateTimePickerAndroid.open({ value: when, mode: 'date', minimumDate: new Date(), onChange: (ev, d) => {
      if (ev.type !== 'set' || !d) return;
      DateTimePickerAndroid.open({ value: d, mode: 'time', is24Hour: false, onChange: (ev2, t) => { if (ev2.type === 'set' && t) setWhen(t); } });
    } });
  }

  async function photo(set: (u: string) => void, purpose: 'PACKAGE' | 'PLACE') {
    try { const r = await pickAndUpload('camera', purpose); if (r) { set(r.url); toast.show('تم رفع الصورة'); } } catch (e) { toast.show(errMsg(e), 'error'); }
  }

  if (cat.loading || cat.error) return <Screen edges={['top', 'bottom', 'left', 'right']}><Header title="طلب توصيل جديد" onBack={() => router.back()} /><StateView loading={cat.loading} error={cat.error} onRetry={cat.reload} /></Screen>;
  const c = cat.data!;

  const footer = step < 3
    ? <Button title="التالي" onPress={next} loading={busy} />
    : <Button title={quote ? `تأكيد الطلب — ${egp(quote.total)}` : 'تأكيد الطلب'} icon="checkmark-circle" onPress={confirm} loading={busy} disabled={!quote} />;

  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']} footer={footer} padded>
      <Header title="طلب توصيل جديد" onBack={() => (step ? setStep(step - 1) : router.back())} />
      <Row gap={6} style={{ marginBottom: 16 }}>
        {STEPS.map((sname, i) => (
          <View key={sname} style={{ flex: 1 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? theme.primary : theme.border }} />
            <T size={12} center muted={i !== step} bold={i === step} style={{ marginTop: 4 }}>{sname}</T>
          </View>
        ))}
      </Row>

      {step === 0 && (
        <>
          <Card>
            <T bold style={{ marginBottom: 8 }}>من؟ — نقطة الاستلام</T>
            <Pressable onPress={() => setPicker('pickup')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: errors.pickup ? theme.danger : theme.border }}>
              <Ionicons name="radio-button-on" size={20} color={theme.primary} />
              <T style={{ flex: 1 }} muted={pickup.lat == null} numberOfLines={2}>{pickup.lat != null ? pickup.formatted || 'تم تحديد الموقع على الخريطة' : 'اختر من الخريطة / موقعي / البحث / عنوان محفوظ'}</T>
              <Ionicons name="map-outline" size={20} color={theme.muted} />
            </Pressable>
            {errors.pickup ? <T size={12} color={theme.danger} style={{ marginTop: 4 }}>{errors.pickup}</T> : null}
            <View style={{ height: 10 }} />
            <Input label="وصف العنوان" value={pickup.description ?? ''} onChangeText={(t) => setPickup({ ...pickup, description: t })} placeholder="مثال: البيت التالت بعد المسجد، الدور التاني" maxLength={500} />
            <Input label="علامة مميزة" value={pickup.landmark ?? ''} onChangeText={(t) => setPickup({ ...pickup, landmark: t })} placeholder="مثال: جنب صيدلية الشفاء" maxLength={200} />
          </Card>

          <Card>
            <T bold style={{ marginBottom: 8 }}>إلى أين؟ — نقطة التسليم</T>
            <Pressable onPress={() => setPicker('dropoff')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: errors.drop ? theme.danger : theme.border }}>
              <Ionicons name="location" size={20} color={theme.danger} />
              <T style={{ flex: 1 }} muted={drop.lat == null} numberOfLines={2}>{drop.lat != null ? drop.formatted || 'تم تحديد الموقع على الخريطة' : 'اختر نقطة التسليم'}</T>
              <Ionicons name="map-outline" size={20} color={theme.muted} />
            </Pressable>
            {errors.drop ? <T size={12} color={theme.danger} style={{ marginTop: 4 }}>{errors.drop}</T> : null}
            <View style={{ height: 10 }} />
            <Input label="اسم المستلم *" value={drop.contactName ?? ''} onChangeText={(t) => setDrop({ ...drop, contactName: t })} maxLength={80} error={errors.contactName} />
            <Input label="هاتف المستلم *" value={drop.contactPhone ?? ''} onChangeText={(t) => setDrop({ ...drop, contactPhone: t })} keyboardType="phone-pad" placeholder="01XXXXXXXXX" maxLength={14} error={errors.contactPhone} hint="هيوصله رابط التتبع وكود الاستلام برسالة" />
            <Input label="وصف العنوان" value={drop.description ?? ''} onChangeText={(t) => setDrop({ ...drop, description: t })} placeholder="البيت التالت بعد المسجد بجوار محل..." maxLength={500} multiline />
            <Input label="علامة مميزة" value={drop.landmark ?? ''} onChangeText={(t) => setDrop({ ...drop, landmark: t })} maxLength={200} />
            <Input label="تعليمات للمندوب" value={drop.instructions ?? ''} onChangeText={(t) => setDrop({ ...drop, instructions: t })} placeholder="مثال: اتصل قبل ما توصل بـ 10 دقايق" maxLength={500} />
            <Row>
              <Button small variant="ghost" icon="camera-outline" title={drop.photoUrl ? 'تغيير صورة المكان' : 'صورة للمكان (اختياري)'} onPress={() => photo((u) => setDrop((d) => ({ ...d, photoUrl: u })), 'PLACE')} />
              {drop.photoUrl ? <Image source={{ uri: drop.photoUrl }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : null}
            </Row>
          </Card>
        </>
      )}

      {step === 1 && (
        <>
          <Card>
            <T bold style={{ marginBottom: 8 }}>نوع الشحنة</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{c.categories.map((x) => <Chip key={x.code} label={x.nameAr} selected={category === x.code} onPress={() => setCategory(x.code)} />)}</View>
            {errors.category ? <T size={12} color={theme.danger}>{errors.category}</T> : null}
            <Divider />
            <T bold style={{ marginBottom: 8 }}>الحجم</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{c.sizes.map((x) => <Chip key={x.code} label={`${x.nameAr} (حتى ${x.maxKg} كجم)`} selected={size === x.code} onPress={() => setSize(x.code)} />)}</View>
            <Input label="الوزن التقريبي (كجم)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" maxLength={6} error={errors.weight} />
          </Card>
          <Card>
            <T bold style={{ marginBottom: 8 }}>المركبة</T>
            {vehicles.length === 0 ? <T color={theme.danger}>مفيش مركبة تناسب الحجم/الوزن ده، غيّر الحجم أو الوزن</T> : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{vehicles.map((v) => <Chip key={v.code} icon={VEHICLE_ICON[v.code] ?? 'car-outline'} label={v.nameAr} selected={vehicle === v.code} onPress={() => setVehicle(v.code)} />)}</View>
            )}
          </Card>
          <Card>
            <Input label="ملاحظات على الشحنة" value={notes} onChangeText={setNotes} placeholder="مثال: قابل للكسر، من فضلك بهدوء" maxLength={500} multiline />
            <Row>
              <Button small variant="ghost" icon="camera-outline" title={packagePhoto ? 'تغيير صورة الشحنة' : 'صورة الشحنة (اختياري)'} onPress={() => photo(setPackagePhoto, 'PACKAGE')} />
              {packagePhoto ? <Image source={{ uri: packagePhoto }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : null}
            </Row>
          </Card>
        </>
      )}

      {step === 2 && (
        <Card>
          <T bold style={{ marginBottom: 8 }}>متى نستلم؟</T>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip icon="flash-outline" label="توصيل الآن" selected={!scheduled} onPress={() => setScheduled(false)} />
            <Chip icon="calendar-outline" label="جدولة التوصيل" selected={scheduled} onPress={() => setScheduled(true)} />
          </Row>
          {scheduled ? (
            <View style={{ marginTop: 8 }}>
              {Platform.OS === 'android'
                ? <Button variant="secondary" icon="time-outline" title={fmtDate(when)} onPress={openWhen} />
                : <DateTimePicker value={when} mode="datetime" minimumDate={new Date()} onChange={(_e, d) => d && setWhen(d)} locale="ar-EG" />}
              {errors.when ? <T size={12} color={theme.danger} style={{ marginTop: 6 }}>{errors.when}</T> : <T size={12} muted style={{ marginTop: 6 }}>هنبدأ ندوّر على مندوب قبل الموعد بفترة كافية</T>}
            </View>
          ) : (
            <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <View style={{ flex: 1 }}><T bold>طلب عاجل</T><T size={13} muted>أولوية في التوزيع برسوم إضافية</T></View>
              <Switch value={urgent} onValueChange={setUrgent} trackColor={{ true: theme.primary }} />
            </Row>
          )}
        </Card>
      )}

      {step === 3 && (
        <>
          {busy && !quote ? <StateView loading /> : quoteErr && !quote ? (
            <Card><T color={theme.danger} center>{quoteErr}</T><View style={{ height: 10 }} /><Button small variant="secondary" title="إعادة المحاولة" icon="refresh" onPress={async () => { const e = await fetchQuote(appliedCoupon); if (e) setQuoteErr(e); }} /></Card>
          ) : quote ? (
            <>
              <Card>
                <Row style={{ justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}><Ionicons name="navigate-outline" size={22} color={theme.primary} /><T bold>{km(quote.distanceKm)}</T><T size={12} muted>المسافة</T></View>
                  <View style={{ alignItems: 'center' }}><Ionicons name="time-outline" size={22} color={theme.primary} /><T bold>{mins(quote.etaMinutes)}</T><T size={12} muted>الوقت المتوقع</T></View>
                  <View style={{ alignItems: 'center' }}><Ionicons name={VEHICLE_ICON[vehicle!] ?? 'car-outline'} size={22} color={theme.primary} /><T bold>{c.vehicles.find((v) => v.code === vehicle)?.nameAr}</T><T size={12} muted>المركبة</T></View>
                </Row>
              </Card>
              <Card>
                <T bold style={{ marginBottom: 6 }}>تفاصيل السعر</T>
                {quote.lines.map((l, i) => <KV key={l.code + i} k={l.labelAr} v={egp(l.amount)} />)}
                <Divider />
                <KV k="الإجمالي قبل الخصم" v={egp(quote.subtotal)} />
                {quote.discount > 0 && <KV k={`الخصم (${appliedCoupon})`} v={<T color={theme.success}>−{egp(quote.discount)}</T>} />}
                <KV bold k="الإجمالي" v={egp(quote.total)} />
                <T size={12} muted style={{ marginTop: 4 }}>السعر محسوب من مشاوير ومؤكد — مفيش مفاجآت</T>
              </Card>
              <Card>
                <T bold style={{ marginBottom: 8 }}>كود خصم</T>
                <Row>
                  <View style={{ flex: 1 }}><Input value={coupon} onChangeText={setCoupon} autoCapitalize="characters" placeholder="اكتب الكود" maxLength={40} error={couponErr} /></View>
                  <Button small title={appliedCoupon ? 'تغيير' : 'تطبيق'} onPress={applyCoupon} loading={busy} style={{ marginBottom: 12 }} />
                </Row>
                {appliedCoupon ? <Pressable onPress={removeCoupon}><T size={13} color={theme.primary}>{`إزالة الكود ${appliedCoupon}`}</T></Pressable> : null}
              </Card>
              <Card>
                <T bold style={{ marginBottom: 8 }}>طريقة الدفع</T>
                <Row style={{ flexWrap: 'wrap' }}>
                  <Chip icon="cash-outline" label="كاش عند الاستلام" selected={payment === 'CASH'} onPress={() => setPayment('CASH')} />
                  <Chip icon="wallet-outline" label="المحفظة" selected={payment === 'WALLET'} onPress={() => setPayment('WALLET')} />
                </Row>
                <T size={12} muted>الدفع بالبطاقة والمحافظ الإلكترونية قريبًا</T>
              </Card>
              <Card>
                <KV k="الاستلام" v={<T numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{pickup.formatted || 'على الخريطة'}</T>} />
                <KV k="التسليم" v={<T numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{`${drop.contactName} — ${drop.formatted || 'على الخريطة'}`}</T>} />
                <KV k="الموعد" v={scheduled ? fmtDate(when) : urgent ? 'الآن (عاجل)' : 'الآن'} />
              </Card>
            </>
          ) : null}
        </>
      )}

      <LocationPicker visible={picker != null} title={picker === 'pickup' ? 'نقطة الاستلام' : 'نقطة التسليم'}
        initial={picker === 'pickup' ? (pickup.lat != null ? (pickup as any) : null) : drop.lat != null ? (drop as any) : pickup.lat != null ? (pickup as any) : null}
        onClose={() => setPicker(null)}
        onPick={(p) => {
          const patch = { lat: p.lat, lng: p.lng, formatted: p.formatted, ...(p.description ? { description: p.description } : {}), ...(p.landmark ? { landmark: p.landmark } : {}) };
          if (picker === 'pickup') setPickup((x) => ({ ...x, ...patch }));
          else setDrop((x) => ({ ...x, ...patch, ...(p.contactPhone ? { contactPhone: normPhone(p.contactPhone) } : {}) }));
          setErrors({}); setPicker(null);
        }} />
    </Screen>
  );
}
