// /api/book.js
import { google } from "googleapis";

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function mustString(s) {
  return typeof s === "string" && s.trim().length > 0;
}
function toIsoOrNull(s) {
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // Preflight (usually not needed if same-origin, but harmless)
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
      GOOGLE_REFRESH_TOKEN,

      GOOGLE_CALENDAR_ID = "primary",
      TIMEZONE = "America/New_York",
      BOOKING_DURATION_MINUTES = "60",
      DELETE_AVAILABILITY = "false",

      // NEW: who gets notified (added as attendee so they receive an email)
      NOTIFY_EMAIL = "mattdoylebball@gmail.com",
    } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
      return res.status(500).json({ error: "Server not configured (missing Google OAuth env vars)." });
    }

    // Body: { slot: { title, startIso, endIso, availabilityEventId? }, customer: { name, phone, email, notes? } }
    const body = req.body || {};
    const slot = body.slot || {};
    const customer = body.customer || {};

    const title = mustString(slot.title) ? slot.title.trim() : "Training Session";
    const startIso = toIsoOrNull(slot.startIso);
    let endIso = toIsoOrNull(slot.endIso);

    if (!startIso) return res.status(400).json({ error: "Invalid start time." });

    // If the displayed availability block doesn't include an end time, default to fixed duration
    if (!endIso) {
      const d = new Date(startIso);
      const minutes = Number(BOOKING_DURATION_MINUTES) || 60;
      d.setMinutes(d.getMinutes() + minutes);
      endIso = d.toISOString();
    }

    if (!mustString(customer.name) || !mustString(customer.phone) || !isEmail(customer.email)) {
      return res.status(400).json({ error: "Please provide name, phone, and a valid email." });
    }

    // OAuth client
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // 1) FreeBusy check to prevent double-booking
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: startIso,
        timeMax: endIso,
        timeZone: TIMEZONE,
        items: [{ id: GOOGLE_CALENDAR_ID }],
      },
    });

    const busy = fb?.data?.calendars?.[GOOGLE_CALENDAR_ID]?.busy || [];
    if (busy.length > 0) {
      return res.status(409).json({ error: "That slot was just booked. Please pick another time." });
    }

    // 2) Create booked event + invite attendees
    const descriptionLines = [
      "Booked via website",
      "",
      `Player: ${customer.name}`,
      `Phone: ${customer.phone}`,
      `Email: ${customer.email}`,
    ];

    if (mustString(customer.notes)) {
      descriptionLines.push("", "Notes:", customer.notes.trim());
    }

    // Add NOTIFY_EMAIL as an attendee so they receive an email notification too.
    // Avoid duplicating if customer email == notify email.
    const attendees = [{ email: customer.email }];
    if (isEmail(NOTIFY_EMAIL) && NOTIFY_EMAIL.toLowerCase() !== customer.email.toLowerCase()) {
      attendees.push({ email: NOTIFY_EMAIL });
    }

    const created = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `BOOKED: ${title} — ${customer.name}`,
        description: descriptionLines.join("\n"),
        start: { dateTime: startIso, timeZone: TIMEZONE },
        end: { dateTime: endIso, timeZone: TIMEZONE },
        attendees,
      },
      // This triggers email notifications to attendees
      sendUpdates: "all",
    });

    // 3) Optional: delete the availability event that was clicked (usually keep false)
    if (DELETE_AVAILABILITY === "true" && mustString(slot.availabilityEventId)) {
      try {
        await calendar.events.delete({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: slot.availabilityEventId,
          sendUpdates: "none",
        });
      } catch {
        // ignore; booking succeeded
      }
    }

    return res.status(200).json({
      ok: true,
      eventId: created?.data?.id || null,
      htmlLink: created?.data?.htmlLink || null,
    });
  } catch {
    return res.status(500).json({ error: "Server error creating booking." });
  }
}