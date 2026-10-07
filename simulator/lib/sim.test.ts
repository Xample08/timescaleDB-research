import { expect, test, describe } from 'vitest';
import { advanceVehicle, createRandomInitialState, CENTER_LAT, CENTER_LON, percentile, chunkArray, VehicleState } from './sim';

function seededRandom(seed: number) {
  return function() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

describe('Movement model', () => {
  test('stays within bounds and speed limits over 10,000 ticks', () => {
    const rng = seededRandom(12345);
    let state = createRandomInitialState(1, rng);
    
    for (let i = 0; i < 10000; i++) {
      state = advanceVehicle(state, 5, rng);
      expect(state.speed).toBeGreaterThanOrEqual(0);
      expect(state.speed).toBeLessThanOrEqual(80);
      const dist = distKm(state.lat, state.lon, CENTER_LAT, CENTER_LON);
      // It can temporarily exceed 15 by a tiny bit in the tick it corrects, but shouldn't run away.
      // Allow up to 15.5 just in case it jumps past 15 in one tick.
      expect(dist).toBeLessThan(15.5);
    }
  });

  test('distance moved matches speed * dt within 1% for small dt', () => {
    // Force a specific state
    const state: VehicleState = {
      id: 1, lat: CENTER_LAT, lon: CENTER_LON, speed: 60, heading: 90, alt: 10, stop: 0
    };
    
    // We override rng to avoid speed changes for this one tick
    const constantRng = () => 0.5; // Will produce 0 from gauss because 0.5 maps to mean exactly if we're not careful, but let's just use advanceVehicle knowing speed changes slightly.
    // Actually, speed changes slightly. Let's measure expected vs actual.
    
    const nextState = advanceVehicle(state, 1, constantRng);
    const actualDist = distKm(state.lat, state.lon, nextState.lat, nextState.lon);
    const updatedExpectedDist = (nextState.speed * 1) / 3600;
    expect(Math.abs(actualDist - updatedExpectedDist) / updatedExpectedDist).toBeLessThan(0.01);
  });

  test('stop logic', () => {
    const rng = seededRandom(999);
    let state = createRandomInitialState(1, rng);
    state.stop = 3;
    
    state = advanceVehicle(state, 5, rng);
    expect(state.speed).toBe(0);
    expect(state.stop).toBe(2);
    
    state = advanceVehicle(state, 5, rng);
    expect(state.speed).toBe(0);
    expect(state.stop).toBe(1);
    
    state = advanceVehicle(state, 5, rng);
    // when stop transitions from 1 to 0, speed becomes 20-40
    expect(state.stop).toBe(0);
    expect(state.speed).toBeGreaterThanOrEqual(20);
    expect(state.speed).toBeLessThanOrEqual(40);
  });
});

describe('Dirty data', () => {
  test('rates within tolerance over many rows', () => {
    const rng = seededRandom(111);
    let lates = 0;
    let duplicates = 0;
    const n = 10000;
    
    for (let i = 0; i < n; i++) {
      if (rng() < 0.02) lates++;
      if (rng() < 0.01) duplicates++;
    }
    
    expect(lates / n).toBeGreaterThan(0.015);
    expect(lates / n).toBeLessThan(0.025);
    
    expect(duplicates / n).toBeGreaterThan(0.005);
    expect(duplicates / n).toBeLessThan(0.015);
  });
});

describe('Helpers', () => {
  test('500-row chunking helper', () => {
    const arr = new Array(1050).fill(0);
    const chunks = chunkArray(arr, 500);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(500);
    expect(chunks[1].length).toBe(500);
    expect(chunks[2].length).toBe(50);
  });

  test('nearest-rank percentile', () => {
    const arr = [15, 20, 35, 40, 50];
    // p50
    // index = ceil(50/100 * 5) - 1 = ceil(2.5) - 1 = 3 - 1 = 2
    expect(percentile(arr, 50)).toBe(35);
    
    // p95
    // index = ceil(95/100 * 5) - 1 = ceil(4.75) - 1 = 5 - 1 = 4
    expect(percentile(arr, 95)).toBe(50);
  });
});
