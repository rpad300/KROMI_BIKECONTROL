/**
 * KROMI BikeControl — Ride Engine v2
 * Complete JavaScript engine for ride.html
 *
 * Extracted from ride.html inline <script> + new features:
 *   - Dark/Light mode toggle
 *   - Club theme application (colors, fonts)
 *   - SEO JSON-LD injection
 *   - Live tracking badge
 *
 * Globals exposed (required by HTML):
 *   loadGoogleMaps()  — singleton Google Maps loader
 *   _gmCallback()     — Google Maps ready callback
 */

/* ═══════════════════════════════════════════════════════════════════════════════
   Google Maps Loader  (MUST be global — referenced in script callback URL)
   ═══════════════════════════════════════════════════════════════════════════════ */
var MAPS_KEY = 'AIzaSyBip-WjHT8ZEJ4sWtYPH0pfUwwj9VAsZFE';
var _mapsPromise = null;

function loadGoogleMaps() {
  if (_mapsPromise) return _mapsPromise;
  _mapsPromise = new Promise(function (resolve) {
    if (window.google && window.google.maps && window.google.maps.Map) { resolve(); return; }
    window._gmCallback = function () { resolve(); };
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + MAPS_KEY + '&libraries=geometry,places&callback=_gmCallback';
    document.head.appendChild(script);
  });
  return _mapsPromise;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   IIFE — all other code is encapsulated
   ═══════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
var SB_URL  = 'https://ctsuupvmmyjlrtjnxagv.supabase.co';
var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0c3V1cHZtbXlqbHJ0am54YWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5Njg3MTgsImV4cCI6MjA5MDU0NDcxOH0.VgpKrjxYirb9Gc7OZX-aHGJmGJ3QdDM5I7iXaWDmBXQ';

// ── Globals ──────────────────────────────────────────────────────────────────
var gpxRawData = null; // stored for GPX download

// ── Utils ────────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function fmt(v, dec) { return v == null ? '\u2014' : Number(v).toFixed(dec == null ? 1 : dec); }
function fmtInt(v) { return v == null ? '\u2014' : Math.round(Number(v)).toString(); }

function escHtml(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseParams() {
  var p = new URLSearchParams(location.search);
  return { postId: p.get('id'), rideId: p.get('ride') };
}

function sbGet(path) {
  return fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' \u2014 ' + path);
    return r.json();
  });
}

function showError(msg) {
  $('loading-state').style.display = 'none';
  $('error-state').style.display = '';
  $('error-msg').textContent = msg || 'Erro desconhecido.';
}

function showApp() {
  $('loading-state').style.display = 'none';
  $('error-state').style.display = 'none';
  $('app').style.display = '';
}

// ── Scroll Reveal ────────────────────────────────────────────────────────────
function initReveal() {
  var els = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    els.forEach(function (e) { e.classList.add('revealed'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); }
    });
  }, { threshold: 0.05 });
  els.forEach(function (e) { io.observe(e); });
}

// ── Reveal helper for dynamically added sections ─────────────────────────────
function initRevealForElement(el) {
  if (!el || !('IntersectionObserver' in window)) {
    if (el) el.classList.add('revealed');
    var children = el ? el.querySelectorAll('[data-reveal]') : [];
    children.forEach(function (c) { c.classList.add('revealed'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); }
    });
  }, { threshold: 0.05 });
  io.observe(el);
  el.querySelectorAll('[data-reveal]').forEach(function (c) { io.observe(c); });
}

// ── Date formatting ──────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '\u2014';
  try {
    return new Date(d).toLocaleDateString('pt-PT', {
      weekday: 'short', day: '2-digit', month: 'long', year: 'numeric'
    });
  } catch (e) { return d; }
}
function fmtTime(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
}
function fmtDuration(sec) {
  if (sec == null || sec <= 0) return '\u2014';
  var s = Number(sec);
  if (s < 60) return Math.round(s) + 's';
  var h = Math.floor(s / 3600);
  var m = Math.round((s % 3600) / 60);
  return h > 0 ? h + 'h' + (m < 10 ? '0' : '') + m : m + 'min';
}
function fmtDurationMin(min) {
  if (min == null) return '\u2014';
  return fmtDuration(Number(min) * 60);
}

