"""
AI/ML Prediction Engine for Landslide Risk Assessment.

Uses a multi-factor scoring model combining:
- Rainfall intensity and antecedent moisture
- Slope geometry and terrain stability
- Soil type susceptibility
- Vegetation cover protection
- Historical event frequency
- Sensor anomaly detection

In production this would be replaced with trained XGBoost/LSTM models;
here we use a transparent rule-based + ML-hybrid approach that
demonstrates the architecture and can be upgraded.
"""
import math
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple


# ---------- Feature Weights (learnable in production) ----------
WEIGHTS = {
    "rainfall_intensity": 0.25,
    "antecedent_rainfall": 0.15,
    "slope_angle": 0.20,
    "soil_susceptibility": 0.12,
    "vegetation_loss": 0.10,
    "sensor_anomaly": 0.10,
    "historical_frequency": 0.08,
}

SOIL_SUSCEPTIBILITY = {
    "rocky": 0.3,
    "sandy_clay": 0.7,
    "sandy_loam": 0.6,
    "clay_loam": 0.5,
    "clay": 0.4,
    "alluvial": 0.2,
    "unknown": 0.5,
}

# IMD rainfall thresholds (mm/hour)
RAINFALL_THRESHOLDS = {
    "low": 7.5,
    "moderate": 15.0,
    "heavy": 30.0,
    "very_heavy": 65.0,
    "extreme": 125.0,
}


def classify_rainfall_intensity(mm_per_hour: float) -> str:
    if mm_per_hour >= RAINFALL_THRESHOLDS["extreme"]:
        return "extreme"
    elif mm_per_hour >= RAINFALL_THRESHOLDS["very_heavy"]:
        return "very_heavy"
    elif mm_per_hour >= RAINFALL_THRESHOLDS["heavy"]:
        return "heavy"
    elif mm_per_hour >= RAINFALL_THRESHOLDS["moderate"]:
        return "moderate"
    elif mm_per_hour >= RAINFALL_THRESHOLDS["low"]:
        return "low"
    return "nil"


def sigmoid(x: float, midpoint: float = 50, steepness: float = 0.1) -> float:
    """Smooth 0-1 mapping."""
    return 1.0 / (1.0 + math.exp(-steepness * (x - midpoint)))


def compute_rainfall_score(rainfall_mm_h: float, antecedent_mm_24h: float) -> float:
    """Score 0-100 from rainfall intensity and antecedent moisture."""
    intensity = sigmoid(rainfall_mm_h, midpoint=30, steepness=0.15)
    antecedent = sigmoid(antecedent_mm_24h, midpoint=80, steepness=0.03)
    combined = 0.6 * intensity + 0.4 * antecedent
    return combined * 100


def compute_slope_score(slope_angle: float) -> float:
    """Score 0-100 from slope angle."""
    return sigmoid(slope_angle, midpoint=30, steepness=0.08) * 100


def compute_vegetation_score(veg_cover: float) -> float:
    """Lower vegetation = higher risk. veg_cover is 0-1."""
    return (1 - veg_cover) * 100


def detect_sensor_anomaly(readings: List[float], threshold: float) -> float:
    """
    Simple anomaly detection: returns 0-100 score based on how many readings
    exceed the threshold and how far.
    """
    if not readings or threshold == 0:
        return 0
    exceedances = [max(0, (r - threshold) / threshold) for r in readings]
    if not exceedances:
        return 0
    max_exceedance = max(exceedances)
    count_ratio = sum(1 for e in exceedances if e > 0) / len(exceedances)
    return min(100, (max_exceedance * 60 + count_ratio * 40))


def historical_frequency_score(event_count: int, months: int = 12) -> float:
    """Score from recent event frequency."""
    rate = event_count / max(months, 1)
    return min(100, rate * 200)  # 0.5 events/month → 100


