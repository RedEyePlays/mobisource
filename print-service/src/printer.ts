import { writeFile } from 'node:fs/promises'

// The ZD421 here is USB-attached to whatever machine runs this service, not
// reachable from a browser — so this writes raw ZPL bytes straight to the
// USB printer's device file. On Linux that's the kernel `usblp` driver's
// character device, typically /dev/usb/lp0 (see README for how to find it
// and for the Windows/macOS story, which this hasn't been tested against).
const PRINTER_DEVICE = process.env.PRINTER_DEVICE ?? '/dev/usb/lp0'
const DRY_RUN = process.env.PRINT_DRY_RUN === 'true'

export function printerConfig() {
  return { device: PRINTER_DEVICE, dryRun: DRY_RUN }
}

/**
 * Sends a complete ZPL format to the printer. In dry-run mode (no printer
 * attached — e.g. running this service on a dev machine) it just logs the
 * ZPL instead of writing to a device file that doesn't exist.
 */
export async function sendToPrinter(zpl: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`--- DRY RUN: would write ${zpl.length} bytes to ${PRINTER_DEVICE} ---`)
    console.log(zpl)
    console.log('--- end ---')
    return
  }
  await writeFile(PRINTER_DEVICE, zpl, 'utf8')
}
