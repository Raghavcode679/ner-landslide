"""
NER Landslide Early Warning System — FastAPI Backend

Endpoints:
  GET  /api/zones                  — All monitored zones with risk data
  GET  /api/zones/{id}             — Single zone detail
  GET  /api/dashboard              — Aggregated dashboard data
  GET  /api/predictions            — Run ML predictions for all zones
  GET  /api/weather/{zone_id}      — Current weather + forecast
  GET  /api/roads                  — Road connectivity status
  GET  /api/villages               — Village data
  GET  /api/alerts                 — Active alerts
  POST /api/alerts                 — Create new alert
  POST /api/reports                — Submit citizen report
  GET  /api/reports                — List reports
  GET  /api/heatmap                — GeoJSON risk heatmap data
  GET  /api/stats                  — Summary statistics
  WS   /ws/alerts                  — Real-time alert stream
"""
import asyncio
import json
import random
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, UploadFile, File, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func

from models.database import (
    init_db, get_db, SessionLocal,
    Zone, Sensor, SensorReading, WeatherData, LandslideEvent,
    Report, Alert, Road, Village, NotificationLog,
    RiskLevel, AlertStatus, RoadStatus,
)
from data.seed import seed_data
from ml.predictor import predict_landslide_risk, batch_predict, simulate_realtime_update
from services.notifications import notification_service
from services.weather import weather_simulator

app = FastAPI(
    title="NER Landslide Early Warning System",
    description="AI-powered disaster monitoring for North Eastern Region",
    version="1.0.0",
)

# ---------- Admin auth ----------
ADMIN_PASSWORD = "admin123"  # In production, use hashed passwords and proper auth

@app.post("/api/admin/login")
def admin_login(password: str = Form(...)):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    return {"authenticated": True, "role": "admin", "token": "admin-token-verified"}

@app.get("/api/admin/verify")
def admin_verify(authorization: Optional[str] = Header(None)):
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"authenticated": True, "role": "admin"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    seed_data()
    # Pre-warm data source health checks in background
    if REAL_DATA_IMPORTS:
        async def _warmup():
            try:
                await real_weather_service.health_check()
                print("[startup] Open-Meteo health check: OK")
            except: print("[startup] Open-Meteo health check: FAILED")
            try:
                await elevation_service.health_check()
                print("[startup] SRTM DEM health check: OK")
            except: print("[startup] SRTM DEM health check: FAILED")
            try:
                ndvi_service.health_check()
                print("[startup] NDVI health check: OK")
            except: print("[startup] NDVI health check: FAILED")
        asyncio.ensure_future(_warmup())


# ---------- WebSocket manager ----------
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        for ws in self.active[:]:
            try:
                await ws.send_json(data)
            except Exception:
                self.active.remove(ws)

manager = ConnectionManager()


# ---------- Helper ----------
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ============ ZONE ENDPOINTS ============

@app.get("/api/zones")
def get_zones(
    state: Optional[str] = None,
    risk_level: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Zone)
    if state:
        q = q.filter(Zone.state == state)
    if risk_level:
        q = q.filter(Zone.risk_level == RiskLevel(risk_level))
    zones = q.all()
    return [{
        "id": z.id, "name": z.name, "district": z.district, "state": z.state,
        "latitude": z.latitude, "longitude": z.longitude,
        "elevation_m": z.elevation_m, "slope_angle_deg": z.slope_angle_deg,
        "soil_type": z.soil_type, "vegetation_cover": z.vegetation_cover,
        "risk_level": z.risk_level.value, "risk_score": z.risk_score,
        "last_assessed": z.last_assessed.isoformat() if z.last_assessed else None,
        "sensor_count": len(z.sensors),
        "active_alerts": len([a for a in z.alerts if a.status == AlertStatus.ACTIVE]),
    } for z in zones]