// ── SVG icon helpers ─────────────────────────────────────────────────────────
function svgCalendar() { return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'; }
function svgPin() { return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>'; }
function svgClock() { return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'; }

// ── GPX Parsing ──────────────────────────────────────────────────────────────
function parseGpx(gpxText) {
  var cleaned = gpxText.replace(/xmlns\s*=\s*["'][^"']*["']/gi, '');
  var parser = new DOMParser();
  var doc = parser.parseFromString(cleaned, 'application/xml');
  var trkpts = doc.querySelectorAll('trkpt');
  if (!trkpts.length) trkpts = doc.querySelectorAll('rtept');
  var points = [];
  trkpts.forEach(function (pt) {
    var lat = parseFloat(pt.getAttribute('lat'));
    var lon = parseFloat(pt.getAttribute('lon'));
    var eleEl = pt.querySelector('ele');
    var ele = eleEl ? parseFloat(eleEl.textContent) : 0;
    if (!isNaN(lat) && !isNaN(lon)) points.push({ lat: lat, lon: lon, ele: ele });
  });
  return points;
}

// ── Distance between two coords (Haversine, km) ─────────────────────────────
function haversineKm(a, b) {
  var R = 6371;
  var dLat = (b.lat - a.lat) * Math.PI / 180;
  var dLon = (b.lon - a.lon) * Math.PI / 180;
  var la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// ── Build cumulative distance + smoothed elevation from GPX points ───────────
function buildProfile(pts) {
  if (!pts || pts.length < 2) return [];
  var profile = [];
  var cumDist = 0;
  for (var i = 0; i < pts.length; i++) {
    if (i > 0) cumDist += haversineKm(pts[i - 1], pts[i]);
    profile.push({ d: cumDist, e: pts[i].ele, lat: pts[i].lat, lon: pts[i].lon });
  }
  // 5-point moving average smoothing on elevation
  var smoothed = [];
  var W = 2; // window half-size
  for (var j = 0; j < profile.length; j++) {
    var sum = 0, cnt = 0;
    for (var k = Math.max(0, j - W); k <= Math.min(profile.length - 1, j + W); k++) {
      sum += profile[k].e; cnt++;
    }
    smoothed.push({ d: profile[j].d, e: sum / cnt, lat: profile[j].lat, lon: profile[j].lon });
  }
  return smoothed;
}

// ── Compute D+ and D- with 3m threshold ──────────────────────────────────────
function computeGainLoss(profile) {
  var gain = 0, loss = 0, THRESH = 3;
  var anchor = profile[0].e;
  for (var i = 1; i < profile.length; i++) {
    var diff = profile[i].e - anchor;
    if (diff > THRESH) { gain += diff; anchor = profile[i].e; }
    else if (diff < -THRESH) { loss += Math.abs(diff); anchor = profile[i].e; }
  }
  return { gain: gain, loss: loss };
}

// ── Auto-detect segments ─────────────────────────────────────────────────────
function autoDetectSegments(profile) {
  if (!profile || profile.length < 10) return [];
  var segments = [];
  var MIN_GAIN = 50;
  var i = 0;
  while (i < profile.length - 1) {
    var dir = 0;
    var j = i + 1;
    while (j < profile.length && Math.abs(profile[j].e - profile[i].e) < 10) j++;
    if (j >= profile.length) break;
    dir = profile[j].e > profile[i].e ? 1 : -1;

    var segStart = i;
    var segEnd = j;
    var localMin = profile[segStart].e, localMax = profile[segStart].e;
    while (segEnd < profile.length - 1) {
      var nextE = profile[segEnd + 1].e;
      if (dir > 0) {
        if (nextE > localMax) { localMax = nextE; }
        if (localMax - nextE > 30) break;
      } else {
        if (nextE < localMin) { localMin = nextE; }
        if (nextE - localMin > 30) break;
      }
      segEnd++;
    }

    var startE = profile[segStart].e, endE = profile[segEnd].e;
    var totalGain = 0, totalLoss = 0;
    for (var k = segStart + 1; k <= segEnd; k++) {
      var delta = profile[k].e - profile[k - 1].e;
      if (delta > 0) totalGain += delta; else totalLoss += Math.abs(delta);
    }

    var primaryGain = dir > 0 ? totalGain : totalLoss;
    var distKm = profile[segEnd].d - profile[segStart].d;

    if (primaryGain >= MIN_GAIN && distKm > 0.2) {
      var avgGrad = distKm > 0 ? ((endE - startE) / (distKm * 1000)) * 100 : 0;
      var maxGrad = 0;
      for (var m = segStart + 1; m <= segEnd; m++) {
        var dd = (profile[m].d - profile[m - 1].d) * 1000;
        if (dd > 5) {
          var g = Math.abs((profile[m].e - profile[m - 1].e) / dd) * 100;
          if (g > maxGrad) maxGrad = g;
        }
      }
      segments.push({
        name: dir > 0 ? 'Subida ' + (segments.filter(function (s) { return s.direction > 0; }).length + 1)
                       : 'Descida ' + (segments.filter(function (s) { return s.direction < 0; }).length + 1),
        direction: dir,
        distance_km: distKm,
        elevation_gain_m: totalGain,
        elevation_loss_m: totalLoss,
        avg_gradient_pct: avgGrad,
        max_gradient_pct: maxGrad,
        start_idx: segStart,
        end_idx: segEnd,
        start_ele: startE,
        end_ele: endE,
        profile: profile.slice(segStart, segEnd + 1)
      });
    }
    i = segEnd;
  }
  return segments;
}

// ── Slope color ──────────────────────────────────────────────────────────────
function slopeColor(slope) {
  var s = Math.abs(slope);
  if (s < 4)  return '#22c55e';
  if (s < 8)  return '#fbbf24';
  if (s < 12) return '#ef4444';
  return '#a78bfa';
}
function getDifficulty(grad) {
  var g = Math.abs(grad);
  if (g < 4)  return { cls: 'diff-easy',     label: 'Facil',    color: '#22c55e' };
  if (g < 8)  return { cls: 'diff-moderate',  label: 'Moderado', color: '#fbbf24' };
  if (g < 12) return { cls: 'diff-hard',      label: 'Dificil',  color: '#ef4444' };
  return          { cls: 'diff-extreme',   label: 'Extremo',  color: '#a78bfa' };
}

// ═════════════════════════════════════════════════════════════════════════════
// SPEED MODEL — calibrated from MTB group ride data
// Sources: singletracks.com, mtbr.com, theclimbingcyclist.com, pedalchile.com
// ═════════════════════════════════════════════════════════════════════════════
var SPEED_MODEL = {
  bands: [
    [ 12, 99,   8, 11,  4],
    [  8, 12,  10, 14,  7],
    [  5,  8,  13, 20,  8],
    [  2,  5,  16, 23,  9],
    [ -2,  2,  18, 26, 10],
    [ -5, -2,  22, 34, 12],
    [-10, -5,  28, 42, 14],
    [-99,-10,  28, 45, 10]
  ]
};

function speedForGradient(gradient, profile) {
  var col = profile === 'fast' ? 3 : profile === 'slow' ? 4 : 2;
  for (var b = 0; b < SPEED_MODEL.bands.length; b++) {
    var band = SPEED_MODEL.bands[b];
    if (gradient >= band[0] && (gradient < band[1] || b === SPEED_MODEL.bands.length - 1)) {
      return band[col];
    }
  }
  return SPEED_MODEL.bands[4][col];
}

var GROUP_PENALTY = 1.19;

function estimateRidingTimeToKm(gpxProfile, targetKm, speedProfile) {
  if (!speedProfile) speedProfile = 'avg';
  var totalSeconds = 0;
  for (var i = 1; i < gpxProfile.length; i++) {
    if (gpxProfile[i].d > targetKm) break;
    var segDist = gpxProfile[i].d - gpxProfile[i - 1].d;
    if (segDist <= 0) continue;
    var segEle = gpxProfile[i].e - gpxProfile[i - 1].e;
    var gradient = (segDist > 0.005) ? (segEle / (segDist * 1000)) * 100 : 0;
    var speed = speedForGradient(gradient, speedProfile);
    totalSeconds += (segDist / speed) * 3600;
  }
  if (speedProfile === 'avg') totalSeconds *= GROUP_PENALTY;
  return totalSeconds * 1000;
}

function estimateSegmentDuration(gpxProfile, startIdx, endIdx, speedProfile) {
  if (!speedProfile) speedProfile = 'avg';
  var totalSeconds = 0;
  for (var i = startIdx + 1; i <= endIdx && i < gpxProfile.length; i++) {
    var segDist = gpxProfile[i].d - gpxProfile[i - 1].d;
    if (segDist <= 0) continue;
    var segEle = gpxProfile[i].e - gpxProfile[i - 1].e;
    var gradient = (segDist > 0.005) ? (segEle / (segDist * 1000)) * 100 : 0;
    var speed = speedForGradient(gradient, speedProfile);
    totalSeconds += (segDist / speed) * 3600;
  }
  return totalSeconds;
}

// ═════════════════════════════════════════════════════════════════════════════
// WMO Weather Codes
// ═════════════════════════════════════════════════════════════════════════════
function wmoDescription(code) {
  if (code === 0) return 'Ceu limpo';
  if (code <= 3) return 'Parcialmente nublado';
  if (code <= 48) return 'Nevoeiro';
  if (code <= 57) return 'Chuvisco';
  if (code <= 67) return 'Chuva';
  if (code <= 77) return 'Neve';
  if (code <= 82) return 'Aguaceiros';
  if (code <= 86) return 'Neve em grao';
  return 'Trovoada';
}
function wmoEmoji(code) {
  if (code === 0) return '\u2600\uFE0F';
  if (code <= 3) return '\u26C5';
  if (code <= 48) return '\uD83C\uDF2B\uFE0F';
  if (code <= 57) return '\uD83C\uDF27\uFE0F';
  if (code <= 67) return '\uD83C\uDF27\uFE0F';
  if (code <= 77) return '\u2744\uFE0F';
  if (code <= 82) return '\uD83C\uDF26\uFE0F';
  return '\u26C8\uFE0F';
}
function windDirLabel(deg) {
  var dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// ═════════════════════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════════

// ── Render Club Badge ────────────────────────────────────────────────────────
function renderClub(club) {
  if (!club) return;
  $('club-name').textContent = escHtml(club.name || 'Club');
  var link = $('club-link');
  link.href = club.slug ? 'https://www.kromi.online/club.html?slug=' + encodeURIComponent(club.slug) : '#';
  if (club.color) {
    document.documentElement.style.setProperty('--accent', club.color);
    var hex = club.color.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.substring(0, 2), 16), g = parseInt(hex.substring(2, 4), 16), b = parseInt(hex.substring(4, 6), 16);
    document.documentElement.style.setProperty('--accent-rgb', r + ',' + g + ',' + b);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', club.color);
  }
  if (club.avatar_url) {
    var img = $('club-avatar-img');
    img.src = escAttr(club.avatar_url); img.alt = escAttr(club.name || '');
    img.style.display = ''; $('club-avatar-ph').style.display = 'none';
  } else {
    $('club-avatar-ph').textContent = (club.name || 'K').charAt(0).toUpperCase();
  }
}

// ── Render Hero ──────────────────────────────────────────────────────────────
function renderHero(data, isPreRide) {
  var name = data.name || data.title || 'Pedalada';
  $('ride-title').textContent = escHtml(name);
  $('page-title').textContent = name + ' \u2014 KROMI';
  $('og-title').setAttribute('content', name + ' \u2014 KROMI BikeControl');

  if (isPreRide) $('pre-ride-badge').style.display = '';

  var desc = data.description || data.summary || '';
  if (desc) {
    $('ride-desc').textContent = escHtml(desc.length > 200 ? desc.substring(0, 197) + '...' : desc);
    $('og-desc').setAttribute('content', desc.substring(0, 160));
  }

  var cat = data.ride_type || data.category;
  if (cat) $('ride-category').textContent = escHtml(cat);

  var dateStr = data.ride_date || data.scheduled_date || data.scheduled_at || data.created_at;
  if (dateStr) $('hero-date-top').textContent = fmtDate(dateStr);

  var metaEl = $('hero-meta');
  var metas = [];
  if (dateStr) metas.push({ icon: svgCalendar(), text: fmtDate(dateStr) });
  var meetTime = data.scheduled_at || data.ride_date;
  if (meetTime) { var t = fmtTime(meetTime); if (t) metas.push({ icon: svgClock(), text: 'Encontro ' + t }); }
  if (data.departure_at) { var dt = fmtTime(data.departure_at); if (dt) metas.push({ icon: svgClock(), text: 'Arranque ' + dt }); }
  var mp = data.meeting_point || data.meeting_address || (data.route_data && data.route_data.start_name);
  if (mp) metas.push({ icon: svgPin(), text: escHtml(mp) });

  metas.forEach(function (m) {
    var d = document.createElement('div');
    d.className = 'hero-meta-item';
    d.innerHTML = m.icon + '<span>' + m.text + '</span>';
    metaEl.appendChild(d);
  });
}

// ── Render Stats Strip ───────────────────────────────────────────────────────
function renderStats(stats, gpxProfile) {
  var distance = stats.distance_km;
  var dPlus = stats.elevation_gain_m;
  var dMinus = stats.elevation_loss_m;
  var duration = stats.duration_s;
  var avgSpeed = stats.avg_speed_kmh;

  if (gpxProfile && gpxProfile.length >= 2) {
    if (distance == null) distance = gpxProfile[gpxProfile.length - 1].d;
    if (dPlus == null || dMinus == null) {
      var gl = computeGainLoss(gpxProfile);
      if (dPlus == null) dPlus = gl.gain;
      if (dMinus == null) dMinus = gl.loss;
    }
  }

  var cells = [
    { label: 'Distancia', value: fmt(distance), unit: 'km' },
    { label: 'D+',        value: fmtInt(dPlus),  unit: 'm' },
    { label: 'D\u2212',   value: fmtInt(dMinus), unit: 'm' },
    { label: 'Duracao',   value: duration != null ? fmtDuration(duration) : '\u2014', unit: '' },
    { label: 'Vel Media', value: fmt(avgSpeed), unit: 'km/h' }
  ];

  var inner = $('stats-inner');
  cells.forEach(function (c) {
    var d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = '<span class="stat-label">' + c.label + '</span>' +
      '<div class="stat-value">' + c.value + '<span class="stat-unit">' + c.unit + '</span></div>';
    inner.appendChild(d);
  });
}

// ── Render Map ───────────────────────────────────────────────────────────────
function renderMap(gpxPoints) {
  if (!gpxPoints || gpxPoints.length < 2) return;
  $('section-map').style.display = '';

  loadGoogleMaps().then(function () {
    var container = document.getElementById('ride-map');
    if (!container) return;

    try {
      var map = new google.maps.Map(container, {
        mapTypeId: 'hybrid',
        zoomControl: true,
        scrollwheel: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      });

      // Detect billing error and fallback to Embed API
      google.maps.event.addListenerOnce(map, 'tilesloaded', function () {
        // Map loaded successfully — remove fallback if any
        var fb = document.getElementById('map-embed-fallback');
        if (fb) fb.remove();
      });

      google.maps.event.addListenerOnce(map, 'click', function () {
        map.setOptions({ scrollwheel: true });
      });

      var path = gpxPoints.map(function (p) { return { lat: p.lat, lng: p.lon }; });
      var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3fff8b';

      new google.maps.Polyline({ path: path, strokeColor: '#ffffff', strokeWeight: 6, strokeOpacity: 0.2, map: map });
      new google.maps.Polyline({ path: path, strokeColor: accent, strokeWeight: 3, strokeOpacity: 0.9, map: map });

      new google.maps.Marker({ position: path[0], map: map, icon: {
        path: google.maps.SymbolPath.CIRCLE, scale: 8,
        fillColor: '#22c55e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3
      }, title: 'Partida' });

      new google.maps.Marker({ position: path[path.length - 1], map: map, icon: {
        path: google.maps.SymbolPath.CIRCLE, scale: 8,
        fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3
      }, title: 'Chegada' });

      var bounds = new google.maps.LatLngBounds();
      path.forEach(function (p) { bounds.extend(p); });
      map.fitBounds(bounds, 40);

      // Fallback after 3s if billing error shows
      setTimeout(function () {
        var errDivs = container.querySelectorAll('.gm-err-container, .dismissButton');
        if (errDivs.length > 0) renderMapEmbedFallback(container, gpxPoints);
      }, 3000);
    } catch (e) {
      console.warn('[ride-engine] Maps JS error, using embed fallback:', e);
      renderMapEmbedFallback(container, gpxPoints);
    }
  });
}

function renderMapEmbedFallback(container, gpxPoints) {
  // Calculate center and zoom from bounding box
  var minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  gpxPoints.forEach(function (p) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  });
  var cLat = (minLat + maxLat) / 2;
  var cLon = (minLon + maxLon) / 2;
  var latSpan = maxLat - minLat;
  var lonSpan = maxLon - minLon;
  var span = Math.max(latSpan, lonSpan);
  var zoom = span > 0.5 ? 9 : span > 0.2 ? 11 : span > 0.05 ? 13 : 14;

  container.innerHTML = '';
  var iframe = document.createElement('iframe');
  iframe.id = 'map-embed-fallback';
  iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:12px';
  iframe.loading = 'lazy';
  iframe.allowFullscreen = true;
  iframe.src = 'https://www.google.com/maps/embed/v1/view?key=' + MAPS_KEY + '&center=' + cLat.toFixed(6) + ',' + cLon.toFixed(6) + '&zoom=' + zoom + '&maptype=satellite';
  container.appendChild(iframe);
}

// ── Render Altimetry SVG ─────────────────────────────────────────────────────
function renderAltimetry(profile) {
  if (!profile || profile.length < 2) return;
  $('section-altimetry').style.display = '';

  var W = 800, H = 220, PAD_Y = 20, PAD_X = 50, PAD_TOP = 16;
  var elevs = profile.map(function (p) { return p.e; });
  var dists = profile.map(function (p) { return p.d; });
  var minE = Math.min.apply(null, elevs), maxE = Math.max.apply(null, elevs);
  var minD = dists[0], maxD = dists[dists.length - 1];
  var rangeE = maxE - minE || 1, rangeD = maxD - minD || 1;

  function xPx(d) { return PAD_X + ((d - minD) / rangeD) * (W - PAD_X * 2); }
  function yPx(e) { return PAD_TOP + (H - PAD_Y - PAD_TOP) - ((e - minE) / rangeE) * (H - PAD_Y - PAD_TOP - 10); }

  var pts = profile.map(function (p, i) {
    return { x: xPx(dists[i]), y: yPx(elevs[i]), e: elevs[i], d: dists[i] };
  });

  var gl = computeGainLoss(profile);
  var svg = $('alt-svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  var ns = 'http://www.w3.org/2000/svg';

  // Defs
  var defs = document.createElementNS(ns, 'defs');
  var grad = document.createElementNS(ns, 'linearGradient');
  grad.setAttribute('id', 'alti-fill'); grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  var s1 = document.createElementNS(ns, 'stop'); s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', 'var(--accent)'); s1.setAttribute('stop-opacity', '0.25');
  var s2 = document.createElementNS(ns, 'stop'); s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', 'var(--accent)'); s2.setAttribute('stop-opacity', '0.02');
  grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);

  // Grid lines
  var gridG = document.createElementNS(ns, 'g');
  gridG.setAttribute('stroke', 'rgba(255,255,255,0.06)'); gridG.setAttribute('stroke-width', '1');
  for (var i = 0; i <= 4; i++) {
    var eVal = minE + (i / 4) * rangeE;
    var y = yPx(eVal);
    var line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', PAD_X); line.setAttribute('x2', W - PAD_X);
    line.setAttribute('y1', y); line.setAttribute('y2', y);
    gridG.appendChild(line);
    var txt = document.createElementNS(ns, 'text');
    txt.textContent = Math.round(eVal) + 'm';
    txt.setAttribute('x', PAD_X - 6); txt.setAttribute('y', y + 3);
    txt.setAttribute('text-anchor', 'end'); txt.setAttribute('font-size', '10');
    txt.setAttribute('fill', 'rgba(255,255,255,0.3)'); txt.setAttribute('font-family', 'JetBrains Mono, monospace');
    gridG.appendChild(txt);
  }
  // X axis labels
  var xSteps = Math.min(6, Math.floor(maxD));
  for (var xi = 0; xi <= xSteps; xi++) {
    var dVal = minD + (xi / xSteps) * rangeD;
    var xPos = xPx(dVal);
    var xt = document.createElementNS(ns, 'text');
    xt.textContent = fmt(dVal, 0) + 'km';
    xt.setAttribute('x', xPos); xt.setAttribute('y', H - 2);
    xt.setAttribute('text-anchor', 'middle'); xt.setAttribute('font-size', '10');
    xt.setAttribute('fill', 'rgba(255,255,255,0.3)'); xt.setAttribute('font-family', 'JetBrains Mono, monospace');
    gridG.appendChild(xt);
  }
  svg.appendChild(gridG);

  // Slope-colored polygons
  var baseY = H - PAD_Y;
  var slopeG = document.createElementNS(ns, 'g');
  for (var si = 1; si < pts.length; si++) {
    var prev = pts[si - 1], curr = pts[si];
    var dDist = (dists[si] - dists[si - 1]) * 1000;
    var slope = dDist > 0 ? ((elevs[si] - elevs[si - 1]) / dDist) * 100 : 0;
    var poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', prev.x + ',' + baseY + ' ' + prev.x + ',' + prev.y + ' ' + curr.x + ',' + curr.y + ' ' + curr.x + ',' + baseY);
    poly.setAttribute('fill', slopeColor(slope)); poly.setAttribute('opacity', '0.45');
    slopeG.appendChild(poly);
  }
  svg.appendChild(slopeG);

  // Gradient fill
  var polyArea = document.createElementNS(ns, 'polygon');
  var areaPts = pts[0].x + ',' + baseY + ' ' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' ') + ' ' + pts[pts.length - 1].x + ',' + baseY;
  polyArea.setAttribute('points', areaPts); polyArea.setAttribute('fill', 'url(#alti-fill)');
  svg.appendChild(polyArea);

  // Profile line
  var polyline = document.createElementNS(ns, 'polyline');
  polyline.setAttribute('points', pts.map(function (p) { return p.x + ',' + p.y; }).join(' '));
  polyline.setAttribute('fill', 'none'); polyline.setAttribute('stroke', 'var(--accent)');
  polyline.setAttribute('stroke-width', '2'); polyline.setAttribute('stroke-linejoin', 'round');
  polyline.setAttribute('stroke-linecap', 'round');
  svg.appendChild(polyline);

  // Hover elements
  var hoverLine = document.createElementNS(ns, 'line');
  hoverLine.setAttribute('y1', '0'); hoverLine.setAttribute('y2', H);
  hoverLine.setAttribute('stroke', '#fff'); hoverLine.setAttribute('stroke-width', '1');
  hoverLine.setAttribute('stroke-dasharray', '4 3'); hoverLine.setAttribute('opacity', '0');
  svg.appendChild(hoverLine);
  var hoverDot = document.createElementNS(ns, 'circle');
  hoverDot.setAttribute('r', '4'); hoverDot.setAttribute('fill', '#fff');
  hoverDot.setAttribute('stroke', '#0e0e0e'); hoverDot.setAttribute('stroke-width', '2');
  hoverDot.setAttribute('opacity', '0');
  svg.appendChild(hoverDot);

  // Hit rect
  var hitRect = document.createElementNS(ns, 'rect');
  hitRect.setAttribute('x', PAD_X); hitRect.setAttribute('y', '0');
  hitRect.setAttribute('width', W - PAD_X * 2); hitRect.setAttribute('height', H);
  hitRect.setAttribute('fill', 'transparent'); hitRect.setAttribute('style', 'cursor:crosshair');
  svg.appendChild(hitRect);

  var tooltip = $('alt-tooltip');
  var altWrap = $('alt-wrap');

  hitRect.addEventListener('mousemove', function (e) {
    var rect = svg.getBoundingClientRect();
    var scaleX = W / rect.width;
    var mx = (e.clientX - rect.left) * scaleX;
    var nearest = pts[0], minDx = Infinity;
    pts.forEach(function (p) { var dx = Math.abs(p.x - mx); if (dx < minDx) { minDx = dx; nearest = p; } });
    hoverLine.setAttribute('x1', nearest.x); hoverLine.setAttribute('x2', nearest.x); hoverLine.setAttribute('opacity', '0.4');
    hoverDot.setAttribute('cx', nearest.x); hoverDot.setAttribute('cy', nearest.y); hoverDot.setAttribute('opacity', '1');
    var pct = (nearest.x - PAD_X) / (W - PAD_X * 2);
    var left = pct * rect.width + rect.left - altWrap.getBoundingClientRect().left;
    tooltip.style.left = left + 'px';
    tooltip.style.top = (nearest.y / H * rect.height - 40) + 'px';
    tooltip.style.display = 'block';
    tooltip.textContent = Math.round(nearest.e) + 'm  \u00B7  ' + fmt(nearest.d) + 'km';
  });
  hitRect.addEventListener('mouseleave', function () {
    hoverLine.setAttribute('opacity', '0'); hoverDot.setAttribute('opacity', '0');
    tooltip.style.display = 'none';
  });

  // Caption
  var caption = $('alt-caption');
  caption.innerHTML =
    '<span>' + Math.round(minE) + 'm \u2013 ' + Math.round(maxE) + 'm altitude</span>' +
    '<span style="color:var(--accent)">+' + Math.round(gl.gain) + 'm D+</span>' +
    '<span style="color:#60a5fa">\u2212' + Math.round(gl.loss) + 'm D\u2212</span>' +
    '<span>' + fmt(maxD, 1) + ' km total</span>';
}

// ── Build mini SVG for segment card ──────────────────────────────────────────
function buildMiniSvg(segProfile, dir) {
  if (!segProfile || segProfile.length < 2) return '';
  var W = 240, H = 40, P = 4;
  var elevs = segProfile.map(function (p) { return p.e; });
  var dists = segProfile.map(function (p) { return p.d; });
  var minE = Math.min.apply(null, elevs), maxE = Math.max.apply(null, elevs);
  var minD = dists[0], maxD = dists[dists.length - 1];
  var rE = maxE - minE || 1, rD = maxD - minD || 1;
  var pts = segProfile.map(function (p) {
    return {
      x: P + ((p.d - minD) / rD) * (W - P * 2),
      y: P + (H - P * 2) - ((p.e - minE) / rE) * (H - P * 2)
    };
  });
  var color = dir > 0 ? 'var(--accent)' : '#60a5fa';
  var baseY = H - P;
  var polyPts = pts[0].x + ',' + baseY + ' ' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' ') + ' ' + pts[pts.length - 1].x + ',' + baseY;
  var linePts = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
  return '<svg class="seg-mini-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<polygon points="' + polyPts + '" fill="' + color + '" opacity="0.12"/>' +
    '<polyline points="' + linePts + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>';
}

// ── Render Segments ──────────────────────────────────────────────────────────
function renderSegments(segments, profile) {
  if (!segments || segments.length === 0) return;
  $('section-segments').style.display = '';

  var totalClimbGain = 0, totalClimbDist = 0, climbCount = 0;
  var totalDescentLoss = 0, totalDescentDist = 0, descentCount = 0;
  segments.forEach(function (s) {
    if (s.direction > 0) { totalClimbGain += (s.elevation_gain_m || 0); totalClimbDist += (s.distance_km || 0); climbCount++; }
    else { totalDescentLoss += (s.elevation_loss_m || 0); totalDescentDist += (s.distance_km || 0); descentCount++; }
  });

  var summaryRow = $('seg-summary-row');
  summaryRow.innerHTML =
    '<div class="seg-summary-box up">' +
      '<div class="seg-box-label">Total Subidas</div>' +
      '<h3>+' + Math.round(totalClimbGain) + '<span style="font-size:20px;margin-left:4px">m</span></h3>' +
      '<div class="seg-box-sub">' + climbCount + ' subida' + (climbCount !== 1 ? 's' : '') + ' \u00B7 ' + fmt(totalClimbDist, 1) + ' km</div>' +
    '</div>' +
    '<div class="seg-summary-box down">' +
      '<div class="seg-box-label">Total Descidas</div>' +
      '<h3>\u2212' + Math.round(totalDescentLoss) + '<span style="font-size:20px;margin-left:4px">m</span></h3>' +
      '<div class="seg-box-sub">' + descentCount + ' descida' + (descentCount !== 1 ? 's' : '') + ' \u00B7 ' + fmt(totalDescentDist, 1) + ' km</div>' +
    '</div>';

  var list = $('seg-list');
  var segMapIds = [];
  segments.forEach(function (seg, idx) {
    var avgGrad = seg.avg_gradient_pct != null ? seg.avg_gradient_pct : (seg.avg_gradient || 0);
    var maxGrad = seg.max_gradient_pct != null ? seg.max_gradient_pct : (seg.max_gradient || 0);
    var diff = getDifficulty(avgGrad);
    var isUp = seg.direction > 0;
    var distKm = seg.distance_km || 0;
    var gain = seg.elevation_gain_m || 0;
    var loss = seg.elevation_loss_m || 0;

    var barPct = Math.min(100, (Math.abs(avgGrad) / 15) * 100);
    var miniHtml = buildMiniSvg(seg.profile, seg.direction);
    var mapId = 'seg-map-' + idx;

    var card = document.createElement('div');
    card.className = 'seg-card ' + (isUp ? 'seg-up' : 'seg-down');
    card.setAttribute('data-reveal', '');
    card.innerHTML =
      '<div class="seg-map-col"><div id="' + mapId + '" class="seg-mini-map"></div></div>' +
      '<div class="seg-details-col">' +
      '<div class="seg-top">' +
        '<div class="seg-ident">' +
          '<span class="seg-icon">' + (isUp ? '\u2B06' : '\u2B07') + '</span>' +
          '<span class="seg-name">' + escHtml(seg.name || 'Segmento') + '</span>' +
        '</div>' +
        '<span class="diff-badge ' + diff.cls + '">' + diff.label + '</span>' +
      '</div>' +
      (miniHtml ? '<div class="seg-mini-wrap">' + miniHtml +
        '<div class="seg-mini-labels">' +
          '<span>' + Math.round(seg.start_ele || 0) + 'm</span>' +
          '<span>' + fmt(distKm, 1) + ' km</span>' +
          '<span>' + Math.round(seg.end_ele || 0) + 'm</span>' +
        '</div>' +
      '</div>' : '') +
      '<div class="seg-grade-wrap">' +
        '<div class="seg-grade-big" style="color:' + diff.color + '">' + fmt(Math.abs(avgGrad), 1) + '<span class="seg-grade-unit">%</span></div>' +
        '<div class="seg-grade-sub">gradiente medio</div>' +
      '</div>' +
      '<div class="seg-bar"><div class="seg-bar-fill" style="width:' + barPct + '%;background:' + diff.color + '"></div></div>' +
      '<div class="seg-stats">' +
        '<div class="seg-stat"><span class="ss-label">Dist</span><span class="ss-value">' + fmt(distKm, 1) + ' km</span></div>' +
        '<div class="seg-stat"><span class="ss-label">D+</span><span class="ss-value">+' + fmtInt(gain) + ' m</span></div>' +
        '<div class="seg-stat"><span class="ss-label">D\u2212</span><span class="ss-value">\u2212' + fmtInt(loss) + ' m</span></div>' +
        '<div class="seg-stat"><span class="ss-label">Max</span><span class="ss-value">' + fmt(maxGrad, 1) + '%</span></div>' +
        (seg.start_idx != null ? (function () {
          var durAvg = estimateSegmentDuration(profile, seg.start_idx, seg.end_idx, 'avg');
          var durFast = estimateSegmentDuration(profile, seg.start_idx, seg.end_idx, 'fast');
          var durSlow = estimateSegmentDuration(profile, seg.start_idx, seg.end_idx, 'slow');
          var spdAvg = durAvg > 0 ? (distKm / (durAvg / 3600)).toFixed(1) : '-';
          var spdFast = durFast > 0 ? (distKm / (durFast / 3600)).toFixed(1) : '-';
          var spdSlow = durSlow > 0 ? (distKm / (durSlow / 3600)).toFixed(1) : '-';
          return '<div class="seg-stat"><span class="ss-label">\uD83D\uDD52 Grupo</span><span class="ss-value">' + fmtDuration(durAvg) + '</span><span style="font-size:9px;color:var(--text-muted);margin-top:2px;display:block">' + spdAvg + ' km/h</span></div>' +
            '<div class="seg-stat"><span class="ss-label" style="color:#22c55e">\u26A1 Rapido</span><span class="ss-value" style="color:#22c55e">' + fmtDuration(durFast) + '</span><span style="font-size:9px;color:#22c55e80;margin-top:2px;display:block">' + spdFast + ' km/h</span></div>' +
            '<div class="seg-stat"><span class="ss-label" style="color:#fbbf24">\uD83D\uDC22 Lento</span><span class="ss-value" style="color:#fbbf24">' + fmtDuration(durSlow) + '</span><span style="font-size:9px;color:#fbbf2480;margin-top:2px;display:block">' + spdSlow + ' km/h</span></div>';
        })() : '') +
      '</div>' +
      '</div>';
    list.appendChild(card);
    segMapIds.push({ id: mapId, seg: seg, diff: diff });
  });

  // Render mini Google Maps for each segment after DOM insertion
  loadGoogleMaps().then(function () {
    setTimeout(function () {
      segMapIds.forEach(function (item) {
        var seg = item.seg;
        if (!seg.trackPoints || seg.trackPoints.length < 2) return;
        var container = document.getElementById(item.id);
        if (!container) return;
        try {
          var miniMap = new google.maps.Map(container, {
            mapTypeId: 'hybrid', disableDefaultUI: true,
            gestureHandling: 'none', keyboardShortcuts: false
          });
          var segPath = seg.trackPoints.map(function (p) { return { lat: p.lat, lng: p.lon }; });
          if (window._allTrackPoints) {
            var fullPath = window._allTrackPoints.map(function (p) { return { lat: p.lat, lng: p.lon }; });
            new google.maps.Polyline({ path: fullPath, strokeColor: '#ffffff', strokeWeight: 1.5, strokeOpacity: 0.15, map: miniMap });
          }
          new google.maps.Polyline({ path: segPath, strokeColor: item.diff.color, strokeWeight: 3.5, strokeOpacity: 0.9, map: miniMap });
          new google.maps.Marker({ position: segPath[0], map: miniMap, icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 4,
            fillColor: '#22c55e', fillOpacity: 1, strokeColor: '#000', strokeWeight: 1.5
          }});
          new google.maps.Marker({ position: segPath[segPath.length - 1], map: miniMap, icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: 4,
            fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#000', strokeWeight: 1.5
          }});
          var bounds = new google.maps.LatLngBounds();
          segPath.forEach(function (p) { bounds.extend(p); });
          miniMap.fitBounds(bounds, 15);
        } catch (e) { console.warn('Mini-map error for segment', item.id, e); }
      });
    }, 100);
  });
}