def predict_landslide_risk(
    slope_angle: float,
    soil_type: str,
    vegetation_cover: float,
    rainfall_mm_h: float,
    antecedent_rainfall_24h: float,
    sensor_readings: Dict[str, List[float]],
    sensor_thresholds: Dict[str, float],
    historical_events_12m: int,
) -> Dict:
    """
    Compute a composite landslide risk score and classification.

    Returns:
        {
            "risk_score": float 0-100,
            "risk_level": str,
            "confidence": float 0-1,
            "contributing_factors": {...},
            "rainfall_class": str,
            "recommended_actions": [str]
        }
    """
    # Individual factor scores (0-100)
    rainfall_score = compute_rainfall_score(rainfall_mm_h, antecedent_rainfall_24h)
    slope_score = compute_slope_score(slope_angle)
    soil_score = SOIL_SUSCEPTIBILITY.get(soil_type, 0.5) * 100
    veg_score = compute_vegetation_score(vegetation_cover)

    # Sensor anomaly (aggregate across all sensor types)
    sensor_scores = []
    for stype, readings in sensor_readings.items():
        threshold = sensor_thresholds.get(stype, 1)
        sensor_scores.append(detect_sensor_anomaly(readings, threshold))
    sensor_score = max(sensor_scores) if sensor_scores else 0

    hist_score = historical_frequency_score(historical_events_12m)

    # Weighted composite
    factors = {
        "rainfall": rainfall_score,
        "slope": slope_score,
        "soil": soil_score,
        "vegetation": veg_score,
        "sensor_anomaly": sensor_score,
        "historical": hist_score,
    }

    weighted_sum = (
        WEIGHTS["rainfall_intensity"] * factors["rainfall"]
        + WEIGHTS["antecedent_rainfall"] * factors["rainfall"] * 0.6
        + WEIGHTS["slope_angle"] * factors["slope"]
        + WEIGHTS["soil_susceptibility"] * factors["soil"]
        + WEIGHTS["vegetation_loss"] * factors["vegetation"]
        + WEIGHTS["sensor_anomaly"] * factors["sensor_anomaly"]
        + WEIGHTS["historical_frequency"] * factors["historical"]
    )

    # Normalize
    max_possible = sum(WEIGHTS.values()) * 100
    risk_score = min(100, max(0, (weighted_sum / max_possible) * 100 * 1.15))

    # Classify
    if risk_score >= 75:
        risk_level = "critical"
    elif risk_score >= 50:
        risk_level = "high"
    elif risk_score >= 30:
        risk_level = "moderate"
    else:
        risk_level = "low"

    # Confidence based on data completeness
    data_points = sum([
        1 if rainfall_mm_h > 0 else 0,
        1 if antecedent_rainfall_24h > 0 else 0,
        1 if sensor_readings else 0,
        1 if historical_events_12m > 0 else 0,
        1 if soil_type != "unknown" else 0,
    ])
    confidence = min(0.95, 0.4 + data_points * 0.12)

    # Rainfall classification
    rainfall_class = classify_rainfall_intensity(rainfall_mm_h)

    # Recommended actions
    actions = []
    if risk_level == "critical":
        actions.extend([
            "EVACUATE immediately – issue red alert",
            "Deploy NDRF/SDRF teams to standby positions",
            "Close all roads in the zone",
            "Notify district collector and state disaster authority",
            "Activate emergency communication (sirens, loudspeakers)",
        ])
    elif risk_level == "high":
        actions.extend([
            "Issue orange alert to authorities",
            "Prepare evacuation plans for nearby villages",
            "Monitor sensor data at 5-minute intervals",
            "Alert road maintenance teams",
            "Send SMS/app warnings to residents",
        ])
    elif risk_level == "moderate":
        actions.extend([
            "Issue yellow advisory",
            "Increase sensor monitoring frequency",
            "Alert field officials for ground inspection",
            "Review drainage and slope stabilization measures",
        ])
    else:
        actions.extend([
            "Continue routine monitoring",
            "Log weather data for trend analysis",
        ])

    return {
        "risk_score": round(risk_score, 1),
        "risk_level": risk_level,
        "confidence": round(confidence, 2),
        "contributing_factors": {k: round(v, 1) for k, v in factors.items()},
        "rainfall_class": rainfall_class,
        "recommended_actions": actions,
    }


def batch_predict(zones_data: List[Dict]) -> List[Dict]:
    """Run predictions for a list of zone data dicts."""
    results = []
    for zd in zones_data:
        result = predict_landslide_risk(
            slope_angle=zd.get("slope_angle", 0),
            soil_type=zd.get("soil_type", "unknown"),
            vegetation_cover=zd.get("vegetation_cover", 0.5),
            rainfall_mm_h=zd.get("rainfall_mm_h", 0),
            antecedent_rainfall_24h=zd.get("antecedent_rainfall_24h", 0),
            sensor_readings=zd.get("sensor_readings", {}),
            sensor_thresholds=zd.get("sensor_thresholds", {}),
            historical_events_12m=zd.get("historical_events_12m", 0),
        )
        result["zone_id"] = zd.get("zone_id")
        results.append(result)
    return results


def simulate_realtime_update(zone_data: Dict) -> Dict:
    """
    Simulate real-time sensor/weather data changes for demo purposes.
    Returns updated zone data dict with fresh simulated readings.
    """
    updated = dict(zone_data)
    # Simulate rainfall change
    current_rain = updated.get("rainfall_mm_h", 0)
    delta = random.uniform(-5, 15)
    updated["rainfall_mm_h"] = max(0, current_rain + delta)

    # Simulate antecedent rainfall accumulation
    updated["antecedent_rainfall_24h"] = updated.get("antecedent_rainfall_24h", 20) + updated["rainfall_mm_h"] * 0.1

    # Simulate sensor readings with occasional anomalies
    for stype in ["rainfall", "soil_moisture", "tilt"]:
        readings = updated.get("sensor_readings", {}).get(stype, [])
        new_val = readings[-1] * random.uniform(0.8, 1.3) if readings else random.uniform(0, 50)
        if random.random() < 0.05:  # 5% chance of anomaly spike
            new_val *= random.uniform(2, 5)
        readings.append(new_val)
        updated.setdefault("sensor_readings", {})[stype] = readings[-20:]  # keep last 20

    return updated


