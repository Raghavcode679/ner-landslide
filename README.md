# 🏔️ NER Landslide Early Warning System

**AI-Powered Real-Time Disaster Monitoring for North Eastern Region**

An intelligent early warning and monitoring platform that predicts and tracks landslide-prone areas in real time across India's North Eastern Region (Assam, Arunachal Pradesh, Manipur, Mizoram, Nagaland, Meghalaya, Tripura).

---

## 🎯 Problem Statement

The North Eastern Region frequently faces:
- **Landslides** from heavy rainfall and fragile terrain
- **Flash floods** disrupting connectivity
- **Road blockages** isolating remote villages for days
- **Slope failures** from unplanned hill cutting
- **Delayed emergency response** due to reactive monitoring

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React + TS)            │
│  ┌──────────┬──────────┬──────────┬───────────┐  │
│  │ GIS Map  │Dashboard │ Alerts   │ Reports   │  │
│  │ Leaflet  │ Recharts │ Realtime │ Field     │  │
│  │ Heatmaps │ Charts   │ WebSocket│ Geo-tagged│  │
│  └──────────┴──────────┴──────────┴───────────┘  │
├─────────────────────────────────────────────────┤
│                  Backend (FastAPI)                │
│  ┌──────────┬──────────┬──────────┬───────────┐  │
│  │ REST API │WebSocket │ ML Engine│ Weather   │  │
│  │ /api/*   │ /ws/*    │ Predictor│ Simulator │  │
│  └──────────┴──────────┴──────────┴───────────┘  │
├─────────────────────────────────────────────────┤
│              SQLite + SQLAlchemy ORM              │
│  Zones | Sensors | Weather | Alerts | Reports    │
│  Roads | Villages | Events | Notifications       │
└─────────────────────────────────────────────────┘
```

## ✅ Features Implemented

### a. Data Collection & Analysis
- **Rainfall patterns**: Simulated IMD weather data with monsoon patterns
- **Soil moisture sensors**: IoT sensor simulation with anomaly detection
- **Satellite imagery metadata**: Zone terrain profiles
- **Terrain/slope data**: Slope angles, elevation, soil types
- **Historical landslide records**: Seeded event database

### b. AI/ML Prediction Engine (`backend/ml/predictor.py`)
- Multi-factor risk scoring (weighted composite model)
- Factor analysis: rainfall intensity, slope geometry, soil susceptibility, vegetation cover, sensor anomalies, historical frequency
- Risk classification: LOW → MODERATE → HIGH → CRITICAL
- Confidence scoring based on data completeness
- Recommended actions per risk level

### c. Real-Time Alerts
- WebSocket-based live alert streaming
- Multilingual notifications (English, Hindi, Bengali, Assamese, Manipuri, Tamil, Marathi)
- Multi-channel: SMS, App push, Email (simulated)
- Alert lifecycle: Active → Acknowledged → Resolved

### d. GIS Mapping
- Interactive Leaflet map with zone markers
- Risk-coded color markers (green→red)
- Road connectivity overlay
- Village monitoring with population data
- Click-to-inspect zone details

### e. Citizen/Field Reporting
- Geo-tagged report submission form
- Report types: cracks, slope movement, blocked roads, flooding
- Severity classification
- Verification workflow
- Photo/video upload UI (simulated geo-tag capture)

### f. Dashboards
- **Risk severity levels**: Bar charts, risk bars, zone rankings
- **Road connectivity status**: Status indicators, blocked road alerts
- **Weather-linked risk forecasts**: 24-hour hourly forecasts
- **Emergency response prioritisation**: Action recommendations per zone

### g. Multilingual & Offline
- 6 languages: English, Hindi, Bengali, Assamese, Tamil, Marathi
- Language switcher in header
- PWA-ready architecture

## 🚀 Quick Start

### Backend
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Access
- **Dashboard**: http://localhost:5173
- **API Docs**: http://localhost:8000/docs
- **API Root**: http://localhost:8000

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/zones` | All monitored zones with risk data |
| GET | `/api/zones/{id}` | Single zone detail |
| GET | `/api/dashboard` | Aggregated dashboard data |
| GET | `/api/predictions` | Run ML predictions for all zones |
| GET | `/api/weather/{zone_id}` | Current weather + forecast |
| GET | `/api/roads` | Road connectivity status |
| GET | `/api/villages` | Village monitoring data |
| GET | `/api/alerts` | Active alerts |
| POST | `/api/alerts` | Create new alert |
| POST | `/api/reports` | Submit citizen report |
| GET | `/api/reports` | List field reports |
| GET | `/api/heatmap` | GeoJSON risk heatmap data |
| GET | `/api/stats` | Summary statistics |
| POST | `/api/simulate/update` | Simulate real-time data changes |
| POST | `/api/simulate/road_disruption` | Simulate road blockage |
| WS | `/ws/alerts` | Real-time alert stream |

## 🧠 AI/ML Model

The prediction engine uses a **multi-factor weighted scoring model**:

```
Risk Score = w1·Rainfall + w2·Slope + w3·Soil + w4·Vegetation + w5·Sensors + w6·History
```

| Factor | Weight | Description |
|--------|--------|-------------|
| Rainfall Intensity | 0.25 | IMD rainfall classification |
| Slope Angle | 0.20 | Terrain steepness (degrees) |
| Soil Susceptibility | 0.12 | Soil type risk mapping |
| Sensor Anomaly | 0.10 | IoT sensor threshold breaches |
| Vegetation Loss | 0.10 | Bare slope exposure |
| Historical Events | 0.08 | Past landslide frequency |

**In production**: Replace with trained XGBoost/LSTM models using real NER historical data from GSI, IMD, and ISRO satellite feeds.

## 📊 Seeded Data

### 24 Monitored Zones across 7 states:
- **Meghalaya**: Cherrapunji, Mawsynram, Shillong Plateau
- **Arunachal Pradesh**: Tawang, Ziro, Itanagar, Pasighat
- **Nagaland**: Dzükou Valley, Kohima, Mokokchung
- **Manipur**: Tamenglong, Jiribam, Imphal Valley Edge
- **Mizoram**: Aizawl, Lunglei, Champhai, Kolasib
- **Assam**: Dibrugarh, Guwahati, Tezpur, Silchar, Haflong
- **Tripura**: Agartala Foothills

### 12 Major Roads (NH, SH, District)
### 14 Villages with population data
### 2-4 sensors per zone (rainfall, soil moisture, tilt, GPS displacement)
### Weather data with monsoon patterns
### Historical landslide events

## 🔧 Production Roadmap

1. **Real IMD API integration** (api.imd.gov.in)
2. **ISRO satellite feed** (Bhuvan API for real-time imagery)
3. **GSI landslide inventory** integration
4. **Trained ML models** (XGBoost, LSTM for time-series)
5. **PostgreSQL + PostGIS** for geospatial queries
6. **Redis** for real-time sensor data caching
7. **AWS/Azure cloud** deployment with auto-scaling
8. **SMS gateway** (Twilio/MSG91) for actual alerts
9. **React Native mobile app** with offline sync (SQLite + CRDTs)
10. **Offline-first PWA** with service workers for remote areas

## 🛡️ Data Sources (Production)

| Source | Data Type | API |
|--------|-----------|-----|
| IMD | Rainfall, weather | api.imd.gov.in |
| ISRO/Bhuvan | Satellite imagery | bhuvan.nrsc.gov.in |
| GSI | Landslide inventory | gsi.gov.in |
| USGS | Earthquake data | earthquake.usgs.gov |
| IoT Sensors | Real-time readings | MQTT/HTTP |
| OpenStreetMap | Road/infrastructure | Overpass API |

---

**Built for climate-resilient governance in the North Eastern Region** 🇮🇳
