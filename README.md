# Matt Doyle Basketball — Website

> **Built, Not Born.**  
> Official website for Matt Doyle Basketball Training — elite skill development for serious athletes in the Mohawk Valley (NY) and Northeast Kingdom (VT).

🌐 **Live site:** [mattdoylebball.vercel.app](https://mattdoylebball.vercel.app)

---

## Pages

| File | Description |
|---|---|
| `index.html` | Home / landing page |
| `about.html` | The Difference — program philosophy |
| `matt.html` | About Matt — background & career stats |
| `sessions.html` | Training session types |
| `collegeprep.html` | College prep program |
| `booking.html` | Live booking calendar |

---

## How Booking Works

The booking system is a two-part setup:

1. **Frontend (`booking.html`)** — displays a FullCalendar calendar that fetches **public events only** from Google Calendar via the Google Calendar REST API. When a visitor clicks a slot, a modal collects their name, phone, email, and notes.

2. **Backend (`api/book.js`)** — a Vercel serverless function that:
   - Validates the submission
   - Checks for double-booking via Google Calendar freebusy API
   - Creates a `BOOKED: ...` event on the calendar with the customer as an attendee (they receive a Google Calendar invite automatically)
   - Deletes the original availability slot so it disappears from the calendar
   - Sends an email notification to Matt via [Resend](https://resend.com)

---

## Deployment (Vercel)

The site is deployed on Vercel. The `api/` folder is automatically treated as serverless functions.

### Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Authorized redirect URI (e.g. `https://developers.google.com/oauthplayground`) |
| `GOOGLE_REFRESH_TOKEN` | Refresh token obtained via OAuth playground |
| `GOOGLE_CALENDAR_ID` | Calendar ID to read/write (e.g. `mattdoylebball@gmail.com`) |
| `TIMEZONE` | Timezone string (e.g. `America/New_York`) |
| `BOOKING_DURATION_MINUTES` | Default session length if no end time provided (e.g. `60`) |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) for email notifications |
| `EMAIL_FROM` | Sender address — use `onboarding@resend.dev` for Resend's default, or a verified custom domain |
| `NOTIFY_EMAIL` | Where booking notifications are sent — defaults to `mattdoylebball@gmail.com` |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | Google API key used client-side to fetch public calendar events |

> ⚠️ Never commit `.env` or real credentials to the repo. Use Vercel's environment variable dashboard.

---

## Adding Bookable Slots

1. Open Google Calendar on the `mattdoylebball@gmail.com` account
2. Create an event for the available time slot
3. Set the event visibility to **Public**
4. It will appear on the booking page automatically within a few minutes

Events marked **Default** or **Private** are filtered out and will not show on the booking page.

---

## Tech Stack

- **Frontend:** Vanilla HTML, Tailwind CSS (CDN), Inter font
- **Calendar:** [FullCalendar v6](https://fullcalendar.io/) with custom Google Calendar REST fetch
- **Backend:** Node.js serverless function on Vercel
- **Calendar API:** Google Calendar API v3 (via `googleapis` npm package)
- **Email:** [Resend](https://resend.com)

---

## Local Development

```bash
npm install
vercel dev
```

Requires the [Vercel CLI](https://vercel.com/docs/cli) and a `.env` file with the variables listed above.

---

© 2026 Matt Doyle Basketball · Built, Not Born.