// ── Render Rider Stats ───────────────────────────────────────────────────────
function renderRiders(riderStats) {
  if (!riderStats || riderStats.length === 0) return;
  $('section-riders').style.display = '';
  var tbody = $('riders-tbody');

  var topIdx = 0;
  riderStats.forEach(function (r, i) {
    if ((r.distance_km || r.distance || 0) > (riderStats[topIdx].distance_km || riderStats[topIdx].distance || 0)) topIdx = i;
  });

  riderStats.forEach(function (r, i) {
    var initial = (r.name || '?').charAt(0).toUpperCase();
    var avatarHtml = r.avatar_url
      ? '<img class="rider-avatar" src="' + escAttr(r.avatar_url) + '" alt="' + escAttr(r.name || '') + '">'
      : '<div class="rider-avatar-ph">' + initial + '</div>';
    var tr = document.createElement('tr');
    if (i === topIdx) tr.className = 'rider-top';
    tr.innerHTML =
      '<td><div class="rider-name-cell">' + avatarHtml + '<span>' + escHtml(r.name || '\u2014') + '</span></div></td>' +
      '<td class="mono-val">' + fmt(r.distance_km != null ? r.distance_km : r.distance, 1) + '</td>' +
      '<td class="mono-val">' + fmtInt(r.elevation_gain_m != null ? r.elevation_gain_m : (r.elevation_gain != null ? r.elevation_gain : r.dplus)) + 'm</td>' +
      '<td class="mono-val">' + fmt(r.avg_speed_kmh != null ? r.avg_speed_kmh : r.avg_speed, 1) + '</td>' +
      '<td class="mono-val">' + fmtInt(r.avg_heart_rate != null ? r.avg_heart_rate : (r.avg_hr != null ? r.avg_hr : r.fc_avg)) + '</td>' +
      '<td class="mono-val">' + fmtInt(r.avg_power != null ? r.avg_power : r.watts_avg) + 'W</td>';
    tbody.appendChild(tr);
  });
}