# ---------- Real Data Integration ----------
try:
    from services.real_weather import real_weather_service
    from services.ndvi import ndvi_service
    from services.elevation import elevation_service
    from services.sensor_gateway import sensor_gateway
    REAL_DATA_AVAILABLE = True
except ImportError:
    REAL_DATA_AVAILABLE = False


async def update_zone_real_data(zone) -> Dict:
    """
    Fetch real-world data for a zone: weather, NDVI, elevation, slope.
    Returns dict of real values to merge into zone data for prediction.
    """
    result = {
        "rainfall_mm_h": 0,
        "antecedent_rainfall_24h": 0,
        "vegetation_cover": zone.vegetation_cover,
        "slope_angle_deg": zone.slope_angle_deg,
        "elevation_m": zone.elevation_m,
        "source": "seed_data",
    }
    if not REAL_DATA_AVAILABLE:
        return result

    # 1. Real weather (Open-Meteo / IMD)
    try:
        weather = await real_weather_service.get_zone_weather(
            zone.latitude, zone.longitude, zone.id,
            district=zone.district, state=zone.state
        )
        if weather.get("source") not in (None, "unavailable"):
            result["rainfall_mm_h"] = weather.get("rainfall_mm_h", 0)
            result["antecedent_rainfall_24h"] = weather.get("antecedent_rainfall_24h", 0)
            result["weather_source"] = weather.get("source", "unknown")
    except Exception as e:
        print(f"[Predictor] Weather fetch failed for zone {zone.id}: {e}")

    # 2. Real NDVI (Sentinel-2)
    try:
        ndvi = await ndvi_service.get_ndvi(zone.latitude, zone.longitude)
        if ndvi and ndvi.get("source") == "sentinel_2":
            result["vegetation_cover"] = ndvi_service.ndvi_to_vegetation_cover(ndvi["ndvi"])
            result["ndvi_value"] = ndvi["ndvi"]
            result["ndvi_source"] = "sentinel_2"
    except Exception as e:
        print(f"[Predictor] NDVI fetch failed for zone {zone.id}: {e}")

    # 3. Real elevation + slope (SRTM DEM)
    try:
        topo = await elevation_service.get_zone_topography(zone.latitude, zone.longitude)
        if topo and topo.get("source") == "srtm_dem":
            result["slope_angle_deg"] = topo["slope_angle_deg"]
            result["elevation_m"] = topo["elevation_m"]
    except Exception as e:
        print(f"[Predictor] Elevation fetch failed for zone {zone.id}: {e}")

    # 4. Real sensor readings (MQTT/HTTP)
    try:
        sensor_data = sensor_gateway.get_realtime_readings(zone.id)
        if sensor_data and zone.id in sensor_data:
            zone_sensors = sensor_data[zone.id]
            result["sensor_readings"] = {}
            result["sensor_thresholds"] = {}
            for stype, reading in zone_sensors.items():
                result["sensor_readings"][stype] = [reading["value"]]
                from services.sensor_gateway import SENSOR_TYPES
                result["sensor_thresholds"][stype] = SENSOR_TYPES.get(stype, {}).get("threshold", 50)
    except Exception as e:
        print(f"[Predictor] Sensor fetch failed for zone {zone.id}: {e}")

    result["source"] = "real" if any(
        result.get(k) != getattr(zone, k, None)
        for k in ["vegetation_cover", "slope_angle_deg"]
    ) else "seed_data"

    return result


async def batch_predict_real_data(zones) -> List[Dict]:
    """Run predictions using real data for all zones."""
    results = []
    for zone in zones:
        real_data = await update_zone_real_data(zone)
        result = predict_landslide_risk(
            slope_angle=real_data.get("slope_angle_deg", zone.slope_angle_deg),
            soil_type=zone.soil_type,
            vegetation_cover=real_data.get("vegetation_cover", zone.vegetation_cover),
            rainfall_mm_h=real_data.get("rainfall_mm_h", 0),
            antecedent_rainfall_24h=real_data.get("antecedent_rainfall_24h", 0),
            sensor_readings=real_data.get("sensor_readings", {}),
            sensor_thresholds=real_data.get("sensor_thresholds", {}),
            historical_events_12m=0,
        )
        result["zone_id"] = zone.id
        result["data_source"] = real_data.get("source", "seed_data")
        result["weather_source"] = real_data.get("weather_source", "simulated")
        results.append(result)
    return results
