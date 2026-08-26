"""
Weather data service — real APIs (Open-Meteo, IMD) with simulation fallback.
Primary: RealWeatherService (real_weather.py)
Fallback: WeatherSimulator (this file)
"""
import math
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional


# Monsoon month patterns (1-12) — probability of heavy rain
MONSOON_INTENSITY = {
    1: 0.1, 2: 0.1, 3: 0.2, 4: 0.3, 5: 0.5,
    6: 0.8, 7: 0.95, 8: 0.9, 9: 0.7, 10: 0.4,
    11: 0.15, 12: 0.1,
}

# Zone-specific weather profiles
ZONE_PROFILES = {
    "Meghalaya": {"base_rainfall": 40, "temp_range": (18, 28), "humidity_base": 85},
    "Arunachal Pradesh": {"base_rainfall": 25, "temp_range": (12, 25), "humidity_base": 75},
    "Nagaland": {"base_rainfall": 30, "temp_range": (15, 28), "humidity_base": 80},
    "Manipur": {"base_rainfall": 28, "temp_range": (16, 30), "humidity_base": 78},
    "Mizoram": {"base_rainfall": 35, "temp_range": (18, 32), "humidity_base": 82},
    "Assam": {"base_rainfall": 30, "temp_range": (20, 35), "humidity_base": 80},
    "Tripura": {"base_rainfall": 25, "temp_range": (22, 34), "humidity_base": 78},
}


class WeatherSimulator:
    """Generates realistic weather data for NER zones."""

    def __init__(self):
        self._state = {}  # zone_id -> last_state for continuity

    def _get_state(self, zone_id: int) -> Dict:
        if zone_id not in self._state:
            self._state[zone_id] = {
                "rainfall": random.uniform(0, 20),
                "temperature": random.uniform(20, 30),
                "humidity": random.uniform(60, 90),
                "wind": random.uniform(5, 20),
                "storm_active": False,
                "storm_duration": 0,
            }
        return self._state[zone_id]

    def generate_current_weather(
        self, zone_id: int, state: str, latitude: float
    ) -> Dict:
        """Generate current weather for a zone."""
        s = self._get_state(zone_id)
        profile = ZONE_PROFILES.get(state, ZONE_PROFILES["Assam"])
        month = datetime.utcnow().month
        monsoon_factor = MONSOON_INTENSITY.get(month, 0.3)

        # Storm simulation
        if s["storm_active"]:
            s["storm_duration"] -= 1
            if s["storm_duration"] <= 0:
                s["storm_active"] = False
        elif random.random() < 0.05 * monsoon_factor:
            s["storm_active"] = True
            s["storm_duration"] = random.randint(3, 12)

        # Rainfall
        if s["storm_active"]:
            s["rainfall"] = max(0, s["rainfall"] + random.uniform(5, 40))
            s["rainfall"] = min(s["rainfall"], 150)
        else:
            s["rainfall"] = max(0, s["rainfall"] + random.uniform(-8, 5))
            s["rainfall"] = min(s["rainfall"], 50)

        base_rain = profile["base_rainfall"] * monsoon_factor
        actual_rainfall = s["rainfall"] + base_rain * 0.3

        # Temperature (inversely correlated with rainfall)
        temp_min, temp_max = profile["temp_range"]
        s["temperature"] += random.uniform(-1, 1)
        s["temperature"] = max(temp_min, min(temp_max, s["temperature"]))
        if actual_rainfall > 30:
            s["temperature"] -= 2

        # Humidity
        s["humidity"] += random.uniform(-3, 3)
        s["humidity"] = max(40, min(99, s["humidity"]))
        if actual_rainfall > 20:
            s["humidity"] = min(99, s["humidity"] + 5)

        # Wind
        s["wind"] += random.uniform(-3, 3)
        s["wind"] = max(0, min(80, s["wind"]))
        if s["storm_active"]:
            s["wind"] = min(80, s["wind"] + random.uniform(5, 15))

        return {
            "rainfall_mm": round(actual_rainfall, 1),
            "temperature_c": round(s["temperature"], 1),
            "humidity_pct": round(s["humidity"], 1),
            "wind_speed_kmh": round(s["wind"], 1),
            "storm_active": s["storm_active"],
            "monsoon_intensity": round(monsoon_factor, 2),
            "source": "imd_simulated",
        }

    def generate_forecast(
        self, zone_id: int, state: str, latitude: float, hours_ahead: int = 24
    ) -> List[Dict]:
        """Generate hourly forecast."""
        forecasts = []
        s = self._get_state(zone_id)
        profile = ZONE_PROFILES.get(state, ZONE_PROFILES["Assam"])
        month = datetime.utcnow().month
        monsoon_factor = MONSOON_INTENSITY.get(month, 0.3)

        for h in range(1, hours_ahead + 1):
            # Forecast gets less certain further out
            uncertainty = 0.1 + (h / hours_ahead) * 0.4
            forecast_rain = max(0, s["rainfall"] + random.uniform(
                -20 * uncertainty, 30 * uncertainty
            ))
            forecast_rain *= monsoon_factor

            forecasts.append({
                "hour": h,
                "timestamp": (datetime.utcnow() + timedelta(hours=h)).isoformat(),
                "rainfall_mm": round(forecast_rain, 1),
                "temperature_c": round(s["temperature"] + random.uniform(-2, 2), 1),
                "humidity_pct": round(min(99, max(40, s["humidity"] + random.uniform(-5, 5))), 1),
                "wind_speed_kmh": round(max(0, s["wind"] + random.uniform(-5, 5)), 1),
                "confidence": round(max(0.3, 1 - uncertainty), 2),
            })
        return forecasts

    def calculate_antecedent_rainfall(
        self, zone_id: int, hours: int = 24
    ) -> float:
        """Estimate antecedent (past N hours) cumulative rainfall."""
        s = self._get_state(zone_id)
        base = s["rainfall"]
        # Rough estimation
        return round(base * hours * 0.3 + random.uniform(0, 10), 1)