// ── Render Photos ────────────────────────────────────────────────────────────
function renderPhotos(photos) {
  if (!photos || photos.length === 0) return;
  $('section-photos').style.display = '';
  var grid = $('gallery-grid');

  photos.forEach(function (p) {
    var url = p.url || p.drive_thumbnail_url || p.drive_thumbnail_link || p.drive_view_url || p.drive_view_link || p.src;
    var fullUrl = p.full_url || p.drive_view_url || p.drive_view_link || url;
    var cap = p.caption || p.description || '';
    if (!url) return;
    var item = document.createElement('div');
    item.className = 'gallery-item';
    item.innerHTML = '<img src="' + escAttr(url) + '" alt="' + escAttr(cap) + '" loading="lazy">' +
      (cap ? '<div class="gallery-caption">' + escHtml(cap) + '</div>' : '');
    item.addEventListener('click', function () { openLightbox(fullUrl, cap); });
    grid.appendChild(item);
  });
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(url, cap) {
  $('lightbox-img').src = url;
  $('lightbox-caption').textContent = cap || '';
  $('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  $('lightbox').classList.remove('open');
  document.body.style.overflow = '';
  $('lightbox-img').src = '';
}

// ── Weather Fetch & Render ───────────────────────────────────────────────────
function fetchAndRenderWeather(gpxPoints, gpxProfile, scheduledAt) {
  if (!scheduledAt || !gpxProfile || gpxProfile.length < 2) return;
  var rideDate = new Date(scheduledAt);
  var now = new Date();
  var diffDays = (rideDate - now) / (1000 * 60 * 60 * 24);
  if (diffDays < -1 || diffDays > 16) return;

  var totalDist = gpxProfile[gpxProfile.length - 1].d;
  var startTime = rideDate.getTime();
  var dateStr = rideDate.toISOString().split('T')[0];

  var zones = [
    { label: 'Zona 1 \u00B7 Partida', frac: 0 },
    { label: 'Zona 2 \u00B7 Meio',    frac: 0.5 },
    { label: 'Zona 3 \u00B7 Chegada',  frac: 1 }
  ];

  function profileAtFrac(frac) {
    var targetD = totalDist * frac;
    var closest = gpxProfile[0];
    for (var i = 1; i < gpxProfile.length; i++) {
      if (Math.abs(gpxProfile[i].d - targetD) < Math.abs(closest.d - targetD)) closest = gpxProfile[i];
    }
    return closest;
  }

  zones.forEach(function (z) {
    var pt = profileAtFrac(z.frac);
    z.lat = pt.lat;
    z.lon = pt.lon;
    z.km = pt.d;
    z.ele = pt.e;
    z.arrivalMs = startTime + estimateRidingTimeToKm(gpxProfile, pt.d);
    z.arrivalDate = new Date(z.arrivalMs);
    z.arrivalHour = z.arrivalDate.getHours();
  });

  var fetches = zones.map(function (z) {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + z.lat.toFixed(4) +
      '&longitude=' + z.lon.toFixed(4) +
      '&hourly=temperature_2m,weathercode,windspeed_10m,winddirection_10m,precipitation_probability,uv_index' +
      '&timezone=Europe/Lisbon&start_date=' + dateStr + '&end_date=' + dateStr;
    return fetch(url).then(function (r) { return r.json(); }).catch(function () { return null; });
  });

  Promise.all(fetches).then(function (results) {
    var hasData = false;
    var grid = $('meteo-grid');
    grid.innerHTML = '';

    zones.forEach(function (z, idx) {
      var res = results[idx];
      if (!res || !res.hourly || !res.hourly.time) return;
      var hourly = res.hourly;
      var hi = Math.max(0, Math.min(23, z.arrivalHour));
      var temp = hourly.temperature_2m[hi];
      var wcode = hourly.weathercode[hi];
      var wind = hourly.windspeed_10m[hi];
      var windDir = hourly.winddirection_10m[hi];
      var precip = hourly.precipitation_probability[hi];
      var uv = hourly.uv_index[hi];

      hasData = true;
      var col = document.createElement('div');
      col.className = 'meteo-col';
      col.innerHTML =
        '<div class="meteo-zone">' + escHtml(z.label) + '</div>' +
        '<div class="meteo-location">Km ' + fmt(z.km, 1) + ' \u00B7 ' + Math.round(z.ele) + 'm</div>' +
        '<div class="meteo-time">' + z.arrivalDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) + ' estimativa</div>' +
        '<div class="meteo-temp">' + wmoEmoji(wcode) + ' ' + fmt(temp, 0) + '<span class="small">\u00B0C</span></div>' +
        '<div class="meteo-cond">' + escHtml(wmoDescription(wcode)) + '</div>' +
        '<div class="meteo-details">' +
          '<div class="meteo-detail"><span>Vento</span><strong>' + fmt(wind, 0) + ' km/h ' + windDirLabel(windDir || 0) + '</strong></div>' +
          '<div class="meteo-detail"><span>Precipitacao</span><strong>' + fmtInt(precip) + '%</strong></div>' +
          '<div class="meteo-detail"><span>UV</span><strong>' + fmt(uv, 1) + '</strong></div>' +
        '</div>';
      grid.appendChild(col);
    });

    if (hasData) {
      $('section-weather').style.display = '';
      var daysOut = Math.round(diffDays);
      var note = $('meteo-note');
      if (daysOut <= 3) {
        note.innerHTML = '\u2139\uFE0F Previsao a <strong>' + daysOut + ' dia' + (daysOut !== 1 ? 's' : '') + '</strong> \u2014 fiabilidade elevada. Dados Open-Meteo (modelo ECMWF).';
      } else if (daysOut <= 7) {
        note.innerHTML = '\u2139\uFE0F Previsao a <strong>' + daysOut + ' dias</strong> \u2014 fiabilidade moderada. Pode mudar. Dados Open-Meteo.';
      } else {
        note.innerHTML = '\u26A0\uFE0F Previsao a <strong>' + daysOut + ' dias</strong> \u2014 fiabilidade baixa, meramente indicativa. Dados Open-Meteo.';
      }
      initRevealForElement($('section-weather'));
    }
  }).catch(function (err) { console.warn('[weather]', err); });
}

// ── POI Generation ───────────────────────────────────────────────────────────
function generatePOIs(gpxPoints, gpxProfile, data) {
  var pois = [];
  if (!gpxProfile || gpxProfile.length < 2) return pois;
  var totalDist = gpxProfile[gpxProfile.length - 1].d;

  pois.push({ type: 'start', name: 'Partida', desc: 'Ponto de encontro e inicio do percurso', km: 0, ele: gpxProfile[0].e, lat: gpxProfile[0].lat, lon: gpxProfile[0].lon });

  var maxIdx = 0;
  gpxProfile.forEach(function (p, i) { if (p.e > gpxProfile[maxIdx].e) maxIdx = i; });
  if (maxIdx > 0 && maxIdx < gpxProfile.length - 1) {
    pois.push({ type: 'summit', name: 'Ponto mais alto', desc: 'Altitude maxima do percurso (' + Math.round(gpxProfile[maxIdx].e) + 'm)', km: gpxProfile[maxIdx].d, ele: gpxProfile[maxIdx].e, lat: gpxProfile[maxIdx].lat, lon: gpxProfile[maxIdx].lon });
  }

  var minIdx = 0;
  gpxProfile.forEach(function (p, i) { if (p.e < gpxProfile[minIdx].e) minIdx = i; });
  if (gpxProfile[maxIdx].e - gpxProfile[minIdx].e > 100 && minIdx > 0 && minIdx < gpxProfile.length - 1) {
    pois.push({ type: 'valley', name: 'Ponto mais baixo', desc: 'Altitude minima do percurso (' + Math.round(gpxProfile[minIdx].e) + 'm)', km: gpxProfile[minIdx].d, ele: gpxProfile[minIdx].e, lat: gpxProfile[minIdx].lat, lon: gpxProfile[minIdx].lon });
  }

  var midTarget = totalDist / 2;
  var midIdx = 0;
  gpxProfile.forEach(function (p, i) { if (Math.abs(p.d - midTarget) < Math.abs(gpxProfile[midIdx].d - midTarget)) midIdx = i; });
  pois.push({ type: 'midpoint', name: 'Meio do percurso', desc: 'Ponto medio a ~' + fmt(gpxProfile[midIdx].d, 1) + ' km', km: gpxProfile[midIdx].d, ele: gpxProfile[midIdx].e, lat: gpxProfile[midIdx].lat, lon: gpxProfile[midIdx].lon });

  var last = gpxProfile[gpxProfile.length - 1];
  pois.push({ type: 'end', name: 'Chegada', desc: 'Final do percurso', km: last.d, ele: last.e, lat: last.lat, lon: last.lon });

  if (data.route_gpx) {
    try {
      var cleaned = data.route_gpx.replace(/xmlns\s*=\s*["'][^"']*["']/gi, '');
      var doc = new DOMParser().parseFromString(cleaned, 'application/xml');
      var wpts = doc.querySelectorAll('wpt');
      wpts.forEach(function (wpt) {
        var lat = parseFloat(wpt.getAttribute('lat'));
        var lon = parseFloat(wpt.getAttribute('lon'));
        var nameEl = wpt.querySelector('name');
        var descEl = wpt.querySelector('desc') || wpt.querySelector('cmt');
        var eleEl = wpt.querySelector('ele');
        if (isNaN(lat) || isNaN(lon)) return;
        var closestIdx = 0, minD = Infinity;
        gpxProfile.forEach(function (p, i) {
          var d = Math.abs(p.lat - lat) + Math.abs(p.lon - lon);
          if (d < minD) { minD = d; closestIdx = i; }
        });
        pois.push({
          type: 'waypoint',
          name: nameEl ? nameEl.textContent : 'Waypoint',
          desc: descEl ? descEl.textContent : '',
          km: gpxProfile[closestIdx].d,
          ele: eleEl ? parseFloat(eleEl.textContent) : gpxProfile[closestIdx].e,
          lat: lat, lon: lon
        });
      });
    } catch (e) { /* ignore wpt parse errors */ }
  }

  pois.sort(function (a, b) { return a.km - b.km; });
  return pois;
}

// ── Enrich POIs with map images ──────────────────────────────────────────────
function enrichPOIsWithImages(pois) {
  var typeColors = { start: '#22c55e', end: '#ef4444', summit: '#a78bfa', valley: '#3b82f6', midpoint: '#fbbf24', waypoint: '#f97316' };
  var typeLabels = { start: 'PARTIDA', end: 'CHEGADA', summit: 'CUME', valley: 'VALE', midpoint: 'MEIO', waypoint: 'WAYPOINT' };
  pois.forEach(function (poi) {
    if (!poi.lat || !poi.lon) return;
    var imgEl = document.getElementById('poi-img-' + poi._idx);
    if (!imgEl) return;
    // Try Maps Embed API (works with referrer-restricted keys)
    var iframe = document.createElement('iframe');
    iframe.className = 'poi-img';
    iframe.style.cssText = 'width:100%;height:160px;border:none;border-radius:8px 8px 0 0;display:block;pointer-events:none';
    iframe.loading = 'lazy';
    iframe.src = 'https://www.google.com/maps/embed/v1/view?key=' + MAPS_KEY + '&center=' + poi.lat + ',' + poi.lon + '&zoom=14&maptype=satellite';
    imgEl.parentNode.replaceChild(iframe, imgEl);
  });
}

function renderPOIs(gpxPoints, gpxProfile, data) {
  var pois = generatePOIs(gpxPoints, gpxProfile, data);
  if (!pois || pois.length === 0) return;
  window._allPOIs = pois; // Store for AI enrichment
  $('section-pois').style.display = '';

  var grid = $('poi-grid');
  var rideStart = data.departure_at ? new Date(data.departure_at) : (data.scheduled_at ? new Date(data.scheduled_at) : null);
  pois.forEach(function (poi, idx) {
    poi._idx = idx;
    var code = idx < 10 ? '0' + idx : '' + idx;
    var arrivalStr = '';
    if (rideStart && gpxProfile) {
      var ridingMs = estimateRidingTimeToKm(gpxProfile, poi.km);
      var arrival = new Date(rideStart.getTime() + ridingMs);
      arrivalStr = arrival.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    }

    var card = document.createElement('div');
    card.className = 'poi-card';
    card.setAttribute('data-reveal', '');
    var typeIcons = { start: '\uD83D\uDEB4', end: '\uD83C\uDFC1', summit: '\u26F0\uFE0F', valley: '\uD83C\uDF0A', midpoint: '\uD83C\uDF7D\uFE0F', waypoint: '\uD83D\uDCCD' };
    card.innerHTML =
      '<img id="poi-img-' + idx + '" class="poi-img" src="" alt="">' +
      '<div class="poi-header">' +
        '<span class="poi-code">' + (typeIcons[poi.type] || '\uD83D\uDCCD') + ' ' + code + '</span>' +
        '<span class="poi-km">Km ' + fmt(poi.km, 1) + '</span>' +
      '</div>' +
      '<div id="poi-location-' + idx + '" class="poi-location"></div>' +
      '<div class="poi-name">' + escHtml(poi.name) + '</div>' +
      (poi.desc ? '<div class="poi-subtitle">' + escHtml(poi.desc) + '</div>' : '') +
      '<div id="poi-place-' + idx + '" class="poi-place-info"></div>' +
      '<div class="poi-meta">' +
        '<span>\u25C6 ' + Math.round(poi.ele) + ' m</span>' +
        (arrivalStr ? '<span>\uD83D\uDD52 ' + arrivalStr + '</span>' : '') +
      '</div>';
    grid.appendChild(card);
  });

  enrichPOIsWithImages(pois);
  initRevealForElement($('section-pois'));
}

// ── Stop Estimation ──────────────────────────────────────────────────────────
function estimateStops(entries, totalDist) {
  var lastStopKm = 0;
  var lunchAssigned = false;

  entries.forEach(function (e) {
    e.stop_min = 0;
    e.stop_reason = null;
    e.stop_type = null;
    var frac = totalDist > 0 ? e.km / totalDist : 0;
    var distSinceStop = e.km - lastStopKm;
    var nameLower = (e.name || '').toLowerCase();

    if (e.type === 'start') {
      e.stop_min = 10; e.stop_reason = 'Briefing inicial e foto de grupo'; e.stop_type = 'briefing';
      lastStopKm = e.km;
    } else if (e.type === 'end') {
      e.stop_min = 0;
    } else if (e.type === 'climb' || e.type === 'descent') {
      // Segments are riding — never assign stops
    } else if (e.type === 'summit') {
      e.stop_min = 12; e.stop_reason = 'Reagrupar no cume, reabastecer'; e.stop_type = 'regroup';
      lastStopKm = e.km;
    } else if (e.type === 'valley') {
      e.stop_min = 12; e.stop_reason = 'Reagrupar apos descida longa'; e.stop_type = 'regroup';
      lastStopKm = e.km;
    } else if (e.type === 'waypoint') {
      var isFood = /restaurante|tasca|churras|cafe|caf[eé]|bar|snack|almo[cç]/i.test(nameLower);
      var isWater = /[aá]gua|fonte|water/i.test(nameLower);
      var isDanger = /aten[cç][aã]o|travessia|perigo|danger|cuidado/i.test(nameLower);
      var isNav = /viragem|virar|esq|dir|nav|cruzamento/i.test(nameLower);

      if (isFood && !lunchAssigned && frac > 0.3 && frac < 0.7 && totalDist > 40) {
        e.stop_min = 75; e.stop_reason = 'Almoco (grupo)'; e.stop_type = 'lunch';
        lunchAssigned = true;
        lastStopKm = e.km;
      } else if (isFood) {
        e.stop_min = 25; e.stop_reason = 'Cafe e snack'; e.stop_type = 'coffee';
        lastStopKm = e.km;
      } else if (isWater) {
        e.stop_min = 12; e.stop_reason = 'Reabastecer agua'; e.stop_type = 'water';
        lastStopKm = e.km;
      } else if (isDanger && distSinceStop > 8) {
        e.stop_min = 12; e.stop_reason = 'Reagrupar antes de zona de atencao'; e.stop_type = 'regroup';
        lastStopKm = e.km;
      } else if (isNav && distSinceStop > 15) {
        e.stop_min = 10; e.stop_reason = 'Pausa de navegacao e reagrupamento'; e.stop_type = 'regroup';
        lastStopKm = e.km;
      } else if (frac > 0.6 && frac < 0.85 && distSinceStop > 15 && totalDist > 50) {
        e.stop_min = 15; e.stop_reason = 'Pausa tecnica, ajustar material, reagrupar'; e.stop_type = 'rest';
        lastStopKm = e.km;
      } else if (distSinceStop > 20) {
        e.stop_min = 10; e.stop_reason = 'Reagrupamento'; e.stop_type = 'regroup';
        lastStopKm = e.km;
      } else {
        e.stop_min = distSinceStop > 5 ? 5 : 0;
        if (e.stop_min > 0) { e.stop_reason = 'Referencia de navegacao'; e.stop_type = 'regroup'; }
      }
    } else if (e.type === 'midpoint') {
      if (!lunchAssigned && totalDist > 50) {
        e.stop_min = 60; e.stop_reason = 'Almoco (grupo)'; e.stop_type = 'lunch';
        lunchAssigned = true;
      } else {
        e.stop_min = 15; e.stop_reason = 'Pausa tecnica, reagrupar'; e.stop_type = 'rest';
      }
      lastStopKm = e.km;
    } else if (distSinceStop > 20) {
      e.stop_min = 10; e.stop_reason = 'Reagrupamento'; e.stop_type = 'regroup';
      lastStopKm = e.km;
    }
  });
  return entries;
}

// ── Render Timeline / Chronogram ─────────────────────────────────────────────
function renderTimeline(gpxPoints, gpxProfile, segments, data) {
  if (!gpxProfile || gpxProfile.length < 2) return;
  var rideStart = data.departure_at ? new Date(data.departure_at) : (data.scheduled_at ? new Date(data.scheduled_at) : null);
  if (!rideStart) return;

  var totalDist = gpxProfile[gpxProfile.length - 1].d;
  var pois = generatePOIs(gpxPoints, gpxProfile, data);
  if (!pois || pois.length < 2) return;

  var entries = [];
  pois.forEach(function (poi, idx) {
    var color = '#fbbf24';
    if (poi.type === 'start') color = '#22c55e';
    else if (poi.type === 'end') color = '#ef4444';
    else if (poi.type === 'summit') color = 'var(--accent)';

    entries.push({
      km: poi.km, ele: poi.ele, name: poi.name,
      desc: poi.desc || '', type: poi.type, color: color,
      code: idx < 10 ? '0' + idx : '' + idx,
      stop_min: 0, stop_reason: null, stop_type: null
    });
  });

  if (segments && segments.length) {
    segments.forEach(function (seg) {
      var startKm = seg.profile ? seg.profile[0].d : (seg.distance_km ? gpxProfile[seg.start_idx || 0].d : null);
      if (startKm == null) return;
      var isUp = seg.direction > 0;
      entries.push({
        km: startKm, ele: seg.start_ele || 0,
        name: seg.name || (isUp ? 'Subida' : 'Descida'),
        desc: fmt(seg.distance_km, 1) + ' km \u00B7 ' + (isUp ? '+' : '\u2212') + Math.round(isUp ? (seg.elevation_gain_m || 0) : (seg.elevation_loss_m || 0)) + 'm \u00B7 ' + fmt(Math.abs(seg.avg_gradient_pct || seg.avg_gradient || 0), 1) + '% medio',
        type: isUp ? 'climb' : 'descent',
        color: isUp ? 'var(--accent)' : '#60a5fa',
        code: isUp ? '\u2B06' : '\u2B07',
        stop_min: 0, stop_reason: null, stop_type: null
      });
    });
  }

  var poiTypes = { start: 1, end: 1, summit: 1, valley: 1, midpoint: 1, waypoint: 1 };
  entries.sort(function (a, b) { return a.km - b.km || ((poiTypes[b.type] || 0) - (poiTypes[a.type] || 0)); });
  var filtered = [entries[0]];
  for (var i = 1; i < entries.length; i++) {
    var prev = filtered[filtered.length - 1];
    if (Math.abs(entries[i].km - prev.km) > 0.5) {
      filtered.push(entries[i]);
    } else if (poiTypes[entries[i].type] && !poiTypes[prev.type]) {
      filtered[filtered.length - 1] = entries[i];
    }
  }

  filtered = estimateStops(filtered, totalDist);

  filtered.forEach(function (e) {
    if ((e.type === 'climb' || e.type === 'descent') && e.stop_min > 0) {
      e.stop_min = 0; e.stop_reason = null; e.stop_type = null;
    }
  });

  if (totalDist > 50) {
    var hasLunch = filtered.some(function (e) { return e.stop_type === 'lunch'; });
    if (!hasLunch) {
      var lunchTarget = totalDist * 0.45;
      var bestIdx = -1, bestDiff = Infinity;
      filtered.forEach(function (e, i) {
        if (e.type === 'start' || e.type === 'end' || e.type === 'climb' || e.type === 'descent') return;
        var diff = Math.abs(e.km - lunchTarget);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      });
      if (bestIdx < 0) {
        var insertAfterIdx = -1;
        filtered.forEach(function (e, i) {
          if (e.type === 'start' || e.type === 'end') return;
          if (e.km <= lunchTarget) insertAfterIdx = i;
        });
        if (insertAfterIdx >= 0) {
          var ref = filtered[insertAfterIdx];
          var lunchEntry = {
            km: ref.km + 0.1, ele: ref.ele, name: 'Paragem para almoco',
            desc: 'Ponto de paragem estimado para almoco', type: 'midpoint',
            color: '#fbbf24', code: '\uD83C\uDF7D\uFE0F',
            stop_min: 60, stop_reason: 'Almoco (grupo)', stop_type: 'lunch'
          };
          filtered.splice(insertAfterIdx + 1, 0, lunchEntry);
        }
      } else {
        filtered[bestIdx].stop_min = 60;
        filtered[bestIdx].stop_reason = 'Almoco (grupo)';
        filtered[bestIdx].stop_type = 'lunch';
      }
    }
  }

  // Calculate cumulative times
  var cumulativeStopMs = 0;
  filtered.forEach(function (e) {
    var ridingMs = estimateRidingTimeToKm(gpxProfile, e.km);
    e.arrivalMs = rideStart.getTime() + ridingMs + cumulativeStopMs;
    e.time = new Date(e.arrivalMs);
    e.departureMs = e.arrivalMs + (e.stop_min || 0) * 60 * 1000;
    cumulativeStopMs += (e.stop_min || 0) * 60 * 1000;
  });

  // KPI calculations
  var lastEntry = filtered[filtered.length - 1];
  var totalTimeMs = lastEntry.arrivalMs - rideStart.getTime();

  var movingStopTypes = { briefing: 1, regroup: 1 };
  var totalStopMs = 0, longStopMs = 0, shortStopMs = 0;
  filtered.forEach(function (e) {
    var ms = (e.stop_min || 0) * 60 * 1000;
    totalStopMs += ms;
    if (movingStopTypes[e.stop_type]) shortStopMs += ms;
    else longStopMs += ms;
  });

  var ridingTimeMs = estimateRidingTimeToKm(gpxProfile, totalDist);
  var movingTimeMs = ridingTimeMs + shortStopMs;
  var stoppedTimeMs = longStopMs;

  var totalH = Math.floor(totalTimeMs / 3600000);
  var totalM = Math.floor((totalTimeMs % 3600000) / 60000);
  var movingH = Math.floor(movingTimeMs / 3600000);
  var movingM = Math.floor((movingTimeMs % 3600000) / 60000);
  var stoppedH = Math.floor(stoppedTimeMs / 3600000);
  var stoppedM = Math.floor((stoppedTimeMs % 3600000) / 60000);
  var speedWithStops = totalTimeMs > 0 ? (totalDist / (totalTimeMs / 3600000)) : 0;
  var speedMoving = movingTimeMs > 0 ? (totalDist / (movingTimeMs / 3600000)) : 0;

  var arrivalStr = lastEntry.time.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  var departStr = rideStart.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

  $('timeline-desc').innerHTML = '';
  var kpiHtml = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:32px">';
  kpiHtml += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:20px 16px;text-align:center">' +
    '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:var(--accent);margin-bottom:8px">Tempo Total</div>' +
    '<div style="font-family:var(--serif);font-size:32px;font-weight:400;color:#fff;line-height:1">' + totalH + 'h' + String(totalM).padStart(2, '0') + '</div>' +
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:6px">' + departStr + ' \u2192 ' + arrivalStr + '</div>' +
    '<div style="font-family:var(--mono);font-size:11px;color:var(--text-muted);margin-top:4px">~' + speedWithStops.toFixed(1) + ' km/h efetivo</div>' +
    '</div>';
  kpiHtml += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:20px 16px;text-align:center">' +
    '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#22c55e;margin-bottom:8px">Em Andamento</div>' +
    '<div style="font-family:var(--serif);font-size:32px;font-weight:400;color:#fff;line-height:1">' + movingH + 'h' + String(movingM).padStart(2, '0') + '</div>' +
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:6px">Pedalar + reagrupar</div>' +
    '<div style="font-family:var(--mono);font-size:11px;color:#22c55e;margin-top:4px">~' + speedMoving.toFixed(1) + ' km/h medio</div>' +
    '</div>';
  kpiHtml += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:20px 16px;text-align:center">' +
    '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#fbbf24;margin-bottom:8px">Parado</div>' +
    '<div style="font-family:var(--serif);font-size:32px;font-weight:400;color:#fff;line-height:1">' + stoppedH + 'h' + String(stoppedM).padStart(2, '0') + '</div>' +
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:6px">Almoco, cafe, agua</div>' +
    '<div style="font-family:var(--mono);font-size:11px;color:#fbbf24;margin-top:4px">' + Math.round(stoppedTimeMs / 60000) + ' min total</div>' +
    '</div>';
  kpiHtml += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:20px 16px;text-align:center">' +
    '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:#60a5fa;margin-bottom:8px">Distancia</div>' +
    '<div style="font-family:var(--serif);font-size:32px;font-weight:400;color:#fff;line-height:1">' + fmt(totalDist, 1) + '</div>' +
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:6px">km</div>' +
    '<div style="font-family:var(--mono);font-size:11px;color:#60a5fa;margin-top:4px">' + filtered.length + ' pontos</div>' +
    '</div>';
  kpiHtml += '</div>';

  var kpiDiv = document.createElement('div');
  kpiDiv.innerHTML = kpiHtml;
  kpiDiv.setAttribute('data-reveal', '');
  var timelineContainer = $('timeline');
  timelineContainer.parentNode.insertBefore(kpiDiv, timelineContainer);

  if (filtered.length < 2) return;
  $('section-timeline').style.display = '';

  var container = $('timeline');
  container.innerHTML = '';

  var typeLabels = {
    start: 'Partida', end: 'Chegada', summit: 'Cume', valley: 'Vale',
    midpoint: 'Meio', waypoint: 'Waypoint', climb: 'Segmento', descent: 'Segmento'
  };

  filtered.forEach(function (entry) {
    var timeStr = entry.time.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    var stopHtml = '';
    if (entry.stop_min > 0) {
      var depTime = new Date(entry.departureMs).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      var stopIcons = { briefing: '\u25C9', regroup: '\u25C9', water: '\uD83D\uDCA7', coffee: '\u2615', lunch: '\uD83C\uDF7D\uFE0F', rest: '\u2736' };
      var stopIcon = stopIcons[entry.stop_type] || '\u25C9';
      stopHtml = '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;padding:8px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-left:3px solid ' + entry.color + ';font-size:12px">' +
        '<span>' + stopIcon + '</span>' +
        '<span style="color:var(--text-muted)">Pausa \u00B7 <strong style="color:var(--text)">' + entry.stop_min + ' min</strong> \u00B7 Saida ' + depTime + '</span>' +
        '</div>' +
        (entry.stop_reason ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic">' + escHtml(entry.stop_reason) + '</div>' : '');
    }

    var item = document.createElement('div');
    item.className = 'tl-item';
    item.setAttribute('data-reveal', '');
    item.innerHTML =
      '<div class="tl-marker">' +
        '<div class="tl-time">' + timeStr + '</div>' +
        '<div class="tl-dot" style="background:' + entry.color + '">' +
          '<span class="tl-code">' + escHtml(entry.code) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="tl-content">' +
        '<div class="tl-type-label" style="color:' + entry.color + '">' + escHtml(typeLabels[entry.type] || 'Ponto') + '</div>' +
        '<div class="tl-title">' + escHtml(entry.name) + '</div>' +
        (entry.desc ? '<div class="tl-subtitle">' + escHtml(entry.desc) + '</div>' : '') +
        '<div class="tl-stats">' +
          '<div class="tl-stat"><span class="tl-stat-label">Km</span><span class="tl-stat-value">' + fmt(entry.km, 1) + '</span></div>' +
          '<div class="tl-stat"><span class="tl-stat-label">Alt</span><span class="tl-stat-value">' + Math.round(entry.ele) + 'm</span></div>' +
        '</div>' +
        stopHtml +
      '</div>';
    container.appendChild(item);
  });
  initRevealForElement($('section-timeline'));
}

// ═════════════════════════════════════════════════════════════════════════════
// NEW FEATURE: Dark/Light Mode Toggle
// ═════════════════════════════════════════════════════════════════════════════
function initThemeToggle() {
  var btn = $('theme-toggle');
  if (!btn) return;
  var saved = localStorage.getItem('kromi-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
    updateThemeColor(saved);
  }
  btn.addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'light' ? 'dark' : (current === 'dark' ? 'light' :
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'dark' : 'light'));
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('kromi-theme', next);
    updateThemeIcon(next);
    updateThemeColor(next);
  });
}
function updateThemeIcon(theme) {
  var btn = $('theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '\u263E' : '\u2600';
}
function updateThemeColor(theme) {
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f0ebe1' : '#0e0e0e';
}

// ═════════════════════════════════════════════════════════════════════════════
// NEW FEATURE: Club Theme Application
// ═════════════════════════════════════════════════════════════════════════════
function applyClubTheme(club) {
  if (!club) return;
  var root = document.documentElement;
  if (club.color) root.style.setProperty('--accent', club.color);
  if (club.theme) {
    var t = club.theme;
    if (t.color_primary) root.style.setProperty('--accent', t.color_primary);
    if (t.color_secondary) root.style.setProperty('--accent-secondary', t.color_secondary);
    if (t.font_heading) root.style.setProperty('--font-heading', "'" + t.font_heading + "', Georgia, serif");
    if (t.font_body) root.style.setProperty('--font-body', "'" + t.font_body + "', sans-serif");
    // Load custom Google Font if needed
    if (t.font_heading && t.font_heading !== 'Fraunces' && t.font_heading !== 'System') {
      loadGoogleFont(t.font_heading);
    }
    if (t.font_body && t.font_body !== 'System') {
      loadGoogleFont(t.font_body);
    }
  }
  // Recompute accent-rgb from final --accent
  var finalAccent = getComputedStyle(root).getPropertyValue('--accent').trim();
  if (finalAccent && finalAccent.charAt(0) === '#') {
    var hex = finalAccent.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.substring(0, 2), 16), g = parseInt(hex.substring(2, 4), 16), b = parseInt(hex.substring(4, 6), 16);
    root.style.setProperty('--accent-rgb', r + ',' + g + ',' + b);
  }
}
function loadGoogleFont(name) {
  if (!name) return;
  // Avoid duplicate link tags
  var existing = document.querySelector('link[href*="family=' + encodeURIComponent(name) + '"]');
  if (existing) return;
  var link = document.createElement('link');
  link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name) + ':wght@300;400;500;700&display=swap';
  link.rel = 'stylesheet';
  document.head.appendChild(link);
}

