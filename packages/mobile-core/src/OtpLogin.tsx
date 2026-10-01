import React, { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, errMsg } from './api';
import { useAuth } from './auth';
import { Button, Input, Screen, T, Spacer } from './ui';
import { theme } from './theme';
import { APP_NAME, APP_TAGLINE } from './config';

const normalize = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^\d]/g, '');
const validPhone = (p: string) => /^01[0125]\d{8}$/.test(p);

/** Phone + SMS OTP login/registration, shared by both apps (§7). */
export function OtpLogin({ asDriver, subtitle }: { asDriver?: boolean; subtitle?: string }) {
  const { signIn } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [referral, setReferral] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [devCode, setDevCode] = useState<string>();
  const [left, setLeft] = useState(0);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t); }, [left]);

  async function request() {
    const p = normalize(phone);
    if (!validPhone(p)) return setErr('اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 01)');
    setBusy(true); setErr(undefined);
    try {
      const r = await api<{ devCode?: string }>('/v1/auth/otp/request', { body: { phone: p } });
      setDevCode(r.devCode); setStep('code'); setLeft(60);
      setTimeout(() => codeRef.current?.focus(), 300);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  async function verify() {
    const c = normalize(code);
    if (c.length !== 6) return setErr('الكود 6 أرقام');
    setBusy(true); setErr(undefined);
    try {
      const t = await api('/v1/auth/otp/verify', { body: { phone: normalize(phone), code: c, name: name.trim() || undefined, referralCode: referral.trim().toUpperCase() || undefined, asDriver } });
      await signIn(t);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Screen scroll keyboard edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 28 }}>
        <View style={{ width: 76, height: 76, borderRadius: 22, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={asDriver ? 'speedometer' : 'bicycle'} size={40} color="#fff" />
        </View>
        <T size={32} bold style={{ marginTop: 12 }}>{APP_NAME}</T>
        <T muted>{subtitle ?? APP_TAGLINE}</T>
      </View>

      {step === 'phone' ? (
        <>
          <T size={20} bold>أهلًا بيك 👋</T>
          <T muted style={{ marginBottom: 16 }}>اكتب رقم موبايلك وهنبعتلك كود تأكيد</T>
          <Input label="رقم الموبايل" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="01XXXXXXXXX" maxLength={14} autoFocus error={err} textContentType="telephoneNumber" autoComplete="tel" />
          <Button title="إرسال الكود" onPress={request} loading={busy} />
        </>
      ) : (
        <>
          <T size={20} bold>كود التأكيد</T>
          <T muted style={{ marginBottom: 16 }}>بعتنا كود من 6 أرقام للرقم {normalize(phone)}</T>
          <Input ref={codeRef as any} label="الكود" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="• • • • • •" textContentType="oneTimeCode" autoComplete="sms-otp" style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
          {devCode ? <T size={12} color={theme.info} style={{ marginTop: -6, marginBottom: 10 }}>بيئة التطوير: الكود {devCode}</T> : null}
          <Input label="الاسم (للحسابات الجديدة)" value={name} onChangeText={setName} placeholder="اسمك بالكامل" maxLength={80} />
          {!asDriver && <Input label="كود دعوة (اختياري)" value={referral} onChangeText={setReferral} autoCapitalize="characters" placeholder="MSH..." maxLength={20} />}
          {err ? <T color={theme.danger} style={{ marginBottom: 8 }}>{err}</T> : null}
          <Button title="تأكيد ودخول" onPress={verify} loading={busy} />
          <Spacer />
          <Pressable disabled={left > 0 || busy} onPress={request}><T center color={left > 0 ? theme.muted : theme.primary}>{left > 0 ? `إعادة الإرسال بعد ${left} ثانية` : 'إعادة إرسال الكود'}</T></Pressable>
          <Spacer h={8} />
          <Pressable onPress={() => { setStep('phone'); setCode(''); setErr(undefined); }}><T center muted>تغيير الرقم</T></Pressable>
        </>
      )}
      <Spacer h={24} />
      <T size={12} muted center>بالمتابعة أنت توافق على شروط الاستخدام وسياسة الخصوصية</T>
    </Screen>
  );
}