weather_simulator = WeatherSimulator()


# ---------- Hybrid Weather Service ----------
try:
    from services.real_weather import real_weather_service
    REAL_WEATHER_AVAILABLE = True
except ImportError:
    REAL_WEATHER_AVAILABLE = False


class HybridWeatherService:
    """Uses real API first, falls back to simulation."""

    def __init__(self):
        self.real = real_weather_service if REAL_WEATHER_AVAILABLE else None
        self.sim = weather_simulator
        self._data_source = "simulated"  # tracks last source used

    async def get_zone_weather(self, zone_id: int, latitude: float, longitude: float,
                               district: str = "", state: str = "") -> Dict:
        """Get weather — real API first, simulation fallback."""
        if self.real:
            try:
                result = await self.real.get_zone_weather(
                    latitude, longitude, zone_id, district, state
                )
                if result.get("source") != "unavailable":
                    self._data_source = result.get("source", "real")
                    return result
            except Exception as e:
                print(f"[HybridWeather] Real API failed: {e}")

        # Fallback to simulation
        self._data_source = "simulated"
        sim_data = self.sim.generate_current_weather(zone_id, state, latitude)
        antecedent = self.sim.calculate_antecedent_rainfall(zone_id)
        return {
            "zone_id": zone_id,
            "latitude": latitude,
            "longitude": longitude,
            "rainfall_mm_h": sim_data["rainfall_mm"],
            "antecedent_rainfall_24h": antecedent,
            "temperature_c": sim_data["temperature_c"],
            "humidity_pct": sim_data["humidity_pct"],
            "wind_speed_kmh": sim_data["wind_speed_kmh"],
            "soil_moisture": 0.3,
            "storm_active": sim_data["storm_active"],
            "source": "simulated",
            "timestamp": datetime.utcnow().isoformat(),
        }

    async def get_forecast(self, latitude: float, longitude: float,
                           district: str = "", state: str = "", days: int = 3) -> List[Dict]:
        if self.real:
            try:
                result = await self.real.get_forecast(latitude, longitude, days)
                if result:
                    return result
            except Exception:
                pass
        return self.sim.generate_forecast(0, state, latitude, days * 24)

    @property
    def data_source(self) -> str:
        return self._data_source


hybrid_weather = HybridWeatherService()