@app.get("/api/zones/{zone_id}")
def get_zone(zone_id: int, db: Session = Depends(get_db)):
    z = db.query(Zone).filter(Zone.id == zone_id).first()
    if not z:
        return {"error": "Zone not found"}, 404
    sensors = [{
        "id": s.id, "type": s.sensor_type, "last_reading": s.last_reading,
        "unit": s.unit, "threshold": s.threshold,
        "last_reading_time": s.last_reading_time.isoformat() if s.last_reading_time else None,
    } for s in z.sensors]
    return {
        "id": z.id, "name": z.name, "district": z.district, "state": z.state,
        "latitude": z.latitude, "longitude": z.longitude,
        "elevation_m": z.elevation_m, "slope_angle_deg": z.slope_angle_deg,
        "soil_type": z.soil_type, "vegetation_cover": z.vegetation_cover,
        "risk_level": z.risk_level.value, "risk_score": z.risk_score,
        "sensors": sensors,
    }


# ============ DASHBOARD ============

@app.get("/api/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    zones = db.query(Zone).all()
    roads = db.query(Road).all()
    alerts = db.query(Alert).filter(Alert.status == AlertStatus.ACTIVE).all()
    villages = db.query(Village).all()

    risk_distribution = {"low": 0, "moderate": 0, "high": 0, "critical": 0}
    for z in zones:
        risk_distribution[z.risk_level.value] += 1

    road_status = {"open": 0, "blocked": 0, "partial": 0, "damaged": 0}
    for r in roads:
        road_status[r.status.value] += 1

    village_connectivity = {"connected": 0, "isolated": 0, "partially_isolated": 0}
    for v in villages:
        key = v.connectivity_status.replace(" ", "_")
        if key in village_connectivity:
            village_connectivity[key] += 1

    return {
        "summary": {
            "total_zones": len(zones),
            "critical_zones": risk_distribution["critical"],
            "high_risk_zones": risk_distribution["high"],
            "active_alerts": len(alerts),
            "total_villages": len(villages),
            "isolated_villages": village_connectivity.get("isolated", 0) + village_connectivity.get("partially_isolated", 0),
            "roads_blocked": road_status.get("blocked", 0) + road_status.get("partial", 0),
            "avg_risk_score": round(sum(z.risk_score for z in zones) / max(len(zones), 1), 1),
        },
        "risk_distribution": risk_distribution,
        "road_status": road_status,
        "village_connectivity": village_connectivity,
        "recent_alerts": [{
            "id": a.id, "title": a.title, "risk_level": a.risk_level.value,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        } for a in sorted(alerts, key=lambda x: x.created_at or datetime.min, reverse=True)[:5]],
        "top_risk_zones": [{
            "id": z.id, "name": z.name, "risk_score": z.risk_score,
            "risk_level": z.risk_level.value, "district": z.district,
        } for z in sorted(zones, key=lambda x: x.risk_score, reverse=True)[:5]],
    }


# ============ PREDICTIONS ============

@app.get("/api/predictions")
def run_predictions(db: Session = Depends(get_db)):
    zones = db.query(Zone).all()
    results = []
    for z in zones:
        # Gather sensor data
        sensor_readings = {}
        sensor_thresholds = {}
        for s in z.sensors:
            # Simulate recent readings
            readings = [s.last_reading + random.uniform(-5, 5) for _ in range(10)]
            sensor_readings[s.sensor_type] = readings
            sensor_thresholds[s.sensor_type] = s.threshold

        # Weather
        wd = db.query(WeatherData).filter(
            WeatherData.zone_id == z.id, WeatherData.forecast_hours == 0
        ).first()
        rainfall = wd.rainfall_mm if wd else random.uniform(0, 30)
        antecedent = weather_simulator.calculate_antecedent_rainfall(z.id)

        # Historical events
        event_count = db.query(LandslideEvent).filter(
            LandslideEvent.zone_id == z.id,
            LandslideEvent.timestamp >= datetime.utcnow() - timedelta(days=365)
        ).count()

        prediction = predict_landslide_risk(
            slope_angle=z.slope_angle_deg,
            soil_type=z.soil_type,
            vegetation_cover=z.vegetation_cover,
            rainfall_mm_h=rainfall,
            antecedent_rainfall_24h=antecedent,
            sensor_readings=sensor_readings,
            sensor_thresholds=sensor_thresholds,
            historical_events_12m=event_count,
        )

        # Update zone risk in DB
        z.risk_score = prediction["risk_score"]
        z.risk_level = RiskLevel(prediction["risk_level"])
        z.last_assessed = datetime.utcnow()

        results.append({
            "zone_id": z.id,
            "zone_name": z.name,
            "district": z.district,
            "state": z.state,
            "latitude": z.latitude,
            "longitude": z.longitude,
            **prediction,
        })

    db.commit()

    # Auto-generate alerts for critical zones
    for r in results:
        if r["risk_level"] in ("critical", "high"):
            existing = db.query(Alert).filter(
                Alert.zone_id == r["zone_id"],
                Alert.status == AlertStatus.ACTIVE,
            ).first()
            if not existing:
                alert = notification_service.create_alert(
                    db=db,
                    zone_id=r["zone_id"],
                    zone_name=r["zone_name"],
                    risk_level=r["risk_level"],
                    risk_score=r["risk_score"],
                    latitude=r["latitude"],
                    longitude=r["longitude"],
                )
                notification_service.send_multilingual_notifications(
                    db=db, alert=alert, zone_name=r["zone_name"]
                )
                # Note: WebSocket broadcast happens on next request cycle via manager
    db.commit()

    return {"predictions": results, "timestamp": datetime.utcnow().isoformat()}


# ============ WEATHER ============

@app.get("/api/weather/{zone_id}")
def get_weather(zone_id: int, db: Session = Depends(get_db)):
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        return {"error": "Zone not found"}, 404
    current = weather_simulator.generate_current_weather(zone.id, zone.state, zone.latitude)
    forecast = weather_simulator.generate_forecast(zone.id, zone.state, zone.latitude)
    return {
        "zone_id": zone.id,
        "zone_name": zone.name,
        "current": current,
        "forecast": forecast,
    }


# ============ ROADS ============

@app.get("/api/roads")
def get_roads(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Road)
    if status:
        q = q.filter(Road.status == RoadStatus(status))
    roads = q.all()
    return [{
        "id": r.id, "name": r.name, "road_type": r.road_type,
        "from_place": r.from_place, "to_place": r.to_place,
        "latitude": r.latitude, "longitude": r.longitude,
        "status": r.status.value,
        "last_updated": r.last_updated.isoformat() if r.last_updated else None,
    } for r in roads]


# ============ VILLAGES ============

@app.get("/api/villages")
def get_villages(db: Session = Depends(get_db)):
    villages = db.query(Village).all()
    return [{
        "id": v.id, "name": v.name, "district": v.district, "state": v.state,
        "latitude": v.latitude, "longitude": v.longitude,
        "population": v.population,
        "connectivity_status": v.connectivity_status,
    } for v in villages]


# ============ ALERTS ============

@app.get("/api/alerts")
def get_alerts(
    status: Optional[str] = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(Alert)
    if status:
        q = q.filter(Alert.status == AlertStatus(status))
    alerts = q.order_by(Alert.created_at.desc()).limit(limit).all()
    return [{
        "id": a.id, "title": a.title, "message": a.message,
        "risk_level": a.risk_level.value, "status": a.status.value,
        "target_audience": a.target_audience, "channels": a.channels,
        "latitude": a.latitude, "longitude": a.longitude,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "zone_id": a.zone_id,
    } for a in alerts]


@app.post("/api/alerts")
def create_alert(
    zone_id: Optional[int] = None,
    title: str = "",
    message: str = "",
    risk_level: str = "high",
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    db: Session = Depends(get_db),
):
    zone = db.query(Zone).filter(Zone.id == zone_id).first() if zone_id else None
    alert = notification_service.create_alert(
        db=db, zone_id=zone_id,
        zone_name=zone.name if zone else "General",
        risk_level=risk_level, risk_score=0,
        latitude=latitude or (zone.latitude if zone else None),
        longitude=longitude or (zone.longitude if zone else None),
    )
    if title:
        alert.title = title
    if message:
        alert.message = message
    db.commit()
    return {"alert_id": alert.id, "status": "created"}


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if alert:
        alert.status = AlertStatus.ACKNOWLEDGED
        alert.acknowledged_at = datetime.utcnow()
        db.commit()
    return {"status": "acknowledged"}


@app.post("/api/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if alert:
        alert.status = AlertStatus.RESOLVED
        alert.resolved_at = datetime.utcnow()
        db.commit()
    return {"status": "resolved"}


# ============ REPORTS ============

import os, base64

# Ensure upload directory exists
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/api/reports")
async def submit_report(
    reporter_name: str = Form("Anonymous"),
    reporter_phone: str = Form(""),
    reporter_role: str = Form("citizen"),
    latitude: float = Form(...),
    longitude: float = Form(...),
    report_type: str = Form(...),
    description: str = Form(""),
    severity_claimed: str = Form("moderate"),
    db: Session = Depends(get_db),
    photos: List[UploadFile] = File(default=[]),
):
    media_urls = []
    for photo in photos:
        if photo.filename:
            ext = os.path.splitext(photo.filename)[1] or ".jpg"
            fname = f"report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{random.randint(1000,99999)}{ext}"
            fpath = os.path.join(UPLOAD_DIR, fname)
            content = await photo.read()
            with open(fpath, "wb") as f:
                f.write(content)
            media_urls.append(f"/uploads/{fname}")

    report = Report(
        reporter_name=reporter_name,
        reporter_phone=reporter_phone,
        reporter_role=reporter_role,
        latitude=latitude,
        longitude=longitude,
        report_type=report_type,
        description=description,
        severity_claimed=severity_claimed,
        media_urls=media_urls,
    )
    db.add(report)
    db.commit()

    return {"report_id": report.id, "status": "submitted", "media_urls": media_urls}


@app.get("/api/reports")
def get_reports(
    limit: int = Query(50, le=200),
    report_type: Optional[str] = None,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    # Reports are only accessible to admin
    if not authorization or authorization != "Bearer admin-token-verified":
        return {"error": "Unauthorized", "reports": [], "message": "Reports are only accessible to admin users. Please login as admin."}
    q = db.query(Report)
    if report_type:
        q = q.filter(Report.report_type == report_type)
    reports = q.order_by(Report.created_at.desc()).limit(limit).all()
    return [{
        "id": r.id, "reporter_name": r.reporter_name, "reporter_role": r.reporter_role,
        "latitude": r.latitude, "longitude": r.longitude,
        "report_type": r.report_type, "description": r.description,
        "severity_claimed": r.severity_claimed, "verified": r.verified,
        "media_urls": r.media_urls or [],
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in reports]


@app.post("/api/reports/{report_id}/verify")
def verify_report(
    report_id: int,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Admin access required")
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.verified = True
    report.verified_by = "admin"
    db.commit()
    return {"status": "verified", "report_id": report_id}


app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ======================

@app.get("/api/heatmap")
def get_heatmap(db: Session = Depends(get_db)):
    zones = db.query(Zone).all()
    features = []
    for z in zones:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [z.longitude, z.latitude],
            },
            "properties": {
                "id": z.id,
                "name": z.name,
                "district": z.district,
                "state": z.state,
                "risk_score": z.risk_score,
                "risk_level": z.risk_level.value,
                "elevation_m": z.elevation_m,
                "slope_angle": z.slope_angle_deg,
            },
        })
    return {
        "type": "FeatureCollection",
        "features": features,
    }


# ============ REAL DATA INTEGRATION ============

try:
    from services.real_weather import real_weather_service
    from services.ndvi import ndvi_service
    from services.elevation import elevation_service
    from services.sensor_gateway import sensor_gateway, SENSOR_TYPES
    from services.weather import hybrid_weather
    from ml.predictor import batch_predict_real_data, update_zone_real_data
    REAL_DATA_IMPORTS = True
except ImportError:
    REAL_DATA_IMPORTS = False


# Cache for data source health checks (avoid repeated API calls)
_data_sources_cache = {"status": None, "last_check": 0}
import time as _time

@app.get("/api/data-sources/status")
async def get_data_sources_status():
    """Health check for all external data APIs. Cached for 60s."""
    now = _time.time()
    # Return cached result if less than 60 seconds old
    if _data_sources_cache["status"] and (now - _data_sources_cache["last_check"]) < 10:
        return _data_sources_cache["status"]

    status = {"real_data_available": REAL_DATA_IMPORTS}
    if REAL_DATA_IMPORTS:
        try:
            status["open_meteo_weather"] = await real_weather_service.health_check()
        except: status["open_meteo_weather"] = {"status": "error", "note": "health check failed"}
        try:
            status["sentinel_2_ndvi"] = await ndvi_service.health_check()
        except: status["sentinel_2_ndvi"] = {"status": "error", "note": "health check failed"}
        try:
            status["srtm_elevation"] = await elevation_service.health_check()
        except: status["srtm_elevation"] = {"status": "error", "note": "health check failed"}
        try:
            status["mqtt_sensors"] = sensor_gateway.get_sensor_stats()
        except: status["mqtt_sensors"] = {"status": "error", "mqtt_connected": False}
    _data_sources_cache["status"] = status
    _data_sources_cache["last_check"] = now
    return status


@app.get("/api/zone/{zone_id}/real-data")
async def get_zone_real_data(zone_id: int, db: Session = Depends(get_db)):
    """Get real weather + NDVI + elevation for a specific zone."""
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if not REAL_DATA_IMPORTS:
        return {"error": "Real data services not available", "zone_id": zone_id}
    result = await update_zone_real_data(zone)
    result["zone_id"] = zone_id
    result["zone_name"] = zone.name
    return result


@app.post("/api/admin/sync-real-data")
async def sync_real_data(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Force refresh real data for all zones. Admin only."""
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Admin access required")
    if not REAL_DATA_IMPORTS:
        return {"error": "Real data services not available"}

    zones = db.query(Zone).all()
    updated = 0
    for zone in zones:
        try:
            real_data = await update_zone_real_data(zone)
            # Update zone with real data
            if real_data.get("weather_source") in ("open_meteo", "imd"):
                # Update weather in DB
                pass  # Weather is fetched on-the-fly
            if real_data.get("ndvi_source") == "sentinel_2":
                zone.vegetation_cover = real_data["vegetation_cover"]
            if real_data.get("slope_angle_deg") and real_data.get("slope_angle_deg") != zone.slope_angle_deg:
                zone.slope_angle_deg = real_data["slope_angle_deg"]
                zone.elevation_m = real_data.get("elevation_m", zone.elevation_m)
            updated += 1
        except Exception as e:
            print(f"[Sync] Error updating zone {zone.id}: {e}")
    db.commit()
    return {"zones_updated": updated, "total_zones": len(zones), "source": "real_data_sync"}


@app.post("/api/sensors/data")
async def ingest_sensor_data(readings: List[dict]):
    """HTTP sensor data ingestion endpoint for field devices."""
    if not REAL_DATA_IMPORTS:
        return {"error": "Sensor gateway not available"}
    result = sensor_gateway.ingest_http_readings(readings)
    return result


@app.get("/api/sensors/realtime")
async def get_realtime_sensors(zone_id: Optional[int] = None):
    """Get latest sensor readings."""
    if not REAL_DATA_IMPORTS:
        return {"error": "Sensor gateway not available"}
    return sensor_gateway.get_realtime_readings(zone_id)


@app.get("/api/sensors/stats")
async def get_sensor_stats():
    """Get sensor gateway statistics."""
    if not REAL_DATA_IMPORTS:
        return {"error": "Sensor gateway not available"}
    return sensor_gateway.get_sensor_stats()


@app.post("/api/admin/mqtt-connect")
async def mqtt_connect(
    authorization: Optional[str] = Header(None),
    broker: str = Query("broker.hivemq.com"),
    port: int = Query(1883),
):
    """Connect to MQTT broker. Admin only."""
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Admin access required")
    if not REAL_DATA_IMPORTS:
        return {"error": "Sensor gateway not available"}
    success = sensor_gateway.connect_mqtt(broker, port)
    return {"connected": success, "broker": broker, "port": port}


@app.post("/api/admin/mqtt-test-reading")
async def mqtt_test_reading(
    authorization: Optional[str] = Header(None),
    zone_id: int = Query(...),
    sensor_type: str = Query("rainfall"),
    value: Optional[float] = Query(None),
):
    """Publish a test sensor reading via MQTT. Admin only."""
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Admin access required")
    if not REAL_DATA_IMPORTS:
        return {"error": "Sensor gateway not available"}
    success = sensor_gateway.publish_test_reading(zone_id, sensor_type, value)
    return {"published": success, "zone_id": zone_id, "sensor_type": sensor_type}


# ============ STATS ============

@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    zones = db.query(Zone).all()
    events = db.query(LandslideEvent).all()
    reports = db.query(Report).all()
    alerts = db.query(Alert).all()

    states = {}
    for z in zones:
        states.setdefault(z.state, {"zones": 0, "avg_risk": 0, "total_risk": 0})
        states[z.state]["zones"] += 1
        states[z.state]["total_risk"] += z.risk_score
    for s in states:
        states[s]["avg_risk"] = round(states[s]["total_risk"] / max(states[s]["zones"], 1), 1)
        del states[s]["total_risk"]

    return {
        "total_zones": len(zones),
        "total_events": len(events),
        "total_reports": len(reports),
        "total_alerts": len(alerts),
        "active_alerts": len([a for a in alerts if a.status == AlertStatus.ACTIVE]),
        "states_summary": states,
        "last_updated": datetime.utcnow().isoformat(),
    }


# ============ WEBSOCKET ============

@app.websocket("/ws/alerts")
async def websocket_alerts(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            # Keep alive; also accept client messages
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ============ REAL-TIME SIMULATION ============

@app.post("/api/simulate/update")
async def simulate_update(db: Session = Depends(get_db)):
    """Simulate real-time data changes for all zones (demo)."""
    zones = db.query(Zone).all()
    updated = []
    for z in zones:
        # Update weather
        weather = weather_simulator.generate_current_weather(z.id, z.state, z.latitude)
        wd = WeatherData(
            zone_id=z.id, latitude=z.latitude, longitude=z.longitude,
            rainfall_mm=weather["rainfall_mm"],
            temperature_c=weather["temperature_c"],
            humidity_pct=weather["humidity_pct"],
            wind_speed_kmh=weather["wind_speed_kmh"],
            forecast_hours=0,
        )
        db.add(wd)

        # Update sensor readings
        for sensor in z.sensors:
            delta = random.uniform(-2, 5)
            new_val = max(0, sensor.last_reading + delta)
            if random.random() < 0.03:
                new_val *= random.uniform(2, 4)
            reading = SensorReading(
                sensor_id=sensor.id, value=round(new_val, 2),
                unit=sensor.unit,
            )
            db.add(reading)
            sensor.last_reading = new_val
            sensor.last_reading_time = datetime.utcnow()

        updated.append({
            "zone_id": z.id,
            "name": z.name,
            "weather": weather,
        })

    db.commit()

    # Broadcast update
    await manager.broadcast({
        "type": "data_update",
        "zones_updated": len(updated),
        "timestamp": datetime.utcnow().isoformat(),
    })

    return {"updated": len(updated), "timestamp": datetime.utcnow().isoformat()}


# ============ SIMULATE ROAD DISRUPTION ============

@app.post("/api/simulate/road_disruption")
async def simulate_road_disruption(db: Session = Depends(get_db)):
    """Simulate a road disruption event."""
    road = db.query(Road).order_by(func.random()).first()
    if road:
        road.status = random.choice([RoadStatus.BLOCKED, RoadStatus.PARTIAL, RoadStatus.DAMAGED])
        road.last_updated = datetime.utcnow()
        db.commit()

        await manager.broadcast({
            "type": "road_disruption",
            "road_id": road.id,
            "road_name": road.name,
            "status": road.status.value,
            "timestamp": datetime.utcnow().isoformat(),
        })
        return {"road": road.name, "status": road.status.value}
    return {"error": "No roads found"}


# ============ LANDING PAGE ============

@app.get("/")
def root():
    return {
        "system": "NER Landslide Early Warning System",
        "version": "1.0.0",
        "endpoints": {
            "zones": "/api/zones",
            "dashboard": "/api/dashboard",
            "predictions": "/api/predictions",
            "weather": "/api/weather/{zone_id}",
            "roads": "/api/roads",
            "villages": "/api/villages",
            "alerts": "/api/alerts",
            "reports": "/api/reports",
            "heatmap": "/api/heatmap",
            "stats": "/api/stats",
            "simulate": "/api/simulate/update",
            "ws": "/ws/alerts",
        },
    }


# ---------- SMS Notification Gateway ----------
try:
    from services.sms_gateway import sms_gateway
    SMS_AVAILABLE = True
except ImportError:
    SMS_AVAILABLE = False

@app.post("/api/notifications/send")
async def send_notification(
    phone: str = Form(...),
    message: str = Form(...),
    priority: str = Form("normal"),
    authorization: Optional[str] = Header(None),
):
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Admin access required")
    if not SMS_AVAILABLE:
        return {"status": "demo", "message": "SMS provider not configured. Notifications logged."}
    result = await sms_gateway.send_sms(phone, message, priority)
    return result

@app.post("/api/notifications/broadcast")
async def broadcast_alert(
    zone_name: str = Form(...),
    risk_level: str = Form(...),
    message: str = Form(...),
    state: str = Form(""),
    authorization: Optional[str] = Header(None),
):
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Admin access required")
    if not SMS_AVAILABLE:
        return {"status": "demo", "message": "SMS provider not configured.", "contacts": []}
    result = await sms_gateway.broadcast_alert(zone_name, risk_level, message, state)
    return result

@app.get("/api/notifications/log")
async def get_notification_log(
    authorization: Optional[str] = Header(None),
):
    if not authorization or authorization != "Bearer admin-token-verified":
        raise HTTPException(status_code=401, detail="Admin access required")
    if not SMS_AVAILABLE:
        return {"log": [], "stats": {"total_sent": 0}}
    return {"log": sms_gateway.get_notification_log(), "stats": sms_gateway.get_stats()}

# ---------- Historical Landslide Records ----------
HISTORICAL_LANDSLIDES = [
    {"id": 1, "date": "2024-06-15", "zone": "Cherrapunji", "district": "East Khasi Hills", "state": "Meghalaya", "latitude": 25.27, "longitude": 91.73, "type": "Rainfall-induced", "severity": "critical", "casualties": 2, "displaced": 450, "road_blocked": True, "description": "Massive landslide after 48h continuous rainfall. NH6 blocked for 72 hours."},
    {"id": 2, "date": "2024-07-22", "zone": "Tawang", "district": "Tawang", "state": "Arunachal Pradesh", "latitude": 27.58, "longitude": 91.86, "type": "Slope failure", "severity": "high", "casualties": 0, "displaced": 120, "road_blocked": True, "description": "Hill cutting destabilized slope above military road. Multiple cracks reported."},
    {"id": 3, "date": "2024-08-10", "zone": "Imphal", "district": "Imphal East", "state": "Manipur", "latitude": 24.81, "longitude": 93.94, "type": "Flash flood", "severity": "high", "casualties": 1, "displaced": 280, "road_blocked": False, "description": "River overflow caused bank erosion and residential area flooding."},
    {"id": 4, "date": "2023-09-05", "zone": "Dzukou Valley", "district": "Kohima", "state": "Nagaland", "latitude": 25.15, "longitude": 93.58, "type": "Earthflow", "severity": "moderate", "casualties": 0, "displaced": 50, "road_blocked": True, "description": "Post-fire vegetation loss triggered slow-moving earthflow."},
    {"id": 5, "date": "2024-06-28", "zone": "Silchar", "district": "Cachar", "state": "Assam", "latitude": 24.82, "longitude": 92.56, "type": "River bank erosion", "severity": "high", "casualties": 0, 'displaced': 380, "road_blocked": False, "description": "Barak River erosion threatened 3 villages. Emergency embankment built."},
    {"id": 6, "date": "2024-07-15", "zone": "Champhai Ridge", "district": "Champhai", "state": "Mizoram", "latitude": 24.58, "longitude": 93.81, "type": "Landslide", "severity": "critical", "casualties": 3, "displaced": 200, "road_blocked": True, "description": "Catastrophic failure on steep agricultural slope. Myanmar border road cut off."},
    {"id": 7, "date": "2023-07-30", "zone": "Jowai", "district": "Jaintia Hills", "state": "Meghalaya", "latitude": 25.29, "longitude": 92.59, "type": "Mining-related", "severity": "moderate", "casualties": 0, "displaced": 75, "road_blocked": False, "description": "Coal mine subsidence caused ground cracking in 3 areas."},
    {"id": 8, "date": "2024-08-25", "zone": "Dibrugarh", "district": "Dibrugarh", "state": "Assam", "latitude": 27.48, "longitude": 95.02, "type": "Erosion", "severity": "moderate", "casualties": 0, "displaced": 60, "road_blocked": False, "description": "Brahmaputra tributary erosion damaged tea estate roads."},
    {"id": 9, "date": "2024-05-12", "zone": "Mawsynram", "district": "East Khasi Hills", "state": "Meghalaya", "latitude": 25.42, "longitude": 93.10, "type": "Rainfall-induced", "severity": "critical", "casualties": 1, "displaced": 320, "road_blocked": True, "description": "World's wettest place received 350mm in 24h. Multiple road failures."},
    {"id": 10, "date": "2023-08-18", "zone": "Ziro Valley", "district": "Lower Subansiri", "state": "Arunachal Pradesh", "latitude": 27.10, "longitude": 93.60, "type": "Slope failure", "severity": "high", "casualties": 0, "displaced": 150, "road_blocked": True, "description": "Apatani tribal area rice terraces collapsed on access road."},
    {"id": 11, "date": "2024-06-01", "zone": "Kohima", "district": "Kohima", "state": "Nagaland", "latitude": 25.67, "longitude": 94.11, "type": "Construction-triggered", "severity": "moderate", "casualties": 0, "displaced": 90, "road_blocked": False, "description": "Highway widening project destabilized hillside."},
    {"id": 12, "date": "2024-09-02", "zone": "Aizawl", "district": "Aizawl", "state": "Mizoram", "latitude": 23.73, "longitude": 92.72, "type": "Rainfall-induced", "severity": "high", "casualties": 2, "displaced": 500, "road_blocked": True, "description": "Prolonged monsoon rainfall triggered multiple slides across the city hillsides."},
]

@app.get("/api/historical-landslides")
def get_historical_landslides():
    return {"records": HISTORICAL_LANDSLIDES, "total": len(HISTORICAL_LANDSLIDES)}


# ---------- Serve frontend (when built) ----------
import os as _os
from fastapi.responses import FileResponse as _FileResponse

_DIST_DIR = _os.path.join(_os.path.dirname(__file__), '..', 'frontend', 'dist')
if _os.path.isdir(_DIST_DIR):
    _ASSETS_DIR = _os.path.join(_DIST_DIR, 'assets')
    if _os.path.isdir(_ASSETS_DIR):
        app.mount('/assets', StaticFiles(directory=_ASSETS_DIR), name='static-assets')

    @app.get('/{full_path:path}')
    async def _serve_frontend(full_path: str):
        if full_path.startswith('api/') or full_path.startswith('ws/'):
            raise HTTPException(status_code=404)
        file_path = _os.path.join(_DIST_DIR, full_path)
        if _os.path.isfile(file_path):
            return _FileResponse(file_path)
        index = _os.path.join(_DIST_DIR, 'index.html')
        if _os.path.isfile(index):
            return _FileResponse(index)
        raise HTTPException(status_code=404)