// ═════════════════════════════════════════════════════════════════════════════
// NEW FEATURE: SEO JSON-LD Injection
// ═════════════════════════════════════════════════════════════════════════════
function injectJsonLd(data, club) {
  var ld = {
    "@context": "https://schema.org",
    "@type": data.status === 'planned' ? "SportsEvent" : "Article",
    "name": data.name || 'Ride',
    "description": buildMetaDescription(data),
    "url": window.location.href,
    "image": (data.photos && data.photos[0]) ? (data.photos[0].drive_view_url || data.photos[0]) : ((club && club.banner_url) ? club.banner_url : 'https://www.kromi.online/pwa-512x512.png')
  };
  if (data.scheduled_at) {
    ld.startDate = data.scheduled_at;
    ld.location = { "@type": "Place", "name": data.meeting_address || 'Meeting Point' };
  }
  if (club) {
    ld.organizer = { "@type": "SportsTeam", "name": club.name, "url": "https://www.kromi.online/club.html?s=" + (club.slug || '') };
  }
  var script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(ld);
  document.head.appendChild(script);
}
function buildMetaDescription(data) {
  var parts = [];
  if (data.stats && data.stats.distance_km) parts.push(Math.round(data.stats.distance_km) + 'km');
  if (data.stats && data.stats.elevation_gain_m) parts.push(Math.round(data.stats.elevation_gain_m) + 'm D+');
  return (data.name || 'Ride') + ' \u2014 ' + parts.join(', ') + '. KROMI BikeControl.';
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTO-GENERATED CONTENT: Summary + Equipment
// ═════════════════════════════════════════════════════════════════════════════

function renderSummary(gpxProfile, kpis, segments) {
  if (!gpxProfile || gpxProfile.length < 10) return;
  $('section-summary').style.display = '';
  var container = $('summary-content');

  var dist = kpis.distance_km || 0;
  var gain = kpis.elevation_gain || 0;
  var loss = kpis.elevation_loss || 0;
  var maxEle = kpis.max_ele || 0;
  var minEle = kpis.min_ele || 0;

  // Difficulty rating
  var diffScore = 0;
  diffScore += dist > 80 ? 3 : dist > 50 ? 2 : dist > 30 ? 1 : 0;
  diffScore += gain > 2000 ? 3 : gain > 1200 ? 2 : gain > 600 ? 1 : 0;
  var maxGradient = 0;
  if (segments) segments.forEach(function(s) { var g = Math.abs(s.avg_gradient_pct || s.avg_gradient || 0); if (g > maxGradient) maxGradient = g; });
  diffScore += maxGradient > 12 ? 2 : maxGradient > 8 ? 1 : 0;
  var diffLabel, diffColor;
  if (diffScore >= 6) { diffLabel = 'Extremo'; diffColor = '#a78bfa'; }
  else if (diffScore >= 4) { diffLabel = 'Dificil'; diffColor = '#ef4444'; }
  else if (diffScore >= 2) { diffLabel = 'Moderado'; diffColor = '#fbbf24'; }
  else { diffLabel = 'Facil'; diffColor = '#22c55e'; }

  // Terrain type
  var climbDist = 0, descentDist = 0, flatDist = 0;
  if (segments) segments.forEach(function(s) {
    if (s.direction > 0) climbDist += (s.distance_km || 0);
    else descentDist += (s.distance_km || 0);
  });
  flatDist = Math.max(0, dist - climbDist - descentDist);
  var climbPct = dist > 0 ? Math.round((climbDist / dist) * 100) : 0;
  var descentPct = dist > 0 ? Math.round((descentDist / dist) * 100) : 0;
  var flatPct = 100 - climbPct - descentPct;

  // Time estimates
  var timeAvg = estimateRidingTimeToKm(gpxProfile, dist, 'avg') / 1000;
  var timeFast = estimateRidingTimeToKm(gpxProfile, dist, 'fast') / 1000;
  var timeSlow = estimateRidingTimeToKm(gpxProfile, dist, 'slow') / 1000;

  // Cards
  var html = '<div class="summary-grid">';
  html += '<div class="summary-card diff-card"><div class="summary-label" style="color:' + diffColor + '">Dificuldade</div>';
  html += '<div class="summary-value" style="color:' + diffColor + '">' + diffLabel + '</div>';
  html += '<div class="summary-sub">' + fmtInt(dist) + ' km com ' + fmtInt(gain) + 'm D+ e gradiente max de ' + fmt(maxGradient, 1) + '%</div></div>';

  html += '<div class="summary-card terrain-card"><div class="summary-label" style="color:#60a5fa">Terreno</div>';
  html += '<div class="summary-value" style="color:#60a5fa">' + fmtInt(maxEle) + '<span style="font-size:16px;margin-left:4px">m max</span></div>';
  html += '<div class="summary-sub">' + climbPct + '% subida, ' + descentPct + '% descida, ' + flatPct + '% plano. Amplitude: ' + fmtInt(maxEle - minEle) + 'm</div></div>';

  html += '<div class="summary-card effort-card"><div class="summary-label" style="color:#fbbf24">Esforco Estimado</div>';
  html += '<div class="summary-value" style="color:#fbbf24">' + fmtDuration(timeAvg) + '</div>';
  html += '<div class="summary-sub">Rapido: ' + fmtDuration(timeFast) + ' \u00B7 Lento: ' + fmtDuration(timeSlow) + ' (so pedalada, sem paragens)</div></div>';

  var climbCount = 0, descentCount = 0;
  if (segments) segments.forEach(function(s) { if (s.direction > 0) climbCount++; else descentCount++; });
  html += '<div class="summary-card time-card"><div class="summary-label" style="color:#a78bfa">Perfil</div>';
  html += '<div class="summary-value" style="color:#a78bfa">' + (climbCount + descentCount) + '<span style="font-size:16px;margin-left:4px">segmentos</span></div>';
  html += '<div class="summary-sub">' + climbCount + ' subida' + (climbCount !== 1 ? 's' : '') + ' e ' + descentCount + ' descida' + (descentCount !== 1 ? 's' : '') + ' detetados</div></div>';
  html += '</div>';

  // Prose summary
  var prose = 'Percurso de <strong>' + fmt(dist, 1) + ' km</strong> com <strong>' + fmtInt(gain) + 'm de desnivel positivo</strong>';
  prose += ' e <strong>' + fmtInt(loss) + 'm de desnivel negativo</strong>.';
  prose += ' A altitude varia entre <strong>' + fmtInt(minEle) + 'm</strong> e <strong>' + fmtInt(maxEle) + 'm</strong>';
  prose += ' (amplitude de ' + fmtInt(maxEle - minEle) + 'm).';
  if (maxGradient > 10) prose += ' Contem seccoes com gradiente superior a <strong>' + fmt(maxGradient, 0) + '%</strong> que exigem boa condicao fisica e tecnica.';
  if (dist > 60) prose += ' A distancia superior a 60 km requer boa gestao de energia e hidratacao ao longo do percurso.';
  if (gain > 1500) prose += ' O desnivel acumulado e significativo — recomenda-se experiencia em subidas prolongadas.';
  html += '<div class="summary-prose">' + prose + '</div>';

  container.innerHTML = html;
  initRevealForElement($('section-summary'));
}

function renderEquipment(gpxProfile, kpis, weatherData) {
  if (!kpis) return;
  $('section-equipment').style.display = '';
  var grid = $('equip-grid');
  var dist = kpis.distance_km || 0;
  var gain = kpis.elevation_gain || 0;
  var maxEle = kpis.max_ele || 0;
  var minEle = kpis.min_ele || 0;
  var hasHighAlt = maxEle > 800;
  var isLong = dist > 50;
  var hasBigDescent = (kpis.elevation_loss || 0) > 800;

  var cards = [];

  // Card 1: Vestuario
  var vestItems = [];
  if (hasHighAlt) vestItems.push('<strong>Corta-vento impermeavel</strong> leve para altitude');
  if (hasHighAlt) vestItems.push('Luvas longas ou manguitos removiveis');
  vestItems.push('Base-layer tecnica de manga comprida');
  if (maxEle - minEle > 500) vestItems.push('Sistema de camadas (variacao termica de ~' + Math.round((maxEle - minEle) * 0.0065) + '\u00B0C)');
  vestItems.push('Buff ou tubular para o pescoco');
  cards.push({ cat: 'Vestuario', title: 'Camadas e protecao', items: vestItems, num: '01' });

  // Card 2: Mecanica
  var mecItems = [];
  if (hasBigDescent) mecItems.push('<strong>Pastilhas de travao verificadas</strong> (descida de ' + fmtInt(kpis.elevation_loss) + 'm)');
  mecItems.push('Camara de ar reserva + kit de remendo');
  mecItems.push('Multiferramenta com corrente');
  mecItems.push('Bomba ou CO2 (minimo 2 cartuchos)');
  mecItems.push('<strong>eMTB</strong>: bateria a 100%');
  cards.push({ cat: 'Mecanica', title: 'Bicicleta e reserva', items: mecItems, num: '02' });

  // Card 3: Hidratacao
  var hidItems = [];
  var waterLitres = Math.max(1.5, Math.ceil(dist / 25) * 0.75);
  hidItems.push('<strong>' + waterLitres.toFixed(1) + ' L de agua</strong> minimo');
  var bars = Math.max(2, Math.ceil(dist / 20));
  hidItems.push(bars + ' barras energeticas');
  if (dist > 40) hidItems.push('1 a 2 geis para as subidas');
  hidItems.push('Frutos secos ou bananas');
  hidItems.push('Eletrolitos ou sais minerais');
  cards.push({ cat: 'Hidratacao', title: 'Autonomia de ' + fmtInt(dist) + ' km', items: hidItems, num: '03' });

  // Card 4: Seguranca
  var segItems = [];
  segItems.push('<strong>GPS</strong> ou telemovel com GPX carregado');
  segItems.push('Powerbank para telemovel');
  if (isLong || hasHighAlt) segItems.push('Apito de emergencia');
  if (hasHighAlt) segItems.push('Manta termica (100g)');
  segItems.push('Cartao de cidadao + seguro');
  segItems.push('Dinheiro em numerario');
  cards.push({ cat: 'Seguranca', title: 'Navegacao e emergencia', items: segItems, num: '04' });

  // Card 5: Optica
  var optItems = [];
  optItems.push('<strong>Oculos fotocromaticos</strong> ou lente clara');
  optItems.push('Capacete ventilado');
  optItems.push('Protetor solar fator 30+');
  optItems.push('Balsamo labial');
  cards.push({ cat: 'Optica', title: 'Protecao visual', items: optItems, num: '05' });

  cards.forEach(function(c) {
    var card = document.createElement('div');
    card.className = 'equip-card';
    card.setAttribute('data-num', c.num);
    card.setAttribute('data-reveal', '');
    card.innerHTML = '<div class="equip-category">' + escHtml(c.cat) + '</div>' +
      '<h4>' + escHtml(c.title) + '</h4>' +
      '<ul class="equip-list">' + c.items.map(function(item) { return '<li>' + item + '</li>'; }).join('') + '</ul>';
    grid.appendChild(card);
  });
  initRevealForElement($('section-equipment'));
}

// ═════════════════════════════════════════════════════════════════════════════
// AI ENRICHMENT via Gemini (ride-enrich edge function)
// ═════════════════════════════════════════════════════════════════════════════

function fetchAIEnrichment(data, gpxProfile) {
  var rideId = data.ride_id || data.id;
  if (!rideId) return;

  // Check if already in ride_data
  var existing = data.ride_data && data.ride_data.ai_enrichment;
  if (existing) {
    renderAIContent(existing);
    return;
  }

  // Build POIs for the prompt
  var pois = [];
  if (window._allPOIs) {
    pois = window._allPOIs.map(function(p) {
      return { name: p.name, km: p.km, ele: p.ele, lat: p.lat, lon: p.lon, type: p.type };
    });
  }

  // Build ride data summary
  var kpis = {};
  if (gpxProfile && gpxProfile.length >= 2) {
    var gl = computeGainLoss(gpxProfile);
    kpis = {
      name: data.name || 'Ride',
      description: data.description || '',
      distance_km: gpxProfile[gpxProfile.length - 1].d,
      elevation_gain: gl.gain,
      elevation_loss: gl.loss,
      max_ele: Math.max.apply(null, gpxProfile.map(function(p) { return p.e; })),
      min_ele: Math.min.apply(null, gpxProfile.map(function(p) { return p.e; }))
    };
  }

  // Build segments for prompt
  var segs = [];
  if (window._allSegments) {
    segs = window._allSegments.map(function(s) {
      return { name: s.name, direction: s.direction, distance_km: s.distance_km, elevation_gain_m: s.elevation_gain_m, elevation_loss_m: s.elevation_loss_m, avg_gradient_pct: s.avg_gradient_pct, start_ele: s.start_ele, end_ele: s.end_ele };
    });
  }

  // Call edge function (async, non-blocking)
  fetch(SB_URL + '/functions/v1/ride-enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ ride_id: rideId, pois: pois, ride_data: kpis, segments: segs })
  })
  .then(function(r) { return r.json(); })
  .then(function(result) {
    if (result.enrichment) {
      renderAIContent(result.enrichment);
    }
  })
  .catch(function(err) {
    console.warn('[ride-engine] AI enrichment failed:', err);
  });
}

