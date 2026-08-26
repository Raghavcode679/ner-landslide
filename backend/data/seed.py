"""
Seed the database with realistic NER landslide-prone zones, sensors, roads, villages.
Covers: Assam, Arunachal Pradesh, Manipur, Mizoram, Nagaland, Meghalaya, Tripura.
"""
from datetime import datetime, timedelta
import random
from models.database import (
    SessionLocal, Zone, Sensor, Road, Village, WeatherData,
    LandslideEvent, RiskLevel, RoadStatus, init_db
)

NER_ZONES = [
    {"name": "Cherrapunji Slope", "district": "East Khasi Hills", "state": "Meghalaya", "lat": 25.2971, "lon": 91.7527, "elev": 1484, "slope": 42, "soil": "sandy_loam", "veg": 0.35},
    {"name": "Mawsynram Ridge", "district": "East Khasi Hills", "state": "Meghalaya", "lat": 25.2957, "lon": 91.5846, "elev": 1401, "slope": 38, "soil": "sandy_loam", "veg": 0.30},
    {"name": "Tawang Valley", "district": "Tawang", "state": "Arunachal Pradesh", "lat": 27.5856, "lon": 91.8690, "elev": 3048, "slope": 55, "soil": "rocky", "veg": 0.25},
    {"name": "Ziro Valley", "district": "Lower Subansiri", "state": "Arunachal Pradesh", "lat": 27.6256, "lon": 93.8322, "elev": 1688, "slope": 35, "soil": "clay", "veg": 0.55},
    {"name": "Dzükou Valley", "district": "Kohima", "state": "Nagaland", "lat": 25.7134, "lon": 94.0875, "elev": 2438, "slope": 48, "soil": "sandy_clay", "veg": 0.40},
    {"name": "Tamenglong Hills", "district": "Tamenglong", "state": "Manipur", "lat": 24.9873, "lon": 93.4952, "elev": 900, "slope": 45, "soil": "clay_loam", "veg": 0.45},
    {"name": "Aizawl Slopes", "district": "Aizawl", "state": "Mizoram", "lat": 23.7271, "lon": 92.7177, "elev": 1090, "slope": 50, "soil": "sandy_loam", "veg": 0.30},
    {"name": "Lunglei Ridge", "district": "Lunglei", "state": "Mizoram", "lat": 22.2075, "lon": 92.7430, "elev": 750, "slope": 40, "soil": "sandy_clay", "veg": 0.35},
    {"name": "Jiribam Hills", "district": "Jiribam", "state": "Manipur", "lat": 24.8167, "lon": 93.1333, "elev": 200, "slope": 30, "soil": "alluvial", "veg": 0.50},
    {"name": "Dibrugarh Bank", "district": "Dibrugarh", "state": "Assam", "lat": 27.4728, "lon": 94.9120, "elev": 108, "slope": 8, "soil": "alluvial", "veg": 0.60},
    {"name": "Guwahati Hills", "district": "Kamrup Metropolitan", "state": "Assam", "lat": 26.1445, "lon": 91.7362, "elev": 55, "slope": 25, "soil": "sandy_loam", "veg": 0.40},
    {"name": "Tezpur Bank", "district": "Sonitpur", "state": "Assam", "lat": 26.6323, "lon": 92.7933, "elev": 72, "slope": 12, "soil": "alluvial", "veg": 0.55},
    {"name": "Itanagar Slopes", "district": "Papum Pare", "state": "Arunachal Pradesh", "lat": 27.1044, "lon": 93.6920, "elev": 340, "slope": 32, "soil": "clay_loam", "veg": 0.48},
    {"name": "Imphal Valley Edge", "district": "Imphal East", "state": "Manipur", "lat": 24.8100, "lon": 93.9400, "elev": 786, "slope": 35, "soil": "sandy_loam", "veg": 0.38},
    {"name": "Shillong Plateau", "district": "East Khasi Hills", "state": "Meghalaya", "lat": 25.5788, "lon": 91.8933, "elev": 1525, "slope": 28, "soil": "sandy_loam", "veg": 0.42},
    {"name": "Agartala Foothills", "district": "West Tripura", "state": "Tripura", "lat": 23.8315, "lon": 91.2869, "elev": 15, "slope": 5, "soil": "alluvial", "veg": 0.65},
    {"name": "Silchar Hills", "district": "Cachar", "state": "Assam", "lat": 24.8333, "lon": 92.7833, "elev": 23, "slope": 15, "soil": "alluvial", "veg": 0.50},
    {"name": "Pasighat Bank", "district": "East Siang", "state": "Arunachal Pradesh", "lat": 28.0665, "lon": 95.3260, "elev": 155, "slope": 18, "soil": "sandy_clay", "veg": 0.52},
    {"name": "Kohima Slopes", "district": "Kohima", "state": "Nagaland", "lat": 25.6586, "lon": 94.1086, "elev": 1444, "slope": 40, "soil": "sandy_loam", "veg": 0.35},
    {"name": "Mokokchung Ridge", "district": "Mokokchung", "state": "Nagaland", "lat": 26.3243, "lon": 94.5636, "elev": 1190, "slope": 36, "soil": "clay_loam", "veg": 0.40},
    {"name": "Kolasib Valley", "district": "Kolasib", "state": "Mizoram", "lat": 24.2200, "lon": 92.6100, "elev": 500, "slope": 28, "soil": "sandy_clay", "veg": 0.55},
    {"name": "Diphu Hills", "district": "Karbi Anglong", "state": "Assam", "lat": 25.8440, "lon": 93.4310, "elev": 200, "slope": 22, "soil": "clay", "veg": 0.45},
    {"name": "Udalguri Slopes", "district": "Udalguri", "state": "Assam", "lat": 26.7509, "lon": 92.1020, "elev": 120, "slope": 18, "soil": "clay_loam", "veg": 0.50},
    {"name": "Champhai Ridge", "district": "Champhai", "state": "Mizoram", "lat": 23.4746, "lon": 93.3286, "elev": 930, "slope": 44, "soil": "sandy_loam", "veg": 0.32},
]

