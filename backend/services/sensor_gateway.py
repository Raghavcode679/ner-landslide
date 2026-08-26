"""
MQTT/HTTP Sensor Gateway for IoT landslide monitoring sensors.
Supports:
  - MQTT protocol for real-time sensor data ingestion
  - HTTP REST API for batch upload from field devices
  - Topic pattern: ner/landslide/{zone_id}/{sensor_type}
  - Sensor types: rainfall, soil_moisture, tilt, gps_displacement
"""
import json
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
import random

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False
    print("[SensorGateway] paho-mqtt not installed. MQTT features disabled. Install: pip install paho-mqtt")


# Default broker settings (public HiveMQ broker for testing)
DEFAULT_BROKER = "broker.hivemq.com"
DEFAULT_PORT = 1883
DEFAULT_TOPIC_PREFIX = "ner/landslide"
KEEPALIVE = 60

# Sensor type configurations
SENSOR_TYPES = {
    "rainfall": {"unit": "mm", "threshold": 100, "min": 0, "max": 300},
    "soil_moisture": {"unit": "%", "threshold": 80, "min": 0, "max": 100},
    "tilt": {"unit": "degrees", "threshold": 5, "min": -15, "max": 15},
    "gps_displacement": {"unit": "mm", "threshold": 50, "min": -200, "max": 200},
    "temperature": {"unit": "celsius", "threshold": 45, "min": -10, "max": 55},
    "humidity": {"unit": "%", "threshold": 95, "min": 0, "max": 100},
}


class SensorReading:
    """Represents a single sensor reading."""
    def __init__(self, zone_id: int, sensor_type: str, value: float,
                 unit: str = "", timestamp: str = "", source: str = "mqtt"):
        self.zone_id = zone_id
        self.sensor_type = sensor_type
        self.value = value
        self.unit = unit or SENSOR_TYPES.get(sensor_type, {}).get("unit", "unknown")
        self.timestamp = timestamp or datetime.utcnow().isoformat()
        self.source = source
        self.is_anomaly = self._check_anomaly()

    def _check_anomaly(self) -> bool:
        config = SENSOR_TYPES.get(self.sensor_type, {})
        threshold = config.get("threshold", float("inf"))
        return abs(self.value) > threshold

    def to_dict(self) -> Dict:
        return {
            "zone_id": self.zone_id,
            "sensor_type": self.sensor_type,
            "value": self.value,
            "unit": self.unit,
            "timestamp": self.timestamp,
            "source": self.source,
            "is_anomaly": self.is_anomaly,
        }


