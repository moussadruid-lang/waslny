import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.ts';
import { ah, E } from '../lib/errors.ts';

/**
 * File storage is an interface so we can swap local disk (dev/staging) for S3-compatible storage
 * (AWS S3 / Cloudflare R2 / DO Spaces) in production without touching callers.
 */
export interface FileStorage { put(key: string, data: Buffer, mime: string): Promise<string> }

const localStorage: FileStorage = {
  async put(key, data) {
    await fs.mkdir(env.UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(env.UPLOAD_DIR, key), data);
    return `${env.PUBLIC_FILES_BASE_URL}/${key}`;
  },
};
export const storage: FileStorage = localStorage;

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** Verify magic bytes: never trust the declared mime type. */
export function looksLike(b: Buffer, mime: string) {
  if (mime === 'image/png') return b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/webp') return b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  return false;
}

const PURPOSES = ['PACKAGE', 'PLACE', 'PICKUP_PROOF', 'DELIVERY_PROOF', 'SIGNATURE', 'FAILURE_PROOF', 'DRIVER_DOCUMENT', 'AVATAR', 'TICKET'] as const;

export const uploadsRouter = Router();
uploadsRouter.post('/', ah(async (req, res) => {
  const b = z.object({ purpose: z.enum(PURPOSES), mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), dataBase64: z.string().min(100) }).parse(req.body);
  const buf = Buffer.from(b.dataBase64, 'base64');
  if (buf.length > 5 * 1024 * 1024) throw E.bad('FILE_TOO_LARGE', 'حجم الصورة كبير، الحد الأقصى 5 ميجا');
  if (!looksLike(buf, b.mime)) throw E.bad('BAD_FILE', 'الملف ليس صورة صالحة');
  // Unguessable names (96-bit random). Phase 4: private bucket + signed URLs for DRIVER_DOCUMENT.
  const key = `${b.purpose.toLowerCase()}-${crypto.randomBytes(12).toString('hex')}.${EXT[b.mime]}`;
  res.status(201).json({ url: await storage.put(key, buf, b.mime) });
}));