NER_ROADS = [
    {"name": "NH-6 (Guwahati-Shillong)", "type": "national_highway", "from": "Guwahati", "to": "Shillong", "lat": 25.9650, "lon": 91.8500},
    {"name": "NH-37 (Assam Trunk Road)", "type": "national_highway", "from": "Dibrugarh", "to": "Guwahati", "lat": 26.5000, "lon": 93.0000},
    {"name": "NH-29 (Dimapur-Kohima)", "type": "national_highway", "from": "Dimapur", "to": "Kohima", "lat": 25.9000, "lon": 93.7000},
    {"name": "NH-154 (Aizawl-Tripura)", "type": "national_highway", "from": "Aizawl", "to": "Agartala", "lat": 23.7800, "lon": 92.4000},
    {"name": "SH-1 (Tawang Road)", "type": "state_highway", "from": "Bomdila", "to": "Tawang", "lat": 27.4500, "lon": 92.1000},
    {"name": "SH-4 (Tamenglong Road)", "type": "state_highway", "from": "Imphal", "to": "Tamenglong", "lat": 24.6000, "lon": 93.5000},
    {"name": "NH-102 (Imphal-Jiribam)", "type": "national_highway", "from": "Imphal", "to": "Jiribam", "lat": 24.8200, "lon": 93.5000},
    {"name": "DH-4 (Lunglei Road)", "type": "district_road", "from": "Aizawl", "to": "Lunglei", "lat": 23.1000, "lon": 92.7300},
    {"name": "NH-44 (Shillong-Dawki)", "type": "national_highway", "from": "Shillong", "to": "Dawki", "lat": 25.2000, "lon": 92.0000},
    {"name": "SH-10 (Cherrapunji Road)", "type": "state_highway", "from": "Shillong", "to": "Cherrapunji", "lat": 25.3500, "lon": 91.7000},
    {"name": "NH-2 (Itanagar Road)", "type": "national_highway", "from": "Lakhimpur", "to": "Itanagar", "lat": 27.1500, "lon": 93.8000},
    {"name": "DH-7 (Mokokchung Road)", "type": "district_road", "from": "Kohima", "to": "Mokokchung", "lat": 26.1000, "lon": 94.3000},
]

