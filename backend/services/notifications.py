"""
Notification service for early warnings.
Supports: SMS, app push, email (simulated).
Multilingual: English, Hindi, Assamese, Bengali, Manipuri, Mizo.
"""
from datetime import datetime
from typing import Dict, List, Optional
from models.database import SessionLocal, Alert, NotificationLog, AlertStatus, RiskLevel


TRANSLATIONS = {
    "en": {
        "critical_alert": "🔴 CRITICAL: Landslide risk imminent in {zone}. Evacuate immediately!",
        "high_alert": "🟠 HIGH RISK: Possible landslide in {zone}. Stay alert and be ready to evacuate.",
        "moderate_alert": "🟡 MODERATE: Elevated landslide risk in {zone}. Monitor updates.",
        "low_alert": "🟢 LOW: Normal conditions in {zone}. Routine monitoring.",
        "road_blocked": "Road {road} is BLOCKED. Use alternate routes.",
        "road_partial": "Road {road} is partially accessible. Exercise caution.",
        "evacuation": "EVACUATION ORDER: Residents of {village} near {zone} should evacuate to designated shelters.",
    },
    "hi": {
        "critical_alert": "🔴 गंभीर: {zone} में भूस्खलन का तत्काल खतरा। तुरंत खाली करें!",
        "high_alert": "🟠 उच्च जोखिम: {zone} में संभावित भूस्खलन। सतर्क रहें।",
        "moderate_alert": "🟡 मध्यम: {zone} में बढ़ा हुआ भूस्खलन जोखिम। अपडेट की निगरानी करें।",
        "low_alert": "🟢 निम्न: {zone} में सामान्य स्थिति।",
        "road_blocked": "सड़क {road} अवरुद्ध है। वैकल्पिक मार्ग का उपयोग करें।",
        "evacuation": "निकासी आदेश: {zone} के पास {village} के निवासियों को निर्धारित आश्रयों में जाना चाहिए।",
    },
    "bn": {
        "critical_alert": "🔴 গুরুতর: {zone} এ ভূমিধসের তাৎক্ষণিক ঝুঁকি। এখনই সরে যান!",
        "high_alert": "🟠 উচ্চ ঝুঁকি: {zone} এ সম্ভাব্য ভূমিধস। সতর্ক থাকুন।",
        "moderate_alert": "🟡 মাঝারি: {zone} এ বৃদ্ধি পাওয়া ভূমিধস ঝুঁকি।",
        "road_blocked": "সড়ক {road} অবরোধিত।",
        "evacuation": "সরিয়ে নেওয়ার আদেশ: {zone} এর কাছে {village} এর বাসিন্দাদের নির্ধারিত আশ্রয়ে যেতে হবে।",
    },
    "as": {
        "critical_alert": "🔴 গুৰুতৰ: {zone} ত ভূমিধ্বংসৰ তাৎক্ষণিক বিপদ। লগেই উঠি যাওক!",
        "high_alert": "🟠 উচ্চ বিপদ: {zone} ত সম্ভাব্য ভূমিধ্বংস। সাবধান হওক।",
        "moderate_alert": "🟡 মধ্যম: {zone} ত বৃদ্ধি পোৱা ভূমিধ্বংস বিপদ।",
        "road_blocked": "ৰাস্তা {road} অৱৰোধিত।",
    },
    "mni": {
        "critical_alert": "🔴 সিং: {zone} দা লৈ লিচিংনা চাক্লে। চাং ইরিবা!",
        "high_alert": "🟠 খ্বাইদগী যান্ত্রক: {zone} দা মিংদগি লৈ লিচিংনা।",
        "road_blocked": "লম্বি {road} খেংদোক্তে।",
    },
    "lus": {
        "critical_alert": "🔴 CIHGAWL: {zone} a hla that chang a awm. Hmasa takin a chhuak rawh!",
        "high_alert": "🟠 A SAN: {zone} a hla that chang a awm nih awm ka rawh.",
        "road_blocked": "Lam {road} a awmlo.",
    },
}


class NotificationService:
    """Manages creation and delivery of multilingual alerts."""

    def __init__(self):
        self.default_language = "en"
        self.supported_languages = list(TRANSLATIONS.keys())

    def get_risk_key(self, risk_level: str) -> str:
        return f"{risk_level}_alert"

    def translate(
        self, key: str, language: str, **kwargs
    ) -> str:
        """Get translated message with variable substitution."""
        lang = language if language in TRANSLATIONS else self.default_language
        templates = TRANSLATIONS.get(lang, TRANSLATIONS[self.default_language])
        template = templates.get(key, TRANSLATIONS[self.default_language].get(key, key))
        try:
            return template.format(**kwargs)
        except KeyError:
            return template

    def create_alert(
        self,
        db,
        zone_id: Optional[int],
        zone_name: str,
        risk_level: str,
        risk_score: float,
        latitude: Optional[float],
        longitude: Optional[float],
        channels: List[str] = None,
        target_audience: List[str] = None,
        extra_info: str = "",
    ) -> Alert:
        """Create and store a new alert."""
        channels = channels or ["app", "sms"]
        target_audience = target_audience or ["district_admin", "ndrf", "community"]

        level_enum = RiskLevel(risk_level) if risk_level in [e.value for e in RiskLevel] else RiskLevel.MODERATE
        title = self.translate(
            self.get_risk_key(risk_level),
            self.default_language,
            zone=zone_name,
        )
        message = (
            f"Landslide risk: {risk_level.upper()} (score: {risk_score}/100) "
            f"in {zone_name}. "
            f"Risk factors active. "
            f"{extra_info}"
        )

        alert = Alert(
            zone_id=zone_id,
            title=title,
            message=message,
            risk_level=level_enum,
            target_audience=target_audience,
            channels=channels,
            latitude=latitude,
            longitude=longitude,
        )
        db.add(alert)
        db.flush()
        return alert

    def send_multilingual_notifications(
        self, db, alert: Alert, zone_name: str, languages: List[str] = None
    ) -> List[NotificationLog]:
        """Simulate sending notifications in multiple languages."""
        languages = languages or ["en", "hi", "bn", "as"]
        logs = []

        for lang in languages:
            risk_key = self.get_risk_key(alert.risk_level.value)
            message = self.translate(risk_key, lang, zone=zone_name)

            for channel in (alert.channels or ["app"]):
                log = NotificationLog(
                    alert_id=alert.id,
                    channel=channel,
                    recipient=f"broadcast_{lang}_{channel}",
                    message=message,
                    status="sent",
                    language=lang,
                )
                db.add(log)
                logs.append(log)

        db.flush()
        return logs

    def generate_road_alerts(
        self, db, road_name: str, road_status: str, language: str = "en"
    ) -> str:
        """Generate road-specific alert message."""
        if road_status == "blocked":
            return self.translate("road_blocked", language, road=road_name)
        elif road_status == "partial":
            return self.translate("road_partial", language, road=road_name)
        return ""

    def generate_evacuation_notice(
        self, db, zone_name: str, village_name: str, language: str = "en"
    ) -> str:
        return self.translate("evacuation", language, zone=zone_name, village=village_name)


notification_service = NotificationService()
