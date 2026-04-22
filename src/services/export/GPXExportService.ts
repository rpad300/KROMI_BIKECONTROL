/**
 * GPX Export Service — exports ride data as GPX 1.1 files.
 *
 * Generates standards-compliant GPX XML with Garmin TrackPointExtension
 * for power, heart rate, and cadence data.
 */

export interface TrackPoint {
  lat: number;
  lng: number;
  elevation: number;
  timestamp: number; // unix ms
  speed?: number;
  power?: number;
  hr?: number;
  cadence?: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toISOString(ms: number): string {
  return new Date(ms).toISOString();
}

function buildTrackPoint(pt: TrackPoint): string {
  const lines: string[] = [];
  lines.push(`      <trkpt lat="${pt.lat}" lon="${pt.lng}">`);
  lines.push(`        <ele>${pt.elevation.toFixed(1)}</ele>`);
  lines.push(`        <time>${toISOString(pt.timestamp)}</time>`);

  // Extensions for power, HR, cadence
  const hasExtensions = pt.power !== undefined || pt.hr !== undefined || pt.cadence !== undefined;
  if (hasExtensions) {
    lines.push('        <extensions>');
    lines.push('          <gpxtpx:TrackPointExtension>');
    if (pt.hr !== undefined) {
      lines.push(`            <gpxtpx:hr>${Math.round(pt.hr)}</gpxtpx:hr>`);
    }
    if (pt.cadence !== undefined) {
      lines.push(`            <gpxtpx:cad>${Math.round(pt.cadence)}</gpxtpx:cad>`);
    }
    if (pt.power !== undefined) {
      lines.push(`            <gpxtpx:power>${Math.round(pt.power)}</gpxtpx:power>`);
    }
    lines.push('          </gpxtpx:TrackPointExtension>');
    lines.push('        </extensions>');
  }

  lines.push('      </trkpt>');
  return lines.join('\n');
}

/**
 * Build GPX from a simplified trail (post-processed).
 * Falls back to raw snapshots if no simplified trail available.
 */
export function buildGPXFromSimplified(
  rideName: string,
  simplifiedTrail: { lat: number; lng: number; alt: number; elapsed_s: number; speed: number }[],
  startedAt: number,
): string {
  const points: TrackPoint[] = simplifiedTrail.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    elevation: p.alt,
    timestamp: startedAt + p.elapsed_s * 1000,
    speed: p.speed,
  }));
  return buildGPXString(rideName, points);
}

export function buildGPXString(rideName: string, points: TrackPoint[]): string {
  const escapedName = escapeXml(rideName);
  const trackPoints = points.map(buildTrackPoint).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="KROMI BikeControl"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapedName}</name>
    <time>${points.length > 0 ? toISOString(points[0]!.timestamp) : toISOString(Date.now())}</time>
  </metadata>
  <trk>
    <name>${escapedName}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

export function exportRideAsGPX(rideName: string, points: TrackPoint[]): void {
  const gpxString = buildGPXString(rideName, points);
  const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);

  const safeName = rideName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