function renderAIContent(enrichment) {
  if (!enrichment) return;

  // 1. Replace summary prose with AI narrative
  var summaryProse = document.querySelector('.summary-prose');
  if (summaryProse && enrichment.narrative) {
    summaryProse.innerHTML = enrichment.narrative.replace(/\n\n/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
    summaryProse.style.borderLeftColor = 'var(--accent)';
  }

  // 2. Replace difficulty text
  if (enrichment.difficulty_text) {
    var diffSub = document.querySelector('.summary-card.diff-card .summary-sub');
    if (diffSub) diffSub.textContent = enrichment.difficulty_text;
  }

  // 3. Enrich POI cards with AI descriptions
  if (enrichment.pois && enrichment.pois.length) {
    enrichment.pois.forEach(function(aiPoi) {
      var idx = aiPoi.index;
      var descEl = document.getElementById('poi-place-' + idx);
      var subtitleEl = document.querySelector('#poi-grid .poi-card:nth-child(' + (idx + 1) + ') .poi-subtitle');

      if (descEl && aiPoi.description) {
        var html = '<div style="font-size:13px;color:var(--text-soft);line-height:1.6;margin-top:6px">' + escHtml(aiPoi.description) + '</div>';
        if (aiPoi.curiosity) {
          html += '<div style="font-size:11px;color:var(--accent);margin-top:6px;font-style:italic">\uD83D\uDCA1 ' + escHtml(aiPoi.curiosity) + '</div>';
        }
        if (aiPoi.food_tip && aiPoi.food_tip !== 'null') {
          html += '<div style="font-size:11px;color:#fbbf24;margin-top:4px">\uD83C\uDF7D\uFE0F ' + escHtml(aiPoi.food_tip) + '</div>';
        }
        descEl.innerHTML = html;
      }
    });
  }

  // 4. Add safety notes to summary section
  if (enrichment.safety_notes && enrichment.safety_notes.length) {
    var summaryContent = $('summary-content');
    if (summaryContent) {
      var safetyHtml = '<div style="margin-top:20px">';
      safetyHtml += '<div style="font-family:var(--mono);font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#ef4444;font-weight:700;margin-bottom:12px">\u26A0\uFE0F Notas de Seguranca</div>';
      enrichment.safety_notes.forEach(function(note) {
        safetyHtml += '<div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid #ef4444;padding:14px 16px;margin-bottom:8px">';
        safetyHtml += '<div style="font-size:13px;font-weight:700;color:var(--text)">' + escHtml(note.zone) + ' <span style="font-size:11px;color:var(--text-muted);font-weight:400">(' + escHtml(note.km_range) + ')</span></div>';
        safetyHtml += '<div style="font-size:12px;color:var(--text-soft);margin-top:4px">' + escHtml(note.warning) + '</div>';
        safetyHtml += '<div style="font-size:11px;color:var(--accent);margin-top:4px;font-style:italic">\uD83D\uDCA1 ' + escHtml(note.tip) + '</div>';
        safetyHtml += '</div>';
      });
      safetyHtml += '</div>';
      summaryContent.insertAdjacentHTML('beforeend', safetyHtml);
    }
  }

  // 5. Add AI gear tips to equipment section
  if (enrichment.gear_tips && enrichment.gear_tips.length) {
    var equipGrid = $('equip-grid');
    if (equipGrid) {
      var aiCard = document.createElement('div');
      aiCard.className = 'equip-card';
      aiCard.setAttribute('data-num', 'AI');
      aiCard.setAttribute('data-reveal', '');
      aiCard.innerHTML = '<div class="equip-category">\u2728 Recomendacoes AI</div>' +
        '<h4>Especifico para este percurso</h4>' +
        '<ul class="equip-list">' + enrichment.gear_tips.map(function(tip) { return '<li>' + escHtml(tip) + '</li>'; }).join('') + '</ul>';
      equipGrid.appendChild(aiCard);
    }
  }

  // 6. Enrich segment cards with AI descriptions
  if (enrichment.segments && enrichment.segments.length) {
    var segCards = document.querySelectorAll('.seg-card');
    enrichment.segments.forEach(function(aiSeg) {
      var idx = aiSeg.index;
      if (idx >= segCards.length) return;
      var card = segCards[idx];
      var detailsCol = card.querySelector('.seg-details-col') || card;
      // Find or create AI content area after seg-stats
      var segStats = detailsCol.querySelector('.seg-stats');
      if (!segStats) return;
      var aiDiv = document.createElement('div');
      aiDiv.style.cssText = 'padding-top:12px;margin-top:12px;border-top:1px dashed rgba(255,255,255,0.08)';
      var html = '';
      if (aiSeg.description) html += '<div style="font-size:13px;color:var(--text-soft);line-height:1.6">' + escHtml(aiSeg.description) + '</div>';
      if (aiSeg.surface) html += '<div style="font-size:11px;color:#60a5fa;margin-top:6px">\uD83D\uDEB4 Piso: <strong>' + escHtml(aiSeg.surface) + '</strong></div>';
      if (aiSeg.tip) html += '<div style="font-size:11px;color:var(--accent);margin-top:4px;font-style:italic">\uD83D\uDCA1 ' + escHtml(aiSeg.tip) + '</div>';
      if (aiSeg.curiosity) html += '<div style="font-size:11px;color:#fbbf24;margin-top:4px">\u2728 ' + escHtml(aiSeg.curiosity) + '</div>';
      aiDiv.innerHTML = html;
      segStats.parentNode.insertBefore(aiDiv, segStats.nextSibling);
    });
  }

  // 7. Render terrain analysis section
  if (enrichment.terrain_analysis) {
    var ta = enrichment.terrain_analysis;
    var summaryContent = $('summary-content');
    if (summaryContent) {
      var terrainHtml = '<div style="margin-top:24px">';
      terrainHtml += '<div style="font-family:var(--mono);font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#60a5fa;font-weight:700;margin-bottom:12px">\uD83D\uDEB4 Analise de Piso</div>';
      if (ta.summary) terrainHtml += '<div style="font-size:14px;color:var(--text-soft);line-height:1.7;margin-bottom:16px">' + escHtml(ta.summary) + '</div>';
      if (ta.surfaces && ta.surfaces.length) {
        terrainHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:16px">';
        ta.surfaces.forEach(function(s) {
          var pct = s.percentage || 0;
          terrainHtml += '<div style="background:var(--bg-card);border:1px solid var(--border);padding:14px;border-left:3px solid #60a5fa">';
          terrainHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
          terrainHtml += '<span style="font-size:13px;font-weight:700;color:var(--text)">' + escHtml(s.type) + '</span>';
          terrainHtml += '<span style="font-family:var(--mono);font-size:12px;color:#60a5fa;font-weight:700">' + pct + '%</span>';
          terrainHtml += '</div>';
          terrainHtml += '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:' + pct + '%;background:#60a5fa;border-radius:2px"></div></div>';
          if (s.km_range) terrainHtml += '<div style="font-size:10px;color:var(--text-muted)">' + escHtml(s.km_range) + '</div>';
          if (s.description) terrainHtml += '<div style="font-size:11px;color:var(--text-soft);margin-top:4px;line-height:1.5">' + escHtml(s.description) + '</div>';
          if (s.tire_recommendation) terrainHtml += '<div style="font-size:10px;color:var(--accent);margin-top:4px">\uD83D\uDD27 ' + escHtml(s.tire_recommendation) + '</div>';
          terrainHtml += '</div>';
        });
        terrainHtml += '</div>';
      }
      if (ta.tire_recommendation) terrainHtml += '<div style="background:rgba(96,165,250,0.06);border:1px solid rgba(96,165,250,0.2);border-left:3px solid #60a5fa;padding:14px;font-size:13px;color:var(--text-soft)"><strong style="color:var(--text)">\uD83D\uDD27 Pneu recomendado:</strong> ' + escHtml(ta.tire_recommendation) + '</div>';
      if (ta.pressure_tip) terrainHtml += '<div style="font-size:12px;color:var(--text-muted);margin-top:8px;font-style:italic">' + escHtml(ta.pressure_tip) + '</div>';
      terrainHtml += '</div>';
      summaryContent.insertAdjacentHTML('beforeend', terrainHtml);
    }
  }
}
function checkLiveStatus(data) {
  var isActive = data.status === 'active';
  var schedMs = data.scheduled_at ? new Date(data.scheduled_at).getTime() : 0;
  var now = Date.now();
  var diffMs = schedMs - now;
  var diffH = diffMs / 3600000;

  if (isActive) {
    // Ride is LIVE right now
    showLiveBadge(data, 'live');
  } else if (diffH > -2 && diffH < 2) {
    // Within 2h of scheduled time — about to start or just started
    showLiveBadge(data, 'live');
  } else if (diffH >= 2 && diffH < 48) {
    // Within 48h — show "EM BREVE" badge
    showLiveBadge(data, 'soon');
  }
  // > 48h or past — no badge
}
function showLiveBadge(data, mode) {
  var badge = $('live-badge');
  if (badge) {
    badge.style.display = 'inline-flex';
    if (mode === 'soon') {
      badge.innerHTML = '<span class="soon-dot"></span> EM BREVE';
      badge.classList.add('live-badge-soon');
    }
  }
  var bar = $('live-bar');
  if (bar) {
    var rideId = data.ride_id || data.id;
    var liveUrl = 'https://www.kromi.online/live.html?ride=' + rideId;
    bar.style.display = 'flex';
    if (mode === 'soon') {
      bar.classList.add('soon');
    } else {
      bar.classList.remove('soon');
    }
    var link = $('live-bar-link');
    if (link) link.href = liveUrl;
    var textEl = $('live-bar-text');
    var subEl = $('live-bar-sub');
    var dotEl = $('live-bar-dot');
    if (mode === 'soon') {
      var d = new Date(data.scheduled_at || data.departure_at);
      var dayStr = d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
      var timeStr = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      if (textEl) textEl.textContent = 'Arranca ' + dayStr + ' as ' + timeStr;
      if (subEl) subEl.textContent = 'Live tracking disponivel no dia da pedalada';
      if (dotEl) { dotEl.className = 'soon-dot'; }
    } else {
      if (textEl) textEl.textContent = 'Acompanhar em tempo real';
      if (subEl) subEl.textContent = 'Pedalada a decorrer agora';
      if (dotEl) { dotEl.className = 'live-dot'; }
    }
    var btn = $('live-bar-link');
    if (btn) btn.textContent = 'Ver Live Tracking';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS (Lightbox, Share, GPX Download)
// ═════════════════════════════════════════════════════════════════════════════
function initEventListeners() {
  // Lightbox
  var lbClose = $('lightbox-close');
  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  var lb = $('lightbox');
  if (lb) lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });

  // Copy link
  var btnCopy = $('btn-copy');
  if (btnCopy) {
    btnCopy.addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(location.href);
        btnCopy.textContent = 'Copiado!';
        setTimeout(function () {
          btnCopy.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar Link';
        }, 2000);
      } catch (e) { prompt('Copiar URL:', location.href); }
    });
  }

  // WhatsApp
  var btnWa = $('btn-whatsapp');
  if (btnWa) {
    btnWa.addEventListener('click', function () {
      var text = encodeURIComponent(document.title + '\n' + location.href);
      window.open('https://wa.me/?text=' + text, '_blank');
    });
  }

  // GPX download
  var btnGpx = $('btn-gpx');
  if (btnGpx) {
    btnGpx.addEventListener('click', function () {
      if (!gpxRawData) return;
      var blob = new Blob([gpxRawData], { type: 'application/gpx+xml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (document.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'route') + '.gpx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  var params = parseParams();
  if (!params.postId && !params.rideId) { showError('Nenhum ID fornecido. Use ?id= ou ?ride='); return; }

  try {
    var data, club, isPreRide = false;

    if (params.postId) {
      var rows = await sbGet('club_ride_posts?id=eq.' + encodeURIComponent(params.postId) + '&select=*&limit=1');
      if (!rows || rows.length === 0) { showError('Post de pedalada nao encontrado.'); return; }
      data = rows[0];
      if (data.ride_id) {
        try {
          var rideRows = await sbGet('club_rides?id=eq.' + encodeURIComponent(data.ride_id) + '&select=*&limit=1');
          if (rideRows && rideRows[0]) {
            var ride = rideRows[0];
            if (!data.name && ride.name) data.name = ride.name;
            if (!data.description && ride.description) data.description = ride.description;
            if (!data.meeting_address && ride.meeting_address) data.meeting_address = ride.meeting_address;
            if (!data.route_gpx && ride.route_gpx) data.route_gpx = ride.route_gpx;
            if (!data.scheduled_at && ride.scheduled_at) data.scheduled_at = ride.scheduled_at;
            if (!data.club_id && ride.club_id) data.club_id = ride.club_id;
          }
        } catch (e) { /* ignore */ }
      }
      if (data.club_id) {
        var clubRows = await sbGet('clubs?id=eq.' + encodeURIComponent(data.club_id) + '&select=id,name,slug,color,avatar_url,banner_url,theme&limit=1');
        club = clubRows && clubRows[0];
      }
    } else {
      isPreRide = true;
      var rows2 = await sbGet('club_rides?id=eq.' + encodeURIComponent(params.rideId) + '&select=*&limit=1');
      if (!rows2 || rows2.length === 0) { showError('Pedalada planeada nao encontrada.'); return; }
      data = rows2[0];
      if (data.club_id) {
        var clubRows2 = await sbGet('clubs?id=eq.' + encodeURIComponent(data.club_id) + '&select=id,name,slug,color,avatar_url,banner_url,theme&limit=1');
        club = clubRows2 && clubRows2[0];
      }
    }

    $('og-url').setAttribute('content', location.href);

    // ── New features: apply club theme, SEO, live badge ──
    applyClubTheme(club);
    initThemeToggle();
    injectJsonLd(data, club);
    checkLiveStatus(data);

    // ── Existing renders ──
    renderClub(club);
    renderHero(data, isPreRide);

    // Build GPX profile
    var gpxPoints = null;
    var gpxProfile = null;
    if (data.route_gpx) {
      gpxRawData = data.route_gpx;
      gpxPoints = parseGpx(data.route_gpx);
      window._allTrackPoints = gpxPoints;
      if (gpxPoints.length >= 2) gpxProfile = buildProfile(gpxPoints);
      $('btn-gpx').style.display = '';
    }

    // Hero background: AI image (Nano Banana) > club banner > Static Maps fallback
    var heroSection = $('hero-section');
    if (heroSection && !(club && club.banner_url)) {
      var rideDataHero = data.ride_data || {};
      if (rideDataHero.hero_image) {
        // AI-generated hero image from Nano Banana
        heroSection.style.backgroundImage = 'linear-gradient(180deg, rgba(14,14,14,0.2) 0%, rgba(14,14,14,0.6) 40%, var(--bg) 100%), url(' + rideDataHero.hero_image + ')';
        heroSection.style.backgroundSize = 'cover';
        heroSection.style.backgroundPosition = 'center 30%';
      } else if (gpxPoints && gpxPoints.length > 0) {
        // Fallback: satellite map of start point
        var startPt = gpxPoints[0];
        var heroImg = 'https://maps.googleapis.com/maps/api/staticmap?center=' + startPt.lat + ',' + startPt.lon + '&zoom=12&size=1200x600&maptype=hybrid&key=' + MAPS_KEY;
        heroSection.style.backgroundImage = 'linear-gradient(180deg, rgba(14,14,14,0.3) 0%, rgba(14,14,14,0.7) 50%, var(--bg) 100%), url(' + heroImg + ')';
        heroSection.style.backgroundSize = 'cover';
        heroSection.style.backgroundPosition = 'center';
      }
    }

    // Stats
    var stats = data.stats || {};
    renderStats(stats, gpxProfile);

    // Map
    if (gpxPoints && gpxPoints.length >= 2) renderMap(gpxPoints);

    // Altimetry
    var rideData = data.ride_data || {};
    var elevProfile = rideData.elevation_profile || data.elevation_profile;
    if (elevProfile && elevProfile.length >= 2) {
      var normProfile = elevProfile.map(function (p, i) {
        return { d: p.d != null ? p.d : (p.dist != null ? p.dist : (p.distance_km != null ? p.distance_km : i / (elevProfile.length - 1))), e: p.e != null ? p.e : (p.ele != null ? p.ele : (p.elevation != null ? p.elevation : (p.alt != null ? p.alt : 0))) };
      });
      renderAltimetry(normProfile);
    } else if (gpxProfile && gpxProfile.length >= 2) {
      renderAltimetry(gpxProfile);
    }

    // Segments
    var segments = rideData.segments || data.segments;
    if (segments && segments.length) {
      segments = segments.map(function (s) {
        return {
          name: s.name,
          direction: (s.elevation_gain_m || s.elevation_gain || 0) >= (s.elevation_loss_m || s.elevation_loss || 0) ? 1 : -1,
          distance_km: s.distance_km,
          elevation_gain_m: s.elevation_gain_m || s.elevation_gain || 0,
          elevation_loss_m: s.elevation_loss_m || s.elevation_loss || 0,
          avg_gradient_pct: s.avg_gradient_pct || s.avg_gradient || 0,
          max_gradient_pct: s.max_gradient_pct || s.max_gradient || 0,
          start_ele: s.start_ele, end_ele: s.end_ele, profile: s.profile
        };
      });
      renderSegments(segments, gpxProfile);
    } else if (gpxProfile && gpxProfile.length >= 10) {
      var autoSegs = autoDetectSegments(gpxProfile);
      if (gpxPoints) {
        autoSegs.forEach(function (seg) {
          seg.trackPoints = gpxPoints.slice(seg.start_idx, seg.end_idx + 1);
        });
      }
      if (autoSegs.length) { window._allSegments = autoSegs; renderSegments(autoSegs, gpxProfile); }
    }

    // Summary + Equipment (auto-generated from GPX)
    var allSegs = (segments && segments.length) ? segments : autoSegs;
    if (gpxProfile && gpxProfile.length >= 10) {
      var summaryKpis = computeGainLoss(gpxProfile);
      summaryKpis.distance_km = gpxProfile[gpxProfile.length - 1].d;
      summaryKpis.max_ele = Math.max.apply(null, gpxProfile.map(function(p) { return p.e; }));
      summaryKpis.min_ele = Math.min.apply(null, gpxProfile.map(function(p) { return p.e; }));
      summaryKpis.elevation_gain = summaryKpis.gain;
      summaryKpis.elevation_loss = summaryKpis.loss;
      renderSummary(gpxProfile, summaryKpis, allSegs);
      renderEquipment(gpxProfile, summaryKpis);
    }

    // Weather, POIs, Timeline
    var rideStartAt = data.departure_at || data.scheduled_at;
    if (gpxPoints && gpxPoints.length >= 2 && rideStartAt) {
      renderPOIs(gpxPoints, gpxProfile, data);
      var autoSegsForTimeline = allSegs || [];
      renderTimeline(gpxPoints, gpxProfile, autoSegsForTimeline, data);
      fetchAndRenderWeather(gpxPoints, gpxProfile, rideStartAt);
    }

    // AI Enrichment — only render if already cached in ride_data
    // Generation is done by the ride creator via the app, NOT on public page load
    var cachedAI = (data.ride_data && data.ride_data.ai_enrichment) || (rideData && rideData.ai_enrichment);
    if (cachedAI) {
      renderAIContent(cachedAI);
    }

    // Rider stats
    var riderStats = rideData.rider_stats || data.rider_stats || (stats.participants);
    if (riderStats && riderStats.length) renderRiders(riderStats);

    // Photos
    var photos = data.photos || rideData.photos;
    if (photos && photos.length) renderPhotos(photos);

    showApp();
    initReveal();

    // Load participants for CTA section
    loadParticipants(data);

  } catch (err) {
    console.error('[ride.html]', err);
    showError(err.message || 'Erro ao carregar dados.');
  }
}

// ── Participants + Join ──────────────────────────────────────────────────────
function loadParticipants(data) {
  var rideId = data.ride_id || data.id;
  if (!rideId) return;

  sbGet('club_ride_participants?club_ride_id=eq.' + rideId + '&select=display_name,status')
    .then(function (parts) {
      if (!Array.isArray(parts)) return;

      // Show in live-bar
      var barParts = $('live-bar-participants');
      if (barParts && parts.length > 0) {
        barParts.style.display = '';
        barParts.textContent = parts.length + ' participante' + (parts.length !== 1 ? 's' : '') + ' confirmados';
      }

      // Participants are shown in live-bar only (CTA section removed)
    })
    .catch(function () {});

  // Show join button in live-bar
  var joinBar = $('btn-join-bar');
  if (joinBar) joinBar.style.display = '';
}

// ── Join Ride (public) — OTP flow with auto-register + auto-join club ────────
var _joinState = { step: 'idle', email: '', rideId: '', clubId: '' };

window.joinRidePublic = function () {
  var params = parseParams();
  var rideId = params.rideId || params.postId;
  if (!rideId) return;
  _joinState.rideId = rideId;

  // Check if already logged in
  var authRaw = null;
  try { authRaw = localStorage.getItem('kromi-auth'); } catch (e) {}
  var auth = authRaw ? JSON.parse(authRaw) : null;
  var jwt = auth && auth.state && auth.state.jwt;

  if (jwt) {
    // Already logged in — join directly
    _doJoinRide(jwt, auth.state.user);
    return;
  }

  // Show email modal
  _showJoinModal('email');
};

function _showJoinModal(step) {
  _joinState.step = step;
  var existing = document.getElementById('join-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'join-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';

  var card = '<div style="background:#1a1919;border:1px solid #333;border-radius:16px;padding:28px 24px;max-width:380px;width:90%;text-align:center">';
  card += '<div style="font-size:11px;font-weight:900;letter-spacing:2px;color:#3fff8b;margin-bottom:16px">KROMI BIKECONTROL</div>';

  if (step === 'email') {
    card += '<div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:6px">Juntar-me a esta Ride</div>';
    card += '<div style="font-size:12px;color:#888;margin-bottom:20px">Insere o teu email para receberes um codigo de acesso</div>';
    card += '<input id="join-email" type="email" placeholder="o.teu@email.com" style="width:100%;padding:14px;background:#262626;border:1px solid #444;border-radius:8px;color:#fff;font-size:15px;text-align:center;outline:none" autofocus />';
    card += '<div id="join-error" style="color:#ff716c;font-size:11px;margin-top:8px;display:none"></div>';
    card += '<button id="join-send-btn" onclick="_sendOTP()" style="width:100%;margin-top:14px;padding:14px;background:#3fff8b;color:#000;border:none;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer">Enviar Codigo</button>';
  } else if (step === 'otp') {
    card += '<div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:6px">Codigo de Verificacao</div>';
    card += '<div style="font-size:12px;color:#888;margin-bottom:6px">Enviamos um codigo para</div>';
    card += '<div style="font-size:13px;color:#3fff8b;font-weight:700;margin-bottom:20px">' + escHtml(_joinState.email) + '</div>';
    card += '<input id="join-otp" type="text" inputmode="numeric" maxlength="6" placeholder="000000" style="width:160px;padding:14px;background:#262626;border:1px solid #444;border-radius:8px;color:#fff;font-size:28px;font-weight:900;text-align:center;letter-spacing:8px;outline:none;font-family:monospace" autofocus />';
    card += '<div id="join-error" style="color:#ff716c;font-size:11px;margin-top:8px;display:none"></div>';
    card += '<button id="join-verify-btn" onclick="_verifyOTP()" style="width:100%;margin-top:14px;padding:14px;background:#3fff8b;color:#000;border:none;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer">Verificar</button>';
    card += '<div onclick="_showJoinModal(\'email\')" style="margin-top:12px;font-size:11px;color:#666;cursor:pointer">Alterar email</div>';
  } else if (step === 'success') {
    card += '<div style="font-size:48px;margin-bottom:12px">&#127881;</div>';
    card += '<div style="font-size:18px;font-weight:800;color:#3fff8b;margin-bottom:8px">Juntaste-te a esta Ride!</div>';
    card += '<div style="font-size:12px;color:#888;margin-bottom:20px">Bem-vindo ao grupo. Vemo-nos no dia da pedalada.</div>';
    card += '<button onclick="document.getElementById(\'join-modal\').remove()" style="padding:12px 32px;background:#3fff8b;color:#000;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Fechar</button>';
  }

  card += '</div>';
  modal.innerHTML = card;

  // Close on backdrop click
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

  document.body.appendChild(modal);

  // Auto-focus + enter key
  setTimeout(function () {
    var input = document.getElementById('join-email') || document.getElementById('join-otp');
    if (input) {
      input.focus();
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          if (step === 'email') _sendOTP();
          else if (step === 'otp') _verifyOTP();
        }
      });
    }
  }, 100);
}

window._sendOTP = function () {
  var emailEl = document.getElementById('join-email');
  var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
  if (!email || email.indexOf('@') < 0) {
    _showJoinError('Email invalido');
    return;
  }
  _joinState.email = email;

  var btn = document.getElementById('join-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'A enviar...'; }

  fetch(SB_URL + '/functions/v1/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify({ email: email })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.error) {
      _showJoinError(data.error);
      if (btn) { btn.disabled = false; btn.textContent = 'Enviar Codigo'; }
    } else {
      _showJoinModal('otp');
    }
  }).catch(function () {
    _showJoinError('Erro de rede. Tenta novamente.');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar Codigo'; }
  });
};

window._verifyOTP = function () {
  var otpEl = document.getElementById('join-otp');
  var code = otpEl ? otpEl.value.trim() : '';
  if (code.length !== 6) { _showJoinError('Codigo deve ter 6 digitos'); return; }

  var btn = document.getElementById('join-verify-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'A verificar...'; }

  fetch(SB_URL + '/functions/v1/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify({ email: _joinState.email, code: code })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.error) {
      _showJoinError(data.error);
      if (btn) { btn.disabled = false; btn.textContent = 'Verificar'; }
      return;
    }
    // Success — we have JWT + user
    var jwt = data.jwt;
    var user = data.user;
    if (!jwt || !user) { _showJoinError('Erro de autenticacao'); return; }

    // Save session to localStorage for future visits
    try {
      localStorage.setItem('kromi-auth', JSON.stringify({ state: { jwt: jwt, user: user } }));
    } catch (e) {}

    // Join club + ride
    _doJoinRide(jwt, user);
  }).catch(function () {
    _showJoinError('Erro de rede');
    if (btn) { btn.disabled = false; btn.textContent = 'Verificar'; }
  });
};