NER_VILLAGES = [
    {"name": "Laitryngew", "district": "East Khasi Hills", "state": "Meghalaya", "lat": 25.3100, "lon": 91.7700, "pop": 3200},
    {"name": "Mawphlang", "district": "East Khasi Hills", "state": "Meghalaya", "lat": 25.4700, "lon": 91.7900, "pop": 1800},
    {"name": "Dirang", "district": "West Kameng", "state": "Arunachal Pradesh", "lat": 27.3500, "lon": 92.2300, "pop": 4500},
    {"name": "Ziro", "district": "Lower Subansiri", "state": "Arunachal Pradesh", "lat": 27.6300, "lon": 93.8400, "pop": 12000},
    {"name": "Pfutsero", "district": "Phek", "state": "Nagaland", "lat": 25.5500, "lon": 94.0200, "pop": 8000},
    {"name": "Thanlon", "district": "Churachandpur", "state": "Manipur", "lat": 24.3700, "lon": 93.3400, "pop": 2100},
    {"name": "Thenzawl", "district": "Serchhip", "state": "Mizoram", "lat": 23.3200, "lon": 92.8500, "pop": 5500},
    {"name": "Saitual", "district": "Champhai", "state": "Mizoram", "lat": 23.5700, "lon": 93.2500, "pop": 3800},
    {"name": "Haflong", "district": "Dima Hasao", "state": "Assam", "lat": 25.1700, "lon": 93.0200, "pop": 15000},
    {"name": "Bomdila", "district": "West Kameng", "state": "Arunachal Pradesh", "lat": 27.2600, "lon": 92.4200, "pop": 7000},
    {"name": "Mokokchung Town", "district": "Mokokchung", "state": "Nagaland", "lat": 26.3200, "lon": 94.5600, "pop": 35000},
    {"name": "Ukhrul", "district": "Ukhrul", "state": "Manipur", "lat": 25.1200, "lon": 94.3700, "pop": 15000},
    {"name": "Champhai Town", "district": "Champhai", "state": "Mizoram", "lat": 23.4700, "lon": 93.3300, "pop": 30000},
    {"name": "Kohima Town", "district": "Kohima", "state": "Nagaland", "lat": 25.6600, "lon": 94.1100, "pop": 100000},
]


def compute_initial_risk(zone_data):
    """Compute initial risk score from terrain parameters."""
    score = 0
    # Slope contribution (0-40 points)
    score += min(zone_data["slope"] * 0.7, 40)
    # Soil type contribution
    soil_risk = {"rocky": 15, "sandy_clay": 12, "sandy_loam": 10, "clay_loam": 8, "clay": 5, "alluvial": 3}
    score += soil_risk.get(zone_data["soil"], 5)
    # Vegetation inverse (lower veg = higher risk)
    score += (1 - zone_data["veg"]) * 20
    # Elevation bonus for high terrain
    if zone_data["elev"] > 2000:
        score += 15
    elif zone_data["elev"] > 1000:
        score += 10
    # Random variation
    score += random.uniform(-5, 5)
    return max(0, min(100, round(score, 1)))


