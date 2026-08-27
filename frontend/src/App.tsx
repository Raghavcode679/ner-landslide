import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
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

// ============ API HELPERS ============
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
      ws.onmessage = (e) => {
        try { onMessage(JSON.parse(e.data)); } catch {}
      };
      ws.onclose = () => {
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [url]);

  return wsRef;
}

// ============ RISK COLORS ============
const riskColor: Record<string, string> = {
  low: '#22c55e', moderate: '#eab308', high: '#f97316', critical: '#ef4444',
};
const riskBg: Record<string, string> = {
  low: 'rgba(34,197,94,0.15)', moderate: 'rgba(234,179,8,0.15)', high: 'rgba(249,115,22,0.15)', critical: 'rgba(239,68,68,0.15)',
};
const roadColors: Record<string, string> = { open: '#22c55e', blocked: '#ef4444', partial: '#eab308', damaged: '#f97316' };

// ============ MULTILINGUAL ============
const LANGUAGES: Record<string, Record<string, string>> = {
  en: {
    dashboard: 'Dashboard', zones: 'Zones', alerts: 'Alerts', roads: 'Roads', villages: 'Villages', reports: 'Reports', predictions: 'Predictions', history: 'History',
    report_now: 'Report Now', simulate: 'Simulate Update', language: 'Language', search: 'Search zones...',
    title: 'NER Landslide Early Warning System', subtitle: 'AI-Powered Real-Time Disaster Monitoring',
    risk_summary: 'Risk Summary', road_status: 'Road Connectivity', village_status: 'Village Connectivity', active_alerts: 'Active Alerts', top_risk: 'Top Risk Zones',
    critical_zones: 'Critical Zones', high_risk: 'High Risk', avg_risk: 'Avg Risk Score', roads_blocked: 'Roads Blocked', isolated_villages: 'Isolated Villages',
    run_predictions: 'Run Predictions', analyzing: 'Analyzing...', ai_analysis: 'Running AI/ML risk analysis on all 24 zones...', ai_desc: 'Analyzing rainfall, slope, soil, sensors, vegetation & historical data',
    slope_vs_risk: 'Slope Angle vs Risk Score', slope_desc: 'Each bar = one zone. Left axis = slope, Right axis = risk score.',
    rainfall_vs_risk: 'Rainfall Factor vs Risk Score', rainfall_desc: 'How rainfall contribution correlates with overall risk.',
    risk_heatmap: 'Real-Time Risk Heatmap', heatmap_desc: 'Circle size = risk score. Color = risk level.',
    factor_breakdown: 'Top Zone Risk Factor Breakdown', all_zone_scores: 'All Zone Risk Scores', prediction_summary: 'Prediction Summary',
    moderate_risk: 'Moderate Risk', low_risk: 'Low Risk', priority_actions: 'Priority Actions',
    avg_risk_score: 'Average Risk Score', avg_confidence: 'Avg Confidence',
    click_run: 'Click "Run Predictions" to analyze all zones', ai_model_desc: 'The AI model analyzes real-time rainfall, slope geometry, soil type, vegetation cover, sensor anomalies, and historical event data for all 24 monitored zones across the North Eastern Region.',
    rainfall_data: 'Rainfall Data', terrain_analysis: 'Terrain Analysis', sensor_feeds: 'Sensor Feeds',
    no_active_alerts: 'No active alerts. System operating normally.', no_alerts: 'No alerts yet. Run predictions to generate alerts.',
    all_zones: 'All Monitored Zones', current_weather: 'Current Weather', storm_detected: 'Active storm system detected',
    district: 'District', state: 'State', elevation: 'Elevation', slope: 'Slope', soil: 'Soil', vegetation: 'Vegetation', risk_level: 'Risk Level', risk_score: 'Risk Score',
    alerts_notifications: 'Alerts & Notifications', road_connectivity: 'Road Connectivity Status', status_overview: 'Status Overview', all_roads: 'All Roads',
    village_monitoring: 'Village Monitoring', all_villages: 'Villages',
    admin_reports: 'Admin — Field Reports', no_reports: 'No reports found.', verify_report: 'Verify Report',
    submit_report: 'Submit Field Report', your_name: 'Your Name', phone: 'Phone', report_type: 'Report Type', severity: 'Severity', description: 'Description',
    submit_location: 'Submit with Location', submitting: 'Submitting...', location_detected: 'Location detected', location_fallback: 'Location fallback', detecting_location: 'Detecting your location...',
    admin_login: 'Admin Login', admin_access: 'Reports are only accessible to authorized administrators.', password: 'Password', login: 'Login', cancel: 'Cancel', logout: 'Logout', verifying: 'Verifying...', hint: 'Hint: Password is',
    photo_attach: 'Click to attach photo or video', gps_tagged: 'GPS: auto-tagged to your report', view_report: 'View My Report',
    run_predictions_to_see: 'Run predictions to see top risk zones',
  },
  hi: {
    dashboard: 'डैशबोर्ड', zones: 'क्षेत्र', alerts: 'अलर्ट', roads: 'सड़कें', villages: 'गाँव', reports: 'रिपोर्ट', predictions: 'भविष्यवाणी', history: 'इतिहास',
    report_now: 'अभी रिपोर्ट करें', simulate: 'अपडेट अनुकरण', language: 'भाषा', search: 'क्षेत्र खोजें...',
    title: 'पूर्वोत्तर भूस्खलन प्रारंभिक चेतावनी प्रणाली', subtitle: 'AI-संचालित वास्तविक समय आपदा निगरानी',
    risk_summary: 'जोखिम सारांश', road_status: 'सड़क कनेक्टिविटी', village_status: 'गाँव कनेक्टिविटी', active_alerts: 'सक्रिय अलर्ट', top_risk: 'उच्च जोखिम क्षेत्र',
    critical_zones: 'गंभीर क्षेत्र', high_risk: 'उच्च जोखिम', avg_risk: 'औसत जोखिम स्कोर', roads_blocked: 'अवरुद्ध सड़कें', isolated_villages: 'अलग-थलग गाँव',
    run_predictions: 'भविष्यवाणी चलाएं', analyzing: 'विश्लेषण हो रहा है...', ai_analysis: 'सभी 24 क्षेत्रों पर AI/ML जोखिम विश्लेषण...', ai_desc: 'वर्षा, ढलान, मिट्टी, सेंसर, वनस्पति और ऐतिहासिक डेटा का विश्लेषण',
    slope_vs_risk: 'ढलान कोण बनाम जोखिम स्कोर', slope_desc: 'प्रत्येक बार = एक क्षेत्र। बाईं अक्ष = ढलान, दाईं अक्ष = जोखिम।',
    rainfall_vs_risk: 'वर्षा कारक बनाम जोखिम स्कोर', rainfall_desc: 'वर्षा योगदान समग्र जोखिम से कैसे संबंधित है।',
    risk_heatmap: 'वास्तविक समय जोखिम हीटमैप', heatmap_desc: 'वृत्त का आकार = जोखिम स्कोर। रंग = जोखिम स्तर।',
    factor_breakdown: 'शीर्ष क्षेत्र जोखिम कारक विश्लेषण', all_zone_scores: 'सभी क्षेत्र जोखिम स्कोर', prediction_summary: 'भविष्यवाणी सारांश',
    moderate_risk: 'मध्यम जोखिम', low_risk: 'कम जोखिम', priority_actions: 'प्राथमिकता कार्य',
    avg_risk_score: 'औसत जोखिम स्कोर', avg_confidence: 'औसत विश्वास',
    click_run: '"भविष्यवाणी चलाएं" पर क्लिक करें', ai_model_desc: 'AI मॉडल सभी 24 क्षेत्रों का विश्लेषण करता है...',
    rainfall_data: 'वर्षा डेटा', terrain_analysis: 'भू-भाग विश्लेषण', sensor_feeds: 'सेंसर फीड',
    no_active_alerts: 'कोई सक्रिय अलर्ट नहीं। सिस्टम सामान्य रूप से काम कर रहा है।', no_alerts: 'अभी तक कोई अलर्ट नहीं। भविष्यवाणी चलाएं।',
    all_zones: 'सभी निगरानी क्षेत्र', current_weather: 'वर्तमान मौसम', storm_detected: 'सक्रिय तूफान प्रणाली का पता चला',
    district: 'जिला', state: 'राज्य', elevation: 'ऊँचाई', slope: 'ढलान', soil: 'मिट्टी', vegetation: 'वनस्पति', risk_level: 'जोखिम स्तर', risk_score: 'जोखिम स्कोर',
    alerts_notifications: 'अलर्ट और सूचनाएं', road_connectivity: 'सड़क कनेक्टिविटी स्थिति', status_overview: 'स्थिति अवलोकन', all_roads: 'सभी सड़कें',
    village_monitoring: 'गाँव निगरानी', all_villages: 'गाँव',
    admin_reports: 'व्यवस्थापक — फील्ड रिपोर्ट', no_reports: 'कोई रिपोर्ट नहीं मिली।', verify_report: 'रिपोर्ट सत्यापित करें',
    submit_report: 'फील्ड रिपोर्ट सबमिट करें', your_name: 'आपका नाम', phone: 'फ़ोन', report_type: 'रिपोर्ट प्रकार', severity: 'गंभीरता', description: 'विवरण',
    submit_location: 'स्थान के साथ सबमिट करें', submitting: 'सबमिट हो रहा है...', location_detected: 'स्थान मिला', location_fallback: 'स्थान फ़ॉलबैक', detecting_location: 'स्थान का पता लगा रहे हैं...',
    admin_login: 'व्यवस्थापक लॉगिन', admin_access: 'रिपोर्ट केवल अधिकृत व्यवस्थापकों के लिए हैं।', password: 'पासवर्ड', login: 'लॉगिन', cancel: 'रद्द करें', logout: 'लॉगआउट', verifying: 'सत्यापित हो रहा है...', hint: 'संकेत: पासवर्ड है',
    photo_attach: 'फ़ोटो या वीडियो संलग्न करने के लिए क्लिक करें', gps_tagged: 'GPS: आपकी रिपोर्ट से जुड़ा हुआ', view_report: 'रिपोर्ट देखें',
    run_predictions_to_see: 'शीर्ष जोखिम क्षेत्र देखने के लिए भविष्यवाणी चलाएं',
  },
  bn: {
    dashboard: 'ড্যাশবোর্ড', zones: 'অঞ্চল', alerts: 'সতর্কতা', roads: 'সড়ক', villages: 'গ্রাম', reports: 'প্রতিবেদন', predictions: 'পূর্বাভাস', history: 'ইতিহাস',
    report_now: 'এখনই জানান', simulate: 'আপডেট সিমুলেট', language: 'ভাষা', search: 'অঞ্চল খুঁজুন...',
    title: 'উত্তর-পূর্ব ভূমিধস প্রাথমিক সতর্কতা সিস্টেম', subtitle: 'AI-চালিত রিয়েল-টাইম দুর্যোগ পর্যবেক্ষণ',
    risk_summary: 'ঝুঁকি সারসংক্ষেপ', road_status: 'সড়ক সংযোগ', village_status: 'গ্রাম সংযোগ', active_alerts: 'সক্রিয় সতর্কতা', top_risk: 'সর্বোচ্চ ঝুঁকি অঞ্চল',
    critical_zones: 'সমালোচনামূলক অঞ্চল', high_risk: 'উচ্চ ঝুঁকি', avg_risk: 'গড় ঝুঁকি স্কোর', roads_blocked: 'অবরুদ্ধ সড়ক', isolated_villages: 'বিচ্ছিন্ন গ্রাম',
    run_predictions: 'পূর্বাভাস চালান', analyzing: 'বিশ্লেষণ হচ্ছে...', ai_analysis: 'সকল ২৪ অঞ্চলে AI/ML ঝুঁকি বিশ্লেষণ...', ai_desc: 'বৃষ্টিপাত, ঢাল, মাটি, সেন্সর, উদ্ভিদ ও ঐতিহাসিক ডেটা বিশ্লেষণ',
    slope_vs_risk: 'ঢাল কোণ বনাম ঝুঁকি স্কোর', slope_desc: 'প্রতিটি বার = একটি অঞ্চল।',
    rainfall_vs_risk: 'বৃষ্টিপাত ফ্যাক্টর বনাম ঝুঁকি স্কোর', rainfall_desc: 'বৃষ্টিপাত অবদান সামগ্রিক ঝুঁকির সাথে কীভাবে সম্পর্কিত।',
    risk_heatmap: 'রিয়েল-টাইম ঝুঁকি হিটম্যাপ', heatmap_desc: 'বৃত্তের আকার = ঝুঁকি স্কোর। রং = ঝুঁকি স্তর।',
    factor_breakdown: 'শীর্ষ অঞ্চল ঝুঁকি ফ্যাক্টর ব্রেকডাউন', all_zone_scores: 'সকল অঞ্চলের ঝুঁকি স্কোর', prediction_summary: 'পূর্বাভাস সারসংক্ষেপ',
    moderate_risk: 'মাঝারি ঝুঁকি', low_risk: 'কম ঝুঁকি', priority_actions: 'অগ্রাধিকার পদক্ষেপ',
    avg_risk_score: 'গড় ঝুঁকি স্কোর', avg_confidence: 'গড় আস্থা',
    click_run: '"পূর্বাভাস চালান" ক্লিক করুন', ai_model_desc: 'AI মডেল সকল ২৪ অঞ্চলের বিশ্লেষণ করে...',
    rainfall_data: 'বৃষ্টিপাত ডেটা', terrain_analysis: 'টেরেইন বিশ্লেষণ', sensor_feeds: 'সেন্সর ফিড',
    no_active_alerts: 'কোনো সক্রিয় সতর্কতা নেই।', no_alerts: 'এখনো কোনো সতর্কতা নেই।',
    all_zones: 'সকল পর্যবেক্ষিত অঞ্চল', current_weather: 'বর্তমান আবহাওয়া', storm_detected: 'সক্রিয় ঝড় সিস্টেম সনাক্ত',
    district: 'জেলা', state: 'রাজ্য', elevation: 'উচ্চতা', slope: 'ঢাল', soil: 'মাটি', vegetation: 'উদ্ভিদ', risk_level: 'ঝুঁকি স্তর', risk_score: 'ঝুঁকি স্কোর',
    alerts_notifications: 'সতর্কতা ও বিজ্ঞপ্তি', road_connectivity: 'সড়ক সংযোগ অবস্থা', status_overview: 'অবস্থা পর্যালোচনা', all_roads: 'সকল সড়ক',
    village_monitoring: 'গ্রাম পর্যবেক্ষণ', all_villages: 'গ্রাম',
    admin_reports: 'প্রশাসক — ফিল্ড রিপোর্ট', no_reports: 'কোনো রিপোর্ট পাওয়া যায়নি।', verify_report: 'রিপোর্ট যাচাই করুন',
    submit_report: 'ফিল্ড রিপোর্ট জমা দিন', your_name: 'আপনার নাম', phone: 'ফোন', report_type: 'রিপোর্টের ধরন', severity: 'তীব্রতা', description: 'বিবরণ',
    submit_location: 'অবস্থান সহ জমা দিন', submitting: 'জমা দেওয়া হচ্ছে...', location_detected: 'অবস্থান সনাক্ত', location_fallback: 'অবস্থান ফলব্যাক', detecting_location: 'আপনার অবস্থান সনাক্ত করা হচ্ছে...',
    admin_login: 'প্রশাসক লগইন', admin_access: 'রিপোর্ট শুধুমাত্র অনুমোদিত প্রশাসকদের জন্য।', password: 'পাসওয়ার্ড', login: 'লগইন', cancel: 'বাতিল', logout: 'লগআউট', verifying: 'যাচাই হচ্ছে...', hint: 'ইঙ্গিত: পাসওয়ার্ড হলো',
    photo_attach: 'ছবি বা ভিডিও সংযুক্ত করতে ক্লিক করুন', gps_tagged: 'GPS: আপনার রিপোর্টে ট্যাগ করা হয়েছে', view_report: 'রিপোর্ট দেখুন',
    run_predictions_to_see: 'শীর্ষ ঝুঁকি অঞ্চল দেখতে পূর্বাভাস চালান',
  },
  as: {
    dashboard: 'ডেশবৰ্ড', zones: 'অঞ্চল', alerts: 'সতৰ্কতা', roads: 'ৰাস্তা', villages: 'গাঁও', reports: 'প্ৰতিবেদন', predictions: 'পূৰ্বানুমান', history: 'ইতিহাস',
    report_now: 'এতিয়াই সঁচাৰ কৰক', simulate: 'আপডেট চিমুলেট', language: 'ভাষা', search: 'অঞ্চল বিচাৰক...',
    title: 'উত্তৰ-পূৱ ভূমিধ্বংস আগতীয়া সতৰ্কতা ব্যৱস্থা', subtitle: 'AI-চালিত ৰিয়েল-টাইম দুৰ্ঘটনা নিৰীক্ষণ',
    risk_summary: 'বিপদৰ সাৰাংশ', road_status: 'ৰাস্তা সংযোগ', village_status: 'গাঁও সংযোগ', active_alerts: 'সক্ৰিয় সতৰ্কতা', top_risk: 'চৰ্বোচ্চ বিপদ অঞ্চল',
    critical_zones: 'সমালোচনামূলক অঞ্চল', high_risk: 'উচ্চ বিপদ', avg_risk: 'গড় বিপদ স্কোৰ', roads_blocked: 'বাধাগ্ৰস্ত ৰাস্তা', isolated_villages: 'বিচ্ছিন্ন গাঁও',
    run_predictions: 'পূৰ্বানুমান চলাওক', analyzing: 'বিশ্লেষণ হৈ আছে...', ai_analysis: 'সকল ২৪ অঞ্চলত AI/ML বিপদ বিশ্লেষণ...', ai_desc: 'বৃষ্টিপাত, ঢাল, মাটি, চেন্ছৰ, উদ্ভিদ আৰু ঐতিহাসিক ডেটা বিশ্লেষণ',
    slope_vs_risk: 'ঢাল কোণ বনাম বিপদ স্কোৰ', slope_desc: 'প্ৰতিটো বাৰ = এটা অঞ্চল।',
    rainfall_vs_risk: 'বৃষ্টিপাত ফেক্টৰ বনাম বিপদ স্কোৰ', rainfall_desc: 'বৃষ্টিপাতৰ অৱদান সামগ্ৰিক বিপদৰ সৈতে কেনেকৈ সম্পৰ্কিত।',
    risk_heatmap: 'ৰিয়েল-টাইম বিপদ হিটমেপ', heatmap_desc: 'বৃত্তৰ আকাৰ = বিপদ স্কোৰ। ৰং = বিপদ স্তৰ।',
    factor_breakdown: 'চৰ্বোচ্চ অঞ্চল বিপদ ফেক্টৰ ব্ৰেকডাউন', all_zone_scores: 'সকল অঞ্চলৰ বিপদ স্কোৰ', prediction_summary: 'পূৰ্বানুমান সাৰাংশ',
    moderate_risk: 'মধ্যম বিপদ', low_risk: 'কম বিপদ', priority_actions: 'প্ৰাথমিকতা কাৰ্য',
    avg_risk_score: 'গড় বিপদ স্কোৰ', avg_confidence: 'গড় বিশ্বাস',
    click_run: '"পূৰ্বানুমান চলাওক" ক্লিক কৰক', ai_model_desc: 'AI মডেলে সকল ২৪ অঞ্চলৰ বিশ্লেষণ কৰে...',
    rainfall_data: 'বৃষ্টিপাত ডেটা', terrain_analysis: 'টেৰেইন বিশ্লেষণ', sensor_feeds: 'চেন্ছৰ ফিড',
    no_active_alerts: 'কোনো সক্ৰিয় সতৰ্কতা নাই।', no_alerts: 'এতিয়ালৈ কোনো সতৰ্কতা নাই।',
    all_zones: 'সকল নিৰীক্ষিত অঞ্চল', current_weather: 'বৰ্তমান বতৰা', storm_detected: 'সক্ৰিয় ঘূৰ্ণিবাতাস সিষ্টেম চিহ্নিত',
    district: 'জিলা', state: 'ৰাজ্য', elevation: 'উচ্চতা', slope: 'ঢাল', soil: 'মাটি', vegetation: 'উদ্ভিদ', risk_level: 'বিপদ স্তৰ', risk_score: 'বিপদ স্কোৰ',
    alerts_notifications: 'সতৰ্কতা আৰু বিজ্ঞপ্তি', road_connectivity: 'ৰাস্তা সংযোগ অৱস্থা', status_overview: 'অৱস্থা পৰ্যালোচনা', all_roads: 'সকল ৰাস্তা',
    village_monitoring: 'গাঁও নিৰীক্ষণ', all_villages: 'গাঁও',
    admin_reports: 'প্ৰশাসক — ফিল্ড প্ৰতিবেদন', no_reports: 'কোনো প্ৰতিবেদন পোৱা নগ'+'ল।', verify_report: 'প্ৰতিবেদন সত্যাপন কৰক',
    submit_report: 'ফিল্ড প্ৰতিবেদন দাখিল কৰক', your_name: 'আপোনাৰ নাম', phone: 'ফোন', report_type: 'প্ৰতিবেদনৰ ধৰণ', severity: 'তীব্ৰতা', description: 'বিৱৰণ',
    submit_location: 'স্থানৰ সৈতে দাখিল কৰক', submitting: 'দাখিল হৈ আছে...', location_detected: 'স্থান চিহ্নিত', location_fallback: 'স্থান ফলবেক', detecting_location: 'আপোনাৰ স্থান চিহ্নিত কৰা হৈ আছে...',
    admin_login: 'প্ৰশাসক লগইন', admin_access: 'প্ৰতিবেদন কেৱল অনুমোদিত প্ৰশাসকৰ বাবে।', password: 'পাছৱৰ্ড', login: 'লগইন', cancel: 'বাতিল', logout: 'লগআউট', verifying: 'সত্যাপন হৈ আছে...', hint: 'ইঙ্গিত: পাছৱৰ্ড হৈছে',
    photo_attach: 'ছবি বা ভিডিও সংলগ্ন কৰিবলৈ ক্লিক কৰক', gps_tagged: 'GPS: আপোনাৰ প্ৰতিবেদনত টেগ কৰা হৈছে', view_report: 'প্ৰতিবেদন চাওক',
    run_predictions_to_see: 'চৰ্বোচ্চ বিপদ অঞ্চল চাবলৈ পূৰ্বানুমান চলাওক',
  },
  mr: {
    dashboard: 'डॅशबोर्ड', zones: 'झोने', alerts: 'सूचना', roads: 'मार्ग', villages: 'गावे', reports: 'अहवाल', predictions: 'अंदाज', history: 'इतिहास',
    report_now: 'आता कळवा', simulate: 'अद्यतन सिम्युलेट', language: 'भाषा', search: 'झोने शोधा...',
    title: 'उत्तर-पूर्व भूस्खलन प्रारंभिक सूचना प्रणाली', subtitle: 'AI-शक्तीवर चालणारी रिअल-टाइम आपत्ती निरीक्षण',
    risk_summary: 'धोका सारांश', road_status: 'मार्ग कनेक्टिव्हिटी', village_status: 'गाव कनेक्टिव्हिटी', active_alerts: 'सक्रिय सूचना', top_risk: 'सर्वाधिक धोकादायक झोने',
    critical_zones: 'गंभीर झोने', high_risk: 'उच्च धोका', avg_risk: 'सरासरी धोका स्कोअर', roads_blocked: 'अवरोधित मार्ग', isolated_villages: 'एकटे गावे',
    run_predictions: 'अंदाज चालवा', analyzing: 'विश्लेषण होत आहे...', ai_analysis: 'सर्व २४ झोन्स AI/ML धोका विश्लेषण...', ai_desc: 'पाऊस, भिंती, माती, सेन्सर, वनस्पती आणि इतिहास डेटा विश्लेषण',
    slope_vs_risk: 'भिंती कोन विरुद्ध धोका स्कोअर', slope_desc: 'प्रत्येक बार = एक झोने।',
    rainfall_vs_risk: 'पाऊस घटक विरुद्ध धोका स्कोअर', rainfall_desc: 'पाऊस योगदान एकूण धोक्याशी कसे संबंधित आहे.',
    risk_heatmap: 'रिअल-टाइम धोका हीटमॅप', heatmap_desc: 'वर्तुळाचा आकार = धोका स्कोअर। रंग = धोका पात्री।',
    factor_breakdown: 'शीर्ष झोने धोका घटक विश्लेषण', all_zone_scores: 'सर्व झोन्स धोका स्कोअर', prediction_summary: 'अंदाज सारांश',
    moderate_risk: 'मध्यम धोका', low_risk: 'कमी धोका', priority_actions: 'प्राधान्य क्रिया',
    avg_risk_score: 'सरासरी धोका स्कोअर', avg_confidence: 'सरासरी विश्वास',
    click_run: '"अंदाज चालवा" वर क्लिक करा', ai_model_desc: 'AI मॉडेल सर्व २४ झोन्सचे विश्लेषण करते...',
    rainfall_data: 'पाऊस डेटा', terrain_analysis: 'भूभाग विश्लेषण', sensor_feeds: 'सेन्सर फीड',
    no_active_alerts: 'कोणतीही सक्रिय सूचना नाही.', no_alerts: 'अजून कोणतीही सूचना नाही.',
    all_zones: 'सर्व निरीक्षित झोने', current_weather: 'सध्याचे हवामान', storm_detected: 'सक्रिय वादळ प्रणाली शोधली',
    district: 'जिल्हा', state: 'राज्य', elevation: 'उंची', slope: 'भिंती', soil: 'माती', vegetation: 'वनस्पती', risk_level: 'धोका पात्री', risk_score: 'धोका स्कोअर',
    alerts_notifications: 'सूचना आणि बातम्या', road_connectivity: 'मार्ग कनेक्टिव्हिटी स्थिती', status_overview: 'स्थिती पाहणी', all_roads: 'सर्व मार्ग',
    village_monitoring: 'गाव निरीक्षण', all_villages: 'गावे',
    admin_reports: 'प्रशासक — फील्ड अहवाल', no_reports: 'अहवाल सापडले नाहीत.', verify_report: 'अहवाल पडताळा',
    submit_report: 'फील्ड अहवाल सबमिट करा', your_name: 'तुमचे नाव', phone: 'फोन', report_type: 'अहवाल प्रकार', severity: 'तीव्रता', description: 'वर्णन',
    submit_location: 'स्थानासह सबमिट करा', submitting: 'सबमिट होत आहे...', location_detected: 'स्थान शोधले', location_fallback: 'स्थान फॉलबॅक', detecting_location: 'तुमचे स्थान शोधत आहे...',
    admin_login: 'प्रशासक लॉगिन', admin_access: 'अहवाल केवळ अधिकृत प्रशासकांसाठी आहेत.', password: 'पासवर्ड', login: 'लॉगिन', cancel: 'रद्द करा', logout: 'लॉगआउट', verifying: 'पडताळा होत आहे...', hint: 'संकेत: पासवर्ड आहे',
    photo_attach: 'फोटो किंवा व्हिडिओ जोडण्यासाठी क्लिक करा', gps_tagged: 'GPS: तुमच्या अहवालाशी जोडले', view_report: 'अहवाल पहा',
    run_predictions_to_see: 'शीर्ष धोका झोने पाहण्यासाठी अंदाज चालवा',
  },
  ta: {
    dashboard: 'டாஷ்போர்டு', zones: 'மண்டலங்கள்', alerts: 'எச்சரிக்கை', roads: 'சாலைகள்', villages: 'கிராமங்கள்', reports: 'அறிக்கைகள்', predictions: 'முன்னறிவிப்பு', history: 'வரலாறு',
    report_now: 'இப்போது தெரிவிக்கவும்', simulate: 'புதுப்பிப்பு சிமுலேஷன்', language: 'மொழி', search: 'மண்டலங்களைத் தேடு...',
    title: 'வடகிழக்கு மண்சரிவு முன்னெச்சரிக்கை அமைப்பு', subtitle: 'AI-இயங்கும் நிகழ்நேர பேரிடர் கண்காணிப்பு',
    risk_summary: 'ஆபத்து சுருக்கம்', road_status: 'சாலை இணைப்பு', village_status: 'கிராம இணைப்பு', active_alerts: 'செயலில் உள்ள எச்சரிக்கை', top_risk: 'அதிக ஆபத்து மண்டலங்கள்',
    critical_zones: 'முக்கிய மண்டலங்கள்', high_risk: 'அதிக ஆபத்து', avg_risk: 'சராசரி ஆபத்து மதிப்பெண்', roads_blocked: 'தடுக்கப்பட்ட சாலைகள்', isolated_villages: 'தனிமைப்படுத்தப்பட்ட கிராமங்கள்',
    run_predictions: 'முன்னறிவிப்புகளை இயக்கு', analyzing: 'பகுப்பாய்வு நடக்கிறது...', ai_analysis: 'அனைத்து 24 மண்டலங்களிலும் AI/ML ஆபத்து பகுப்பாய்வு...', ai_desc: 'மழை, சாய்வு, மண், சென்சார், தாவரம் & வரலாற்று தரவு பகுப்பாய்வு',
    slope_vs_risk: 'சாய்வு கோணம் எதிராக ஆபத்து மதிப்பெண்', slope_desc: 'ஒவ்வொரு பட்டையும் = ஒரு மண்டலம்.',
    rainfall_vs_risk: 'மழை காரணி எதிராக ஆபத்து மதிப்பெண்', rainfall_desc: 'மழை பங்களிப்பு ஒட்டுமொத்த ஆபத்துடன் எவ்வாறு தொடர்புடையது.',
    risk_heatmap: 'நிகழ்நேர ஆபத்து வெப்பமானிகள்', heatmap_desc: 'வட்டத்தின் அளவு = ஆபத்து மதிப்பெண்.',
    factor_breakdown: 'உயர் மண்டல ஆபத்து காரணி பிரிவு', all_zone_scores: 'அனைத்து மண்டல ஆபத்து மதிப்பெண்கள்', prediction_summary: 'முன்னறிவிப்பு சுருக்கம்',
    moderate_risk: 'மிதமான ஆபத்து', low_risk: 'குறைந்த ஆபத்து', priority_actions: 'முன்னுரிமை நடவடிக்கைகள்',
    avg_risk_score: 'சராசரி ஆபத்து மதிப்பெண்', avg_confidence: 'சராசரி நம்பிக்கை',
    click_run: '"முன்னறிவிப்புகளை இயக்கு" என்பதைக் கிளிக் செய்யுங்கள்', ai_model_desc: 'AI மாதிரி அனைத்து 24 மண்டலங்களையும் பகுப்பாய்வு செய்கிறது...',
    rainfall_data: 'மழை தரவு', terrain_analysis: 'நிலப்பரப்பு பகுப்பாய்வு', sensor_feeds: 'சென்சார் ஊட்டங்கள்',
    no_active_alerts: 'செயலில் உள்ள எச்சரிக்கை இல்லை.', no_alerts: 'இன்னும் எச்சரிக்கை இல்லை.',
    all_zones: 'அனைத்து கண்காணிக்கப்படும் மண்டலங்கள்', current_weather: 'தற்போதைய வானிலை', storm_detected: 'செயலில் உள்ள புயல் அமைப்பு கண்டறியப்பட்டது',
    district: 'மாவட்டம்', state: 'மாநிலம்', elevation: 'உயரம்', slope: 'சாய்வு', soil: 'மண்', vegetation: 'தாவரம்', risk_level: 'ஆபத்து நிலை', risk_score: 'ஆபத்து மதிப்பெண்',
    alerts_notifications: 'எச்சரிக்கைகள் & அறிவிப்புகள்', road_connectivity: 'சாலை இணைப்பு நிலை', status_overview: 'நிலை கண்ணோட்டம்', all_roads: 'அனைத்து சாலைகள்',
    village_monitoring: 'கிராம கண்காணிப்பு', all_villages: 'கிராமங்கள்',
    admin_reports: 'நிர்வாகி — கள அறிக்கைகள்', no_reports: 'அறிக்கைகள் எதுவும் இல்லை.', verify_report: 'அறிக்கையை சரிபார்க்கவும்',
    submit_report: 'கள அறிக்கையைச் சமர்ப்பிக்கவும்', your_name: 'உங்கள் பெயர்', phone: 'தொலைபேசி', report_type: 'அறிக்கை வகை', severity: 'தீவிரம்', description: 'விளக்கம்',
    submit_location: 'இருப்பிடத்துடன் சமர்ப்பிக்கவும்', submitting: 'சமர்ப்பிக்கிறது...', location_detected: 'இருப்பிடம் கண்டறியப்பட்டது', location_fallback: 'இருப்பிட மாற்று', detecting_location: 'உங்கள் இருப்பிடத்தைக் கண்டறிகிறது...',
    admin_login: 'நிர்வாகி உள்நுழைவு', admin_access: 'அறிக்கைகள் அங்கீகரிக்கப்பட்ட நிர்வாகிகளுக்கு மட்டுமே.', password: 'கடவுச்சொல்', login: 'உள்நுழை', cancel: 'ரத்துசெய்', logout: 'வெளியேறு', verifying: 'சரிபார்க்கிறது...', hint: 'குறிப்பு: கடவுச்சொல்',
    photo_attach: 'புகைப்படம் அல்லது வீடியோ இணைக்க கிளிக் செய்யுங்கள்', gps_tagged: 'GPS: உங்கள் அறிக்கையில் குறிக்கப்பட்டது', view_report: 'அறிக்கையைக் காண்க',
    run_predictions_to_see: 'உயர் ஆபத்து மண்டலங்களைப் பார்க்க முன்னறிவிப்புகளை இயக்கு',
  },
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

// ============ MAIN APP ============
// ============ HISTORY PAGE ============
function HistoryPage({ t }: { t: Record<string, string> }) {
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
        ) : records.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No historical records found.</div>
        ) : records.map((r: any) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 120px 100px 100px 100px', gap: 0, padding: '12px 16px', borderBottom: '1px solid #1e293b', fontSize: 13, alignItems: 'start' }}>
            <div style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{r.date}</div>
            <div><div style={{ fontWeight: 600, color: '#e2e8f0' }}>{r.zone} — {r.district}, {r.state}</div><div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{r.description}</div></div>
            <div style={{ color: '#94a3b8' }}>{r.type}</div>
            <div><span style={{ background: `${severityColors[r.severity]}22`, color: severityColors[r.severity], padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{r.severity.toUpperCase()}</span></div>
            <div style={{ color: r.casualties > 0 ? '#ef4444' : '#64748b', fontWeight: r.casualties > 0 ? 700 : 400 }}>{r.casualties}</div>
            <div style={{ color: '#f97316' }}>{r.displaced?.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [wsMessages, setWsMessages] = useState<any[]>([]);
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
    setWsMessages(prev => [data, ...prev].slice(0, 20));
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

  // Load reports (admin only)
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

  // Run predictions
  const runPredictions = async () => {
    setPredicting(true);
    try {
      const data = await fetchAPI<{ predictions: Prediction[] }>('/predictions');
      setPredictions(data.predictions);
      const z = await fetchAPI<Zone[]>('/zones');
      setZones(z);
    } catch (e) {
      console.error('Prediction error:', e);
      alert('Failed to run predictions. Make sure backend is running on port 8000.');
    }
    setPredicting(false);
  };

  // Simulate real-time update
  const simulateUpdate = async () => {
    setSimulating(true);
    try {
      await postAPI('/simulate/update');
      await loadData();
      await runPredictions();
    } catch (e) { console.error(e); }
    setSimulating(false);
  };

  // Load weather for zone
  const loadWeather = async (zoneId: number) => {
    try {
      const w = await fetchAPI<WeatherData>(`/weather/${zoneId}`);
      setWeather(w);
      setSelectedZoneId(zoneId);
    } catch (e) { console.error(e); }
  };

  // Get user location on mount
  useEffect(() => {
    if (showReportForm && !userLocation) {
      setLocationError('');
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
            setLocationError('');
          },
          (err) => {
            console.warn('Geolocation error:', err.message);
            setLocationError('Could not access location. Using default NER coordinates.');
            setUserLocation({ lat: 25.6, lon: 93.5 });
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      } else {
        setLocationError('Geolocation not supported by your browser.');
        setUserLocation({ lat: 25.6, lon: 93.5 });
      }
    }
  }, [showReportForm]);

  // Admin login
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

  // Check admin session on mount
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      fetchAPI<{ authenticated: boolean }>('/admin/verify', token)
        .then(d => { if (d.authenticated) { setIsAdmin(true); loadReports(); } })
        .catch(() => sessionStorage.removeItem('admin_token'));
    }
    // Load data source status
    fetchAPI<Record<string, any>>('/data-sources/status').then(setDataSourceStatus).catch(() => {});
  }, []);

  // Sync real data (admin only)
  const syncRealData = async () => {
    const token = getAuthToken();
    if (!token) return;
    setSyncingRealData(true);
    try {
      const res = await fetch(`${API_BASE}/admin/sync-real-data`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      alert(`Synced ${data.zones_updated}/${data.total_zones} zones with real data!`);
      await loadData();
    } catch (e) {
      alert('Sync failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    }
    setSyncingRealData(false);
  };

  // Handle photo selection
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newPhotos = [...reportPhotos, ...files].slice(0, 5);
    setReportPhotos(newPhotos);
    // Create previews
    const urls = newPhotos.map(f => URL.createObjectURL(f));
    setPhotoPreviewUrls(urls);
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(photoPreviewUrls[idx]);
    const newPhotos = reportPhotos.filter((_, i) => i !== idx);
    const newUrls = photoPreviewUrls.filter((_, i) => i !== idx);
    setReportPhotos(newPhotos);
    setPhotoPreviewUrls(newUrls);
  };

  // Submit report
  const submitReport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setReportStatus({ type: 'loading', message: 'Submitting report...' });
    const form = new FormData(e.currentTarget);
    const lat = userLocation?.lat || 25.6;
    const lon = userLocation?.lon || 93.5;
    form.set('latitude', String(lat));
    form.set('longitude', String(lon));
    form.set('reporter_role', 'citizen');
    // Add photos
    reportPhotos.forEach(photo => { form.append('photos', photo); });
    try {
      const result = await postAPI<{ report_id: number; media_urls: string[] }>('/reports', form, true);
      const newReport: Report = {
        id: result.report_id,
        reporter_name: form.get('reporter_name') as string || 'Anonymous',
        latitude: lat, longitude: lon,
        report_type: form.get('report_type') as string || 'other',
        description: form.get('description') as string || '',
        severity_claimed: form.get('severity_claimed') as string || 'moderate',
        verified: false, created_at: new Date().toISOString(),
      };
      setReports(prev => [newReport, ...prev]);
      setReportStatus({ type: 'success', message: `Report #${result.report_id} submitted! ${result.media_urls?.length || 0} photo(s) attached. Location: (${lat.toFixed(4)}, ${lon.toFixed(4)})` });
      setReportPhotos([]);
      setPhotoPreviewUrls([]);
    } catch (err) {
      console.error('Report submit error:', err);
      setReportStatus({ type: 'error', message: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
  };

  const centerPos: [number, number] = selectedZone
    ? [selectedZone.latitude, selectedZone.longitude]
    : [25.5, 93.0];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏔️</div>
        <div style={{ fontSize: 20, color: '#94a3b8' }}>Loading NER Early Warning System...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* ============ HEADER ============ */}
      <header style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderBottom: '1px solid #334155', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>🏔️</span>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{t.title}</h1>
            <p style={{ fontSize: 12, color: '#64748b' }}>{t.subtitle}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Language selector */}
          <select value={lang} onChange={e => setLang(e.target.value)} style={{ background: '#334155', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="bn">বাংলা</option>
            <option value="as">অসমীয়া</option>
            <option value="mr">मराठी</option>
            <option value="ta">தமிழ்</option>
          </select>
          <button onClick={simulateUpdate} disabled={simulating} style={{ background: simulating ? '#475569' : '#2563eb', color: 'white', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
            {simulating ? '⏳ Updating...' : `📡 ${t.simulate}`}
          </button>
          {isAdmin && (
            <button onClick={syncRealData} disabled={syncingRealData} style={{ background: syncingRealData ? '#475569' : '#059669', color: 'white', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: syncingRealData ? 'wait' : 'pointer' }}>
              {syncingRealData ? '⏳ Syncing...' : '🌍 Sync Real Data'}
            </button>
          )}
          {/* Data source status - labeled pills */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {dataSourceStatus.open_meteo_weather && (
              <span title={`Open-Meteo Weather: ${dataSourceStatus.open_meteo_weather.status}`} style={{ fontSize: 10, background: dataSourceStatus.open_meteo_weather.status === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${dataSourceStatus.open_meteo_weather.status === 'ok' ? '#22c55e44' : '#ef444444'}`, borderRadius: 4, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                <span>{dataSourceStatus.open_meteo_weather.status === 'ok' ? '🟢' : '🔴'}</span>
                <span style={{ color: '#94a3b8' }}>Rain</span>
              </span>
            )}
            {dataSourceStatus.sentinel_2_ndvi && (
              <span title={`Sentinel-2 NDVI: ${dataSourceStatus.sentinel_2_ndvi.status}`} style={{ fontSize: 10, background: dataSourceStatus.sentinel_2_ndvi.status === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${dataSourceStatus.sentinel_2_ndvi.status === 'ok' ? '#22c55e44' : '#ef444444'}`, borderRadius: 4, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                <span>{dataSourceStatus.sentinel_2_ndvi.status === 'ok' ? '🟢' : '🔴'}</span>
                <span style={{ color: '#94a3b8' }}>NDVI</span>
              </span>
            )}
            {dataSourceStatus.srtm_elevation && (
              <span title={`SRTM DEM: ${dataSourceStatus.srtm_elevation.status}`} style={{ fontSize: 10, background: dataSourceStatus.srtm_elevation.status === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${dataSourceStatus.srtm_elevation.status === 'ok' ? '#22c55e44' : '#ef444444'}`, borderRadius: 4, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                <span>{dataSourceStatus.srtm_elevation.status === 'ok' ? '🟢' : '🔴'}</span>
                <span style={{ color: '#94a3b8' }}>DEM</span>
              </span>
            )}
            {dataSourceStatus.mqtt_sensors && (
              <span title={`MQTT Sensors: ${dataSourceStatus.mqtt_sensors.mqtt_connected ? 'Connected' : 'Disconnected'}`} style={{ fontSize: 10, background: dataSourceStatus.mqtt_sensors.mqtt_connected ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${dataSourceStatus.mqtt_sensors.mqtt_connected ? '#22c55e44' : '#ef444444'}`, borderRadius: 4, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                <span>{dataSourceStatus.mqtt_sensors.mqtt_connected ? '🟢' : '🔴'}</span>
                <span style={{ color: '#94a3b8' }}>MQTT</span>
              </span>
            )}
          </div>
          <button onClick={() => setShowReportForm(true)} style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
            📸 {t.report_now}
          </button>
          {/* Admin button */}
          {isAdmin ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#22c55e', background: 'rgba(34,197,94,0.15)', padding: '4px 8px', borderRadius: 4, border: '1px solid #22c55e44' }}>🔑 {t.admin_login}</span>
              <button onClick={handleAdminLogout} style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef444444', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>{t.logout}</button>
            </div>
          ) : (
            <button onClick={() => setShowAdminLogin(true)} style={{ background: '#475569', color: '#e2e8f0', border: '1px solid #64748b', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>🔐 {t.admin_login}</button>
          )}
        </div>
      </header>

      {/* ============ NAV TABS ============ */}
      <nav style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '0 24px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {(['dashboard', 'zones', 'alerts', 'roads', 'villages', 'predictions', 'history'] as const).map(p => (
          <button key={p} onClick={() => setPage(p)} style={{ background: page === p ? '#334155' : 'transparent', color: page === p ? '#60a5fa' : '#94a3b8', border: 'none', borderBottom: page === p ? '2px solid #60a5fa' : '2px solid transparent', padding: '12px 16px', fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {t[p] || p}
          </button>
        ))}
        {isAdmin && (
          <button onClick={() => { setPage('reports'); loadReports(); }} style={{ background: page === 'reports' ? '#334155' : 'transparent', color: page === 'reports' ? '#22c55e' : '#94a3b8', border: 'none', borderBottom: page === 'reports' ? '2px solid #22c55e' : '2px solid transparent', padding: '12px 16px', fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            🔐 {t.reports}
          </button>
        )}
      </nav>

      <main style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>

        {/* ============ DASHBOARD PAGE ============ */}
        {page === 'dashboard' && dashboard && (
          <>
            {/* Stats row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <StatCard label={t.zones} value={dashboard.summary.total_zones} icon="🗺️" color="#3b82f6" />
              <StatCard label={t.critical_zones} value={dashboard.summary.critical_zones} icon="🔴" color="#ef4444" />
              <StatCard label={t.high_risk} value={dashboard.summary.high_risk_zones} icon="🟠" color="#f97316" />
              <StatCard label={t.active_alerts} value={dashboard.summary.active_alerts} icon="🚨" color="#eab308" />
              <StatCard label={t.avg_risk} value={`${dashboard.summary.avg_risk_score}%`} icon="📊" color="#a855f7" />
              <StatCard label={t.roads_blocked} value={dashboard.summary.roads_blocked} icon="🚧" color="#f97316" />
              <StatCard label={t.isolated_villages} value={dashboard.summary.isolated_villages} icon="🏘️" color="#ef4444" />
            </div>

            {/* Map + Charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              {/* GIS Map */}
              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 400 }}>
                <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                  {zones.map(z => (
                    <CircleMarker
                      key={z.id}
                      center={[z.latitude, z.longitude]}
                      radius={Math.max(6, z.risk_score / 8)}
                      fillColor={riskColor[z.risk_level]}
                      color={riskColor[z.risk_level]}
                      weight={2}
                      fillOpacity={0.7}
                      eventHandlers={{ click: () => { setSelectedZone(z); loadWeather(z.id); } }}
                    >
                      <Popup>
                        <div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}>
                          <strong>{z.name}</strong><br />
                          {z.district}, {z.state}<br />
                          Risk: <strong style={{ color: riskColor[z.risk_level] }}>{z.risk_level.toUpperCase()}</strong> ({z.risk_score}%)<br />
                          Elevation: {z.elevation_m}m | Slope: {z.slope_angle_deg}°<br />
                          <small>Click for details</small>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>

              {/* Risk Distribution Chart */}
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

                {/* Road Status Pie */}
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

            {/* Top Risk Zones + Recent Alerts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                <h3 style={{ fontSize: 15, marginBottom: 12, color: '#e2e8f0' }}>⚠️ {t.top_risk}</h3>
                {dashboard.top_risk_zones.map((z: any) => (
                  <div key={z.id} onClick={() => { setSelectedZone(z); setPage('zones'); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #334155', cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{z.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{z.district}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${z.risk_score}%`, height: '100%', background: riskColor[z.risk_level], borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: riskColor[z.risk_level] }}>{z.risk_score}%</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                <h3 style={{ fontSize: 15, marginBottom: 12, color: '#e2e8f0' }}>🚨 {t.active_alerts}</h3>
                {alerts.filter(a => a.status === 'active').length === 0 && (
                  <p style={{ color: '#64748b', fontSize: 14 }}>{t.no_active_alerts}</p>
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
            {/* Map */}
            <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 350, marginBottom: 20 }}>
              <MapContainer center={centerPos} zoom={selectedZone ? 10 : 6} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
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

            {/* Zone detail + list */}
            <div style={{ display: 'grid', gridTemplateColumns: selectedZone ? '1fr 1fr' : '1fr', gap: 20 }}>
              {selectedZone && (
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                  <h3 style={{ fontSize: 16, marginBottom: 12, color: '#f1f5f9' }}>📍 {selectedZone.name}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                    <div><span style={{ color: '#64748b' }}>{t.district}:</span> {selectedZone.district}</div>
                    <div><span style={{ color: '#64748b' }}>{t.state}:</span> {selectedZone.state}</div>
                    <div><span style={{ color: '#64748b' }}>{t.elevation}:</span> {selectedZone.elevation_m}m</div>
                    <div><span style={{ color: '#64748b' }}>{t.slope}:</span> {selectedZone.slope_angle_deg}°</div>
                    <div><span style={{ color: '#64748b' }}>{t.soil}:</span> {selectedZone.soil_type}</div>
                    <div><span style={{ color: '#64748b' }}>{t.vegetation}:</span> {(selectedZone.vegetation_cover * 100).toFixed(0)}%</div>
                    <div><span style={{ color: '#64748b' }}>{t.risk_level}:</span> <strong style={{ color: riskColor[selectedZone.risk_level] }}>{selectedZone.risk_level.toUpperCase()}</strong></div>
                    <div><span style={{ color: '#64748b' }}>{t.risk_score}:</span> <strong style={{ color: riskColor[selectedZone.risk_level] }}>{selectedZone.risk_score}%</strong></div>
                  </div>
                  {/* Risk bar */}
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span>{t.risk_score}</span><span>{selectedZone.risk_score}/100</span>
                    </div>
                    <div style={{ width: '100%', height: 12, background: '#334155', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${selectedZone.risk_score}%`, height: '100%', background: `linear-gradient(90deg, #22c55e, ${riskColor[selectedZone.risk_level]})`, borderRadius: 6, transition: 'width 0.5s' }} />
                    </div>
                  </div>
                  {/* Weather panel */}
                  {weather && selectedZoneId === selectedZone.id && (
                    <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 8 }}>
                      <h4 style={{ fontSize: 13, color: '#60a5fa', marginBottom: 8 }}>🌤️ {t.current_weather}</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div>🌧️ Rainfall: {weather.current.rainfall_mm} mm</div>
                        <div>🌡️ Temp: {weather.current.temperature_c}°C</div>
                        <div>💧 Humidity: {weather.current.humidity_pct}%</div>
                        <div>💨 Wind: {weather.current.wind_speed_kmh} km/h</div>
                      </div>
                      {weather.current.storm_active && (
                        <div style={{ marginTop: 8, padding: 6, background: '#ef444433', borderRadius: 4, fontSize: 12, color: '#fca5a5' }}>⛈️ {t.storm_detected}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Zone list */}
              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20, maxHeight: 600, overflowY: 'auto' }}>
                <h3 style={{ fontSize: 15, marginBottom: 12, color: '#e2e8f0' }}>🗺️ {t.all_zones} ({zones.length})</h3>
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
            <h2 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>🚨 {t.alerts_notifications}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Alert Map */}
              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 400 }}>
                <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {alerts.filter(a => a.status === 'active').map(a => (
                    a.latitude && a.longitude ? (
                      <CircleMarker key={a.id} center={[a.latitude, a.longitude]} radius={10}
                        fillColor={riskColor[a.risk_level]} color={riskColor[a.risk_level]} weight={3} fillOpacity={0.8}>
                        <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{a.title}</strong><br />{a.message}</div></Popup>
                      </CircleMarker>
                    ) : null
                  ))}
                </MapContainer>
              </div>

              {/* Alert list */}
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
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
                {alerts.length === 0 && <p style={{ color: '#64748b' }}>{t.no_alerts}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ============ ROADS PAGE ============ */}
        {page === 'roads' && (
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>🛣️ {t.road_connectivity}</h2>
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
                {/* Road status chart */}
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20, marginBottom: 20 }}>
                  <h3 style={{ fontSize: 15, marginBottom: 12 }}>📊 {t.status_overview}</h3>
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

                {/* Road list */}
                <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                  <h3 style={{ fontSize: 15, marginBottom: 12 }}>🛤️ {t.all_roads} ({roads.length})</h3>
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
            <h2 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>🏘️ {t.village_monitoring}</h2>
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
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>🏘️ {t.all_villages} ({villages.length})</h3>
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

        {/* ============ REPORTS PAGE ============ */}
        {page === 'reports' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, color: '#f1f5f9' }}>🔒 {t.admin_reports} ({reports.length})</h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 400 }}>
                <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {reports.map(r => (
                    <CircleMarker key={r.id} center={[r.latitude, r.longitude]} radius={8}
                      fillColor={r.severity_claimed === 'critical' ? '#ef4444' : r.severity_claimed === 'high' ? '#f97316' : '#eab308'}
                      color="#fff" weight={2} fillOpacity={0.8}>
                      <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{r.report_type}</strong><br />{r.description}<br />By: {r.reporter_name}{r.media_urls && r.media_urls.length > 0 && <><br />📷 {r.media_urls.length} photo(s) attached</>}</div></Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {reports.length === 0 && <p style={{ color: '#64748b', padding: 20 }}>{t.no_reports}</p>}
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
                    {/* Photos display */}
                    {r.media_urls && r.media_urls.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {r.media_urls.map((url: string, i: number) => (
                          <img key={i} src={`${url}`} alt={`Report photo ${i + 1}`} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px solid #334155', cursor: 'pointer' }} onClick={() => window.open(`${url}`, '_blank')} />
                        ))}
                      </div>
                    )}
                    {/* Verify button */}
                    {!r.verified && (
                      <button onClick={async () => {
                        const token = getAuthToken();
                        if (!token) return;
                        try {
                          await fetch(`${API_BASE}/reports/${r.id}/verify`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` },
                          });
                          loadReports();
                        } catch (e) { console.error(e); }
                      }} style={{ marginTop: 8, padding: '4px 12px', borderRadius: 4, border: '1px solid #22c55e44', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 12, cursor: 'pointer' }}>
                        ✅ {t.verify_report}
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
              <h2 style={{ fontSize: 18, color: '#f1f5f9' }}>🤖 AI/ML {t.predictions} — Live Risk Analysis</h2>
              <button onClick={runPredictions} disabled={predicting} style={{ background: predicting ? '#475569' : '#7c3aed', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: predicting ? 'wait' : 'pointer' }}>
                {predicting ? '⏳ Analyzing...' : '🧠 Run Predictions'}
              </button>
            </div>

            {predicting && (
              <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #7c3aed44', padding: 30, textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🧠</div>
                <p style={{ color: '#a855f7', fontSize: 14 }}>{t.ai_analysis}</p>
                <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{t.ai_desc}</p>
              </div>
            )}

            {predictions.length > 0 && (
              <>
                {/* ---- ROW 1: Scatter Plot + Risk Heatmap on Map ---- */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                  {/* Scatter: Slope vs Risk Score */}
                  <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                    <h3 style={{ fontSize: 15, marginBottom: 4, color: '#e2e8f0' }}>📈 {t.slope_vs_risk}</h3>
                    <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>{t.slope_desc}</p>
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

                  {/* Risk Heatmap on Map */}
                  <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', height: 360 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155' }}>
                      <h3 style={{ fontSize: 15, color: '#e2e8f0' }}>🗺️ {t.risk_heatmap}</h3>
                      <p style={{ fontSize: 11, color: '#64748b' }}>{t.heatmap_desc}</p>
                    </div>
                    <MapContainer center={[25.5, 93.0]} zoom={6} style={{ height: 300, width: '100%' }} scrollWheelZoom={false}>
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                      {predictions.map(p => (
                        <CircleMarker key={p.zone_id} center={[
                          zones.find(z => z.id === p.zone_id)?.latitude || 25.5,
                          zones.find(z => z.id === p.zone_id)?.longitude || 93.0
                        ]} radius={Math.max(5, p.risk_score / 5)} fillColor={riskColor[p.risk_level]} color="white" weight={1} fillOpacity={0.8}>
                          <Popup><div style={{ fontFamily: 'sans-serif', color: '#1e293b' }}><strong>{p.zone_name}</strong><br />Risk: <span style={{color: riskColor[p.risk_level]}}>{p.risk_level.toUpperCase()} ({p.risk_score}%)</span><br />Confidence: {(p.confidence * 100).toFixed(0)}%</div></Popup>
                        </CircleMarker>
                      ))}
                    </MapContainer>
                  </div>
                </div>

                {/* ---- ROW 2: Factor breakdown scatter + rainfall correlation ---- */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                  {/* Scatter: Rainfall vs Risk by zone */}
                  <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                    <h3 style={{ fontSize: 15, marginBottom: 4, color: '#e2e8f0' }}>🌧️ {t.rainfall_vs_risk}</h3>
                    <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>{t.rainfall_desc}</p>
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

                  {/* Risk Factor Radar for top zone */}
                  {(() => {
                    const sorted = [...predictions].sort((a, b) => b.risk_score - a.risk_score);
                    const top = sorted[0];
                    const radarData = top ? Object.entries(top.contributing_factors).map(([k, v]) => ({ factor: k, value: v, fullMark: 100 })) : [];
                    return (
                      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                        <h3 style={{ fontSize: 15, marginBottom: 4, color: '#e2e8f0' }}>🎯 {t.factor_breakdown}</h3>
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

                {/* ---- ROW 3: All zone risk bars + summary stats ---- */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                  <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                    <h3 style={{ fontSize: 15, marginBottom: 12 }}>📊 {t.all_zone_scores}</h3>
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
                    {/* Summary stats */}
                    <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 20 }}>
                      <h3 style={{ fontSize: 15, marginBottom: 12 }}>📈 {t.prediction_summary}</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{predictions.filter(p => p.risk_level === 'critical').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>Critical Zones</div></div>
                        <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#f97316' }}>{predictions.filter(p => p.risk_level === 'high').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>High Risk</div></div>
                        <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#eab308' }}>{predictions.filter(p => p.risk_level === 'moderate').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>{t.moderate_risk}</div></div>
                          <div style={{ padding: 12, background: '#0f172a', borderRadius: 8 }}><div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{predictions.filter(p => p.risk_level === 'low').length}</div><div style={{ fontSize: 12, color: '#64748b' }}>{t.low_risk}</div></div>
                      </div>
                      <div style={{ marginTop: 12, padding: 12, background: '#0f172a', borderRadius: 8 }}>
                        <div style={{ fontSize: 13, color: '#94a3b8' }}>{t.avg_risk_score}: <strong style={{ color: '#e2e8f0' }}>{(predictions.reduce((s, p) => s + p.risk_score, 0) / predictions.length).toFixed(1)}%</strong></div>
                        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{t.avg_confidence}: <strong style={{ color: '#e2e8f0' }}>{(predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length * 100).toFixed(0)}%</strong></div>
                      </div>
                    </div>

                    {/* Top 5 actionable */}
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
                <p style={{ fontSize: 16, color: '#e2e8f0' }}>Click "{t.click_run}</p>
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

        {/* ============ HISTORY PAGE ============ */}
        {page === 'history' && (
          <HistoryPage t={t} />
        )}
      </main>

      {/* ============ REPORT MODAL ============ */}
      {showReportForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }} onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); }}>
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, width: 440, maxWidth: '90vw', border: '1px solid #334155', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9' }}>📸 {t.submit_report}</h3>

            {/* Location status */}
            <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: userLocation ? 'rgba(34,197,94,0.1)' : locationError ? 'rgba(234,179,8,0.1)' : 'rgba(96,165,250,0.1)', border: `1px solid ${userLocation ? '#22c55e44' : locationError ? '#eab30844' : '#60a5fa44'}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: userLocation ? '#22c55e' : locationError ? '#eab308' : '#60a5fa', marginBottom: 4 }}>
                {userLocation ? '✅ ' + t.location_detected : locationError ? '⚠️ ' + t.location_fallback : '📍 ' + t.detecting_location}
              </div>
              {userLocation && (
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  🌐 Your GPS Coordinates: Lat {userLocation.lat.toFixed(6)}, Lon {userLocation.lon.toFixed(6)}
                </div>
              )}
              {locationError && !userLocation && (
                <div style={{ fontSize: 11, color: '#eab308' }}>{locationError}</div>
              )}
            </div>

            <form onSubmit={submitReport}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.your_name}</label>
                <input name="reporter_name" defaultValue="Anonymous" required style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.phone}</label>
                <input name="reporter_phone" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.report_type}</label>
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
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.severity}</label>
                <select name="severity_claimed" style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }}>
                  <option value="low">Low</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.description} *</label>
                <textarea name="description" rows={3} required placeholder="Describe what you observed..." style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, resize: 'vertical' }} />
              </div>

              {/* Status message */}
              {reportStatus.type && (
                <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, fontSize: 13, background: reportStatus.type === 'success' ? 'rgba(34,197,94,0.15)' : reportStatus.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(96,165,250,0.15)', color: reportStatus.type === 'success' ? '#22c55e' : reportStatus.type === 'error' ? '#ef4444' : '#60a5fa', border: `1px solid ${reportStatus.type === 'success' ? '#22c55e44' : reportStatus.type === 'error' ? '#ef444444' : '#60a5fa44'}` }}>
                  {reportStatus.type === 'loading' ? '⏳ ' : reportStatus.type === 'success' ? '✅ ' : '❌ '}{reportStatus.message}
                </div>
              )}

              {/* Photo upload with camera access */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>📸 Photo/Video (optional, max 5)</label>
                <label style={{ display: 'block', padding: 16, border: '2px dashed #475569', borderRadius: 8, textAlign: 'center', color: '#64748b', fontSize: 13, cursor: 'pointer', transition: 'border-color 0.2s' }}>
                  📷 {t.photo_attach}
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
                {userLocation && <div style={{ marginTop: 6, fontSize: 11, color: '#22c55e' }}>📍 GPS: {userLocation.lat.toFixed(4)}°N, {userLocation.lon.toFixed(4)}°E — {t.gps_tagged}</div>}
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                {reportStatus.type === 'success' ? (
                  <button type="button" onClick={() => { setShowReportForm(false); setReportStatus({ type: null, message: '' }); setReportPhotos([]); photoPreviewUrls.forEach(u => URL.revokeObjectURL(u)); setPhotoPreviewUrls([]); setPage('reports'); }} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: '#22c55e', color: 'white', fontSize: 14, cursor: 'pointer' }}>
                    ✅ {t.view_report}
                  </button>
                ) : (
                  <button type="submit" disabled={!userLocation || reportStatus.type === 'loading'} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: (!userLocation || reportStatus.type === 'loading') ? '#475569' : '#2563eb', color: 'white', fontSize: 14, cursor: (!userLocation || reportStatus.type === 'loading') ? 'not-allowed' : 'pointer' }}>
                    {reportStatus.type === 'loading' ? '⏳ ' + t.submitting : '📍 ' + t.submit_location}
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
            <h3 style={{ fontSize: 18, marginBottom: 16, color: '#f1f5f9', textAlign: 'center' }}>🔐 {t.admin_login}</h3>
            <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 16 }}>{t.admin_access}</p>
            <form onSubmit={(e) => { e.preventDefault(); handleAdminLogin(); }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.password}</label>
                <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Enter admin password" autoFocus style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
              </div>
              {adminLoginError && (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontSize: 13, border: '1px solid #ef444444' }}>
                  ❌ {adminLoginError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" disabled={!adminPassword || adminLoggingIn} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: (!adminPassword || adminLoggingIn) ? '#475569' : '#2563eb', color: 'white', fontSize: 14, cursor: (!adminPassword || adminLoggingIn) ? 'not-allowed' : 'pointer' }}>
                  {adminLoggingIn ? '⏳ ' + t.verifying : '🔓 ' + t.login}
                </button>
                <button type="button" onClick={() => { setShowAdminLogin(false); setAdminLoginError(''); setAdminPassword(''); }} style={{ padding: 10, borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>{t.cancel}</button>
              </div>
              <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#0f172a', fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                💡 {t.hint} <code style={{ color: '#60a5fa' }}>admin123</code>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ LIVE FEED ============ */}
      {wsMessages.length > 0 && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, width: 300, maxHeight: 200, overflowY: 'auto', background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 12, zIndex: 999 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#60a5fa', marginBottom: 8 }}>📡 Live Feed</div>
          {wsMessages.slice(0, 5).map((m, i) => (
            <div key={i} style={{ fontSize: 11, color: '#94a3b8', padding: '3px 0', borderBottom: '1px solid #334155' }}>
              <span style={{ color: '#64748b' }}>[{m.type}]</span> {m.zone_name || m.road_name || JSON.stringify(m).substring(0, 60)}
            </div>
          ))}
        </div>
      )}

      {/* ============ FOOTER ============ */}
      <footer style={{ padding: '16px 24px', textAlign: 'center', color: '#475569', fontSize: 12, borderTop: '1px solid #1e293b' }}>
        NER Landslide Early Warning System v1.0 | AI-Powered Disaster Monitoring for North Eastern Region | Built for Climate-Resilient Governance
      </footer>
    </div>
  );
}
