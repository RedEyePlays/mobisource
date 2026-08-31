# MobiSource print service

A small local HTTP service that turns a label job into ZPL and sends it to a
USB-attached Zebra ZD421. The browser app can't reach a USB printer directly,
so this runs on the same machine as the printer (the bench PC/laptop at the
unit) and the app posts label jobs to it over `localhost` (or the machine's
LAN address, if the app is served from elsewhere on the same network).

## Label types

- **`harvested`** — one per serialized `stockItem` created by a teardown. QR
  encodes the `itemId` (the Firestore doc ID) — the only thing that uniquely
  identifies that physical part. Human-readable model, SKU code, and grade
  alongside it.
- **`bulk`** — one SKU-level label, the same on every unit of a batch. QR
  encodes the `skuCode` instead, since bulk stock has no per-unit identity
  (docs/SCHEMA.md §2). Printed N times per bulk-receiving line via the ZPL
  `^PQ` (print quantity) command, not by resending the job N times.

Both are 2" x 1" direct thermal labels, generated for 203 dpi (the ZD421's
default resolution — see "300 dpi printers" below if the unit's is the
higher-density variant).

See `docs/labels/` at the repo root for rendered previews of both label
layouts (`harvested-label-preview.svg`, `bulk-label-preview.svg`) and the
exact example ZPL each one printed from (`*-label-example.zpl`) — check
those before burning a roll on a new layout change.

## Running it

```
cd print-service
npm install
npm run build
PRINTER_DEVICE=/dev/usb/lp0 npm start
```

The service listens on port 9100 by default (`PRINT_SERVICE_PORT` to
change it), and the frontend expects it there by default too
(`VITE_PRINT_SERVICE_URL`, see `src/printing/printClient.ts`).

Run it as a background service on the bench machine (systemd unit, a
Startup Items entry, whatever fits) so it comes back after a reboot without
someone remembering to `npm start` it.

### Finding the printer device (Linux)

Plug the ZD421 into USB. The kernel's `usblp` driver should expose it as a
character device:

```
ls /dev/usb/lp*
```

If it shows up as `/dev/usb/lp0`, that's the default this service already
uses — no env var needed. If there's more than one USB printer on the box,
or it enumerates differently, set `PRINTER_DEVICE` to the right path. You
may need the account running this service to be in the `lp` group (or
otherwise have write access to that device file) — `ls -l /dev/usb/lp0` to
check, `sudo usermod -aG lp $USER` (then re-login) if not.

### macOS / Windows

This has only been built and tested against the Linux raw-USB-device path
above — that's the primary supported setup, and the one this README
assumes. If the bench machine runs something else:

- **macOS**: Zebra USB printers usually enumerate similarly under
  `/dev/usb/` or via IOKit-managed device nodes; `PRINTER_DEVICE` should
  still work if you can find the right path, but this hasn't been verified
  against real hardware.
- **Windows**: there's no direct equivalent of writing to a device file.
  The two options, neither implemented here: (a) share the printer as a
  raw/generic-text printer and write to `\\.\<share-name>` from Node, or
  (b) run this service inside WSL and pass the USB device through
  (`usbipd`), then use the Linux path above. Either would need someone with
  the actual hardware to wire up and test — flagged here rather than
  guessed at blind.

### Dry-run mode (no printer attached)

```
PRINT_DRY_RUN=true npm start
```

Logs the ZPL it would have sent instead of writing to `PRINTER_DEVICE`.
Useful for testing the HTTP contract, or developing against this service on
a machine that isn't the bench PC.

## HTTP contract

`GET /health` → `{ ok: true, device: string, dryRun: boolean }`

`POST /print` — body:

```jsonc
{
  "template": "harvested" | "bulk",
  "copies": 1,        // optional, defaults to 1 — the ZPL ^PQ count
  "fields": {
    // harvested: { itemId, skuCode, grade, model }
    // bulk:      { skuCode, model, grade, partType }
  }
}
```

→ `{ ok: true }` on success, or `{ ok: false, error: string }` with a 400
status if the fields don't validate or the printer write fails.

CORS is wide open (`Access-Control-Allow-Origin: *`) — this service never
touches money, ledger, or auth data, it only turns a label job into printer
bytes, so there's nothing here worth restricting the origin on.

## Regenerating previews

```
npm run render-previews
```

Regenerates `docs/labels/*.svg` and the example `.zpl` files, from the same
`LABEL_LAYOUT` constants and `harvestedLabelZpl`/`bulkLabelZpl` functions
the real print jobs use (`src/zpl.ts`) — so the preview can't silently
drift from what actually prints.

The previews are SVG, not PNG. There's no printer here to render the real
ZPL through, so the preview draws its own QR code (via the `qrcode`
package's low-level module-matrix encoder — the actual printer draws its
own QR from the raw `^BQ` data at print time, this is a separate stand-in
for on-screen viewing) and lays out text using the same coordinates the ZPL
uses. Producing a raster PNG instead would need a native canvas library
(e.g. `node-canvas`), which pulls in system-level build dependencies this
project didn't want to take on for a documentation asset — SVG renders
natively in any browser, image viewer, and GitHub's own file preview, so it
covers "check the layout before burning a roll" without that dependency.

## Tests

```
npm test
```

Unit tests for the ZPL builders (`src/zpl.test.ts`) — field placement, QR
data (itemId vs. skuCode), copy counts, and that control characters in
label data get stripped rather than corrupting the ZPL format.
