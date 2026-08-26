"""
Database models for NER Landslide Early Warning System.
Covers: Zones, Sensors, Weather, Landslide Events, Reports, Alerts, Roads, Villages.
"""
from sqlalchemy import (
    Column, Integer, Float, String, DateTime, Text, Boolean, Enum as SAEnum,
    ForeignKey, JSON, create_engine
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
from datetime import datetime
import enum

Base = declarative_base()


class RiskLevel(enum.Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"


class AlertStatus(enum.Enum):
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class RoadStatus(enum.Enum):
    OPEN = "open"
    BLOCKED = "blocked"
    PARTIAL = "partial"
    DAMAGED = "damaged"


class Zone(Base):
    """Monitored geographic zone (grid cell or administrative area)."""
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    district = Column(String(100), nullable=False)
    state = Column(String(100), nullable=False, default="Assam")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    elevation_m = Column(Float, default=0)
    slope_angle_deg = Column(Float, default=0)
    soil_type = Column(String(50), default="unknown")
    vegetation_cover = Column(Float, default=0)  # 0-1 fraction
    risk_level = Column(SAEnum(RiskLevel), default=RiskLevel.LOW)
    risk_score = Column(Float, default=0)  # 0-100
    last_assessed = Column(DateTime, default=datetime.utcnow)
    metadata_json = Column(JSON, default=dict)

    sensors = relationship("Sensor", back_populates="zone")
    events = relationship("LandslideEvent", back_populates="zone")
    alerts = relationship("Alert", back_populates="zone")


class Sensor(Base):
    """IoT sensor deployed in a zone."""
    __tablename__ = "sensors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False)
    sensor_type = Column(String(50), nullable=False)  # rainfall, soil_moisture, tilt, gps_displacement
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)
    last_reading = Column(Float, default=0)
    last_reading_time = Column(DateTime, default=datetime.utcnow)
    threshold = Column(Float, default=0)  # alert threshold
    unit = Column(String(20), default="")

    zone = relationship("Zone", back_populates="sensors")
    readings = relationship("SensorReading", back_populates="sensor")


class SensorReading(Base):
    """Time-series reading from a sensor."""
    __tablename__ = "sensor_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sensor_id = Column(Integer, ForeignKey("sensors.id"), nullable=False)
    value = Column(Float, nullable=False)
    unit = Column(String(20), default="")
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)

    sensor = relationship("Sensor", back_populates="readings")


class WeatherData(Base):
    """Weather observations and forecasts from IMD or simulated sources."""
    __tablename__ = "weather_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    rainfall_mm = Column(Float, default=0)
    temperature_c = Column(Float, default=25)
    humidity_pct = Column(Float, default=50)
    wind_speed_kmh = Column(Float, default=0)
    forecast_hours = Column(Integer, default=0)  # 0 = current, 24 = 24h forecast
    source = Column(String(50), default="imd")
    timestamp = Column(DateTime, default=datetime.utcnow)


class LandslideEvent(Base):
    """Historical or real-time landslide event."""
    __tablename__ = "landslide_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    severity = Column(SAEnum(RiskLevel), default=RiskLevel.MODERATE)
    event_type = Column(String(50), default="landslide")  # landslide, flash_flood, slope_failure, road_block
    description = Column(Text, default="")
    triggered_by = Column(String(100), default="rainfall")
    estimated_volume_m3 = Column(Float, default=0)
    roads_affected = Column(JSON, default=list)  # list of road IDs
    villages_affected = Column(JSON, default=list)
    timestamp = Column(DateTime, default=datetime.utcnow)
    resolved = Column(Boolean, default=False)

    zone = relationship("Zone", back_populates="events")


class Report(Base):
    """Citizen/field-officer geo-tagged report with photo/video."""
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    reporter_name = Column(String(100), default="Anonymous")
    reporter_phone = Column(String(20), default="")
    reporter_role = Column(String(50), default="citizen")  # citizen, field_official, police
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    report_type = Column(String(50), nullable=False)  # crack, slope_movement, blocked_road, flooding, other
    description = Column(Text, default="")
    media_urls = Column(JSON, default=list)  # uploaded photo/video URLs
    severity_claimed = Column(String(20), default="moderate")
    verified = Column(Boolean, default=False)
    verified_by = Column(String(100), default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Alert(Base):
    """Alert issued to authorities and communities."""
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=True)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    risk_level = Column(SAEnum(RiskLevel), default=RiskLevel.HIGH)
    status = Column(SAEnum(AlertStatus), default=AlertStatus.ACTIVE)
    target_audience = Column(JSON, default=list)  # ["district_admin", "ndrf", "community"]
    channels = Column(JSON, default=list)  # ["sms", "app", "siren"]
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    acknowledged_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    language = Column(String(10), default="en")

    zone = relationship("Zone", back_populates="alerts")


class Road(Base):
    """Road connectivity status."""
    __tablename__ = "roads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    road_type = Column(String(50), default="state_highway")  # national_highway, state_highway, district_road
    from_place = Column(String(100), default="")
    to_place = Column(String(100), default="")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    status = Column(SAEnum(RoadStatus), default=RoadStatus.OPEN)
    last_updated = Column(DateTime, default=datetime.utcnow)
    coordinates_geojson = Column(JSON, default=dict)  # GeoJSON LineString


class Village(Base):
    """Village/population center near monitored zones."""
    __tablename__ = "villages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    district = Column(String(100), nullable=False)
    state = Column(String(100), default="Assam")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    population = Column(Integer, default=0)
    connectivity_status = Column(String(50), default="connected")  # connected, isolated, partially_isolated
    nearest_road_id = Column(Integer, ForeignKey("roads.id"), nullable=True)


class NotificationLog(Base):
    """Log of sent notifications."""
    __tablename__ = "notification_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=True)
    channel = Column(String(20), nullable=False)  # sms, app_push, email
    recipient = Column(String(200), default="")
    message = Column(Text, default="")
    status = Column(String(20), default="sent")  # sent, delivered, failed
    language = Column(String(10), default="en")
    sent_at = Column(DateTime, default=datetime.utcnow)


# ---------- Database setup ----------
DATABASE_URL = "sqlite:///./ner_disaster.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False}, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
