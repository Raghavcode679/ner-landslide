"""
SRTM DEM elevation and slope calculation service.
Uses Open-Meteo Elevation API (free, no key) backed by SRTM 30m DEM data.
Computes slope from multi-point elevation gradients.
"""
import aiohttp
import math
from datetime import datetime
from typing import Dict, List, Optional, Tuple

OPEN_METEO = "https://api.open-meteo.com/v1"
TIMEOUT = aiohttp.ClientTimeout(total=10)

# 1 degree latitude ≈ 111,320 meters
# 1 degree longitude ≈ 111,320 * cos(latitude) meters
EARTH_M_PER_DEG_LAT = 111320.0


class ElevationService:
    """Fetches real SRTM DEM elevation and computes slope angles."""

    def __init__(self):
        self._cache: Dict[str, Dict] = {}

    def _cache_key(self, lat: float, lon: float) -> str:
        return f"{round(lat, 4)},{round(lon, 4)}"

    async def get_elevation(self, lat: float, lon: float) -> Optional[float]:
        """Get elevation in meters for a single coordinate pair."""
        params = {
            "latitude": lat,
            "longitude": lon,
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{OPEN_METEO}/elevation",
                    params=params,
                    timeout=TIMEOUT,
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    elevations = data.get("elevation", [])
                    if elevations and len(elevations) > 0:
                        return round(elevations[0], 1)
        except Exception as e:
            print(f"[Elevation] Error fetching elevation: {e}")
        return None

    async def get_elevations_batch(self, coords: List[Tuple[float, float]]) -> List[Optional[float]]:
        """Batch fetch elevations for multiple coordinate pairs."""
        if not coords:
            return []

        # Open-Meteo supports multiple lat/lon in one request
        lats = [c[0] for c in coords]
        lons = [c[1] for c in coords]

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{OPEN_METEO}/elevation",
                    params={
                        "latitude": ",".join(str(l) for l in lats),
                        "longitude": ",".join(str(l) for l in lons),
                    },
                    timeout=TIMEOUT,
                ) as resp:
                    if resp.status != 200:
                        return [None] * len(coords)
                    data = await resp.json()
                    elevations = data.get("elevation", [])
                    return [round(e, 1) if e is not None else None for e in elevations]
        except Exception as e:
            print(f"[Elevation] Batch error: {e}")
            return [None] * len(coords)

    async def compute_slope(self, lat: float, lon: float, resolution_m: float = 100.0) -> Optional[Dict]:
        """
        Compute slope angle from elevation gradient using 4 cardinal neighbors.
        
        Fetches elevation at center point + 4 neighbors at `resolution_m` offset.
        Computes maximum gradient slope in degrees.
        
        Returns: {
            "slope_angle_deg": float,
            "elevation_m": float,
            "elevation_n": float, "elevation_s": float,
            "elevation_e": float, "elevation_w": float,
            "method": "srtm_4point_gradient"
        }
        """
        # Calculate offset in degrees
        lat_offset = resolution_m / EARTH_M_PER_DEG_LAT
        lon_offset = resolution_m / (EARTH_M_PER_DEG_LAT * math.cos(math.radians(lat)))

        # 5 points: center + N, S, E, W
        points = [
            (lat, lon),                    # center
            (lat + lat_offset, lon),       # north
            (lat - lat_offset, lon),       # south
            (lat, lon + lon_offset),       # east
            (lat, lon - lon_offset),       # west
        ]

        elevations = await self.get_elevations_batch(points)

        if elevations[0] is None:
            return None

        center_elev = elevations[0]
        n_elev = elevations[1] if elevations[1] is not None else center_elev
        s_elev = elevations[2] if elevations[2] is not None else center_elev
        e_elev = elevations[3] if elevations[3] is not None else center_elev
        w_elev = elevations[4] if elevations[4] is not None else center_elev

        # Compute gradient in N-S and E-W directions
        ns_diff = abs(n_elev - s_elev)
        ew_diff = abs(e_elev - w_elev)
        ns_slope_rad = math.atan(ns_diff / (2 * resolution_m))
        ew_slope_rad = math.atan(ew_diff / (2 * resolution_m))

        # Maximum slope angle
        max_slope_rad = max(ns_slope_rad, ew_slope_rad)
        slope_deg = math.degrees(max_slope_rad)

        # Also compute aspect (direction of steepest slope)
        ns_gradient = (n_elev - s_elev) / (2 * resolution_m)
        ew_gradient = (e_elev - w_elev) / (2 * resolution_m)
        aspect = math.degrees(math.atan2(ew_gradient, ns_gradient))
        if aspect < 0:
            aspect += 360

        result = {
            "slope_angle_deg": round(min(slope_deg, 90), 2),
            "elevation_m": round(center_elev, 1),
            "elevation_n": round(n_elev, 1),
            "elevation_s": round(s_elev, 1),
            "elevation_e": round(e_elev, 1),
            "elevation_w": round(w_elev, 1),
            "aspect_deg": round(aspect, 1),
            "resolution_m": resolution_m,
            "method": "srtm_4point_gradient",
            "source": "srtm_dem",
            "timestamp": datetime.utcnow().isoformat(),
        }

        key = self._cache_key(lat, lon)
        self._cache[key] = result
        return result

    async def update_zone_slopes(self, zones: list) -> Dict[int, Dict]:
        """Batch compute slope and elevation for all zones."""
        results = {}
        for zone in zones:
            key = self._cache_key(zone.latitude, zone.longitude)
            cached = self._cache.get(key)
            if cached:
                results[zone.id] = cached
                continue

            slope_data = await self.compute_slope(zone.latitude, zone.longitude)
            if slope_data:
                results[zone.id] = slope_data
            else:
                # Fallback to existing zone data
                results[zone.id] = {
                    "slope_angle_deg": zone.slope_angle_deg,
                    "elevation_m": zone.elevation_m,
                    "source": "seed_data",
                    "method": "fallback",
                }
        return results

    async def get_zone_topography(self, lat: float, lon: float) -> Dict:
        """Get comprehensive topographic data for a zone."""
        slope_data = await self.compute_slope(lat, lon)
        if not slope_data:
            elev = await self.get_elevation(lat, lon)
            return {
                "elevation_m": elev or 0,
                "slope_angle_deg": 0,
                "source": "partial",
            }
        return slope_data

    async def health_check(self) -> Dict:
        """Check connectivity to elevation API."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{OPEN_METEO}/elevation",
                    params={"latitude": 25.5, "longitude": 93.0},
                    timeout=TIMEOUT,
                ) as resp:
                    return {"status": "ok" if resp.status == 200 else "error", "code": resp.status}
        except Exception as e:
            return {"status": "error", "error": str(e)}


elevation_service = ElevationService()
