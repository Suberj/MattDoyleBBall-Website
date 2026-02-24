import { google } from "googleapis";

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function mustString(s) {
  return typeof s === "string" && s.trim().length > 0;
}
function safeTrim(s) {
  return typeof s === "string" ? s.trim() : "";
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

async function sendResendEmail({ apiKey, from, to, subject, text }) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Resend failed (${resp.status}): ${body}`);
  }

  return resp.json().catch(() => ({}));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let emailSent = false;

  try {
    const {
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
      GOOGLE_REFRESH_TOKEN,

      GOOGLE_CALENDAR_ID = "primary",
      TIMEZONE = "America/New_York",
      BOOKING_DURATION_MINUTES = "60",

      // Keep slots from reappearing:
      DELETE_AVAILABILITY = "true",

      // Email notification settings (GUARANTEED):
      NOTIFY_EMAIL = "mattdoylebball@gmail.com",
      RESEND_API_KEY,
      EMAIL_FROM = "onboarding@resend.dev",
    } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_REFRESH_TOKEN) {
      return res.status(500).json({ error: "Server not configured (missing Google OAuth env vars)." });
    }

    const body = req.body || {};
    const slot = body.slot || {};
    const customer = body.customer || {};

    const title = mustString(slot.title) ? slot.title.trim() : "Training Session";
    if (title.toUpperCase().startsWith("BOOKED")) {
      return res.status(400).json({ error: "That time is already booked. Please pick another slot." });
    }

    const startIso = toIsoOrNull(slot.startIso);
    let endIso = toIsoOrNull(slot.endIso);
    if (!startIso) return res.status(400).json({ error: "Invalid start time." });

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

    // Prevent double booking
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

    // Create booked event (customer gets invite)
    const description =
      `Booked via website\n\n` +
      `Player: ${custName}\nPhone: ${custPhone}\nEmail: ${custEmail}\n` +
      (custNotes ? `\nNotes:\n${custNotes}\n` : "");

    const created = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `BOOKED: ${title} — ${custName}`,
        description,
        start: { dateTime: startIso, timeZone: TIMEZONE },
        end: { dateTime: endIso, timeZone: TIMEZONE },
        attendees: [{ email: custEmail }],
      },
      sendUpdates: "all",
    });

    // Delete the clicked availability event so it doesn't come back
    const availabilityEventId = safeTrim(slot.availabilityEventId);
    if (DELETE_AVAILABILITY === "true" && mustString(availabilityEventId)) {
      try {
        await calendar.events.delete({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: availabilityEventId,
          sendUpdates: "none",
        });
      } catch {
        // ignore; booking succeeded
      }
    }

    // GUARANTEED premade email notification
    const notifyTo = safeTrim(NOTIFY_EMAIL);

    // Format start time nicely
    const startLocal = new Date(startIso).toLocaleString("en-US", {
      timeZone: TIMEZONE,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    if (mustString(RESEND_API_KEY) && isEmail(notifyTo)) {
      const subject = `New booking: ${startLocal}`;
      const text =
        `Someone has booked your ${startLocal} (${TIMEZONE}). Check your calendar.\n\n` +
        `Title: ${title}\n` +
        `Player: ${custName}\n` +
        `Phone: ${custPhone}\n` +
        `Email: ${custEmail}\n` +
        (custNotes ? `\nNotes:\n${custNotes}\n` : "") +
        (created?.data?.htmlLink ? `\nOpen event:\n${created.data.htmlLink}\n` : "");

      try {
        await sendResendEmail({
          apiKey: RESEND_API_KEY,
          from: EMAIL_FROM,
          to: notifyTo,
          subject,
          text,
        });
        emailSent = true;
      } catch {
        // Do not fail the booking if email fails
        emailSent = false;
      }
    }

    return res.status(200).json({
      ok: true,
      emailSent,
      eventId: created?.data?.id || null,
      htmlLink: created?.data?.htmlLink || null,
    });
  } catch {
    return res.status(500).json({ error: "Server error creating booking.", emailSent });
  }
}