function _doJoinRide(jwt, user) {
  var rideId = _joinState.rideId;
  var userId = user.id;
  var displayName = user.name || user.email || 'Rider';

  // 1. Get the club_id for this ride
  sbGet('club_rides?id=eq.' + rideId + '&select=club_id&limit=1')
    .then(function (rides) {
      var clubId = rides && rides[0] && rides[0].club_id;
      if (!clubId) throw new Error('Ride not found');

      // 2. Auto-join club (ignore conflict if already member)
      return fetch(SB_URL + '/rest/v1/club_members', {
        method: 'POST',
        headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ club_id: clubId, user_id: userId, display_name: displayName, role: 'member' })
      }).then(function () {
        // 3. Get user's tracking token (from emergency_profiles)
        return fetch(SB_URL + '/rest/v1/emergency_profiles?user_id=eq.' + userId + '&active=eq.true&select=tracking_token&limit=1', {
          headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + jwt }
        }).then(function (r) { return r.json(); }).then(function (profiles) {
          var trackingToken = (profiles && profiles[0]) ? profiles[0].tracking_token : null;
          // 4. Join ride with tracking token
          var body = { club_ride_id: rideId, user_id: userId, display_name: displayName, status: 'joined' };
          if (trackingToken) body.tracking_token = trackingToken;
          return fetch(SB_URL + '/rest/v1/club_ride_participants', {
            method: 'POST',
            headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify(body)
          });
        });
      });
    })
    .then(function () {
      // Show success
      _showJoinModal('success');
      // Update participants list
      loadParticipants({ id: rideId, ride_id: rideId });
      // Hide join button
      var b2 = $('btn-join-bar'); if (b2) b2.style.display = 'none';
    })
    .catch(function (err) {
      console.warn('Join error:', err);
      // Might be duplicate — still show success
      _showJoinModal('success');
      loadParticipants({ id: rideId, ride_id: rideId });
    });
}

function _showJoinError(msg) {
  var el = document.getElementById('join-error');
  if (el) { el.style.display = ''; el.textContent = msg; }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
initEventListeners();
main();

})();
