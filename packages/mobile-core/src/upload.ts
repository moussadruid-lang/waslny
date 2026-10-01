import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, ApiError } from './api';

export type UploadPurpose = 'PACKAGE' | 'PLACE' | 'PICKUP_PROOF' | 'DELIVERY_PROOF' | 'SIGNATURE' | 'FAILURE_PROOF' | 'DRIVER_DOCUMENT' | 'AVATAR' | 'TICKET';
export interface PickedImage { uri: string; base64: string; mime: 'image/jpeg' | 'image/png' }

/** Pick or capture, then downscale to 1280px JPEG (§65 image optimization; keeps uploads < 1MB). */
export async function pickImage(source: 'camera' | 'library'): Promise<PickedImage | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new ApiError('PERMISSION', source === 'camera' ? 'اسمح للتطبيق باستخدام الكاميرا من الإعدادات' : 'اسمح للتطبيق بالوصول للصور من الإعدادات');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const resize = a.width && a.width > 1280 ? [{ resize: { width: 1280 } }] : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, resize, { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return { uri: out.uri, base64: out.base64!, mime: 'image/jpeg' };
}

export async function uploadBase64(base64: string, mime: 'image/jpeg' | 'image/png', purpose: UploadPurpose): Promise<string> {
  const r = await api<{ url: string }>('/v1/uploads', { body: { purpose, mime, dataBase64: base64 }, timeoutMs: 60000 });
  return r.url;
}

export async function pickAndUpload(source: 'camera' | 'library', purpose: UploadPurpose) {
  const img = await pickImage(source);
  if (!img) return null;
  return { ...img, url: await uploadBase64(img.base64, img.mime, purpose) };
}
