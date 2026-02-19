/**
 * Minimal booking backend for booking_fixed.html
 *
 * What it does:
 * - Receives POST /api/book with { slot: {title, startIso, endIso, availabilityEventId}, customer: {name, phone, email, notes} }
 * - Verifies the slot is still free (FreeBusy API)
 * - Creates a calendar event in Matt's calendar (Events.insert)
 * - Optionally deletes the availability event (Events.delete) if availabilityEventId is provided AND you decide to enable it
 *
 * IMPORTANT:
 * - You cannot safely "book into Google Calendar" from a static HTML-only site.
 * - This server must run somewhere (Render, Railway, Fly.io, VM, etc.)
 *
 * Auth:
 * - For a regular @gmail.com calendar, the simplest reliable approach is OAuth2.
 * - Matt does a ONE-TIME authorization to generate a refresh token.
 * - That refresh token is stored on the server and used to call Google Calendar APIs.
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const app = express();

// If you host frontend+backend on same domain, you can remove cors() or restrict origins.
app.use(cors());
app.use(express.json({ limit: "200kb" }));

const {
  PORT = "8787",
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_CALENDAR_ID = "primary",
  TIMEZONE = "America/New_York",
  BOOKING_DURATION_MINUTES = "60",
  DELETE_AVAILABILITY = "false",
} = process.env;

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing required env var: ${name}`);
}

requireEnv("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
requireEnv("GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET);
requireEnv("GOOGLE_REDIRECT_URI", GOOGLE_REDIRECT_URI);
requireEnv("GOOGLE_REFRESH_TOKEN", GOOGLE_REFRESH_TOKEN);

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

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

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * POST /api/book
 * Body:
 * {
 *   slot: { title, startIso, endIso, availabilityEventId? },
 *   customer: { name, phone, email, notes? }
 * }
 */
app.post("/api/book", async (req, res) => {
  try {
    const body = req.body || {};
    const slot = body.slot || {};
    const customer = body.customer || {};

    const title = mustString(slot.title) ? slot.title.trim() : "Training Session";
    const startIso = toIsoOrNull(slot.startIso);
    let endIso = toIsoOrNull(slot.endIso);

    if (!startIso) {
      return res.status(400).json({ error: "Invalid start time." });
    }

    // If the availability blocks don't have explicit end times, fall back to a fixed duration.
    if (!endIso) {
      const d = new Date(startIso);
      const minutes = Number(BOOKING_DURATION_MINUTES) || 60;
      d.setMinutes(d.getMinutes() + minutes);
      endIso = d.toISOString();
    }

    if (!mustString(customer.name) || !mustString(customer.phone) || !isEmail(customer.email)) {
      return res.status(400).json({ error: "Please provide name, phone, and a valid email." });
    }

    // 1) FreeBusy check (avoid double booking)
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
      `Booked via website`,
      ``,
      `Player: ${customer.name}`,
      `Phone: ${customer.phone}`,
      `Email: ${customer.email}`,
    ];

    if (mustString(customer.notes)) {
      descriptionLines.push(``, `Notes:`, customer.notes.trim());
    }

    const created = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: `BOOKED: ${title} — ${customer.name}`,
        description: descriptionLines.join("\n"),
        start: { dateTime: startIso, timeZone: TIMEZONE },
        end: { dateTime: endIso, timeZone: TIMEZONE },
        // Invite the customer so they get a calendar email automatically:
        attendees: [{ email: customer.email }],
      },
      sendUpdates: "all",
    });

    // 3) Optional: delete the availability event (only if you decide to turn it on)
    // NOTE: This only works if the availability events are in the SAME calendar you control and their IDs match.
    if (DELETE_AVAILABILITY === "true" && mustString(slot.availabilityEventId)) {
      try {
        await calendar.events.delete({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: slot.availabilityEventId,
          sendUpdates: "none",
        });
      } catch {
        // Non-fatal: booking still succeeded.
      }
    }

    return res.json({
      ok: true,
      eventId: created?.data?.id || null,
      htmlLink: created?.data?.htmlLink || null,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error creating booking." });
  }
});

app.listen(Number(PORT), () => {
  console.log(`Booking server running on http://localhost:${PORT}`);
});
