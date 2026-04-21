/**
 * RideCameraButton — floating quick-capture button for ride photos/videos.
 *
 * Opens the back camera directly on mobile via capture="environment".
 * Uploads to Google Drive via RidePhotoService (KromiFileStore).
 * Shows a brief flash effect on capture and a spinner during upload.
 */

import { useState, useRef } from 'react';
import { uploadRidePhoto } from '../../services/tracking/RidePhotoService';
import { useTripStore } from '../../store/tripStore';

export function RideCameraButton() {
  const tripState = useTripStore((s) => s.state);
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only show camera when trip is active
  if (tripState !== 'running') return null;

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setFlash(true);
    setTimeout(() => setFlash(false), 300);

    try {
      const result = await uploadRidePhoto(file);
      if (result) {
        console.log('[RideCamera] Photo uploaded:', result.id);
      }
    } catch (err) {
      console.error('[RideCamera] Capture failed:', err);
    }

    setUploading(false);

    // Reset input so same file can be captured again
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      {/* Flash overlay */}
      {flash && (
        <div
          className="fixed inset-0 pointer-events-none z-[9999]"
          style={{
            backgroundColor: 'white',
            opacity: 0.5,
            transition: 'opacity 0.3s',
          }}
        />
      )}

      {/* Camera button — positioned above bottom nav (h-20 = 80px) */}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="fixed z-40 flex items-center justify-center rounded-full"
        style={{
          bottom: 92,
          right: 16,
          width: 48,
          height: 48,
          backgroundColor: uploading
            ? 'var(--ev-surface-2, #262626)'
            : 'var(--ev-surface-1, #1a1a1a)',
          border: '2px solid rgba(63, 255, 139, 0.25)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          cursor: uploading ? 'wait' : 'pointer',
        }}
      >
        {uploading ? (
          <div
            className="animate-spin rounded-full"
            style={{
              width: 20,
              height: 20,
              border: '2px solid var(--ev-accent, #3fff8b)',
              borderTopColor: 'transparent',
            }}
          />
        ) : (
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 22, color: 'var(--ev-accent, #3fff8b)' }}
          >
            photo_camera
          </span>
        )}
      </button>

      {/* Hidden file input — opens camera on mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        onChange={handleCapture}
        style={{ display: 'none' }}
      />
    </>
  );
}
