import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, EGYPT_CENTER, T, api, currentPosition, errMsg, inEgypt, reverseLabel, searchPlace, theme, useToast, type LatLng } from '@mashawir/mobile-core';

export interface PickedPlace extends LatLng { formatted?: string; description?: string | null; landmark?: string | null; contactPhone?: string | null; title?: string | null }
const LABEL_AR: Record<string, string> = { HOME: 'البيت', WORK: 'الشغل', FAVORITE: 'مفضّل', CUSTOM: 'عنوان' };

/**
 * Choose a point by: GPS, dragging the map under a fixed pin, searching (device geocoder),
 * a saved address, or typing the address manually. Informal Egyptian addresses are supported
 * through the free-text label + description/landmark fields on the next screen.
 */
export function LocationPicker({ visible, title, initial, onClose, onPick }: { visible: boolean; title: string; initial?: LatLng | null; onClose: () => void; onPick: (p: PickedPlace) => void }) {
  const toast = useToast();
  const map = useRef<MapView>(null);
  const [center, setCenter] = useState<LatLng>(initial ?? EGYPT_CENTER);
  const [label, setLabel] = useState('');
  const [labelEdited, setLabelEdited] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<(LatLng & { label?: string })[]>([]);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<any[]>([]);

  useEffect(() => {
    if (!visible) return;
    setLabelEdited(false); setResults([]); setQuery('');
    api<any[]>('/v1/customer/addresses').then(setSaved).catch(() => {});
    if (!initial) locate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const moveTo = (p: LatLng, zoom = 0.008) => map.current?.animateToRegion({ latitude: p.lat, longitude: p.lng, latitudeDelta: zoom, longitudeDelta: zoom }, 400);

  async function locate(showErr = true) {
    try { const p = await currentPosition(); moveTo(p); } catch (e) { if (showErr) toast.show(errMsg(e), 'error'); }
  }
  async function onRegion(r: Region) {
    const p = { lat: r.latitude, lng: r.longitude };
    setCenter(p);
    if (labelEdited) return;
    setResolving(true);
    const l = await reverseLabel(p);
    setResolving(false);
    if (l) setLabel(l);
  }
  async function search() {
    if (query.trim().length < 2) return;
    setSearching(true);
    const r = await searchPlace(query.trim());
    setSearching(false);
    if (!r.length) toast.show('ملقيناش المكان، حرّك الخريطة أو اكتب العنوان يدويًا', 'info');
    setResults(r.map((x) => ({ ...x, label: query.trim() })));
    if (r[0]) moveTo(r[0], 0.02);
  }
  const out = !inEgypt(center);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="إغلاق"><Ionicons name="close" size={26} color={theme.text} /></Pressable>
          <T bold size={17} style={{ flex: 1 }}>{title}</T>
        </View>
        <View style={{ flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 8 }}>
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" placeholder="ابحث: اسم منطقة، شارع، معلم..." placeholderTextColor="#9CA3AF"
            style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 15, color: theme.text }} />
          <Pressable onPress={search} style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
            {searching ? <ActivityIndicator color="#fff" /> : <Ionicons name="search" size={22} color="#fff" />}
          </Pressable>
        </View>
        {saved.length > 0 && (
          <FlatList horizontal data={saved} keyExtractor={(a) => a.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }} style={{ flexGrow: 0 }}
            renderItem={({ item: a }) => <Chip icon="bookmark-outline" label={a.title || LABEL_AR[a.label] || 'عنوان'} onPress={() => onPick({ lat: a.lat, lng: a.lng, formatted: a.formatted ?? a.title, description: a.description, landmark: a.landmark, contactPhone: a.contactPhone, title: a.title })} />} />
        )}
        <View style={{ flex: 1 }}>
          <MapView ref={map} style={{ flex: 1 }} provider={PROVIDER_GOOGLE} showsUserLocation showsMyLocationButton={false} onRegionChangeComplete={onRegion}
            initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: initial ? 0.008 : 0.05, longitudeDelta: initial ? 0.008 : 0.05 }} />
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="location" size={44} color={theme.danger} style={{ marginBottom: 40 }} />
          </View>
          <Pressable onPress={() => locate()} style={{ position: 'absolute', bottom: 16, end: 16, width: 50, height: 50, borderRadius: 25, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...theme.shadow }} accessibilityLabel="موقعي الحالي">
            <Ionicons name="locate" size={24} color={theme.primary} />
          </Pressable>
          {results.length > 1 && (
            <View style={{ position: 'absolute', top: 8, left: 12, right: 12, backgroundColor: '#fff', borderRadius: 12, ...theme.shadow }}>
              {results.map((r, i) => <Pressable key={i} onPress={() => { moveTo(r); setResults([]); }} style={{ padding: 12 }}><T>{`${r.label} (${i + 1})`}</T></Pressable>)}
            </View>
          )}
        </View>
        <View style={{ padding: 16, backgroundColor: '#fff' }}>
          <T size={13} muted style={{ marginBottom: 6 }}>العنوان (تقدر تعدّله أو تكتبه يدويًا)</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <TextInput value={label} onChangeText={(t) => { setLabel(t); setLabelEdited(true); }} placeholder="مثال: دمرو، شارع المدرسة" placeholderTextColor="#9CA3AF" maxLength={300}
              style={{ flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, fontSize: 15, color: theme.text }} />
            {resolving && <ActivityIndicator color={theme.primary} />}
          </View>
          {out && <T color={theme.danger} size={13} style={{ marginBottom: 8 }}>الموقع خارج مصر، حرّك الخريطة للمكان الصحيح</T>}
          <Button title="تأكيد الموقع" icon="checkmark" disabled={out} onPress={() => onPick({ ...center, formatted: label.trim() || undefined })} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
