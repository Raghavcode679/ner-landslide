import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import {
  LayoutDashboard, MapPin, AlertTriangle, Route, Home, Brain,
  History, FileText, Shield, ShieldOff, RefreshCw, Radio,
  Camera, X, Send, Loader2, CheckCircle2, XCircle,
  Mountain, CloudRain, Activity, Users, BarChart3, TrendingUp,
  AlertCircle, Droplets, Thermometer, Wind, Waves, Map as MapIcon
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
const riskBg: Record<string, string> = { low: 'rgba(34,197,94,0.15)', moderate: 'rgba(234,179,8,0.15)', high: 'rgba(249,115,22,0.15)', critical: 'rgba(239,68,68,0.15)' };
const roadColors: Record<string, string> = { open: '#22c55e', blocked: '#ef4444', partial: '#eab308', damaged: '#f97316' };

const LANGUAGES: Record<string, Record<string, string>> = {
  en: { dashboard: 'Dashboard', zones: 'Zones', alerts: 'Alerts', roads: 'Roads', villages: 'Villages', reports: 'Reports', weather: 'Weather', predictions: 'Predictions', history: 'History', report_now: 'Report Now', title: 'NER Landslide Early Warning System', subtitle: 'AI-Powered Real-Time Disaster Monitoring', risk_summary: 'Risk Summary', road_status: 'Road Connectivity', village_status: 'Village Connectivity', active_alerts: 'Active Alerts', top_risk: 'Top Risk Zones', simulate: 'Simulate Update', language: 'Language', search: 'Search zones...' },
  hi: { dashboard: 'डैशबोर्ड', zones: 'क्षेत्र', alerts: 'अलर्ट', roads: 'सड़कें', villages: 'गाँव', reports: 'रिपोर्ट', weather: 'मौसम', predictions: 'भविष्यवाणी', history: 'इतिहास', report_now: 'अभी रिपोर्ट करें', title: 'पूर्वोत्तर भूस्खलन प्रारंभिक चेतावनी प्रणाली', subtitle: 'AI-संचालित वास्तविक समय आपदा निगरानी', risk_summary: 'जोखिम सारांश', road_status: 'सड़क कनेक्टिविटी', village_status: 'गाँव कनेक्टिविटी', active_alerts: 'सक्रिय अलर्ट', top_risk: 'उच्च जोखिम क्षेत्र', simulate: 'अपडेट अनुकरण', language: 'भाषा', search: 'क्षेत्र खोजें...' },
  bn: { dashboard: 'ড্যাশবোর্ড', zones: 'অঞ্চল', alerts: 'সতর্কতা', roads: 'সড়ক', villages: 'গ্রাম', reports: 'প্রতিবেদন', weather: 'আবহাওয়া', predictions: 'পূর্বাভাস', history: 'ইতিহাস', report_now: 'এখনই জানান', title: 'উত্তর-পূর্ব ভূমিধস প্রাথমিক সতর্কতা সিস্টেম', subtitle: 'AI-চালিত রিয়েল-টাইম দুর্যোগ পর্যবেক্ষণ', risk_summary: 'ঝুঁকি সারসংক্ষেপ', road_status: 'সড়ক সংযোগ', village_status: 'গ্রাম সংযোগ', active_alerts: 'সক্রিয় সতর্কতা', top_risk: 'সর্বোচ্চ ঝুঁকি অঞ্চল', simulate: 'আপডেট সিমুলেট', language: 'ভাষা', search: 'অঞ্চল খুঁজুন...' },
  as: { dashboard: 'ডেশবৰ্ড', zones: 'অঞ্চল', alerts: 'সতৰ্কতা', roads: 'ৰাস্তা', villages: 'গাঁও', reports: 'প্ৰতিবেদন', weather: 'বতৰা', predictions: 'পূৰ্বানুমান', history: 'ইতিহাস', report_now: 'এতিয়াই সঁচাৰ কৰক', title: 'উত্তৰ-পূৱ ভূমিধ্বংস আগতীয়া সতৰ্কতা ব্যৱস্থা', subtitle: 'AI-চালিত ৰিয়েল-টাইম দুৰ্ঘটনা নিৰীক্ষণ', risk_summary: 'বিপদৰ সাৰাংশ', road_status: 'ৰাস্তা সংযোগ', village_status: 'গাঁও সংযোগ', active_alerts: 'সক্ৰিয় সতৰ্কতা', top_risk: 'চৰ্বোচ্চ বিপদ অঞ্চল', simulate: 'আপডেট চিমুলেট', language: 'ভাষা', search: 'অঞ্চল বিচাৰক...' },
  mr: { dashboard: 'डॅशबोर्ड', zones: 'झोने', alerts: 'सूचना', roads: 'मार्ग', villages: 'गावे', reports: 'अहवाल', weather: 'हवामान', predictions: 'अंदाज', history: 'इतिहास', report_now: 'आता कळवा', title: 'उत्तर-पूर्व भूस्खलन प्रारंभिक सूचना प्रणाली', subtitle: 'AI-शक्तीवर चालणारी रिअल-टाइम आपत्ती निरीक्षण', risk_summary: 'धोका सारांश', road_status: 'मार्ग कनेक्टिव्हिटी', village_status: 'गाव कनेक्टिव्हिटी', active_alerts: 'सक्रिय सूचना', top_risk: 'सर्वाधिक धोकादायक झोने', simulate: 'अद्यतन सिम्युलेट', language: 'भाषा', search: 'झोने शोधा...' },
  ta: { dashboard: 'டாஷ்போர்டு', zones: 'மண்டலங்கள்', alerts: 'எச்சரிக்கை', roads: 'சாலைகள்', villages: 'கிராமங்கள்', reports: 'அறிக்கைகள்', weather: 'வானிலை', predictions: 'முன்னறிவிப்பு', history: 'வரலாறு', report_now: 'இப்போது தெரிவிக்கவும்', title: 'வடகிழக்கு மண்சரிவு முன்னெச்சரிக்கை அமைப்பு', subtitle: 'AI-இயங்கும் நிகழ்நேர பேரிடர் கண்காணிப்பு', risk_summary: 'ஆபத்து சுருக்கம்', road_status: 'சாலை இணைப்பு', village_status: 'கிராம இணைப்பு', active_alerts: 'செயலில் உள்ள எச்சரிக்கை', top_risk: 'அதிக ஆபத்து மண்டலங்கள்', simulate: 'புதுப்பிப்பு சிமுலேஷன்', language: 'மொழி', search: 'மண்டலங்களைத் தேடு...' },
};

// ============ MAP COMPONENT ============
function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(center, 6); }, [center]);
  return null;
}