def risk_score_to_level(score):
    if score >= 75:
        return RiskLevel.CRITICAL
    elif score >= 50:
        return RiskLevel.HIGH
    elif score >= 30:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def seed_data():
    """Seed the database with initial NER data."""
    init_db()
    db = SessionLocal()
    try:
        # Check if already seeded
        if db.query(Zone).count() > 0:
            print("Database already seeded.")
            return

        print("Seeding NER disaster monitoring data...")

        # Seed zones
        zones = []
        for z in NER_ZONES:
            risk = compute_initial_risk(z)
            zone = Zone(
                name=z["name"], district=z["district"], state=z["state"],
                latitude=z["lat"], longitude=z["lon"], elevation_m=z["elev"],
                slope_angle_deg=z["slope"], soil_type=z["soil"],
                vegetation_cover=z["veg"], risk_level=risk_score_to_level(risk),
                risk_score=risk,
                metadata_json={"terrain": "hills", "climate_zone": "subtropical_monsoon"}
            )
            db.add(zone)
            zones.append(zone)
        db.flush()

        # Seed sensors for each zone (2-3 sensors per zone)
        sensor_types = [
            ("rainfall", "mm", 100),
            ("soil_moisture", "%", 80),
            ("tilt", "degrees", 5),
            ("gps_displacement", "mm", 50),
        ]
        for zone in zones:
            n_sensors = random.randint(2, 4)
            chosen = random.sample(sensor_types, n_sensors)
            for stype, unit, threshold in chosen:
                sensor = Sensor(
                    zone_id=zone.id, sensor_type=stype,
                    latitude=zone.latitude + random.uniform(-0.01, 0.01),
                    longitude=zone.longitude + random.uniform(-0.01, 0.01),
                    threshold=threshold, unit=unit,
                    last_reading=random.uniform(0, threshold * 0.6),
                    last_reading_time=datetime.utcnow() - timedelta(minutes=random.randint(1, 30))
                )
                db.add(sensor)
        db.flush()

        # Seed weather data (current + 24h forecast per zone)
        for zone in zones:
            for forecast_h in [0, 6, 12, 18, 24]:
                rainfall = random.uniform(0, 60) if forecast_h == 0 else random.uniform(0, 120)
                wd = WeatherData(
                    zone_id=zone.id, latitude=zone.latitude, longitude=zone.longitude,
                    rainfall_mm=rainfall,
                    temperature_c=random.uniform(18, 32),
                    humidity_pct=random.uniform(60, 98),
                    wind_speed_kmh=random.uniform(5, 45),
                    forecast_hours=forecast_h,
                    source="imd_simulated",
                    timestamp=datetime.utcnow() + timedelta(hours=forecast_h)
                )
                db.add(wd)

        # Seed roads
        roads = []
        for r in NER_ROADS:
            road = Road(
                name=r["name"], road_type=r["type"],
                from_place=r["from"], to_place=r["to"],
                latitude=r["lat"], longitude=r["lon"],
                status=random.choice([RoadStatus.OPEN, RoadStatus.OPEN, RoadStatus.OPEN, RoadStatus.PARTIAL])
            )
            db.add(road)
            roads.append(road)
        db.flush()

        # Seed villages
        for v in NER_VILLAGES:
            village = Village(
                name=v["name"], district=v["district"], state=v["state"],
                latitude=v["lat"], longitude=v["lon"], population=v["pop"],
                connectivity_status=random.choice(["connected", "connected", "partially_isolated"]),
                nearest_road_id=random.choice(roads).id if roads else None
            )
            db.add(village)

        # Seed some historical landslide events
        event_types = ["landslide", "flash_flood", "slope_failure", "road_block"]
        triggers = ["rainfall", "earthquake", "human_activity", "erosion"]
        for _ in range(8):
            zone = random.choice(zones)
            evt = LandslideEvent(
                zone_id=zone.id,
                latitude=zone.latitude + random.uniform(-0.02, 0.02),
                longitude=zone.longitude + random.uniform(-0.02, 0.02),
                severity=random.choice(list(RiskLevel)),
                event_type=random.choice(event_types),
                description=f"Event recorded at {zone.name}",
                triggered_by=random.choice(triggers),
                estimated_volume_m3=random.randint(10, 5000),
                timestamp=datetime.utcnow() - timedelta(days=random.randint(1, 180))
            )
            db.add(evt)

        db.commit()
        print(f"Seeded {len(zones)} zones, {len(roads)} roads, {len(NER_VILLAGES)} villages, sensors, weather, and events.")

        # Optionally fetch real NDVI and elevation data
        try:
            import asyncio
            from services.ndvi import ndvi_service
            from services.elevation import elevation_service
            print("Fetching real NDVI data from Sentinel-2...")
            loop = asyncio.new_event_loop()
            ndvi_map = loop.run_until_complete(ndvi_service.get_ndvi_for_zones(zones))
            updated_count = 0
            for zone in zones:
                ndvi_data = ndvi_map.get(zone.id)
                if ndvi_data and ndvi_data.get("source") == "sentinel_2":
                    zone.vegetation_cover = ndvi_service.ndvi_to_vegetation_cover(ndvi_data["ndvi"])
                    updated_count += 1
            if updated_count > 0:
                print(f"Updated {updated_count} zones with real Sentinel-2 NDVI data.")

            print("Fetching real elevation data from SRTM DEM...")
            topo_map = loop.run_until_complete(elevation_service.update_zone_slopes(zones))
            updated_elev = 0
            for zone in zones:
                topo = topo_map.get(zone.id)
                if topo and topo.get("source") == "srtm_dem":
                    zone.slope_angle_deg = topo["slope_angle_deg"]
                    zone.elevation_m = topo["elevation_m"]
                    updated_elev += 1
            if updated_elev > 0:
                print(f"Updated {updated_elev} zones with real SRTM DEM elevation/slope data.")

            db.commit()
            loop.close()
        except ImportError as e:
            print(f"Real data services not available (install aiohttp): {e}")
        except Exception as e:
            print(f"Real data fetch failed (using seed data): {e}")

    finally:
        db.close()


if __name__ == "__main__":
    seed_data()
