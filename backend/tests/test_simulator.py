import pytest
from app.simulator import calculate_bearing, calculate_distance, percentile, VehicleState

def test_calculate_bearing():
    assert calculate_bearing(0, 0, 1, 0) == 0.0
    assert calculate_bearing(0, 0, 0, 1) == 90.0

def test_calculate_distance():
    d = calculate_distance(0, 0, 1, 0)
    assert 111.0 < d < 112.0

def test_percentile():
    data = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert percentile(data, 50) == 3.0
    assert percentile(data, 95) == 4.8
    assert percentile([], 50) == 0.0

def test_movement_model_bounds():
    v = VehicleState(1)
    # Ensure lat/lon is initialized properly
    assert -7.0 < v.lat < -5.0
    assert 105.0 < v.lon < 108.0
    assert 20 <= v.speed_kmh <= 60
    assert 0 <= v.heading_deg <= 360
    assert 5 <= v.altitude_m <= 25

    # Tick 100 times to test bounds
    for _ in range(100):
        row = v.tick(5.0)
        assert 0 <= row["speed_kmh"] <= 80.0
        assert 0 <= row["heading_deg"] <= 360.0
        assert 5.0 <= row["altitude_m"] <= 25.0
        assert 3.0 <= row["gps_accuracy_m"] <= 15.0
        # distance from center check
        assert calculate_distance(row["latitude"], row["longitude"], -6.2000, 106.8000) <= 16.0