// ============ STAT CARD ============
function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 16px', border: `1px solid ${color}33`, minWidth: 160, flex: 1 }}>
      <div style={{ fontSize: 24, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ============ HISTORICAL LANDSLIDES PAGE ============
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
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>📜 Historical Landslide Records — NER Region</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: '#1e293b', padding: 16, borderRadius: 12, border: '1px solid #334155' }}><div style={{ fontSize: 11, color: '#64748b' }}>Total Events</div><div style={{ fontSize: 24, fontWeight: 700, color: '#60a5fa' }}>{records.length}</div></div>
        <div style={{ background: '#1e293b', padding: 16, borderRadius: 12, border: '1px solid #334155' }}><div style={{ fontSize: 11, color: '#64748b' }}>Casualties</div><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{totalCasualties}</div></div>
        <div style={{ background: '#1e293b', padding: 16, borderRadius: 12, border: '1px solid #334155' }}><div style={{ fontSize: 11, color: '#64748b' }}>People Displaced</div><div style={{ fontSize: 24, fontWeight: 700, color: '#f97316' }}>{totalDisplaced.toLocaleString()}</div></div>
        <div style={{ background: '#1e293b', padding: 16, borderRadius: 12, border: '1px solid #334155' }}><div style={{ fontSize: 11, color: '#64748b' }}>Roads Blocked</div><div style={{ fontSize: 24, fontWeight: 700, color: '#eab308' }}>{totalBlocked}</div></div>
      </div>
      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 120px 100px 100px 100px', gap: 0, padding: '10px 16px', background: '#0f172a', borderBottom: '1px solid #334155', fontSize: 11, fontWeight: 600, color: '#64748b' }}>
          <div>Date</div><div>Zone / Description</div><div>Type</div><div>Severity</div><div>Casualties</div><div>Displaced</div>
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading records...</div>
        ) : records.map((r: any) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 120px 100px 100px 100px', gap: 0, padding: '12px 16px', borderBottom: '1px solid #1e293b', fontSize: 13, alignItems: 'start' }}>
            <div style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{r.date}</div>
            <div><div style={{ fontWeight: 600, color: '#e2e8f0' }}>{r.zone} — {r.district}, {r.state}</div><div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{r.description}</div></div>
            <div style={{ color: '#94a3b8' }}>{r.type}</div>
            <div><span style={{ background: `${severityColors[r.severity]}22`, color: severityColors[r.severity], padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{r.severity.toUpperCase()}</span></div>
            <div style={{ color: r.casualties > 0 ? '#ef4444' : '#64748b', fontWeight: r.casualties > 0 ? 700 : 400 }}>{r.casualties}</div>
            <div style={{ color: '#f97316' }}>{r.displaced.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
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

  const t = LANGUAGES[lang] || LANGUAGES.en;

  // WebSocket
  useWebSocket('/ws/alerts', (data) => {
    if (data.type === 'new_alert') {
      setAlerts(prev => [{ id: data.alert_id, title: data.zone_name, message: data.message, risk_level: data.risk_level, status: 'active', latitude: 0, longitude: 0, created_at: data.timestamp, zone_id: 0 }, ...prev]);
    }
  });

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
    } catch (e) { alert('Failed to run predictions. Make sure backend is running on port 8000.'); }
    setPredicting(false);
  };

  const simulateUpdate = async () => {
    setSimulating(true);
    try {
      await postAPI('/simulate/update');
      await loadData();
      await runPredictions();
    } catch (e) { console.error(e); }
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
          () => { setLocationError('Could not access location. Using default NER coordinates.'); setUserLocation({ lat: 25.6, lon: 93.5 }); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      } else {
        setLocationError('Geolocation not supported by your browser.');
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
    } catch (err) {
      setAdminLoginError(err instanceof Error ? err.message : 'Login failed');
    }
    setAdminLoggingIn(false);
  };

  const handleAdminLogout = () => {
    sessionStorage.removeItem('admin_token');
    setIsAdmin(false);
    setReports([]);
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
      alert(`Synced ${data.zones_updated}/${data.total_zones} zones with real data!`);
      await loadData();
    } catch (e) { alert('Sync failed.'); }
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
      setReportStatus({ type: 'success', message: `Report #${result.report_id} submitted! ${result.media_urls?.length || 0} photo(s) attached. Location: (${(userLocation?.lat || 25.6).toFixed(4)}, ${(userLocation?.lon || 93.5).toFixed(4)})` });
      setReportPhotos([]);
      setPhotoPreviewUrls([]);
    } catch (err) {
      setReportStatus({ type: 'error', message: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
  };

  const centerPos: [number, number] = selectedZone ? [selectedZone.latitude, selectedZone.longitude] : [25.5, 93.0];
  const activeAlertCount = alerts.filter(a => a.status === 'active').length;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏔️</div>
        <div style={{ fontSize: 20, color: '#94a3b8' }}>Loading NER Early Warning System...</div>
      </div>
    );
  }

  // ============ SIDEBAR ============
  const navItems = [
    { id: 'dashboard', label: t.dashboard, icon: LayoutDashboard },
    { id: 'zones', label: t.zones, icon: MapPin },
    { id: 'alerts', label: t.alerts, icon: AlertTriangle, badge: activeAlertCount || undefined },
    { id: 'roads', label: t.roads, icon: Route },
    { id: 'villages', label: t.villages, icon: Home },
    { id: 'predictions', label: t.predictions, icon: Brain },
    { id: 'history', label: t.history, icon: History },
  ];
  if (isAdmin) navItems.push({ id: 'reports', label: t.reports, icon: FileText });

  return (
    <div className="app-layout">
      {/* ============ SIDEBAR ============ */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">🏔️</div>
          <div className="sidebar-brand-text">
            <h1>NER Early Warning</h1>
            <p>Landslide Monitoring</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Operations</div>
          {navItems.slice(0, 5).map(item => (
            <button key={item.id} className={`sidebar-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
              <item.icon className="sidebar-item-icon" size={18} />
              {item.label}
              {item.badge !== undefined && <span className="sidebar-item-badge">{item.badge}</span>}
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
                <span className="data-source-dot" /> Rain
              </span>
            )}
            {dataSourceStatus.sentinel_2_ndvi && (
              <span className={`data-source-pill ${dataSourceStatus.sentinel_2_ndvi.status === 'ok' ? 'ok' : 'error'}`}>
                <span className="data-source-dot" /> NDVI
              </span>
            )}
            {dataSourceStatus.srtm_elevation && (
              <span className={`data-source-pill ${dataSourceStatus.srtm_elevation.status === 'ok' ? 'ok' : 'error'}`}>
                <span className="data-source-dot" /> DEM
              </span>
            )}
            {dataSourceStatus.mqtt_sensors && (
              <span className={`data-source-pill ${dataSourceStatus.mqtt_sensors.mqtt_connected ? 'ok' : 'error'}`}>
                <span className="data-source-dot" /> MQTT
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
            <h2 className="topbar-page-title">{navItems.find(n => n.id === page)?.label || page}</h2>
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
              {simulating ? '⏳ Updating...' : '📡 ' + t.simulate}
            </button>
            {isAdmin && (
              <button className="btn btn-success btn-sm" onClick={syncRealData} disabled={syncingRealData}>
                {syncingRealData ? '⏳ Syncing...' : '🌍 Sync Real Data'}
              </button>
            )}
            <button className="btn btn-danger btn-sm" onClick={() => setShowReportForm(true)}>
              📸 {t.report_now}
            </button>
            {isAdmin ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="admin-badge">🔑 Admin</span>
                <button className="btn btn-ghost btn-sm" onClick={handleAdminLogout}>Logout</button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAdminLogin(true)}>🔐 Admin Login</button>
            )}
          </div>
        </header>

        {/* ============ PAGE CONTENT ============ */}
        <main style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>

          {/* ============ DASHBOARD PAGE ============ */}
          {page === 'dashboard' && dashboard && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <StatCard label={t.zones} value={dashboard.summary.total_zones} icon="🗺️" color="#3b82f6" />
                <StatCard label="Critical Zones" value={dashboard.summary.critical_zones} icon="🔴" color="#ef4444" />
                <StatCard label="High Risk" value={dashboard.summary.high_risk_zones} icon="🟠" color="#f97316" />
                <StatCard label={t.active_alerts} value={dashboard.summary.active_alerts} icon="🚨" color="#eab308" />
                <StatCard label="Avg Risk Score" value={`${dashboard.summary.avg_risk_score}%`} icon="📊" color="#a855f7" />
                <StatCard label="Roads Blocked" value={dashboard.summary.roads_blocked} icon="🚧" color="#f97316" />
                <StatCard label="Isolated Villages" value={dashboard.summary.isolated_villages} icon="🏘️" color="#ef4444" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 400 }}>
                  <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                    {zones.map(z => (
                      <CircleMarker key={z.id} center={[z.latitude, z.longitude]} radius={Math.max(6, z.risk_score / 8)}
                        fillColor={riskColor[z.risk_level]} color={riskColor[z.risk_level]} weight={2} fillOpacity={0.7}
                        eventHandlers={{ click: () => { setSelectedZone(z); loadWeather(z.id); } }}>
                        <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{z.name}</strong><br />{z.district}, {z.state}<br />Risk: <strong style={{ color: riskColor[z.risk_level] }}>{z.risk_level.toUpperCase()}</strong> ({z.risk_score}%)<br />Elevation: {z.elevation_m}m | Slope: {z.slope_angle_deg}°</div></Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>

                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                  <h3 style={{ fontSize: 15, marginBottom: 16, color: '#e2e8f0' }}>{t.risk_summary}</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={Object.entries(dashboard.risk_distribution).map(([k, v]) => ({ name: k, count: v, fill: riskColor[k] }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <YAxis tick={{ fill: '#94a3b8' }} />
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {Object.entries(dashboard.risk_distribution).map(([key]) => (
                          <Cell key={key} fill={riskColor[key]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  <h3 style={{ fontSize: 15, marginBottom: 12, marginTop: 20, color: '#e2e8f0' }}>{t.road_status}</h3>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={Object.entries(dashboard.road_status).map(([k, v]) => ({ name: k, value: v }))}
                        cx="50%" cy="50%" outerRadius={60} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                        {Object.entries(dashboard.road_status).map(([key]) => (
                          <Cell key={key} fill={roadColors[key] || '#64748b'} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                  <h3 style={{ fontSize: 15, marginBottom: 12, color: '#e2e8f0' }}>⚠️ {t.top_risk}</h3>
                  {(dashboard.top_risk_zones || []).length === 0 && (
                    <p style={{ color: '#64748b', fontSize: 13 }}>Run predictions to see top risk zones.</p>
                  )}
                  {(dashboard.top_risk_zones || []).slice(0, 8).map((z: any) => (
                    <div key={z.id || z.zone_id || Math.random()} onClick={() => { if (z && z.latitude && z.longitude) { setSelectedZone(z); setPage('zones'); } }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #334155', cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{z.name || z.zone_name || 'Zone'}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{z.district || ''}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 80, height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, Math.max(0, z.risk_score || 0))}%`, height: '100%', background: riskColor[z.risk_level] || '#64748b', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: riskColor[z.risk_level] || '#64748b' }}>{z.risk_score || 0}%</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                  <h3 style={{ fontSize: 15, marginBottom: 12, color: '#e2e8f0' }}>🚨 {t.active_alerts}</h3>
                  {alerts.filter(a => a.status === 'active').length === 0 && (
                    <p style={{ color: '#64748b', fontSize: 14 }}>No active alerts. System operating normally.</p>
                  )}
                  {alerts.filter(a => a.status === 'active').slice(0, 8).map(a => (
                    <div key={a.id} style={{ padding: '10px 12px', marginBottom: 8, borderRadius: 8, background: riskBg[a.risk_level], border: `1px solid ${riskColor[a.risk_level]}44` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: riskColor[a.risk_level] }}>{a.risk_level.toUpperCase()}</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                      </div>
                      <p style={{ fontSize: 13, marginTop: 4, color: '#cbd5e1' }}>{a.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ============ ZONES PAGE ============ */}
          {page === 'zones' && (
            <>
              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 350, marginBottom: 20 }}>
                <MapContainer center={centerPos} zoom={selectedZone ? 10 : 6} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                  <MapUpdater center={centerPos} />
                  {zones.map(z => (
                    <CircleMarker key={z.id} center={[z.latitude, z.longitude]} radius={Math.max(6, z.risk_score / 7)}
                      fillColor={riskColor[z.risk_level]} color={riskColor[z.risk_level]} weight={2} fillOpacity={0.7}
                      eventHandlers={{ click: () => { setSelectedZone(z); loadWeather(z.id); } }}>
                      <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{z.name}</strong><br />Risk: {z.risk_level} ({z.risk_score}%)</div></Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: selectedZone ? '1fr 1fr' : '1fr', gap: 20 }}>
                {selectedZone && (
                  <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                    <h3 style={{ fontSize: 16, marginBottom: 12, color: '#f1f5f9' }}>📍 {selectedZone.name}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                      <div><span style={{ color: '#64748b' }}>District:</span> {selectedZone.district}</div>
                      <div><span style={{ color: '#64748b' }}>State:</span> {selectedZone.state}</div>
                      <div><span style={{ color: '#64748b' }}>Elevation:</span> {selectedZone.elevation_m}m</div>
                      <div><span style={{ color: '#64748b' }}>Slope:</span> {selectedZone.slope_angle_deg}°</div>
                      <div><span style={{ color: '#64748b' }}>Soil:</span> {selectedZone.soil_type}</div>
                      <div><span style={{ color: '#64748b' }}>Vegetation:</span> {(selectedZone.vegetation_cover * 100).toFixed(0)}%</div>
                      <div><span style={{ color: '#64748b' }}>Risk Level:</span> <strong style={{ color: riskColor[selectedZone.risk_level] }}>{selectedZone.risk_level.toUpperCase()}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Risk Score:</span> <strong style={{ color: riskColor[selectedZone.risk_level] }}>{selectedZone.risk_score}%</strong></div>
                    </div>
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span>Risk Score</span><span>{selectedZone.risk_score}/100</span>
                      </div>
                      <div style={{ width: '100%', height: 12, background: '#334155', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${selectedZone.risk_score}%`, height: '100%', background: `linear-gradient(90deg, #22c55e, ${riskColor[selectedZone.risk_level]})`, borderRadius: 6, transition: 'width 0.5s' }} />
                      </div>
                    </div>
                    {weather && selectedZoneId === selectedZone.id && (
                      <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 8 }}>
                        <h4 style={{ fontSize: 13, color: '#60a5fa', marginBottom: 8 }}>🌤️ Current Weather</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                          <div>🌧️ Rainfall: {weather.current.rainfall_mm} mm</div>
                          <div>🌡️ Temp: {weather.current.temperature_c}°C</div>
                          <div>💧 Humidity: {weather.current.humidity_pct}%</div>
                          <div>💨 Wind: {weather.current.wind_speed_kmh} km/h</div>
                        </div>
                        {weather.current.storm_active && (
                          <div style={{ marginTop: 8, padding: 6, background: '#ef444433', borderRadius: 4, fontSize: 12, color: '#fca5a5' }}>⛈️ Active storm system detected</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20, maxHeight: 600, overflowY: 'auto' }}>
                  <h3 style={{ fontSize: 15, marginBottom: 12, color: '#e2e8f0' }}>🗺️ All Monitored Zones ({zones.length})</h3>
                  {zones.sort((a, b) => b.risk_score - a.risk_score).map(z => (
                    <div key={z.id} onClick={() => { setSelectedZone(z); loadWeather(z.id); }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', marginBottom: 6, borderRadius: 8, background: selectedZone?.id === z.id ? '#334155' : '#0f172a', cursor: 'pointer', border: `1px solid ${selectedZone?.id === z.id ? riskColor[z.risk_level] : '#1e293b'}` }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{z.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{z.district}, {z.state}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: riskColor[z.risk_level] }}>{z.risk_score}%</div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>{z.risk_level}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ============ ALERTS PAGE ============ */}
          {page === 'alerts' && (
            <div>
              <h2 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>🚨 Alerts & Notifications</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 400 }}>
                  <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {alerts.filter(a => a.status === 'active' && a.latitude && a.longitude).map(a => (
                      <CircleMarker key={a.id} center={[a.latitude, a.longitude]} radius={10}
                        fillColor={riskColor[a.risk_level]} color={riskColor[a.risk_level]} weight={3} fillOpacity={0.8}>
                        <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{a.title}</strong><br />{a.message}</div></Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
                <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                  {alerts.length === 0 && <p style={{ color: '#64748b' }}>No alerts yet. Run predictions to generate alerts.</p>}
                  {alerts.map(a => (
                    <div key={a.id} style={{ padding: 16, marginBottom: 10, borderRadius: 10, background: riskBg[a.risk_level], border: `1px solid ${riskColor[a.risk_level]}44` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: riskColor[a.risk_level], fontSize: 14 }}>{a.risk_level.toUpperCase()}</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{a.status} | {a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                      </div>
                      <p style={{ fontSize: 14, marginTop: 8, color: '#e2e8f0' }}>{a.title}</p>
                      <p style={{ fontSize: 13, marginTop: 4, color: '#94a3b8' }}>{a.message}</p>
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(a.channels || []).map((ch: string) => (
                          <span key={ch} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#334155', color: '#94a3b8' }}>{ch}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============ ROADS PAGE ============ */}
          {page === 'roads' && (
            <div>
              <h2 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>🛣️ Road Connectivity Status</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 450 }}>
                  <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {roads.map(r => (
                      <CircleMarker key={r.id} center={[r.latitude, r.longitude]} radius={8}
                        fillColor={roadColors[r.status]} color={roadColors[r.status]} weight={2} fillOpacity={0.8}>
                        <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{r.name}</strong><br />Status: {r.status}<br />{r.from_place} → {r.to_place}</div></Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
                <div>
                  <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20, marginBottom: 20 }}>
                    <h3 style={{ fontSize: 15, marginBottom: 12 }}>📊 Status Overview</h3>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={roads.reduce((acc: any[], r) => { const ex = acc.find(a => a.name === r.status); if (ex) ex.count++; else acc.push({ name: r.status, count: 1 }); return acc; }, [])}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                        <YAxis tick={{ fill: '#94a3b8' }} />
                        <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {roads.reduce((acc: any[], r) => { if (!acc.find(a => a.name === r.status)) acc.push({ name: r.status }); return acc; }, []).map((r: any) => (
                            <Cell key={r.name} fill={roadColors[r.name] || '#64748b'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                    <h3 style={{ fontSize: 15, marginBottom: 12 }}>🛤️ All Roads ({roads.length})</h3>
                    {roads.map(r => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #334155' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{r.from_place} → {r.to_place}</div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: `${roadColors[r.status]}22`, color: roadColors[r.status], border: `1px solid ${roadColors[r.status]}44` }}>
                          {r.status === 'open' ? '✅' : r.status === 'blocked' ? '🚫' : r.status === 'partial' ? '⚠️' : '🔨'} {r.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============ VILLAGES PAGE ============ */}
          {page === 'villages' && (
            <div>
              <h2 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>🏘️ Village Monitoring</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 450 }}>
                  <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {villages.map(v => (
                      <CircleMarker key={v.id} center={[v.latitude, v.longitude]} radius={Math.max(5, v.population / 10000)}
                        fillColor={v.connectivity_status === 'connected' ? '#22c55e' : v.connectivity_status === 'partially_isolated' ? '#eab308' : '#ef4444'}
                        color={v.connectivity_status === 'connected' ? '#22c55e' : v.connectivity_status === 'partially_isolated' ? '#eab308' : '#ef4444'}
                        weight={2} fillOpacity={0.7}>
                        <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{v.name}</strong><br />{v.district}, {v.state}<br />Population: {v.population.toLocaleString()}<br />Status: {v.connectivity_status}</div></Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20, maxHeight: 500, overflowY: 'auto' }}>
                  <h3 style={{ fontSize: 15, marginBottom: 12 }}>🏘️ Villages ({villages.length})</h3>
                  {villages.map(v => (
                    <div key={v.id} style={{ padding: '10px 12px', marginBottom: 6, borderRadius: 8, background: '#0f172a', border: `1px solid ${v.connectivity_status === 'connected' ? '#22c55e33' : v.connectivity_status === 'partially_isolated' ? '#eab30833' : '#ef444433'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{v.name}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{v.district}, {v.state}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>Pop: {v.population.toLocaleString()}</div>
                          <span style={{ fontSize: 11, color: v.connectivity_status === 'connected' ? '#22c55e' : v.connectivity_status === 'partially_isolated' ? '#eab308' : '#ef4444' }}>
                            {v.connectivity_status === 'connected' ? '🟢 Connected' : v.connectivity_status === 'partially_isolated' ? '🟡 Partial' : '🔴 Isolated'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============ REPORTS PAGE (Admin) ============ */}
          {page === 'reports' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, color: '#f1f5f9' }}>🔒 Admin — Field Reports ({reports.length})</h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 400 }}>
                  <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {reports.map(r => (
                      <CircleMarker key={r.id} center={[r.latitude, r.longitude]} radius={8}
                        fillColor={r.severity_claimed === 'critical' ? '#ef4444' : r.severity_claimed === 'high' ? '#f97316' : '#eab308'}
                        color="#fff" weight={2} fillOpacity={0.8}>
                        <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{r.report_type}</strong><br />{r.description}<br />By: {r.reporter_name}{r.media_urls && r.media_urls.length > 0 && <><br />📷 {r.media_urls.length} photo(s)</>}</div></Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                </div>
                <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                  {reports.length === 0 && <p style={{ color: '#64748b', padding: 20 }}>No reports found.</p>}
                  {reports.map(r => (
                    <div key={r.id} style={{ padding: 16, marginBottom: 10, borderRadius: 10, background: '#0f172a', border: `1px solid ${r.verified ? '#22c55e44' : '#334155'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>📋 {r.report_type.replace('_', ' ')}</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
                      </div>
                      <p style={{ fontSize: 13, marginTop: 8, color: '#cbd5e1' }}>{r.description}</p>
                      <div style={{ marginTop: 8, display: 'flex', gap: 12, fontSize: 12, color: '#64748b' }}>
                        <span>👤 {r.reporter_name}</span>
                        <span>⚠️ {r.severity_claimed}</span>
                        {r.verified && <span style={{ color: '#22c55e' }}>✅ Verified</span>}
                      </div>
                      {r.media_urls && r.media_urls.length > 0 && (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {r.media_urls.map((url: string, i: number) => (
                            <img key={i} src={url} alt={`Report photo ${i + 1}`} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px solid #334155', cursor: 'pointer' }} onClick={() => window.open(url, '_blank')} />
                          ))}
                        </div>
                      )}
                      {!r.verified && (
                        <button onClick={async () => {
                          const token = getAuthToken();
                          if (!token) return;
                          try { await fetch(`${API_BASE}/reports/${r.id}/verify`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); loadReports(); } catch (e) { console.error(e); }
                        }} style={{ marginTop: 8, padding: '4px 12px', borderRadius: 4, border: '1px solid #22c55e44', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 12, cursor: 'pointer' }}>
                          ✅ Verify Report
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============ PREDICTIONS PAGE ============ */}
          {page === 'predictions' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, color: '#f1f5f9' }}>🤖 AI/ML Predictions — Live Risk Analysis</h2>
                <button onClick={runPredictions} disabled={predicting} style={{ background: predicting ? '#475569' : '#7c3aed', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: predicting ? 'wait' : 'pointer' }}>
                  {predicting ? '⏳ Analyzing...' : '🧠 Run Predictions'}
                </button>
              </div>

              {predicting && (
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #7c3aed44', padding: 30, textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🧠</div>
                  <p style={{ color: '#a855f7', fontSize: 14 }}>Running AI/ML risk analysis on all 24 zones...</p>
                  <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Analyzing rainfall, slope, soil, sensors, vegetation & historical data</p>
                </div>
              )}

              {predictions.length > 0 && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                      <h3 style={{ fontSize: 15, marginBottom: 4, color: '#e2e8f0' }}>📈 Slope Angle vs Risk Score</h3>
                      <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>Each bar = one zone. Left axis = slope, Right axis = risk score.</p>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={predictions.map(p => {
                          const zone = zones.find(z => z.id === p.zone_id);
                          return { name: p.zone_name.substring(0, 10), slope: zone?.slope_angle_deg || 0, risk: p.risk_score, fill: riskColor[p.risk_level] };
                        })}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-45} textAnchor="end" height={60} />
                          <YAxis yAxisId="left" tick={{ fill: '#f97316', fontSize: 11 }} label={{ value: 'Slope (°)', angle: -90, position: 'insideLeft', fill: '#f97316', fontSize: 11 }} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#ef4444', fontSize: 11 }} label={{ value: 'Risk %', angle: 90, position: 'insideRight', fill: '#ef4444', fontSize: 11 }} />
                          <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }} />
                          <Bar yAxisId="left" dataKey="slope" fill="#f97316" radius={[2, 2, 0, 0]} fillOpacity={0.6} />
                          <Bar yAxisId="right" dataKey="risk" radius={[2, 2, 0, 0]}>
                            {predictions.map((p, i) => <Cell key={i} fill={riskColor[p.risk_level]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 360 }}>
                      <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155' }}>
                        <h3 style={{ fontSize: 15, color: '#e2e8f0' }}>🗺️ Real-Time Risk Heatmap</h3>
                        <p style={{ fontSize: 11, color: '#64748b' }}>Circle size = risk score. Color = risk level.</p>
                      </div>
                      <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: 300, width: '100%' }} scrollWheelZoom={false}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                        {predictions.map(p => (
                          <CircleMarker key={p.zone_id} center={[
                            zones.find(z => z.id === p.zone_id)?.latitude || 25.5,
                            zones.find(z => z.id === p.zone_id)?.longitude || 93.0
                          ]} radius={Math.max(5, p.risk_score / 5)} fillColor={riskColor[p.risk_level]} color="white" weight={1} fillOpacity={0.8}>
                            <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{p.zone_name}</strong><br />Risk: <span style={{ color: riskColor[p.risk_level] }}>{p.risk_level.toUpperCase()} ({p.risk_score}%)</span><br />Confidence: {(p.confidence * 100).toFixed(0)}%</div></Popup>
                          </CircleMarker>
                        ))}
                      </MapContainer>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                      <h3 style={{ fontSize: 15, marginBottom: 4, color: '#e2e8f0' }}>🌧️ Rainfall Factor vs Risk Score</h3>
                      <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>How rainfall contribution correlates with overall risk.</p>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={predictions.map(p => ({ name: p.zone_name.substring(0, 10), rainfall: p.contributing_factors.rainfall || 0, risk: p.risk_score }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-45} textAnchor="end" height={60} />
                          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                          <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }} />
                          <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                          <Bar dataKey="rainfall" name="Rainfall Factor" fill="#3b82f6" radius={[2, 2, 0, 0]} fillOpacity={0.7} />
                          <Bar dataKey="risk" name="Total Risk" fill="#ef4444" radius={[2, 2, 0, 0]} fillOpacity={0.7} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {(() => {
                      const sorted = [...predictions].sort((a, b) => b.risk_score - a.risk_score);
                      const top = sorted[0];
                      const radarData = top ? Object.entries(top.contributing_factors).map(([k, v]) => ({ factor: k, value: v, fullMark: 100 })) : [];
                      return (
                        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                          <h3 style={{ fontSize: 15, marginBottom: 4, color: '#e2e8f0' }}>🎯 Top Zone Risk Factor Breakdown</h3>
                          <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>{top ? top.zone_name : 'N/A'} — {top ? top.risk_level.toUpperCase() : ''}</p>
                          <ResponsiveContainer width="100%" height={260}>
                            <RadarChart data={radarData}>
                              <PolarGrid stroke="#334155" />
                              <PolarAngleAxis dataKey="factor" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                              <PolarRadiusAxis tick={{ fill: '#64748b', fontSize: 9 }} domain={[0, 100]} />
                              <Radar name="Risk Factors" dataKey="value" stroke="#a855f7" fill="#a855f7" fillOpacity={0.3} />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                      <h3 style={{ fontSize: 15, marginBottom: 12 }}>📊 All Zone Risk Scores</h3>
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={[...predictions].sort((a, b) => b.risk_score - a.risk_score).map(p => ({ name: p.zone_name.substring(0, 14), score: p.risk_score }))} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8' }} />
                          <YAxis dataKey="name" type="category" width={110} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }} />
                          <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                            {[...predictions].sort((a, b) => b.risk_score - a.risk_score).map((p, i) => <Cell key={i} fill={riskColor[p.risk_level]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                        <h3 style={{ fontSize: 15, marginBottom: 12 }}>📈 Prediction Summary</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{predictions.filter(p => p.risk_level === 'critical').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>Critical Zones</div></div>
                          <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#f97316' }}>{predictions.filter(p => p.risk_level === 'high').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>High Risk</div></div>
                          <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#eab308' }}>{predictions.filter(p => p.risk_level === 'moderate').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>Moderate Risk</div></div>
                          <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{predictions.filter(p => p.risk_level === 'low').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>Low Risk</div></div>
                        </div>
                        <div style={{ marginTop: 12, padding: 12, background: '#0f172a', borderRadius: 8 }}>
                          <div style={{ fontSize: 13, color: '#94a3b8' }}>Average Risk Score: <strong style={{ color: '#e2e8f0' }}>{(predictions.reduce((s, p) => s + p.risk_score, 0) / predictions.length).toFixed(1)}%</strong></div>
                          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Avg Confidence: <strong style={{ color: '#e2e8f0' }}>{(predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length * 100).toFixed(0)}%</strong></div>
                        </div>
                      </div>

                      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20, flex: 1, overflowY: 'auto', maxHeight: 300 }}>
                        <h3 style={{ fontSize: 15, marginBottom: 12 }}>🚨 Priority Actions</h3>
                        {[...predictions].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5).map((p, idx) => (
                          <div key={p.zone_id} style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: riskBg[p.risk_level], border: `1px solid ${riskColor[p.risk_level]}33` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, fontSize: 13 }}>#{idx + 1} {p.zone_name}</span>
                              <span style={{ fontWeight: 700, fontSize: 13, color: riskColor[p.risk_level] }}>{p.risk_score}%</span>
                            </div>
                            <div style={{ fontSize: 11, color: '#cbd5e1' }}>{p.recommended_actions[0]}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                              {Object.entries(p.contributing_factors).slice(0, 4).map(([k, v]) => (
                                <span key={k} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#334155', color: '#94a3b8' }}>{k}: {v.toFixed(0)}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
              {predictions.length === 0 && !predicting && (
                <div style={{ textAlign: 'center', padding: 60, color: '#64748b', background: '#1e293b', borderRadius: 12, border: '1px solid #334155' }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🧠</div>
                  <p style={{ fontSize: 16, color: '#e2e8f0' }}>Click "Run Predictions" to analyze all zones</p>
                  <p style={{ fontSize: 13, marginTop: 8 }}>The AI model analyzes real-time rainfall, slope geometry, soil type, vegetation cover, sensor anomalies, and historical event data for all 24 monitored zones across the North Eastern Region.</p>
                  <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', gap: 20 }}>
                    <div style={{ padding: 12, background: '#334155', borderRadius: 8, textAlign: 'center' }}><div style={{ fontSize: 20 }}>🌧️</div><div style={{ fontSize: 11, marginTop: 4 }}>Rainfall Data</div></div>
                    <div style={{ padding: 12, background: '#334155', borderRadius: 8, textAlign: 'center' }}><div style={{ fontSize: 20 }}>⛰️</div><div style={{ fontSize: 11, marginTop: 4 }}>Terrain Analysis</div></div>
                    <div style={{ padding: 12, background: '#334155', borderRadius: 8, textAlign: 'center' }}><div style={{ fontSize: 20 }}>📡</div><div style={{ fontSize: 11, marginTop: 4 }}>Sensor Feeds</div></div>
                    <div style={{ padding: 12, background: '#334155', borderRadius: 8, textAlign: 'center' }}><div style={{ fontSize: 20 }}>📊</div><div style={{ fontSize: 11, marginTop: 4 }}>History</div></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {page === 'history' && <HistoryPage />}
        </main>

        {/* ============ REPORT MODAL ============ */}
        {showReportForm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }} onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); }}>
            <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, width: 440, maxWidth: '90vw', border: '1px solid #334155', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>📸 Submit Field Report</h3>

              <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: userLocation ? 'rgba(34,197,94,0.1)' : locationError ? 'rgba(234,179,8,0.1)' : 'rgba(96,165,250,0.1)', border: `1px solid ${userLocation ? '#22c55e44' : locationError ? '#eab30844' : '#60a5fa44'}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: userLocation ? '#22c55e' : locationError ? '#eab308' : '#60a5fa', marginBottom: 4 }}>
                  {userLocation ? '✅ Location detected' : locationError ? '⚠️ Location fallback' : '📍 Detecting your location...'}
                </div>
                {userLocation && (
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>🌐 GPS: Lat {userLocation.lat.toFixed(6)}, Lon {userLocation.lon.toFixed(6)}</div>
                )}
                {locationError && !userLocation && <div style={{ fontSize: 11, color: '#eab308' }}>{locationError}</div>}
              </div>

              <form onSubmit={submitReport}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Your Name</label>
                  <input name="reporter_name" defaultValue="Anonymous" required style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Phone</label>
                  <input name="reporter_phone" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Report Type</label>
                  <select name="report_type" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }}>
                    <option value="crack">Crack in ground/building</option>
                    <option value="slope_movement">Slope movement</option>
                    <option value="blocked_road">Blocked road</option>
                    <option value="flooding">Flooding</option>
                    <option value="landslide">Landslide observed</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Severity</label>
                  <select name="severity_claimed" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }}>
                    <option value="low">Low</option>
                    <option value="moderate">Moderate</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Description *</label>
                  <textarea name="description" rows={3} required placeholder="Describe what you observed..." style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, resize: 'vertical' }} />
                </div>

                {reportStatus.type && (
                  <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, fontSize: 13, background: reportStatus.type === 'success' ? 'rgba(34,197,94,0.15)' : reportStatus.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(96,165,250,0.15)', color: reportStatus.type === 'success' ? '#22c55e' : reportStatus.type === 'error' ? '#ef4444' : '#60a5fa', border: `1px solid ${reportStatus.type === 'success' ? '#22c55e44' : reportStatus.type === 'error' ? '#ef444444' : '#60a5fa44'}` }}>
                    {reportStatus.type === 'loading' ? '⏳ ' : reportStatus.type === 'success' ? '✅ ' : '❌ '}{reportStatus.message}
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>📸 Photo/Video (optional, max 5)</label>
                  <label style={{ display: 'block', padding: 16, border: '2px dashed #475569', borderRadius: 8, textAlign: 'center', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>
                    📷 Click to attach photo or video
                    <input type="file" accept="image/*,video/*" capture="environment" multiple onChange={handlePhotoSelect} style={{ display: 'none' }} />
                  </label>
                  {photoPreviewUrls.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      {photoPreviewUrls.map((url, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <img src={url} alt={`Preview ${i + 1}`} style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 8, border: '2px solid #475569' }} />
                          <button type="button" onClick={() => removePhoto(i)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', color: 'white', border: 'none', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {userLocation && <div style={{ marginTop: 6, fontSize: 11, color: '#22c55e' }}>📍 GPS: {userLocation.lat.toFixed(4)}°N, {userLocation.lon.toFixed(4)}°E — auto-tagged</div>}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {reportStatus.type === 'success' ? (
                    <button type="button" onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); setPage('reports'); loadReports(); }} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: '#22c55e', color: 'white', fontSize: 14, cursor: 'pointer' }}>
                      ✅ View My Report
                    </button>
                  ) : (
                    <button type="submit" disabled={!userLocation || reportStatus.type === 'loading'} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: (!userLocation || reportStatus.type === 'loading') ? '#475569' : '#2563eb', color: 'white', fontSize: 14, cursor: (!userLocation || reportStatus.type === 'loading') ? 'not-allowed' : 'pointer' }}>
                      {reportStatus.type === 'loading' ? '⏳ Submitting...' : '📍 Submit with Location'}
                    </button>
                  )}
                  <button type="button" onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); }} style={{ padding: 10, borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>Close</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============ ADMIN LOGIN MODAL ============ */}
        {showAdminLogin && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }} onClick={() => { setShowAdminLogin(false); setAdminLoginError(''); setAdminPassword(''); }}>
            <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, width: 380, maxWidth: '90vw', border: '1px solid #334155' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9', textAlign: 'center' }}>🔐 Admin Login</h3>
              <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 16 }}>Reports are only accessible to authorized administrators.</p>
              <form onSubmit={(e) => { e.preventDefault(); handleAdminLogin(); }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Admin Password</label>
                  <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Enter admin password" autoFocus style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
                </div>
                {adminLoginError && (
                  <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontSize: 13, border: '1px solid #ef444444' }}>
                    ❌ {adminLoginError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" disabled={!adminPassword || adminLoggingIn} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: (!adminPassword || adminLoggingIn) ? '#475569' : '#2563eb', color: 'white', fontSize: 14, cursor: (!adminPassword || adminLoggingIn) ? 'not-allowed' : 'pointer' }}>
                    {adminLoggingIn ? '⏳ Verifying...' : '🔓 Login'}
                  </button>
                  <button type="button" onClick={() => { setShowAdminLogin(false); setAdminLoginError(''); setAdminPassword(''); }} style={{ padding: 10, borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                </div>
                <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#0f172a', fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                  💡 Hint: Password is <code style={{ color: '#60a5fa' }}>admin123</code>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============ FOOTER ============ */}
        <footer style={{ padding: '16px 24px', textAlign: 'center', color: '#475569', fontSize: 12, borderTop: '1px solid #1e293b' }}>
          NER Landslide Early Warning System v1.0 | AI-Powered Disaster Monitoring for North Eastern Region | Built for Climate-Resilient Governance
        </footer>
      </div>
    </div>
  );
}