class SensorGateway:
    """Manages MQTT connections and HTTP sensor data ingestion."""

    def __init__(self):
        self._readings: Dict[int, Dict[str, SensorReading]] = {}  # zone_id -> {type -> latest}
        self._readings_history: Dict[int, Dict[str, List[float]]] = {}  # zone_id -> {type -> [values]}
        self._callbacks: List[Callable] = []
        self._mqtt_client: Optional[object] = None
        self._connected = False
        self._stats = {
            "total_readings": 0,
            "anomalies_detected": 0,
            "mqtt_messages": 0,
            "http_uploads": 0,
            "start_time": datetime.utcnow().isoformat(),
        }

    def _on_mqtt_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            print("[SensorGateway] MQTT connected to broker")
            self._connected = True
            # Subscribe to all NER landslide topics
            topic = f"{DEFAULT_TOPIC_PREFIX}/#"
            client.subscribe(topic)
            print(f"[SensorGateway] Subscribed to {topic}")
        else:
            print(f"[SensorGateway] MQTT connection failed with code {rc}")

    def _on_mqtt_disconnect(self, client, userdata, rc, properties=None):
        print(f"[SensorGateway] MQTT disconnected (rc={rc})")
        self._connected = False

    def _on_mqtt_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            reading = self._parse_mqtt_payload(payload)
            if reading:
                self._ingest_reading(reading)
                self._stats["mqtt_messages"] += 1
        except json.JSONDecodeError:
            print(f"[SensorGateway] Invalid JSON from topic {msg.topic}")
        except Exception as e:
            print(f"[SensorGateway] Message processing error: {e}")

    def _parse_mqtt_payload(self, payload: Dict) -> Optional[SensorReading]:
        """Parse MQTT JSON payload into a SensorReading."""
        try:
            zone_id = payload.get("zone_id")
            sensor_type = payload.get("type") or payload.get("sensor_type")
            value = payload.get("value")

            if zone_id is None or sensor_type is None or value is None:
                return None

            return SensorReading(
                zone_id=int(zone_id),
                sensor_type=sensor_type,
                value=float(value),
                unit=payload.get("unit", ""),
                timestamp=payload.get("ts") or payload.get("timestamp", ""),
                source="mqtt",
            )
        except (ValueError, TypeError) as e:
            print(f"[SensorGateway] Payload parse error: {e}")
            return None

    def _ingest_reading(self, reading: SensorReading):
        """Store a sensor reading and check for anomalies."""
        zone_id = reading.zone_id
        sensor_type = reading.sensor_type

        # Update latest reading
        if zone_id not in self._readings:
            self._readings[zone_id] = {}
        self._readings[zone_id][sensor_type] = reading

        # Update history (keep last 100 values)
        if zone_id not in self._readings_history:
            self._readings_history[zone_id] = {}
        if sensor_type not in self._readings_history[zone_id]:
            self._readings_history[zone_id][sensor_type] = []
        history = self._readings_history[zone_id][sensor_type]
        history.append(reading.value)
        if len(history) > 100:
            history[:] = history[-100:]

        self._stats["total_readings"] += 1
        if reading.is_anomaly:
            self._stats["anomalies_detected"] += 1
            print(f"[SensorGateway] ⚠️ ANOMALY: zone={zone_id} type={sensor_type} "
                  f"value={reading.value} {reading.unit}")

        # Notify callbacks
        for cb in self._callbacks:
            try:
                cb(reading)
            except Exception as e:
                print(f"[SensorGateway] Callback error: {e}")

    def connect_mqtt(self, broker: str = DEFAULT_BROKER,
                     port: int = DEFAULT_PORT, topic_prefix: str = DEFAULT_TOPIC_PREFIX):
        """Connect to MQTT broker and subscribe to sensor topics."""
        if not MQTT_AVAILABLE:
            print("[SensorGateway] MQTT not available. Install paho-mqtt.")
            return False

        global DEFAULT_TOPIC_PREFIX
        DEFAULT_TOPIC_PREFIX = topic_prefix

        self._mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self._mqtt_client.on_connect = self._on_mqtt_connect
        self._mqtt_client.on_disconnect = self._on_mqtt_disconnect
        self._mqtt_client.on_message = self._on_mqtt_message

        try:
            self._mqtt_client.connect(broker, port, KEEPALIVE)
            self._mqtt_client.loop_start()
            print(f"[SensorGateway] Connecting to MQTT broker {broker}:{port}...")
            return True
        except Exception as e:
            print(f"[SensorGateway] MQTT connect error: {e}")
            return False

    def disconnect_mqtt(self):
        """Disconnect from MQTT broker."""
        if self._mqtt_client:
            self._mqtt_client.loop_stop()
            self._mqtt_client.disconnect()
            self._connected = False
            print("[SensorGateway] MQTT disconnected")

    def ingest_http_readings(self, readings: List[Dict]) -> Dict:
        """
        Accept batch sensor readings via HTTP (from field devices).
        Each reading: {"zone_id": int, "type": str, "value": float, "unit": str, "ts": str}
        """
        accepted = 0
        rejected = 0
        anomalies = []

        for raw in readings:
            try:
                reading = SensorReading(
                    zone_id=int(raw.get("zone_id", 0)),
                    sensor_type=raw.get("type") or raw.get("sensor_type", "unknown"),
                    value=float(raw.get("value", 0)),
                    unit=raw.get("unit", ""),
                    timestamp=raw.get("ts") or raw.get("timestamp", ""),
                    source="http",
                )
                if reading.zone_id > 0 and reading.sensor_type in SENSOR_TYPES:
                    self._ingest_reading(reading)
                    accepted += 1
                    if reading.is_anomaly:
                        anomalies.append(reading.to_dict())
                else:
                    rejected += 1
            except (ValueError, TypeError):
                rejected += 1

        self._stats["http_uploads"] += accepted

        return {
            "accepted": accepted,
            "rejected": rejected,
            "anomalies": anomalies,
            "total_stored": self._stats["total_readings"],
        }

    def publish_test_reading(self, zone_id: int, sensor_type: str,
                             value: Optional[float] = None) -> bool:
        """Publish a test sensor reading via MQTT."""
        if not self._mqtt_client or not self._connected:
            print("[SensorGateway] MQTT not connected")
            return False

        if value is None:
            config = SENSOR_TYPES.get(sensor_type, {"min": 0, "max": 50})
            value = random.uniform(config.get("min", 0), config.get("max", 50))

        payload = {
            "zone_id": zone_id,
            "type": sensor_type,
            "value": round(value, 2),
            "unit": SENSOR_TYPES.get(sensor_type, {}).get("unit", ""),
            "ts": datetime.utcnow().isoformat(),
        }

        topic = f"{DEFAULT_TOPIC_PREFIX}/{zone_id}/{sensor_type}"
        result = self._mqtt_client.publish(topic, json.dumps(payload))
        return result.rc == 0

    def get_realtime_readings(self, zone_id: Optional[int] = None) -> Dict:
        """Get latest sensor readings for a zone or all zones."""
        if zone_id:
            readings = self._readings.get(zone_id, {})
            return {
                zone_id: {
                    st: r.to_dict() for st, r in readings.items()
                }
            }
        return {
            zid: {
                st: r.to_dict() for st, r in sensors.items()
            }
            for zid, sensors in self._readings.items()
        }

    def get_readings_history(self, zone_id: int, sensor_type: str) -> List[float]:
        """Get recent reading history for a sensor."""
        return self._readings_history.get(zone_id, {}).get(sensor_type, [])

    def get_sensor_stats(self) -> Dict:
        """Get gateway statistics."""
        return {
            **self._stats,
            "mqtt_connected": self._connected,
            "zones_active": len(self._readings),
            "total_sensors_active": sum(
                len(sensors) for sensors in self._readings.values()
            ),
        }

    def on_reading(self, callback: Callable):
        """Register callback for new readings."""
        self._callbacks.append(callback)

    def simulate_zone_sensors(self, zone_id: int) -> Dict:
        """Generate simulated sensor readings for a zone (for testing)."""
        readings = {}
        for sensor_type, config in SENSOR_TYPES.items():
            value = random.uniform(config["min"], config["max"])
            # Occasionally generate anomalies
            if random.random() < 0.05:
                value = config["threshold"] * random.uniform(1.1, 2.0)

            reading = SensorReading(
                zone_id=zone_id,
                sensor_type=sensor_type,
                value=round(value, 2),
                source="simulated",
            )
            self._ingest_reading(reading)
            readings[sensor_type] = reading.to_dict()
        return readings


sensor_gateway = SensorGateway()

# Auto-connect to public MQTT broker on import
try:
    sensor_gateway.connect_mqtt()
except Exception as e:
    print(f"[SensorGateway] Auto-connect failed (non-critical): {e}")
