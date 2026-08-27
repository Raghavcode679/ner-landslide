import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import {
  LayoutDashboard, MapPin, AlertTriangle, Route, Home, Brain,
  History, FileText, Shield, ShieldOff, Globe, RefreshCw,
  Radio, ChevronRight, TrendingUp, AlertCircle, Mountain,
  CloudRain, Activity, Users, Eye, EyeOff, Camera, X,
  Send, Loader2, CheckCircle2, XCircle, Thermometer, Wind,
  Droplets, Waves, Map as MapIcon, BarChart3, Settings
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// ============ TYPES ============
interface Zone {
  id: number; name: string; district: string; state: string;
  latitude: number; longitude: number; elevation_m: number;
  slope_angle_deg: number; soil_type: string; vegetation_cover: number;
  risk_level: string; risk_score: number; sensor_count: number; active_alerts: number;
}

interface DashboardData {
  summary: {
    total_zones: number; critical_zones: number; high_risk_zones: number;
    active_alerts: number; total_villages: number; isolated_villages: number;
    roads_blocked: number; avg_risk_score: number;
  };
  risk_distribution: Record<string, number>;
  road_status: Record<string, number>;
  village_connectivity: Record<string, number>;
  recent_alerts: any[];
  top_risk_zones: any[];
}

interface Alert {
  id: number; title: string; message: string; risk_level: string;
  status: string; latitude: number; longitude: number;
  created_at: string; zone_id: number; channels?: string[];
}

interface Road { id: number; name: string; road_type: string; from_place: string; to_place: string; latitude: number; longitude: number; status: string; }
interface Village { id: number; name: string; district: string; state: string; latitude: number; longitude: number; population: number; connectivity_status: string; }
interface WeatherData { zone_id: number; zone_name: string; current: any; forecast: any[]; }
interface Report { id: number; reporter_name: string; latitude: number; longitude: number; report_type: string; description: string; severity_claimed: string; verified: boolean; created_at: string; media_urls?: string[]; }
interface Prediction { zone_id: number; zone_name: string; risk_score: number; risk_level: string; contributing_factors: Record<string, number>; recommended_actions: string[]; confidence: number; }

// ============ API ============
const API_BASE = (import.meta as any).env?.VITE_API_URL
  ? `${(import.meta as any).env.VITE_API_URL}/api`
  : '/api';

async function fetchAPI<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function getAuthToken(): string | null {
  return sessionStorage.getItem('admin_token');
}

async function postAPI<T>(path: string, data?: any, isForm = false): Promise<T> {
  let res: Response;
  if (isForm && data) {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: data });
  } else {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
    });
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ============ WEBSOCKET ============
function useWebSocket(url: string, onMessage: (data: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${url}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => console.log('WebSocket connected');
      ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => { reconnectRef.current = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => { wsRef.current?.close(); if (reconnectRef.current) clearTimeout(reconnectRef.current); };
  }, [url]);
  return wsRef;
}

// ============ CONSTANTS ============
const riskColor: Record<string, string> = { low: '#22c55e', moderate: '#eab308', high: '#f97316', critical: '#ef4444' };
const riskBg: Record<string, string> = { low: 'rgba(34,197,94,0.08)', moderate: 'rgba(234,179,8,0.08)', high: 'rgba(249,115,22,0.08)', critical: 'rgba(239,68,68,0.08)' };
const roadColors: Record<string, string> = { open: '#22c55e', blocked: '#ef4444', partial: '#eab308', damaged: '#f97316' };
const badgeClass: Record<string, string> = { low: 'badge-low', moderate: 'badge-moderate', high: 'badge-high', critical: 'badge-critical' };

const LANGUAGES: Record<string, Record<string, string>> = {
  en: { dashboard: 'Dashboard', zones: 'Zones', alerts: 'Alerts', roads: 'Roads', villages: 'Villages', reports: 'Reports', weather: 'Weather', predictions: 'Predictions', history: 'History', report_now: 'Report Now', title: 'NER Landslide Early Warning', subtitle: 'AI-Powered Disaster Monitoring', risk_summary: 'Risk Summary', road_status: 'Road Status', village_status: 'Village Connectivity', active_alerts: 'Active Alerts', top_risk: 'Top Risk Zones', simulate: 'Simulate Update', language: 'Language', search: 'Search zones...' },
  hi: { dashboard: 'डैशबोर्ड', zones: 'क्षेत्र', alerts: 'अलर्ट', roads: 'सड़कें', villages: 'गाँव', reports: 'रिपोर्ट', weather: 'मौसम', predictions: 'भविष्यवाणी', history: 'इतिहास', report_now: 'अभी रिपोर्ट करें', title: 'पूर्वोत्तर भूस्खलन चेतावनी', subtitle: 'AI-संचालित आपदा निगरानी', risk_summary: 'जोखिम सारांश', road_status: 'सड़क स्थिति', village_status: 'गाँव कनेक्टिविटी', active_alerts: 'सक्रिय अलर्ट', top_risk: 'उच्च जोखिम क्षेत्र', simulate: 'अपडेट अनुकरण', language: 'भाषा', search: 'क्षेत्र खोजें...' },
  bn: { dashboard: 'ড্যাশবোর্ড', zones: 'অঞ্চল', alerts: 'সতর্কতা', roads: 'সড়ক', villages: 'গ্রাম', reports: 'প্রতিবেদন', weather: 'আবহাওয়া', predictions: 'পূর্বাভাস', history: 'ইতিহাস', report_now: 'এখনই জানান', title: 'উত্তর-পূর্ব ভূমিধস সতর্কতা', subtitle: 'AI-চালিত দুর্যোগ পর্যবেক্ষণ', risk_summary: 'ঝুঁকি সারসংক্ষেপ', road_status: 'সড়ক স্থিতি', village_status: 'গ্রাম সংযোগ', active_alerts: 'সক্রিয় সতর্কতা', top_risk: 'সর্বোচ্চ ঝুঁকি অঞ্চল', simulate: 'আপডেট সিমুলেট', language: 'ভাষা', search: 'অঞ্চল খুঁজুন...' },
  as: { dashboard: 'ডেশবৰ্ড', zones: 'অঞ্চল', alerts: 'সতৰ্কতা', roads: 'ৰাস্তা', villages: 'গাঁও', reports: 'প্ৰতিবেদন', weather: 'বতৰা', predictions: 'পূৰ্বানুমান', history: 'ইতিহাস', report_now: 'এতিয়াই সঁচাৰ কৰক', title: 'উত্তৰ-পূৱ ভূমিধ্বংস সতৰ্কতা', subtitle: 'AI-চালিত দুৰ্ঘটনা নিৰীক্ষণ', risk_summary: 'বিপদৰ সাৰাংশ', road_status: 'ৰাস্তা স্থিতি', village_status: 'গাঁও সংযোগ', active_alerts: 'সক্ৰিয় সতৰ্কতা', top_risk: 'চৰ্বোচ্চ বিপদ অঞ্চল', simulate: 'আপডেট চিমুলেট', language: 'ভাষা', search: 'অঞ্চল বিচাৰক...' },
  mr: { dashboard: 'डॅशबोर्ड', zones: 'झोने', alerts: 'सूचना', roads: 'मार्ग', villages: 'गावे', reports: 'अहवाल', weather: 'हवामान', predictions: 'अंदाज', history: 'इतिहास', report_now: 'आता कळवा', title: 'उत्तर-पूर्व भूस्खलन सूचना', subtitle: 'AI-शक्तीवर आपत्ती निरीक्षण', risk_summary: 'धोका सारांश', road_status: 'मार्ग स्थिती', village_status: 'गाव कनेक्टिव्हिटी', active_alerts: 'सक्रिय सूचना', top_risk: 'सर्वाधिक धोकादायक', simulate: 'अद्यतन सिम्युलेट', language: 'भाषा', search: 'झोने शोधा...' },
  ta: { dashboard: 'டாஷ்போர்டு', zones: 'மண்டலங்கள்', alerts: 'எச்சரிக்கை', roads: 'சாலைகள்', villages: 'கிராமங்கள்', reports: 'அறிக்கைகள்', weather: 'வானிலை', predictions: 'முன்னறிவிப்பு', history: 'வரலாறு', report_now: 'இப்போது தெரிவிக்கவும்', title: 'வடகிழக்கு மண்சரிவு எச்சரிக்கை', subtitle: 'AI-இயங்கும் பேரிடர் கண்காணிப்பு', risk_summary: 'ஆபத்து சுருக்கம்', road_status: 'சாலை நிலை', village_status: 'கிராம இணைப்பு', active_alerts: 'செயலில் உள்ள எச்சரிக்கை', top_risk: 'அதிக ஆபத்து மண்டலங்கள்', simulate: 'புதுப்பிப்பு சிமுலேஷன்', language: 'மொழி', search: 'மண்டலங்களைத் தேடு...' },
};

