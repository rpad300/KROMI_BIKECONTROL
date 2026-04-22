// ═══════════════════════════════════════════════════════════════
// ClubService — abstraction layer for all Club operations
// ═══════════════════════════════════════════════════════════════
//
// ALL Supabase calls go through supaFetch/supaGet/supaRpc.
// NEVER use raw fetch() here — the helpers inject the KROMI JWT
// that RLS policies depend on (kromi_uid() / is_super_admin_jwt()).
//
// RPCs are SECURITY DEFINER functions that handle authorization
// server-side — they verify membership, roles, and ownership.
// ═══════════════════════════════════════════════════════════════

import { supaFetch, supaGet, supaRpc, SupaFetchError } from '../../lib/supaFetch';

// ─── Types ───────────────────────────────────────────────────

export interface LandingConfig {
  show_members?: boolean;
  show_leaderboard?: boolean;
  show_map?: boolean;
  show_feed?: boolean;
  show_upcoming_rides?: boolean;
  custom_about?: string;
  board_members?: BoardMember[];
  show_board?: boolean;
}

export interface BoardMember {
  user_id: string;
  title: string;
  display_name?: string;
  avatar_url?: string;
}

export interface Club {
  id: string;
  name: string;
  slug: string;
  color: string;
  location: string;
  description?: string;
  website?: string;
  visibility: 'public' | 'private';
  avatar_url?: string;
  banner_url?: string;
  founded_at?: string;
  social_links: Record<string, string>;
  landing_config: LandingConfig;
  member_count: number;
  created_by: string;
}

export interface ClubMember {
  user_id: string;
  club_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'moderator' | 'member';
  joined_at: string;
  avatar_url?: string;
}

export interface ClubInvite {
  id: string;
  club_id: string;
  code: string;
  created_by: string;
  email?: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  created_at: string;
}

export interface ClubJoinRequest {
  id: string;
  club_id: string;
  user_id: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  display_name?: string;
}

export interface ClubRidePost {
  id: string;
  club_id: string;
  ride_id?: string;
  author_id: string;
  content?: string;
  stats?: Record<string, unknown>;
  photos?: {
    drive_view_url: string;
    drive_thumbnail_url: string;
    caption?: string;
    lat?: number;
    lng?: number;
  }[];
  gpx_file_id?: string;
  ride_data?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  author_name?: string;
  author_avatar?: string;
}

// ─── Internal helpers ────────────────────────────────────────

/**
 * Unwrap SupaFetchError into a human-readable message and rethrow.
 * Keeps error surfaces consistent across all club operations.
 */
function wrapError(fn: string, err: unknown): never {
  if (err instanceof SupaFetchError) {
    let detail = err.body;
    try {
      const parsed = JSON.parse(detail) as { message?: string; error?: string };
      detail = parsed.message ?? parsed.error ?? detail;
    } catch { /* not json */ }
    throw new Error(`ClubService.${fn}: ${detail}`);
  }
  throw err;
}

// ─── Club CRUD ───────────────────────────────────────────────

/**
 * Fetch a single club by its UUID. Returns null when not found.
 */
export async function getClub(id: string): Promise<Club | null> {
  try {
    const rows = await supaGet<Club[]>(
      `/rest/v1/clubs?id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    return rows?.[0] ?? null;
  } catch (err) {
    return wrapError('getClub', err);
  }
}

/**
 * Fetch a single club by its URL slug. Returns null when not found.
 */
export async function getClubBySlug(slug: string): Promise<Club | null> {
  try {
    const rows = await supaGet<Club[]>(
      `/rest/v1/clubs?slug=eq.${encodeURIComponent(slug)}&limit=1`,
    );
    return rows?.[0] ?? null;
  } catch (err) {
    return wrapError('getClubBySlug', err);
  }
}

/**
 * Full-text search across club name and location. Returns up to 20
 * results ordered by member_count descending so popular clubs surface
 * first.
 */
export async function searchClubs(query: string): Promise<Club[]> {
  try {
    const q = encodeURIComponent(query);
    return await supaGet<Club[]>(
      `/rest/v1/clubs?or=(name.ilike.*${q}*,location.ilike.*${q}*)&order=member_count.desc&limit=20`,
    );
  } catch (err) {
    return wrapError('searchClubs', err);
  }
}

/**
 * Partial update of a club record. Only owners and admins with the
 * appropriate permission can update — RLS enforces this.
 */
export async function updateClub(
  id: string,
  updates: Partial<Omit<Club, 'id' | 'slug' | 'created_by'>>,
): Promise<Club> {
  try {
    const res = await supaFetch(
      `/rest/v1/clubs?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(updates),
      },
    );
    const rows = (await res.json()) as Club[];
    return rows[0]!;
  } catch (err) {
    return wrapError('updateClub', err);
  }
}

// ─── Members ─────────────────────────────────────────────────

/**
 * List all members of a club ordered by role priority then join date.
 */
export async function getMembers(clubId: string): Promise<ClubMember[]> {
  try {
    return await supaGet<ClubMember[]>(
      `/rest/v1/club_members?club_id=eq.${encodeURIComponent(clubId)}&order=joined_at.asc`,
    );
  } catch (err) {
    return wrapError('getMembers', err);
  }
}

/**
 * Promote or demote a member's role. Calls SECURITY DEFINER RPC that
 * validates the caller has sufficient authority (owner > admin).
 */
