/**
 * Direct-to-Cloudinary image upload.
 *
 * The old path was phone → Django → Cloudinary: the file crossed the network
 * twice and held a Railway worker for the whole transfer. Uploading straight
 * to Cloudinary with an unsigned preset removes the middle hop — Django only
 * ever receives the resulting URL string.
 *
 * The preset (`aura_unsigned`) is restricted server-side to image formats and
 * a 1920px bounding box, so nothing here needs to hold a secret.
 */

const CLOUD_NAME = 'dqi7ntmox';
const UPLOAD_PRESET = 'aura_unsigned';
const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

/**
 * Upload a local image (file:// URI from the picker/camera) and return its
 * Cloudinary `secure_url`. Throws on failure — callers already have error
 * paths for the old multipart POST and keep using them.
 */
export async function uploadImageToCloudinary(
  uri: string,
  mimeType: string = 'image/jpeg',
): Promise<string> {
  const form = new FormData();
  form.append('file', { uri, type: mimeType, name: 'upload.jpg' } as any);
  form.append('upload_preset', UPLOAD_PRESET);

  const res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cloudinary upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data: { secure_url?: string } = await res.json();
  if (!data.secure_url) throw new Error('Cloudinary response missing secure_url');
  return data.secure_url;
}
