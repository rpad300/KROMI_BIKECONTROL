/**
 * RidePhotoService — capture ride photos, upload to Drive, save metadata.
 *
 * Uses KromiFileStore for Drive upload (mandatory convention) and
 * supaFetch for Supabase metadata. GPS position is read from mapStore.
 */

import { uploadFile, userFolderSlug } from '../storage/KromiFileStore';
import { useAuthStore } from '../../store/authStore';
import { useMapStore } from '../../store/mapStore';
import { supaFetch } from '../../lib/supaFetch';

/**
 * Upload a ride photo/video file with GPS metadata.
 * Returns the KromiFile record on success, null on failure.
 */
export async function uploadRidePhoto(
  file: File,
  caption?: string,
): Promise<{
  id: string;
  drive_view_link: string | null;
  drive_thumbnail_link: string | null;
  lat: number;
  lng: number;
  altitude: number | null;
} | null> {
  const user = useAuthStore.getState().user;
  if (!user) {
    console.warn('[RidePhoto] No authenticated user');
    return null;
  }

  const { latitude: lat, longitude: lng, altitude } = useMapStore.getState();

  const slug = userFolderSlug(user);

  try {
    // Upload to Google Drive via KromiFileStore (mandatory convention)
    const kromiFile = await uploadFile(file, {
      ownerUserId: user.id,
      ownerUserSlug: slug,
      category: 'ride_photo',
      entityType: 'ride',
      entityId: user.id, // Use user ID as entity (UUID required)
      caption: caption || undefined,
      metadata: {
        lat,
        lng,
        altitude,
        captured_at: new Date().toISOString(),
        media_type: file.type.startsWith('video') ? 'video' : 'photo',
      },
    });

    // Also save to ride_photos table for live tracking gallery
    try {
      await supaFetch('/rest/v1/ride_photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          user_id: user.id,
          lat: lat || 0,
          lng: lng || 0,
          altitude,
          drive_file_id: kromiFile.drive_file_id || null,
          drive_view_url: kromiFile.drive_view_link || null,
          drive_thumbnail_url: kromiFile.drive_thumbnail_link || null,
          caption: caption || null,
          media_type: file.type.startsWith('video') ? 'video' : 'photo',
        }),
      });
    } catch (e) {
      console.warn('[RidePhoto] ride_photos insert failed:', e);
    }

    return {
      id: kromiFile.id,
      drive_view_link: kromiFile.drive_view_link,
      drive_thumbnail_link: kromiFile.drive_thumbnail_link,
      lat,
      lng,
      altitude,
    };
  } catch (err) {
    console.error('[RidePhoto] Upload failed:', err);
    return null;
  }
}