export async function setMemberRole(
  clubId: string,
  targetUserId: string,
  role: ClubMember['role'],
): Promise<void> {
  try {
    await supaRpc('club_set_member_role', {
      p_club_id: clubId,
      p_target_user_id: targetUserId,
      p_role: role,
    });
  } catch (err) {
    return wrapError('setMemberRole', err);
  }
}

/**
 * Remove a member from a club. RPC validates the caller is an
 * owner/admin (or the member themselves leaving).
 */
export async function removeMember(
  clubId: string,
  targetUserId: string,
): Promise<void> {
  try {
    await supaRpc('club_remove_member', {
      p_club_id: clubId,
      p_target_user_id: targetUserId,
    });
  } catch (err) {
    return wrapError('removeMember', err);
  }
}

// ─── Invites ─────────────────────────────────────────────────

/**
 * List all active (non-expired) invite links for a club.
 */
export async function getInvites(clubId: string): Promise<ClubInvite[]> {
  try {
    return await supaGet<ClubInvite[]>(
      `/rest/v1/club_invites?club_id=eq.${encodeURIComponent(clubId)}&order=created_at.desc`,
    );
  } catch (err) {
    return wrapError('getInvites', err);
  }
}

/**
 * Create a new invite link. Options include max_uses, expiry, and an
 * optional target email for single-use invites.
 */
export async function createInvite(
  clubId: string,
  createdBy: string,
  opts: {
    email?: string;
    max_uses?: number;
    expires_at?: string;
  } = {},
): Promise<ClubInvite> {
  try {
    const res = await supaFetch('/rest/v1/club_invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        club_id: clubId,
        created_by: createdBy,
        email: opts.email ?? null,
        max_uses: opts.max_uses ?? 1,
        expires_at:
          opts.expires_at ??
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const rows = (await res.json()) as ClubInvite[];
    return rows[0]!;
  } catch (err) {
    return wrapError('createInvite', err);
  }
}

/**
 * Consume an invite code. The SECURITY DEFINER RPC validates expiry,
 * max_uses, and optional email match before adding the caller as a member.
 */
export async function useInvite(code: string): Promise<void> {
  try {
    await supaRpc('club_use_invite', { p_code: code });
  } catch (err) {
    return wrapError('useInvite', err);
  }
}

// ─── Join Requests ───────────────────────────────────────────

/**
 * List all pending join requests for a club. Admins/owners only —
 * RLS filters non-privileged callers to their own request.
 */
export async function getJoinRequests(clubId: string): Promise<ClubJoinRequest[]> {
  try {
    return await supaGet<ClubJoinRequest[]>(
      `/rest/v1/club_join_requests?club_id=eq.${encodeURIComponent(clubId)}&order=created_at.asc`,
    );
  } catch (err) {
    return wrapError('getJoinRequests', err);
  }
}

/**
 * Submit a join request for the calling user. The optional message is
 * shown to club admins when reviewing the request.
 */
export async function requestJoin(
  clubId: string,
  message?: string,
): Promise<ClubJoinRequest> {
  try {
    const result = await supaRpc<ClubJoinRequest>('club_request_join', {
      p_club_id: clubId,
      p_message: message ?? null,
    });
    return result;
  } catch (err) {
    return wrapError('requestJoin', err);
  }
}

/**
 * Approve or reject a pending join request. RPC validates the caller
 * is an admin/owner of the club and updates status + review metadata.
 */
export async function reviewRequest(
  requestId: string,
  approve: boolean,
): Promise<void> {
  try {
    await supaRpc('club_review_request', {
      p_request_id: requestId,
      p_approve: approve,
    });
  } catch (err) {
    return wrapError('reviewRequest', err);
  }
}

// ─── Landing Config ──────────────────────────────────────────

/**
 * Persist landing page configuration for a club. The RPC merges the
 * provided config into the existing JSONB column rather than replacing
 * it, so callers may pass partial updates.
 */
export async function updateLandingConfig(
  clubId: string,
  config: Partial<LandingConfig>,
): Promise<void> {
  try {
    await supaRpc('club_update_landing_config', {
      p_club_id: clubId,
      p_config: config,
    });
  } catch (err) {
    return wrapError('updateLandingConfig', err);
  }
}

// ─── Ride Posts ──────────────────────────────────────────────

/**
 * Fetch ride posts for a club, newest first. Defaults to the 20 most
 * recent; pass a `limit` to paginate.
 */
export async function getRidePosts(
  clubId: string,
  limit = 20,
): Promise<ClubRidePost[]> {
  try {
    return await supaGet<ClubRidePost[]>(
      `/rest/v1/club_ride_posts?club_id=eq.${encodeURIComponent(clubId)}&order=created_at.desc&limit=${limit}`,
    );
  } catch (err) {
    return wrapError('getRidePosts', err);
  }
}

/**
 * Publish a ride post to a club feed. The author_id must match the
 * calling user — RLS enforces this on INSERT.
 */
export async function createRidePost(
  post: Omit<ClubRidePost, 'id' | 'created_at' | 'updated_at'>,
): Promise<ClubRidePost> {
  try {
    const res = await supaFetch('/rest/v1/club_ride_posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(post),
    });
    const rows = (await res.json()) as ClubRidePost[];
    return rows[0]!;
  } catch (err) {
    return wrapError('createRidePost', err);
  }
}
