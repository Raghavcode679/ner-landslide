"""
SMS/WhatsApp Notification Gateway for NER Landslide Early Warning System.

Supports multiple providers:
- MSG91 (India-focused, cheapest for NER)
- Twilio (global)
- WhatsApp Business API
- Webhook (custom endpoints)

In production, set environment variables:
  MSG91_API_KEY, TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE,
  WHATSAPP_API_URL, WHATSAPP_TOKEN

For demo: notifications are logged and simulated.
"""
import os
import json
import asyncio
from datetime import datetime
from typing import Dict, List, Optional

# Provider configuration from environment
MSG91_API_KEY = os.environ.get("MSG91_API_KEY", "")
TWILIO_SID = os.environ.get("TWILIO_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE = os.environ.get("TWILIO_PHONE", "+1234567890")
WHATSAPP_API_URL = os.environ.get("WHATSAPP_API_URL", "")
WHATSAPP_TOKEN = os.environ.get("WHATSAPP_TOKEN", "")

# NER emergency contacts database (simulated)
NER_CONTACTS = {
    "critical": [
        {"name": "District Magistrate", "phone": "+919876543210", "role": "dm"},
        {"name": "SDO Civil", "phone": "+919876543211", "role": "sdo"},
        {"name": "NDRF Station", "phone": "+919876543212", "role": "ndrf"},
        {"name": "Police Control Room", "phone": "+919876543213", "role": "police"},
    ],
    "high": [
        {"name": "Circle Officer", "phone": "+919876543220", "role": "co"},
        {"name": "Fire Station", "phone": "+919876543221", "role": "fire"},
        {"name": "Block Development Officer", "phone": "+919876543222", "role": "bdo"},
    ],
    "moderate": [
        {"name": "Village Headman", "phone": "+919876543230", "role": "headman"},
        {"name": "ANM Health Worker", "phone": "+919876543231", "role": "anm"},
    ],
    "low": [
        {"name": "Panchayat Member", "phone": "+919876543240", "role": "panchayat"},
    ],
}


class SMSNotificationGateway:
    """Send SMS/WhatsApp alerts to officials and communities."""

    def __init__(self):
        self._log: List[Dict] = []
        self._sent_count = 0
        self._failed_count = 0

    async def send_sms(self, phone: str, message: str, priority: str = "normal") -> Dict:
        """Send SMS via available provider."""
        notification = {
            "type": "sms",
            "phone": phone,
            "message": message,
            "priority": priority,
            "timestamp": datetime.utcnow().isoformat(),
            "status": "sent",
            "provider": "none",
        }

        # Try MSG91 first (India-optimized)
        if MSG91_API_KEY:
            try:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    payload = {
                        "mobile": phone,
                        "message": message,
                        "sender": "NERLWS",
                        "route": "4" if priority == "critical" else "2",
                    }
                    async with session.post(
                        f"https://api.msg91.com/api/v5/flow",
                        headers={"authkey": MSG91_API_KEY, "Content-Type": "application/json"},
                        json={"flow_id": "NER_LANDSLIDE", "recipients": [{"mobiles": phone, "VAR_MESSAGE": message}]},
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        notification["provider"] = "msg91"
                        notification["status"] = "sent" if resp.status == 200 else "failed"
            except Exception as e:
                notification["status"] = "failed"
                notification["error"] = str(e)

        # Try Twilio
        elif TWILIO_SID and TWILIO_AUTH_TOKEN:
            try:
                import aiohttp
                from urllib.parse import urlencode
                url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
                data = urlencode({"From": TWILIO_PHONE, "To": phone, "Body": message})
                import base64
                auth = base64.b64encode(f"{TWILIO_SID}:{TWILIO_AUTH_TOKEN}".encode()).decode()
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        url, data=data,
                        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        notification["provider"] = "twilio"
                        notification["status"] = "sent" if resp.status in (200, 201) else "failed"
            except Exception as e:
                notification["status"] = "failed"
                notification["error"] = str(e)

        # Demo mode — log only
        else:
            notification["provider"] = "demo"
            notification["status"] = "logged"

        self._log.append(notification)
        self._sent_count += 1 if notification["status"] == "sent" else 0
        self._failed_count += 1 if notification["status"] == "failed" else 0
        return notification

    async def send_whatsapp(self, phone: str, message: str) -> Dict:
        """Send WhatsApp message via Business API."""
        notification = {
            "type": "whatsapp",
            "phone": phone,
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
            "status": "logged",
            "provider": "demo",
        }

        if WHATSAPP_API_URL and WHATSAPP_TOKEN:
            try:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    payload = {
                        "messaging_product": "whatsapp",
                        "to": phone,
                        "type": "text",
                        "text": {"body": message},
                    }
                    async with session.post(
                        WHATSAPP_API_URL,
                        headers={"Authorization": f"Bearer {WHATSAPP_TOKEN}", "Content-Type": "application/json"},
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        notification["provider"] = "whatsapp_business"
                        notification["status"] = "sent" if resp.status == 200 else "failed"
            except Exception as e:
                notification["status"] = "failed"
                notification["error"] = str(e)

        self._log.append(notification)
        return notification

    async def broadcast_alert(self, zone_name: str, risk_level: str, message: str, state: str = "") -> Dict:
        """Broadcast alert to all relevant contacts based on severity."""
        contacts = NER_CONTACTS.get(risk_level, [])
        results = {"total": len(contacts), "sent": 0, "failed": 0, "notifications": []}

        for contact in contacts:
            sms_text = f"[NER LANDSLIDE WARNING - {risk_level.upper()}]\n\nZone: {zone_name}\n{state}\n\n{message}\n\nTake immediate action. - NER Landslide Early Warning System"
            result = await self.send_sms(contact["phone"], sms_text, risk_level)
            results["notifications"].append({
                "contact": contact["name"],
                "role": contact["role"],
                "phone": contact["phone"],
                "status": result["status"],
                "provider": result["provider"],
            })
            if result["status"] in ("sent", "logged"):
                results["sent"] += 1
            else:
                results["failed"] += 1

        # Also send WhatsApp for critical
        if risk_level == "critical":
            for contact in contacts[:2]:
                await self.send_whatsapp(contact["phone"], f"🚨 CRITICAL LANDSLIDE RISK\n{zone_name}\n{message}")

        return results

    def get_notification_log(self, limit: int = 50) -> List[Dict]:
        return self._log[-limit:]

    def get_stats(self) -> Dict:
        return {
            "total_sent": self._sent_count,
            "total_failed": self._failed_count,
            "total_logged": len(self._log) - self._sent_count - self._failed_count,
            "providers_available": {
                "msg91": bool(MSG91_API_KEY),
                "twilio": bool(TWILIO_SID),
                "whatsapp": bool(WHATSAPP_API_URL),
            },
        }


sms_gateway = SMSNotificationGateway()
