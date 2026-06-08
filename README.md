# Order Pulling — PMI Tape

A standalone React app for **pulling/verifying orders against a scanner**. Scan the
barcode on a packing list to pull the matching Sales Order from Zoho Inventory, then
scan each case to count it down. The app warns immediately on a wrong item or an
over-scan, and records the lot number of every case scanned.

It shares the look, logo, and Zoho connection approach of the **Order Entry App**.

---

## How it works

1. **Scan the packing list barcode.** It encodes the **Sales Order number**. The app
   pulls that order from Zoho Inventory — draft, open, or closed all work.
   - If the order already has an **"Items Scanned Successfully"** comment, a prompt
     appears first: **Go Back** (load a different packing list) or **Clear Old Scans and
     Start Over** (scan this order's items again — a new comment is still posted afterward).
2. The **Pick List** screen lists every line with its ordered **Qty**, **U/M**,
   **Cases**, **Item #**, **Description**, **Units/Case**, and **Cases left to Scan**.
3. **Scan each case.** Case barcodes are in the format:

   ```
   ItemNumber,Quantity(units),LotNumber
   ```

   e.g. `RIS2260,36,LOT24A`. Each scan reduces **Cases left to Scan** for that item
   (by `Quantity ÷ Units per Case`) and stores the lot number.

   **Nazdar Company** cases use a different, self-identifying format that the app
   auto-detects and converts:

   ```
   ]C1ITNO<alias>|BANO<lot>|QTY<units×1000>
   ```

   e.g. `]C1ITNOIMS84513|BANO406086|QTY24000` → item `NAZ3451` (alias mapped to our
   item number), lot `406086`, qty `24`. The Nazdar alias → item-number list is small
   and fixed, so it lives in code at `src/lib/nazdar.js` (not in Supabase). Add or edit
   rows there if Nazdar items change.

   Two Nazdar items — **PMI3321** and **NAZ4451** — encode their `QTY` in **cases**
   instead of units (e.g. `QTY1000` → 1 case). The app multiplies by the item's
   Units/Case to get units, so `]C1ITNOPMI3213X110CS|BANO123456|QTY1000` counts as
   24 rolls (1 case). That item list is the `NAZDAR_CASES_QTY_ITEMS` set in
   `src/lib/nazdar.js`.
4. **Warnings (immediate, stop-and-restart):**
   - **Wrong item** — the scanned item isn't on the order.
   - **Too many** — scanning that case would exceed the ordered quantity.

   Either one shows a red banner and blocks further scanning until you press **Clear**.
5. **Clear** wipes every scan for the order so you can restart scanning the same order.
6. **Done Scanning** posts a comment to the sales order in Zoho summarizing the result,
   then returns to the barcode screen for the next order:
   - All items scanned correctly → comment headed **"Items Scanned Successfully"**, listing
     each item number with the lot numbers scanned.
   - Anything missing/wrong/over-scanned → comment headed **"Items Scanned UNSUCCESSFULLY"**,
     listing the scanned items and lots plus an **Issues** section (short items, wrong items,
     over-scans). It confirms first before posting an unsuccessful comment.

Captured lot numbers appear under each row and in the collapsible **Scan log**.

---

## Configuration (Netlify environment variables)

Zoho credentials live only in the serverless function — they are never sent to the
browser. Set these in **Netlify → Site settings → Environment variables**:

| Variable | Required | Notes |
| --- | --- | --- |
| `ZOHO_CLIENT_ID` | yes | |
| `ZOHO_CLIENT_SECRET` | yes | |
| `ZOHO_ORGANIZATION_ID` | yes | |
| `ZOHO_REFRESH_TOKEN` | optional | Set for the refresh-token grant. Leave unset to use the client-credentials grant (same as the Order Entry App). |
| `ZOHO_SCOPE` | optional | Defaults include `ZohoInventory.salesorders.READ` + `.CREATE` (needed to post the scan-result comment) + `ZohoInventory.items.READ`. |
| `ZOHO_DOMAIN` | optional | Only if you are not on Zoho US. |

You can copy the same Zoho values you already use for the Order Entry App.

---

## Deploying to Netlify without GitHub

This app has a build step **and** a serverless function, so the simplest no-Git path is
the Netlify CLI (drag-and-drop only uploads static files and skips functions/build).

```bash
# one-time
npm install -g netlify-cli
netlify login

# from inside this folder
npm install
netlify init        # choose "Create & configure a new site" (no Git required)
                    # set the env vars above, here or in the dashboard
netlify deploy --build --prod
```

`netlify deploy --build` runs `npm run build` and bundles
`netlify/functions/zoho-salesorder.js` automatically. Re-run that last command any time
you want to push an update.

For local testing: `netlify dev` (serves the React app and the function together with
your `.env`).

---

## Project structure

```
Order Pulling/
├── netlify.toml
├── package.json
├── .env.example
├── public/index.html
├── netlify/functions/
│   ├── zoho-utils.js          # shared Zoho OAuth + GET (copied from Order Entry App)
│   └── zoho-salesorder.js     # look up a sales order by number, enrich with units/case
└── src/
    ├── App.js                 # header (logo + "Order Pulling") + screen switch
    ├── App.css                # Order Entry App design tokens + pick-list styles
    ├── logo.js                # PMI Tape logo (copied from Order Entry App)
    ├── components/
    │   ├── ScanGate.js        # scan/enter the sales order barcode
    │   ├── PickList.js        # the pick list + scanning logic
    │   ├── Toast.js
    │   └── ErrorBoundary.js
    └── lib/
        ├── zoho.js            # frontend API helper
        └── scan.js            # barcode parsing + helpers
```
