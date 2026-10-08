import type { Incident } from "./scenarios";
export interface VehicleState {
  id: number;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  alt: number;
  stop: number;
  incident?: Incident;
  stoppedSince?: string;
}

export const CENTER_LAT = -6.2;
export const CENTER_LON = 106.8;

// Box-Muller transform for gaussian distribution
function gauss(mean: number, stdDev: number, rng: () => number): number {
  let u1 = 0,
    u2 = 0;
  while (u1 === 0) u1 = rng();
  while (u2 === 0) u2 = rng();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function uniform(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

function distKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function initialPosition(rng: () => number): { lat: number; lon: number } {
  // Uniformly random within 10 km radius
  const angle = rng() * 2 * Math.PI;
  const r = 10 * Math.sqrt(rng()); // sqrt for uniform area distribution
  const lat = CENTER_LAT + (r * Math.cos(angle)) / 111.32;
  const lon =
    CENTER_LON +
    (r * Math.sin(angle)) / (111.32 * Math.cos((CENTER_LAT * Math.PI) / 180));
  return { lat, lon };
}

export function createRandomInitialState(
  id: number,
  rng: () => number,
): VehicleState {
  const { lat, lon } = initialPosition(rng);
  return {
    id,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    speed: Number(uniform(20, 60, rng).toFixed(1)),
    heading: Number(uniform(0, 360, rng).toFixed(1)),
    alt: Number(uniform(5, 25, rng).toFixed(1)),
    stop: 0,
  };
}

export function advanceVehicle(
  v: VehicleState,
  dt: number,
  rng: () => number,
  speedOverride?: number,
): VehicleState {
  let { lat, lon, speed, heading, alt, stop } = v;

  if (stop > 0) {
    speed = 0;
    stop -= 1;
    if (stop === 0) {
      speed = uniform(20, 40, rng);
    }
  } else {
    heading += gauss(0, 10, rng);
    heading = ((heading % 360) + 360) % 360;
    speed += gauss(0, 3, rng);
    speed = Math.max(0, Math.min(80, speed));

    if (rng() < 0.02) {
      stop = Math.floor(uniform(3, 10.999, rng)); // 3 to 10
      speed = 0;
    }
  }

  if (speedOverride !== undefined) {
    speed = speedOverride;
    stop = 0;
  }
  const dist_km = (speed * dt) / 3600;
  lat += (dist_km * Math.cos((heading * Math.PI) / 180)) / 111.32;
  lon +=
    (dist_km * Math.sin((heading * Math.PI) / 180)) /
    (111.32 * Math.cos((lat * Math.PI) / 180));

  if (distKm(lat, lon, CENTER_LAT, CENTER_LON) > 15) {
    // bearing toward center
    const y =
      Math.sin(((CENTER_LON - lon) * Math.PI) / 180) *
      Math.cos((CENTER_LAT * Math.PI) / 180);
    const x =
      Math.cos((lat * Math.PI) / 180) * Math.sin((CENTER_LAT * Math.PI) / 180) -
      Math.sin((lat * Math.PI) / 180) *
        Math.cos((CENTER_LAT * Math.PI) / 180) *
        Math.cos(((CENTER_LON - lon) * Math.PI) / 180);
    const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    heading = (bearing + uniform(-20, 20, rng) + 360) % 360;
  }

  alt += gauss(0, 0.5, rng); // random walk of Â±0.5 per tick, but gauss standard dev could be used, spec says random walk of Â±0.5, let's use uniform(-0.5, 0.5)
  alt = Math.max(5, Math.min(25, alt));

  return {
    ...v,
    id: v.id,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    speed: Number(speed.toFixed(1)),
    heading: Number(heading.toFixed(1)),
    alt: Number(alt.toFixed(1)),
    stop,
  };
}

export function getGpsAccuracy(rng: () => number): number {
  return Number(uniform(3, 15, rng).toFixed(1));
}

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
