"""
Real-time weather data service using Open-Meteo API (primary) and IMD API (backup).
Open-Meteo: Free, no API key needed, 10,000 req/day
IMD: Free public API, no auth for district rainfall
"""
import aiohttp
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import json

# NER district IDs for IMD API
NER_DISTRICT_IDS = {
    "Guwahati": 192, "Shillong": 186, "Imphal": 224,
    "Aizawl": 235, "Kohima": 225, "Agartala": 214,
    "Itanagar": 195, "Tawang": 196, "Dibrugarh": 189,
    "Tezpur": 190, "Silchar": 200, "Diphu": 198,
    "Haflong": 201, "Pasighat": 197, "Mokokchung": 226,
    "Lunglei": 237, "Champhai": 238, "Kolasib": 236,
    "Tamenglong": 227, "Ukhrul": 228, "Jiribam": 229,
}

OPEN_METEO_BASE = "https://api.open-meteo.com/v1"
IMD_BASE = "https://api.imd.gov.in/api/v1"
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=10)


class RealWeatherService:
    """Fetches real-time weather data from Open-Meteo and IMD APIs."""

    def __init__(self):
        self._cache: Dict[int, Dict] = {}
        self._cache_ttl = 1800  # 30 minutes

    async def get_rainfall(self, lat: float, lon: float) -> Optional[Dict]:
        """Get current rainfall, temp, humidity, wind, soil moisture from Open-Meteo."""
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "rain,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,"
                       "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
            "timezone": "Asia/Kolkata",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{OPEN_METEO_BASE}/forecast",
                    params=params,
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    current = data.get("current", {})
                    return {
                        "rainfall_mm": current.get("rain", 0),
                        "temperature_c": current.get("temperature_2m", 25),
                        "humidity_pct": current.get("relative_humidity_2m", 70),
                        "wind_speed_kmh": current.get("wind_speed_10m", 10),
                        "soil_moisture_0_7cm": current.get("soil_moisture_0_to_7cm", 0.3),
                        "soil_moisture_7_28cm": current.get("soil_moisture_7_to_28cm", 0.3),
                        "weather_code": current.get("weather_code", 0),
                        "source": "open_meteo",
                        "timestamp": datetime.utcnow().isoformat(),
                    }
        except Exception as e:
            print(f"[RealWeather] Open-Meteo error: {e}")
            return None

    async def get_antecedent_rainfall(self, lat: float, lon: float, hours: int = 24) -> float:
        """Get cumulative rainfall over past N hours."""
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "rain",
            "past_days": 7,
            "forecast_days": 0,
            "timezone": "Asia/Kolkata",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{OPEN_METEO_BASE}/forecast",
                    params=params,
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    if resp.status != 200:
                        return 0.0
                    data = await resp.json()
                    rain_data = data.get("hourly", {}).get("rain", [])
                    recent = rain_data[-hours:] if len(rain_data) >= hours else rain_data
                    return round(sum(recent), 1)
        except Exception as e:
            print(f"[RealWeather] Antecedent rainfall error: {e}")
            return 0.0

    async def get_forecast(self, lat: float, lon: float, days: int = 3) -> Optional[List[Dict]]:
        """Get hourly rainfall forecast for N days."""
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "rain,soil_moisture_0_to_7cm,temperature_2m,"
                      "relative_humidity_2m,wind_speed_10m",
            "forecast_days": days,
            "timezone": "Asia/Kolkata",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{OPEN_METEO_BASE}/forecast",
                    params=params,
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    hourly = data.get("hourly", {})
                    times = hourly.get("time", [])
                    forecasts = []
                    for i, t in enumerate(times):
                        forecasts.append({
                            "timestamp": t,
                            "rainfall_mm": hourly.get("rain", [0])[i],
                            "temperature_c": hourly.get("temperature_2m", [25])[i],
                            "humidity_pct": hourly.get("relative_humidity_2m", [70])[i],
                            "wind_speed_kmh": hourly.get("wind_speed_10m", [10])[i],
                            "soil_moisture": hourly.get("soil_moisture_0_to_7cm", [0.3])[i],
                        })
                    return forecasts
        except Exception as e:
            print(f"[RealWeather] Forecast error: {e}")
            return None

    async def get_district_rainfall(self, district_name: str) -> Optional[Dict]:
        """Get district rainfall from IMD API (backup source)."""
        district_id = NER_DISTRICT_IDS.get(district_name)
        if not district_id:
            return None
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{IMD_BASE}/districtrainfall",
                    params={"id": district_id},
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    if isinstance(data, list) and len(data) > 0:
                        d = data[0]
                        return {
                            "district": d.get("District", district_name),
                            "daily_actual_mm": float(d.get("Daily Actual", "0")),
                            "daily_normal_mm": float(d.get("Daily Normal", "0")),
                            "daily_departure": d.get("Daily Departure Per", "0%"),
                            "weekly_actual_mm": float(d.get("Weekly Actual", "0")),
                            "cumulative_actual_mm": float(d.get("Cumulative Actual", "0")),
                            "source": "imd",
                        }
        except Exception as e:
            print(f"[RealWeather] IMD API error for {district_name}: {e}")
        return None

    async def get_current_weather_imd(self, station_id: str) -> Optional[Dict]:
        """Get current weather from IMD (backup)."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{IMD_BASE}/current_wx",
                    params={"id": station_id},
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    if isinstance(data, list) and len(data) > 0:
                        d = data[0]
                        return {
                            "temperature_c": float(d.get("Temperature", 25)),
                            "humidity_pct": float(d.get("Humidity", 70)),
                            "wind_speed_kmh": float(d.get("Wind Speed", 10)),
                            "rainfall_24h_mm": float(d.get("Last 24 hrs Rainfall", 0)),
                            "weather_code": int(d.get("Weather Code", 0)),
                            "cloud_cover": int(d.get("Nebulosity", 4)),
                            "source": "imd",
                        }
        except Exception as e:
            print(f"[RealWeather] IMD current weather error: {e}")
        return None

    async def get_zone_weather(
        self, lat: float, lon: float, zone_id: int,
        district: str = "", state: str = ""
    ) -> Dict:
        """Get comprehensive weather for a zone — Open-Meteo first, IMD fallback."""
        cached = self._cache.get(zone_id)
        if cached and (datetime.utcnow() - datetime.fromisoformat(cached["timestamp"])).seconds < self._cache_ttl:
            return cached

        # Try Open-Meteo first
        om_data = await self.get_rainfall(lat, lon)
        antecedent = await self.get_antecedent_rainfall(lat, lon, hours=24)

        if om_data:
            result = {
                "zone_id": zone_id,
                "latitude": lat,
                "longitude": lon,
                "rainfall_mm_h": om_data["rainfall_mm"],
                "antecedent_rainfall_24h": antecedent,
                "temperature_c": om_data["temperature_c"],
                "humidity_pct": om_data["humidity_pct"],
                "wind_speed_kmh": om_data["wind_speed_kmh"],
                "soil_moisture": om_data["soil_moisture_0_7cm"],
                "storm_active": om_data["weather_code"] >= 60,
                "source": "open_meteo",
                "timestamp": datetime.utcnow().isoformat(),
            }
            self._cache[zone_id] = result
            return result

        # Fallback to IMD
        imd_data = await self.get_current_weather_imd(district)
        if imd_data:
            result = {
                "zone_id": zone_id,
                "latitude": lat,
                "longitude": lon,
                "rainfall_mm_h": imd_data["rainfall_24h_mm"] / 24,
                "antecedent_rainfall_24h": imd_data["rainfall_24h_mm"],
                "temperature_c": imd_data["temperature_c"],
                "humidity_pct": imd_data["humidity_pct"],
                "wind_speed_kmh": imd_data["wind_speed_kmh"],
                "soil_moisture": 0.3,
                "storm_active": imd_data["weather_code"] >= 60,
                "source": "imd",
                "timestamp": datetime.utcnow().isoformat(),
            }
            self._cache[zone_id] = result
            return result

        return {
            "zone_id": zone_id, "source": "unavailable",
            "timestamp": datetime.utcnow().isoformat(),
        }

    async def health_check(self) -> Dict:
        """Check connectivity to weather APIs. Returns top-level 'status' key."""
        om_status = "error"
        imd_status = "error"
        # Test Open-Meteo
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{OPEN_METEO_BASE}/forecast",
                    params={"latitude": 25.5, "longitude": 93.0, "current": "rain"},
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    om_status = "ok" if resp.status == 200 else "error"
        except Exception:
            om_status = "error"
        # Test IMD
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{IMD_BASE}/districtrainfall",
                    params={"id": 192},
                    timeout=REQUEST_TIMEOUT,
                ) as resp:
                    imd_status = "ok" if resp.status == 200 else "error"
        except Exception:
            imd_status = "error"

        overall = "ok" if om_status == "ok" else "degraded"
        return {
            "status": overall,
            "open_meteo": om_status,
            "imd": imd_status,
            "source": "real_apis",
        }


real_weather_service = RealWeatherService()
