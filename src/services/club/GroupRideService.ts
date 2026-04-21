/**
 * GroupRideService — manage group rides and sync participant positions.
 *
 * When a rider joins a group ride, their tracking_session token is stored
 * in club_ride_participants. The live.html page polls all participants
 * to show their positions on the map.
 */

import { supaFetch, supaGet } from '../../lib/supaFetch';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';

export interface ClubRide {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  scheduled_at: string;
  status: string; // 'planned' | 'active' | 'completed'
  route_gpx: string | null;
  meeting_lat: number | null;
  meeting_lng: number | null;
  meeting_address: string | null;
  created_by: string;
  created_at: string;
}

export interface RideParticipant {
  id: string;
  club_ride_id: string;
  user_id: string;
  session_id: string | null;
  status: string; // 'confirmed' | 'riding' | 'finished'
  display_name: string | null;
  tracking_token: string | null;
  phone: string | null;
  avatar_url: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_speed: number | null;
  last_update: string | null;
}

/** Get active group rides for the user's club */
export async function getActiveClubRides(clubId: string): Promise<ClubRide[]> {
  return supaGet<ClubRide[]>(
    `/rest/v1/club_rides?club_id=eq.${clubId}&status=in.(planned,active)&order=scheduled_at.asc`
  );
}

/** Get participants for a group ride */
export async function getRideParticipants(rideId: string): Promise<RideParticipant[]> {
  return supaGet<RideParticipant[]>(
    `/rest/v1/club_ride_participants?club_ride_id=eq.${rideId}&select=*`
  );
}

/** Join a group ride — adds current user as participant with tracking token */
export async function joinGroupRide(rideId: string): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;

  const profile = useSettingsStore.getState().riderProfile;
  const token = profile.emergency_qr_token || null;

  await supaFetch('/rest/v1/club_ride_participants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      club_ride_id: rideId,
      user_id: user.id,
      status: 'confirmed',
      display_name: profile.name || user.email,
      tracking_token: token,
      phone: profile.phone || null,
      avatar_url: profile.avatar_url || null,
    }),
  });
}

/** Leave a group ride */
export async function leaveGroupRide(rideId: string): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;
  await supaFetch(
    `/rest/v1/club_ride_participants?club_ride_id=eq.${rideId}&user_id=eq.${user.id}`,
    { method: 'DELETE' }
  );
}

/** Update own participant status (e.g. 'riding', 'finished') */
export async function updateParticipantStatus(rideId: string, status: string): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user) return;
  await supaFetch(
    `/rest/v1/club_ride_participants?club_ride_id=eq.${rideId}&user_id=eq.${user.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  );
}

/** Create a new group ride */
export async function createGroupRide(
  clubId: string,
  data: {
    name: string;
    description?: string;
    scheduled_at: string;
    meeting_address?: string;
    meeting_lat?: number;
    meeting_lng?: number;
    route_gpx?: string;
  }
): Promise<ClubRide | null> {
  const user = useAuthStore.getState().user;
  if (!user) return null;

  const res = await supaFetch('/rest/v1/club_rides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      club_id: clubId,
      created_by: user.id,
      status: 'planned',
      ...data,
    }),
  });
  const rides = await res.json();
  return Array.isArray(rides) && rides.length > 0 ? rides[0] : null;
}