// ============ MAP COMPONENT ============
function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(center, 6); }, [center]);
  return null;
}

// ============ MAIN APP ============
export default function App() {
  const [lang, setLang] = useState('en');
  const [page, setPage] = useState('dashboard');
  const [zones, setZones] = useState<Zone[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [villages, setVillages] = useState<Village[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [reportStatus, setReportStatus] = useState<{ type: 'success' | 'error' | 'loading' | null; message: string }>({ type: null, message: '' });
  const [predicting, setPredicting] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoginError, setAdminLoginError] = useState('');
  const [adminLoggingIn, setAdminLoggingIn] = useState(false);
  const [reportPhotos, setReportPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [dataSourceStatus, setDataSourceStatus] = useState<Record<string, any>>({});
  const [syncingRealData, setSyncingRealData] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const t = LANGUAGES[lang] || LANGUAGES.en;

  // WebSocket
  useWebSocket('/ws/alerts', (data) => {
    if (data.type === 'new_alert') {
      setAlerts(prev => [{ id: data.alert_id, title: data.zone_name, message: data.message, risk_level: data.risk_level, status: 'active', latitude: 0, longitude: 0, created_at: data.timestamp, zone_id: 0 }, ...prev]);
    }
  });

  // Toast helper
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [z, d, a, r, v] = await Promise.all([
        fetchAPI<Zone[]>('/zones'),
        fetchAPI<DashboardData>('/dashboard'),
        fetchAPI<Alert[]>('/alerts'),
        fetchAPI<Road[]>('/roads'),
        fetchAPI<Village[]>('/villages'),
      ]);
      setZones(z); setDashboard(d); setAlerts(a); setRoads(r); setVillages(v);
    } catch (e) { console.error('Load error:', e); }
    setLoading(false);
  }, []);

  const loadReports = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const data = await fetchAPI<{ reports?: Report[]; error?: string } | Report[]>('/reports', token);
      const reportList = Array.isArray(data) ? data : (data.reports || []);
      setReports(reportList);
    } catch (e) { console.error('Load reports error:', e); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const runPredictions = async () => {
    setPredicting(true);
    try {
      const data = await fetchAPI<{ predictions: Prediction[] }>('/predictions');
      setPredictions(data.predictions);
      const z = await fetchAPI<Zone[]>('/zones');
      setZones(z);
      showToast('success', 'Predictions complete. Analysis updated for all 24 zones.');
    } catch (e) {
      showToast('error', 'Failed to run predictions. Ensure backend is running.');
    }
    setPredicting(false);
  };

  const simulateUpdate = async () => {
    setSimulating(true);
    try {
      await postAPI('/simulate/update');
      await loadData();
      await runPredictions();
      showToast('success', 'Simulation complete. Data and predictions refreshed.');
    } catch (e) { showToast('error', 'Simulation failed.'); }
    setSimulating(false);
  };

  const loadWeather = async (zoneId: number) => {
    try {
      const w = await fetchAPI<WeatherData>(`/weather/${zoneId}`);
      setWeather(w);
      setSelectedZoneId(zoneId);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (showReportForm && !userLocation) {
      setLocationError('');
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => { setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setLocationError(''); },
          () => { setLocationError('Location unavailable. Using default NER coordinates.'); setUserLocation({ lat: 25.6, lon: 93.5 }); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      } else {
        setLocationError('Geolocation not supported.');
        setUserLocation({ lat: 25.6, lon: 93.5 });
      }
    }
  }, [showReportForm]);

  const handleAdminLogin = async () => {
    setAdminLoggingIn(true);
    setAdminLoginError('');
    try {
      const form = new FormData();
      form.set('password', adminPassword);
      const result = await fetch(`${API_BASE}/admin/login`, { method: 'POST', body: form });
      const data = await result.json();
      if (!result.ok) throw new Error(data.detail || 'Login failed');
      sessionStorage.setItem('admin_token', data.token);
      setIsAdmin(true);
      setShowAdminLogin(false);
      setAdminPassword('');
      loadReports();
      showToast('success', 'Admin access granted.');
    } catch (err) {
      setAdminLoginError(err instanceof Error ? err.message : 'Login failed');
    }
    setAdminLoggingIn(false);
  };

  const handleAdminLogout = () => {
    sessionStorage.removeItem('admin_token');
    setIsAdmin(false);
    setReports([]);
    showToast('success', 'Admin logged out.');
  };

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      fetchAPI<{ authenticated: boolean }>('/admin/verify', token)
        .then(d => { if (d.authenticated) { setIsAdmin(true); loadReports(); } })
        .catch(() => sessionStorage.removeItem('admin_token'));
    }
    const loadStatus = (attempt: number) => {
      fetchAPI<Record<string, any>>('/data-sources/status')
        .then(setDataSourceStatus)
        .catch(() => { if (attempt < 3) setTimeout(() => loadStatus(attempt + 1), 3000); });
    };
    loadStatus(0);
  }, []);

  const syncRealData = async () => {
    const token = getAuthToken();
    if (!token) return;
    setSyncingRealData(true);
    try {
      const res = await fetch(`${API_BASE}/admin/sync-real-data`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      showToast('success', `Synced ${data.zones_updated}/${data.total_zones} zones with real data.`);
      await loadData();
    } catch (e) { showToast('error', 'Sync failed.'); }
    setSyncingRealData(false);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newPhotos = [...reportPhotos, ...files].slice(0, 5);
    setReportPhotos(newPhotos);
    setPhotoPreviewUrls(newPhotos.map(f => URL.createObjectURL(f)));
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(photoPreviewUrls[idx]);
    setReportPhotos(reportPhotos.filter((_, i) => i !== idx));
    setPhotoPreviewUrls(photoPreviewUrls.filter((_, i) => i !== idx));
  };

  const submitReport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setReportStatus({ type: 'loading', message: 'Submitting report...' });
    const form = new FormData(e.currentTarget);
    form.set('latitude', String(userLocation?.lat || 25.6));
    form.set('longitude', String(userLocation?.lon || 93.5));
    form.set('reporter_role', 'citizen');
    reportPhotos.forEach(photo => form.append('photos', photo));
    try {
      const result = await postAPI<{ report_id: number; media_urls: string[] }>('/reports', form, true);
      setReportStatus({ type: 'success', message: `Report #${result.report_id} submitted successfully.` });
      setReportPhotos([]);
      setPhotoPreviewUrls([]);
      showToast('success', 'Field report submitted with GPS location and photos.');
    } catch (err) {
      setReportStatus({ type: 'error', message: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
  };

  const centerPos: [number, number] = selectedZone ? [selectedZone.latitude, selectedZone.longitude] : [25.5, 93.0];
  const activeAlertCount = alerts.filter(a => a.status === 'active').length;

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Initializing monitoring systems</div>
      </div>
    );
  }

  // ============ SIDEBAR NAV ITEMS ============
  const navItems = [
    { id: 'dashboard', label: t.dashboard, icon: LayoutDashboard },
    { id: 'zones', label: t.zones, icon: MapPin },
    { id: 'alerts', label: t.alerts, icon: AlertTriangle, badge: activeAlertCount || undefined, badgeClass: 'warning' },
    { id: 'roads', label: t.roads, icon: Route },
    { id: 'villages', label: t.villages, icon: Home },
    { id: 'predictions', label: t.predictions, icon: Brain },
    { id: 'history', label: t.history, icon: History },
  ];

  if (isAdmin) {
    navItems.push({ id: 'reports', label: t.reports, icon: FileText });
  }

  return (
    <div className="app-layout">
      {/* ============ SIDEBAR ============ */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <Mountain size={20} />
          </div>
          <div className="sidebar-brand-text">
            <h1>NER Early Warning</h1>
            <p>Landslide Monitoring</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Operations</div>
          {navItems.slice(0, 5).map(item => (
            <button key={item.id} className={`sidebar-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}>
              <item.icon className="sidebar-item-icon" size={18} />
              {item.label}
              {item.badge !== undefined && (
                <span className={`sidebar-item-badge ${item.badgeClass || ''}`}>{item.badge}</span>
              )}
            </button>
          ))}

          <div className="sidebar-section-label">Analytics</div>
          {navItems.slice(5).map(item => (
            <button key={item.id} className={`sidebar-item ${page === item.id ? 'active' : ''}`}
              onClick={() => { setPage(item.id); if (item.id === 'reports') loadReports(); }}>
              <item.icon className="sidebar-item-icon" size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-section-label" style={{ padding: '0 0 8px' }}>Data Sources</div>
          <div className="sidebar-data-sources">
            {dataSourceStatus.open_meteo_weather && (
              <span className={`data-source-pill ${dataSourceStatus.open_meteo_weather.status === 'ok' ? 'ok' : 'error'}`}>
                <span className="data-source-dot" />
                Rain
              </span>
            )}
            {dataSourceStatus.sentinel_2_ndvi && (
              <span className={`data-source-pill ${dataSourceStatus.sentinel_2_ndvi.status === 'ok' ? 'ok' : 'error'}`}>
                <span className="data-source-dot" />
                NDVI
              </span>
            )}
            {dataSourceStatus.srtm_elevation && (
              <span className={`data-source-pill ${dataSourceStatus.srtm_elevation.status === 'ok' ? 'ok' : 'error'}`}>
                <span className="data-source-dot" />
                DEM
              </span>
            )}
            {dataSourceStatus.mqtt_sensors && (
              <span className={`data-source-pill ${dataSourceStatus.mqtt_sensors.mqtt_connected ? 'ok' : 'error'}`}>
                <span className="data-source-dot" />
                MQTT
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <div className="main-content">
        {/* Top Bar */}
        <header className="topbar">
          <div className="topbar-left">
            <h2 className="topbar-page-title">
              {navItems.find(n => n.id === page)?.label || page}
            </h2>
          </div>
          <div className="topbar-right">
            <select className="lang-select" value={lang} onChange={e => setLang(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="bn">বাংলা</option>
              <option value="as">অসমীয়া</option>
              <option value="mr">मराठी</option>
              <option value="ta">தமிழ்</option>
            </select>

            <button className="btn btn-ghost btn-sm" onClick={simulateUpdate} disabled={simulating}>
              {simulating ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
              {simulating ? 'Updating...' : t.simulate}
            </button>

            {isAdmin && (
              <button className="btn btn-success btn-sm" onClick={syncRealData} disabled={syncingRealData}>
                {syncingRealData ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {syncingRealData ? 'Syncing...' : 'Sync Real Data'}
              </button>
            )}

            <button className="btn btn-danger btn-sm" onClick={() => setShowReportForm(true)}>
              <Camera size={14} />
              {t.report_now}
            </button>

            {isAdmin ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="admin-badge"><Shield size={12} /> Admin</span>
                <button className="btn btn-ghost btn-sm" onClick={handleAdminLogout}>
                  <ShieldOff size={14} /> Logout
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAdminLogin(true)}>
                <Shield size={14} /> Admin
              </button>
            )}
          </div>
        </header>

        {/* Page Content */}
        <div className="page-content animate-fade-in" key={page}>

          {/* ============ DASHBOARD ============ */}
          {page === 'dashboard' && dashboard && (
            <>
              <div className="stat-grid">
                {[
                  { label: 'Monitored Zones', value: dashboard.summary.total_zones, icon: MapPin, color: '#6391ff', bg: 'rgba(99,145,255,0.1)' },
                  { label: 'Critical Zones', value: dashboard.summary.critical_zones, icon: AlertCircle, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
                  { label: 'High Risk', value: dashboard.summary.high_risk_zones, icon: TrendingUp, color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
                  { label: 'Active Alerts', value: dashboard.summary.active_alerts, icon: AlertTriangle, color: '#eab308', bg: 'rgba(234,179,8,0.1)' },
                  { label: 'Avg Risk Score', value: `${dashboard.summary.avg_risk_score}%`, icon: BarChart3, color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
                  { label: 'Roads Blocked', value: dashboard.summary.roads_blocked, icon: Route, color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
                  { label: 'Isolated Villages', value: dashboard.summary.isolated_villages, icon: Users, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
                ].map((s, i) => (
                  <div key={i} className="stat-card" style={{ '--stat-accent': s.color } as any}>
                    <div className="stat-card-top">
                      <span className="stat-card-label">{s.label}</span>
                      <div className="stat-card-icon" style={{ background: s.bg }}>
                        <s.icon size={18} color={s.color} />
                      </div>
                    </div>
                    <div className="stat-card-value" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid-2 mb-5">
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title"><MapIcon size={16} className="card-title-icon" /> GIS Risk Map</div>
                      <div className="card-subtitle">Interactive monitoring zones across NER</div>
                    </div>
                  </div>
                  <div className="map-wrapper" style={{ height: 380 }}>
                    <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                      {zones.map(z => (
                        <CircleMarker key={z.id} center={[z.latitude, z.longitude]} radius={Math.max(6, z.risk_score / 8)}
                          fillColor={riskColor[z.risk_level]} color={riskColor[z.risk_level]} weight={2} fillOpacity={0.75}
                          eventHandlers={{ click: () => { setSelectedZone(z); loadWeather(z.id); } }}>
                          <Popup><div style={{ fontFamily: 'Inter, sans-serif', color: '#1e293b' }}><strong>{z.name}</strong><br />{z.district}, {z.state}<br />Risk: <strong style={{ color: riskColor[z.risk_level] }}>{z.risk_level.toUpperCase()}</strong> ({z.risk_score}%)</div></Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title"><BarChart3 size={16} className="card-title-icon" /> {t.risk_summary}</div>
                      <div className="card-subtitle">Zone distribution by risk classification</div>
                    </div>
                  </div>
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height={170}>
                      <BarChart data={Object.entries(dashboard.risk_distribution).map(([k, v]) => ({ name: k, count: v }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#1a2234', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {Object.entries(dashboard.risk_distribution).map(([key]) => (
                            <Cell key={key} fill={riskColor[key]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="card-header" style={{ borderBottom: 'none', paddingTop: 4 }}>
                    <div className="card-title" style={{ fontSize: 12 }}><Activity size={14} className="card-title-icon" /> {t.road_status}</div>
                  </div>
                  <div className="chart-container" style={{ paddingTop: 0 }}>
                    <ResponsiveContainer width="100%" height={140}>
                      <PieChart>
                        <Pie data={Object.entries(dashboard.road_status).map(([k, v]) => ({ name: k, value: v }))}
                          cx="50%" cy="50%" outerRadius={55} innerRadius={30} dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}>
                          {Object.entries(dashboard.road_status).map(([key]) => (
                            <Cell key={key} fill={roadColors[key] || '#64748b'} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#1a2234', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="grid-2">
                <div className="card">
                  <div className="card-header">
                    <div className="card-title"><AlertTriangle size={16} className="card-title-icon" /> {t.top_risk}</div>
                  </div>
                  <div className="card-body" style={{ padding: '8px 20px 16px' }}>
                    {(dashboard.top_risk_zones || []).length === 0 && (
                      <div className="empty-state" style={{ padding: '24px 0' }}>
                        <p className="empty-state-desc">Run predictions to identify top risk zones</p>
                      </div>
                    )}
                    {(dashboard.top_risk_zones || []).slice(0, 6).map((z: any, i: number) => (
                      <div key={z.id || i} className="zone-item"
                        onClick={() => { if (z?.latitude && z?.longitude) { setSelectedZone(z); setPage('zones'); } }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{z.name || z.zone_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{z.district}</div>
                        </div>
                        <div className="risk-bar-container" style={{ width: 160 }}>
                          <div className="risk-bar">
                            <div className="risk-bar-fill" style={{ width: `${Math.min(100, z.risk_score || 0)}%`, background: riskColor[z.risk_level] }} />
                          </div>
                          <span className="risk-bar-value" style={{ color: riskColor[z.risk_level] }}>{z.risk_score || 0}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div className="card-title"><AlertCircle size={16} className="card-title-icon" /> {t.active_alerts}</div>
                  </div>
                  <div className="card-body" style={{ padding: '8px 20px 16px', maxHeight: 360, overflowY: 'auto' }}>
                    {alerts.filter(a => a.status === 'active').length === 0 && (
                      <div className="empty-state" style={{ padding: '24px 0' }}>
                        <CheckCircle2 size={32} style={{ color: 'var(--status-success)', margin: '0 auto 8px', opacity: 0.5 }} />
                        <p className="empty-state-desc">No active alerts. System operating normally.</p>
                      </div>
                    )}
                    {alerts.filter(a => a.status === 'active').slice(0, 6).map(a => (
                      <div key={a.id} className={`alert-card ${a.risk_level}`} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span className={`badge ${badgeClass[a.risk_level]}`}>{a.risk_level.toUpperCase()}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                        </div>
                        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ============ ZONES ============ */}
          {page === 'zones' && (
            <>
              <div className="card mb-5">
                <div className="map-wrapper" style={{ height: 340 }}>
                  <MapContainer center={centerPos} zoom={selectedZone ? 10 : 6} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                    <MapUpdater center={centerPos} />
                    {zones.map(z => (
                      <CircleMarker key={z.id} center={[z.latitude, z.longitude]} radius={Math.max(6, z.risk_score / 7)}
                        fillColor={riskColor[z.risk_level]} color={riskColor[z.risk_level]} weight={2} fillOpacity={0.75}
                        eventHandlers={{ click: () => { setSelectedZone(z); loadWeather(z.id); } }}>
                        <Popup><div style={{ fontFamily: 'Inter, sans-serif', color: '#1e293b' }}><strong>{z.name}</strong><br />Risk: {z.risk_level} ({z.risk_score}%)</div></Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: selectedZone ? '1fr 1fr' : '1fr', gap: 18 }}>
                {selectedZone && (
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title"><MapPin size={16} className="card-title-icon" /> {selectedZone.name}</div>
                      <span className={`badge ${badgeClass[selectedZone.risk_level]}`}>{selectedZone.risk_level.toUpperCase()}</span>
                    </div>
                    <div className="card-body">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                        {[
                          ['District', selectedZone.district],
                          ['State', selectedZone.state],
                          ['Elevation', `${selectedZone.elevation_m}m`],
                          ['Slope', `${selectedZone.slope_angle_deg}°`],
                          ['Soil Type', selectedZone.soil_type],
                          ['Vegetation', `${(selectedZone.vegetation_cover * 100).toFixed(0)}%`],
                          ['Sensors', `${selectedZone.sensor_count}`],
                          ['Active Alerts', `${selectedZone.active_alerts}`],
                        ].map(([label, val]) => (
                          <div key={label} style={{ fontSize: 12.5 }}>
                            <span style={{ color: 'var(--text-tertiary)' }}>{label}:</span>{' '}
                            <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{val}</span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
                          <span style={{ color: 'var(--text-tertiary)' }}>Risk Score</span>
                          <span style={{ fontWeight: 600, color: riskColor[selectedZone.risk_level] }}>{selectedZone.risk_score}/100</span>
                        </div>
                        <div className="risk-bar" style={{ height: 8 }}>
                          <div className="risk-bar-fill" style={{ width: `${selectedZone.risk_score}%`, background: `linear-gradient(90deg, var(--status-success), ${riskColor[selectedZone.risk_level]})` }} />
                        </div>
                      </div>
                      {weather && selectedZoneId === selectedZone.id && (
                        <div style={{ marginTop: 16, padding: 14, background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CloudRain size={14} /> Current Weather
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {([
                              [Droplets, 'Rainfall', `${weather.current.rainfall_mm} mm`, '#3b82f6'],
                              [Thermometer, 'Temp', `${weather.current.temperature_c}°C`, '#f97316'],
                              [Waves, 'Humidity', `${weather.current.humidity_pct}%`, '#06b6d4'],
                              [Wind, 'Wind', `${weather.current.wind_speed_kmh} km/h`, '#8b5cf6'],
                            ] as any[]).map(([Icon, label, val, color]: [any, string, string, string]) => (
                              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                <Icon size={13} style={{ color }} />
                                <span style={{ color: 'var(--text-tertiary)' }}>{label}:</span>
                                <span style={{ fontWeight: 500 }}>{val}</span>
                              </div>
                            ))}
                          </div>
                          {weather.current.storm_active && (
                            <div style={{ marginTop: 10, padding: '6px 10px', background: 'var(--risk-critical-bg)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--risk-critical)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <AlertCircle size={12} /> Active storm system detected
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="card">
                  <div className="card-header">
                    <div className="card-title"><MapPin size={16} className="card-title-icon" /> All Zones ({zones.length})</div>
                  </div>
                  <div className="card-body" style={{ padding: '8px 12px', maxHeight: 560, overflowY: 'auto' }}>
                    {[...zones].sort((a, b) => b.risk_score - a.risk_score).map(z => (
                      <div key={z.id} className={`zone-item ${selectedZone?.id === z.id ? 'selected' : ''}`}
                        onClick={() => { setSelectedZone(z); loadWeather(z.id); }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{z.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{z.district}, {z.state}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: riskColor[z.risk_level], fontVariantNumeric: 'tabular-nums' }}>{z.risk_score}%</div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{z.risk_level}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ============ ALERTS ============ */}
          {page === 'alerts' && (
            <>
              <div className="page-header">
                <div>
                  <div className="page-title">Alerts & Notifications</div>
                  <div className="page-subtitle">Real-time monitoring alerts and SMS broadcast history</div>
                </div>
              </div>
              <div className="grid-2">
                <div className="card">
                  <div className="map-wrapper" style={{ height: 380 }}>
                    <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      {alerts.filter(a => a.status === 'active' && a.latitude && a.longitude).map(a => (
                        <CircleMarker key={a.id} center={[a.latitude, a.longitude]} radius={10}
                          fillColor={riskColor[a.risk_level]} color={riskColor[a.risk_level]} weight={3} fillOpacity={0.8}>
                          <Popup><div style={{ fontFamily: 'Inter, sans-serif', color: '#1e293b' }}><strong>{a.title}</strong><br />{a.message}</div></Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                  </div>
                </div>
                <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                  {alerts.length === 0 && (
                    <div className="empty-state">
                      <AlertTriangle size={40} style={{ color: 'var(--text-disabled)', margin: '0 auto 12px' }} />
                      <p className="empty-state-title">No alerts yet</p>
                      <p className="empty-state-desc">Run predictions to generate alerts for high-risk zones</p>
                    </div>
                  )}
                  {alerts.map(a => (
                    <div key={a.id} className={`alert-card ${a.risk_level}`} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className={`badge ${badgeClass[a.risk_level]}`}>{a.risk_level.toUpperCase()}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{a.status} | {a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{a.title}</div>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>{a.message}</p>
                      {a.channels && a.channels.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {a.channels.map((ch: string) => (
                            <span key={ch} className="badge badge-outline" style={{ fontSize: 10 }}>{ch}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ============ ROADS ============ */}
          {page === 'roads' && (
            <>
              <div className="page-header">
                <div>
                  <div className="page-title">Road Connectivity Status</div>
                  <div className="page-subtitle">Major highway and road monitoring across NER</div>
                </div>
              </div>
              <div className="grid-2">
                <div className="card">
                  <div className="map-wrapper" style={{ height: 420 }}>
                    <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      {roads.map(r => (
                        <CircleMarker key={r.id} center={[r.latitude, r.longitude]} radius={8}
                          fillColor={roadColors[r.status]} color={roadColors[r.status]} weight={2} fillOpacity={0.8}>
                          <Popup><div style={{ fontFamily: 'Inter, sans-serif', color: '#1e293b' }}><strong>{r.name}</strong><br />Status: {r.status}<br />{r.from_place} → {r.to_place}</div></Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                  </div>
                </div>
                <div>
                  <div className="card mb-4">
                    <div className="card-header">
                      <div className="card-title"><BarChart3 size={16} className="card-title-icon" /> Status Overview</div>
                    </div>
                    <div className="chart-container">
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={roads.reduce((acc: any[], r) => { const ex = acc.find(a => a.name === r.status); if (ex) ex.count++; else acc.push({ name: r.status, count: 1 }); return acc; }, [])}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: '#64748b' }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ background: '#1a2234', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {roads.reduce((acc: any[], r) => { if (!acc.find(a => a.name === r.status)) acc.push({ name: r.status }); return acc; }, []).map((r: any) => (
                              <Cell key={r.name} fill={roadColors[r.name] || '#64748b'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title"><Route size={16} className="card-title-icon" /> All Roads ({roads.length})</div>
                    </div>
                    <div className="card-body" style={{ padding: '8px 12px', maxHeight: 300, overflowY: 'auto' }}>
                      {roads.map(r => (
                        <div key={r.id} className="zone-item">
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.from_place} → {r.to_place}</div>
                          </div>
                          <span className={`badge ${r.status === 'open' ? 'badge-low' : r.status === 'blocked' ? 'badge-critical' : r.status === 'partial' ? 'badge-moderate' : 'badge-high'}`}>
                            {r.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ============ VILLAGES ============ */}
          {page === 'villages' && (
            <>
              <div className="page-header">
                <div>
                  <div className="page-title">Village Monitoring</div>
                  <div className="page-subtitle">Connectivity status and population tracking for vulnerable communities</div>
                </div>
              </div>
              <div className="grid-2">
                <div className="card">
                  <div className="map-wrapper" style={{ height: 420 }}>
                    <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      {villages.map(v => (
                        <CircleMarker key={v.id} center={[v.latitude, v.longitude]} radius={Math.max(5, v.population / 10000)}
                          fillColor={v.connectivity_status === 'connected' ? '#22c55e' : v.connectivity_status === 'partially_isolated' ? '#eab308' : '#ef4444'}
                          color={v.connectivity_status === 'connected' ? '#22c55e' : v.connectivity_status === 'partially_isolated' ? '#eab308' : '#ef4444'}
                          weight={2} fillOpacity={0.7}>
                          <Popup><div style={{ fontFamily: 'Inter, sans-serif', color: '#1e293b' }}><strong>{v.name}</strong><br />{v.district}, {v.state}<br />Pop: {v.population.toLocaleString()}<br />Status: {v.connectivity_status}</div></Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                  </div>
                </div>
                <div className="card">
                  <div className="card-header">
                    <div className="card-title"><Home size={16} className="card-title-icon" /> Villages ({villages.length})</div>
                  </div>
                  <div className="card-body" style={{ padding: '8px 12px', maxHeight: 460, overflowY: 'auto' }}>
                    {villages.map(v => {
                      const statusColor = v.connectivity_status === 'connected' ? 'var(--status-success)' : v.connectivity_status === 'partially_isolated' ? 'var(--status-warning)' : 'var(--status-error)';
                      return (
                        <div key={v.id} className="zone-item" style={{ borderLeft: `3px solid ${statusColor}` }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{v.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{v.district}, {v.state}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>Pop: {v.population.toLocaleString()}</div>
                            <span className={`badge ${v.connectivity_status === 'connected' ? 'badge-low' : v.connectivity_status === 'partially_isolated' ? 'badge-moderate' : 'badge-critical'}`} style={{ fontSize: 10, marginTop: 2 }}>
                              {v.connectivity_status === 'connected' ? 'Connected' : v.connectivity_status === 'partially_isolated' ? 'Partial' : 'Isolated'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ============ PREDICTIONS ============ */}
          {page === 'predictions' && (
            <>
              <div className="page-header">
                <div>
                  <div className="page-title">AI/ML Risk Analysis</div>
                  <div className="page-subtitle">Multi-factor predictive modeling for all 24 monitored zones</div>
                </div>
                <button className="btn btn-purple" onClick={runPredictions} disabled={predicting}>
                  {predicting ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
                  {predicting ? 'Analyzing...' : 'Run Predictions'}
                </button>
              </div>

              {predicting && (
                <div className="card mb-5" style={{ textAlign: 'center', padding: 40 }}>
                  <div className="loading-spinner" style={{ margin: '0 auto 16px', borderColor: 'rgba(167,139,250,0.2)', borderTopColor: 'var(--accent-purple)' }} />
                  <p style={{ color: 'var(--accent-purple)', fontSize: 14, fontWeight: 500 }}>Running AI/ML risk analysis on all 24 zones</p>
                  <p style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 4 }}>Analyzing rainfall, slope, soil, sensors, vegetation & historical data</p>
                </div>
              )}

              {predictions.length > 0 && (
                <>
                  <div className="grid-2 mb-5">
                    <div className="card">
                      <div className="card-header">
                        <div>
                          <div className="card-title"><TrendingUp size={16} className="card-title-icon" /> Slope Angle vs Risk Score</div>
                          <div className="card-subtitle">Zone-wise terrain slope compared to calculated risk</div>
                        </div>
                      </div>
                      <div className="chart-container">
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={predictions.map(p => {
                            const zone = zones.find(z => z.id === p.zone_id);
                            return { name: p.zone_name.substring(0, 10), slope: zone?.slope_angle_deg || 0, risk: p.risk_score };
                          })}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-45} textAnchor="end" height={60} axisLine={false} tickLine={false} />
                            <YAxis yAxisId="left" tick={{ fill: '#f97316', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#ef4444', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ background: '#1a2234', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                            <Bar yAxisId="left" dataKey="slope" name="Slope (deg)" fill="#f97316" radius={[2, 2, 0, 0]} fillOpacity={0.6} />
                            <Bar yAxisId="right" dataKey="risk" name="Risk Score" radius={[2, 2, 0, 0]}>
                              {predictions.map((p, i) => <Cell key={i} fill={riskColor[p.risk_level]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="card">
                      <div className="card-header">
                        <div>
                          <div className="card-title"><MapIcon size={16} className="card-title-icon" /> Real-Time Risk Heatmap</div>
                          <div className="card-subtitle">Circle size indicates risk magnitude</div>
                        </div>
                      </div>
                      <div className="map-wrapper" style={{ height: 320 }}>
                        <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                          {predictions.map(p => (
                            <CircleMarker key={p.zone_id} center={[
                              zones.find(z => z.id === p.zone_id)?.latitude || 25.5,
                              zones.find(z => z.id === p.zone_id)?.longitude || 93.0
                            ]} radius={Math.max(5, p.risk_score / 5)} fillColor={riskColor[p.risk_level]} color="white" weight={1} fillOpacity={0.8}>
                              <Popup><div style={{ fontFamily: 'Inter, sans-serif', color: '#1e293b' }}><strong>{p.zone_name}</strong><br />Risk: <span style={{ color: riskColor[p.risk_level] }}>{p.risk_level.toUpperCase()} ({p.risk_score}%)</span><br />Confidence: {(p.confidence * 100).toFixed(0)}%</div></Popup>
                            </CircleMarker>
                          ))}
                        </MapContainer>
                      </div>
                    </div>
                  </div>

                  <div className="grid-2 mb-5">
                    <div className="card">
                      <div className="card-header">
                        <div>
                          <div className="card-title"><CloudRain size={16} className="card-title-icon" /> Rainfall Factor vs Risk Score</div>
                          <div className="card-subtitle">Rainfall contribution correlation with overall risk</div>
                        </div>
                      </div>
                      <div className="chart-container">
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={predictions.map(p => ({ name: p.zone_name.substring(0, 10), rainfall: p.contributing_factors.rainfall || 0, risk: p.risk_score }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-45} textAnchor="end" height={60} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ background: '#1a2234', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                            <Bar dataKey="rainfall" name="Rainfall Factor" fill="#3b82f6" radius={[2, 2, 0, 0]} fillOpacity={0.7} />
                            <Bar dataKey="risk" name="Total Risk" fill="#ef4444" radius={[2, 2, 0, 0]} fillOpacity={0.7} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="card">
                      <div className="card-header">
                        <div>
                          <div className="card-title"><Activity size={16} className="card-title-icon" /> Top Zone Risk Factor Breakdown</div>
                          {(() => { const top = [...predictions].sort((a, b) => b.risk_score - a.risk_score)[0]; return top ? <div className="card-subtitle">{top.zone_name} — {top.risk_level.toUpperCase()}</div> : null; })()}
                        </div>
                      </div>
                      <div className="chart-container">
                        {(() => {
                          const top = [...predictions].sort((a, b) => b.risk_score - a.risk_score)[0];
                          const radarData = top ? Object.entries(top.contributing_factors).map(([k, v]) => ({ factor: k, value: v, fullMark: 100 })) : [];
                          return (
                            <ResponsiveContainer width="100%" height={260}>
                              <RadarChart data={radarData}>
                                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                                <PolarAngleAxis dataKey="factor" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <PolarRadiusAxis tick={{ fill: '#64748b', fontSize: 9 }} domain={[0, 100]} />
                                <Radar name="Risk Factors" dataKey="value" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.2} strokeWidth={2} />
                              </RadarChart>
                            </ResponsiveContainer>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="grid-2">
                    <div className="card">
                      <div className="card-header">
                        <div className="card-title"><BarChart3 size={16} className="card-title-icon" /> All Zone Risk Scores</div>
                      </div>
                      <div className="chart-container">
                        <ResponsiveContainer width="100%" height={400}>
                          <BarChart data={[...predictions].sort((a, b) => b.risk_score - a.risk_score).map(p => ({ name: p.zone_name.substring(0, 14), score: p.risk_score }))} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis dataKey="name" type="category" width={110} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ background: '#1a2234', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                            <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                              {[...predictions].sort((a, b) => b.risk_score - a.risk_score).map((p, i) => <Cell key={i} fill={riskColor[p.risk_level]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div className="card">
                        <div className="card-header">
                          <div className="card-title"><BarChart3 size={16} className="card-title-icon" /> Prediction Summary</div>
                        </div>
                        <div className="card-body">
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            {([
                              ['Critical', predictions.filter(p => p.risk_level === 'critical').length, '#ef4444'],
                              ['High Risk', predictions.filter(p => p.risk_level === 'high').length, '#f97316'],
                              ['Moderate', predictions.filter(p => p.risk_level === 'moderate').length, '#eab308'],
                              ['Low Risk', predictions.filter(p => p.risk_level === 'low').length, '#22c55e'],
                            ] as [string, number, string][]).map(([label, count, color]) => (
                              <div key={label} style={{ padding: 12, background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-secondary)' }}>
                            <div>Avg Risk: <strong style={{ color: 'var(--text-primary)' }}>{(predictions.reduce((s, p) => s + p.risk_score, 0) / predictions.length).toFixed(1)}%</strong></div>
                            <div style={{ marginTop: 3 }}>Avg Confidence: <strong style={{ color: 'var(--text-primary)' }}>{(predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length * 100).toFixed(0)}%</strong></div>
                          </div>
                        </div>
                      </div>

                      <div className="card" style={{ flex: 1 }}>
                        <div className="card-header">
                          <div className="card-title"><AlertTriangle size={16} className="card-title-icon" /> Priority Actions</div>
                        </div>
                        <div className="card-body" style={{ padding: '8px 16px', maxHeight: 260, overflowY: 'auto' }}>
                          {[...predictions].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5).map((p, idx) => (
                            <div key={p.zone_id} className={`alert-card ${p.risk_level}`} style={{ marginBottom: 8, borderLeftWidth: 3 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>#{idx + 1} {p.zone_name}</span>
                                <span style={{ fontWeight: 700, fontSize: 12, color: riskColor[p.risk_level], fontVariantNumeric: 'tabular-nums' }}>{p.risk_score}%</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{p.recommended_actions[0]}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {predictions.length === 0 && !predicting && (
                <div className="card" style={{ textAlign: 'center', padding: 56 }}>
                  <Brain size={44} style={{ color: 'var(--text-disabled)', margin: '0 auto 16px' }} />
                  <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Run Predictions to Begin Analysis</p>
                  <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', maxWidth: 460, margin: '0 auto', lineHeight: 1.7 }}>
                    The AI model analyzes real-time rainfall, slope geometry, soil type, vegetation cover, sensor anomalies, and historical event data for all 24 monitored zones across the North Eastern Region.
                  </p>
                  <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 16 }}>
                    {([
                      [CloudRain, 'Rainfall Data'],
                      [Mountain, 'Terrain Analysis'],
                      [Radio, 'Sensor Feeds'],
                      [BarChart3, 'Historical'],
                    ] as any[]).map(([Icon, label]: [any, string]) => (
                      <div key={label} style={{ padding: '14px 18px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                        <Icon size={20} style={{ color: 'var(--text-tertiary)', margin: '0 auto 6px' }} />
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ============ HISTORY ============ */}
          {page === 'history' && <HistoryPage />}
        </div>

        {/* Footer */}
        <footer style={{ padding: '14px 24px', textAlign: 'center', color: 'var(--text-disabled)', fontSize: 11, borderTop: '1px solid var(--border-subtle)' }}>
          NER Landslide Early Warning System v1.0 — AI-Powered Disaster Monitoring for North Eastern Region
        </footer>
      </div>

      {/* ============ REPORT MODAL ============ */}
      {showReportForm && (
        <div className="modal-overlay" onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Submit Field Report</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); }}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {/* Location */}
              <div style={{ marginBottom: 16, padding: 12, borderRadius: 'var(--radius-md)', background: userLocation ? 'var(--status-success-bg)' : locationError ? 'var(--status-warning-bg)' : 'var(--status-info-bg)', border: `1px solid ${userLocation ? 'rgba(34,197,94,0.2)' : locationError ? 'rgba(234,179,8,0.2)' : 'rgba(99,145,255,0.2)'}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: userLocation ? 'var(--status-success)' : locationError ? 'var(--status-warning)' : 'var(--status-info)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {userLocation ? <CheckCircle2 size={14} /> : locationError ? <AlertTriangle size={14} /> : <Loader2 size={14} className="animate-spin" />}
                  {userLocation ? 'GPS location acquired' : locationError ? 'Using fallback location' : 'Detecting location...'}
                </div>
                {userLocation && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Lat {userLocation.lat.toFixed(6)}, Lon {userLocation.lon.toFixed(6)}
                  </div>
                )}
                {locationError && !userLocation && <div style={{ fontSize: 11, color: 'var(--status-warning)', marginTop: 4 }}>{locationError}</div>}
              </div>

              <form onSubmit={submitReport}>
                <div className="form-group">
                  <label className="form-label">Your Name</label>
                  <input name="reporter_name" defaultValue="Anonymous" required className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone (optional)</label>
                  <input name="reporter_phone" className="form-input" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Report Type</label>
                    <select name="report_type" className="form-select">
                      <option value="crack">Crack in ground/building</option>
                      <option value="slope_movement">Slope movement</option>
                      <option value="blocked_road">Blocked road</option>
                      <option value="flooding">Flooding</option>
                      <option value="landslide">Landslide observed</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Severity</label>
                    <select name="severity_claimed" className="form-select">
                      <option value="low">Low</option>
                      <option value="moderate">Moderate</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description *</label>
                  <textarea name="description" rows={3} required placeholder="Describe what you observed..." className="form-textarea" />
                </div>

                {reportStatus.type && (
                  <div style={{ marginBottom: 14, padding: 12, borderRadius: 'var(--radius-md)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, background: reportStatus.type === 'success' ? 'var(--status-success-bg)' : reportStatus.type === 'error' ? 'var(--status-error-bg)' : 'var(--status-info-bg)', color: reportStatus.type === 'success' ? 'var(--status-success)' : reportStatus.type === 'error' ? 'var(--status-error)' : 'var(--status-info)', border: `1px solid ${reportStatus.type === 'success' ? 'rgba(34,197,94,0.2)' : reportStatus.type === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(99,145,255,0.2)'}` }}>
                    {reportStatus.type === 'loading' ? <Loader2 size={14} className="animate-spin" /> : reportStatus.type === 'success' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                    {reportStatus.message}
                  </div>
                )}

                {/* Photo Upload */}
                <div className="form-group">
                  <label className="form-label">Photos (optional, max 5)</label>
                  <label className="photo-dropzone">
                    <Camera size={20} style={{ color: 'var(--text-tertiary)', margin: '0 auto 6px' }} />
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Click to attach photos</div>
                    <input type="file" accept="image/*,video/*" capture="environment" multiple onChange={handlePhotoSelect} style={{ display: 'none' }} />
                  </label>
                  {photoPreviewUrls.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      {photoPreviewUrls.map((url, i) => (
                        <div key={i} className="photo-preview">
                          <img src={url} alt={`Preview ${i + 1}`} />
                          <button type="button" className="photo-preview-remove" onClick={() => removePhoto(i)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {userLocation && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> GPS: {userLocation.lat.toFixed(4)}°N, {userLocation.lon.toFixed(4)}°E — auto-tagged</div>}
                </div>
              </form>
            </div>
            <div className="modal-footer">
              {reportStatus.type === 'success' ? (
                <button className="btn btn-success" onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); setPage('reports'); loadReports(); }}>
                  <CheckCircle2 size={14} /> View Report
                </button>
              ) : (
                <button className="btn btn-primary" onClick={(e) => { e.preventDefault(); document.querySelector<HTMLFormElement>('.modal-content form')?.requestSubmit(); }}
                  disabled={!userLocation || reportStatus.type === 'loading'}>
                  {reportStatus.type === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {reportStatus.type === 'loading' ? 'Submitting...' : 'Submit Report'}
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ ADMIN LOGIN MODAL ============ */}
      {showAdminLogin && (
        <div className="modal-overlay" onClick={() => { setShowAdminLogin(false); setAdminLoginError(''); setAdminPassword(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 380 }}>
            <div className="modal-header" style={{ justifyContent: 'center', paddingBottom: 0 }}>
              <div style={{ textAlign: 'center' }}>
                <Shield size={32} style={{ color: 'var(--accent-blue)', margin: '0 auto 10px' }} />
                <h3 className="modal-title" style={{ fontSize: 17 }}>Administrator Access</h3>
                <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 }}>Field reports are restricted to authorized personnel</p>
              </div>
            </div>
            <div className="modal-body">
              <form onSubmit={(e) => { e.preventDefault(); handleAdminLogin(); }}>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Enter admin password" autoFocus className="form-input" />
                </div>
                {adminLoginError && (
                  <div style={{ marginBottom: 14, padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--status-error-bg)', color: 'var(--status-error)', fontSize: 12, border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <XCircle size={14} /> {adminLoginError}
                  </div>
                )}
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!adminPassword || adminLoggingIn}>
                  {adminLoggingIn ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                  {adminLoggingIn ? 'Verifying...' : 'Login'}
                </button>
              </form>
              <div style={{ marginTop: 14, padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                Hint: <code style={{ color: 'var(--accent-blue)', fontFamily: 'JetBrains Mono, monospace' }}>admin123</code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ TOAST ============ */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ============ HISTORY PAGE (SEPARATE COMPONENT) ============
function HistoryPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAPI<any>('/historical-landslides')
      .then(d => setRecords(d.records || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const severityColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', moderate: '#eab308', low: '#22c55e' };
  const totalCasualties = records.reduce((s: number, r: any) => s + (r.casualties || 0), 0);
  const totalDisplaced = records.reduce((s: number, r: any) => s + (r.displaced || 0), 0);
  const totalBlocked = records.filter((r: any) => r.road_blocked).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Historical Landslide Records</div>
          <div className="page-subtitle">Verified events across the North Eastern Region (2023-2024)</div>
        </div>
      </div>

      <div className="history-grid">
        {[
          ['Total Events', records.length, '#6391ff'],
          ['Casualties', totalCasualties, '#ef4444'],
          ['People Displaced', totalDisplaced.toLocaleString(), '#f97316'],
          ['Roads Blocked', totalBlocked, '#eab308'],
        ].map(([label, value, color]) => (
          <div key={label} className="history-stat">
            <div className="history-stat-label">{label}</div>
            <div className="history-stat-value" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Loading records...</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Zone / Description</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Casualties</th>
                <th>Displaced</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text-tertiary)' }}>{r.date}</td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 }}>{r.zone} — {r.district}, {r.state}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{r.description}</div>
                  </td>
                  <td><span className="badge badge-outline">{r.type}</span></td>
                  <td><span className={`badge ${r.severity === 'critical' ? 'badge-critical' : r.severity === 'high' ? 'badge-high' : r.severity === 'moderate' ? 'badge-moderate' : 'badge-low'}`}>{r.severity.toUpperCase()}</span></td>
                  <td style={{ color: r.casualties > 0 ? 'var(--risk-critical)' : 'var(--text-tertiary)', fontWeight: r.casualties > 0 ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{r.casualties}</td>
                  <td style={{ color: 'var(--risk-high)', fontVariantNumeric: 'tabular-nums' }}>{r.displaced?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
