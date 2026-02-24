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

function safeTrim(s) {
  return typeof s === "string" ? s.trim() : "";
}

export default async function handler(req, res) {
  // Preflight (safe to keep)
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

      // FIX #1: default to deleting the availability slot so it doesn't reappear on refresh
      DELETE_AVAILABILITY = "true",

      // FIX #2: who should receive an email notification (invite) besides the customer
      NOTIFY_EMAIL = "mattdoylebball@gmail.com",
    } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
      return res
        .status(500)
        .json({ error: "Server not configured (missing Google OAuth env vars)." });
    }

    // Parse body
    const body = req.body || {};
    const slot = body.slot || {};
    const customer = body.customer || {};

    const title = mustString(slot.title) ? slot.title.trim() : "Training Session";

    // Prevent booking on a "BOOKED:" event if someone clicks one accidentally
    if (title.toUpperCase().startsWith("BOOKED")) {
      return res.status(400).json({ error: "That time is already booked. Please pick another slot." });
    }

    const startIso = toIsoOrNull(slot.startIso);
    let endIso = toIsoOrNull(slot.endIso);

    if (!startIso) return res.status(400).json({ error: "Invalid start time." });

    // If no end time came from the calendar event, use a fixed duration
    if (!endIso) {
      const d = new Date(startIso);
      const minutes = Number(BOOKING_DURATION_MINUTES) || 60;
      d.setMinutes(d.getMinutes() + minutes);
      endIso = d.toISOString();
    }

    const custName = safeTrim(customer.name);
    const custPhone = safeTrim(customer.phone);
    const custEmail = safeTrim(customer.email);
    const custNotes = safeTrim(customer.notes);

    if (!mustString(custName) || !mustString(custPhone) || !isEmail(custEmail)) {
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

    // 1) FreeBusy check (prevents double-booking)
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

    // 2) Create the booked event
    const descriptionLines = [
      "Booked via website",
      "",
      `Player: ${custName}`,
      `Phone: ${custPhone}`,
      `Email: ${custEmail}`,
    ];
    if (mustString(custNotes)) {
      descriptionLines.push("", "Notes:", custNotes);
    }

    // Attendees:
    // - customer gets an invite (and email)
    // - notify email ALSO gets an invite (and email) so you get a notification
    const attendees = [{ email: custEmail }];

    const notifyEmail = safeTrim(NOTIFY_EMAIL);
    if (isEmail(notifyEmail) && notifyEmail.toLowerCase() !== custEmail.toLowerCase()) {
      attendees.push({ email: notifyEmail });
    }

    const created = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `BOOKED: ${title} — ${custName}`,
        description: descriptionLines.join("\n"),
        start: { dateTime: startIso, timeZone: TIMEZONE },
        end: { dateTime: endIso, timeZone: TIMEZONE },
        attendees,
      },

      // This is what triggers Google to email the attendees
      sendUpdates: "all",
    });

    // 3) Delete the availability event that was clicked (so it won't come back on refresh)
    //    This fixes your "it disappears then comes back with BOOKED" issue.
    const availabilityEventId = safeTrim(slot.availabilityEventId);
    if (DELETE_AVAILABILITY === "true" && mustString(availabilityEventId)) {
      try {
        await calendar.events.delete({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: availabilityEventId,
          sendUpdates: "none",
        });
      } catch (e) {
        // Don't fail the whole booking if deletion fails. Booking succeeded already.
      }
    }

    return res.status(200).json({
      ok: true,
      eventId: created?.data?.id || null,
      htmlLink: created?.data?.htmlLink || null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error creating booking." });
  }
}