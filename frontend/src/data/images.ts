import { DataError, type EntryImage } from '../domain/entries';
import { supabase } from './supabase';

export const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export const maxImageBytes = 10 * 1024 * 1024;
const bucket = 'entry-images';

export async function uploadImage(
  entryId: string,
  imageId: string,
  file: File,
): Promise<EntryImage> {
  if (!imageTypes.includes(file.type) || file.size > maxImageBytes) {
    throw new DataError('invalid', 'Choose a JPEG, PNG, WebP, GIF or AVIF image up to 10 MB.');
  }
  if (!supabase) throw new DataError('unavailable', 'The book is not connected yet.');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new DataError('auth', 'Sign in again to upload images.');
  const path = `${user.id}/${entryId}/${imageId}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error)
    throw new DataError(
      'unavailable',
      'The image upload could not be confirmed. Retry to finish saving your entry.',
    );
  return { path, name: file.name };
}

export async function imageUrl(path: string): Promise<string> {
  if (!supabase) throw new DataError('unavailable', 'The book is not connected yet.');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw new DataError('unavailable', 'Could not load this image.');
  return data.signedUrl;
}
