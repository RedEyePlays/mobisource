import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { bulkLabelZpl, harvestedLabelZpl } from './zpl.js'
import type { BulkLabelFields, HarvestedLabelFields } from './zpl.js'
import { printerConfig, sendToPrinter } from './printer.js'

const PORT = Number(process.env.PRINT_SERVICE_PORT ?? 9100)

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseHarvestedFields(fields: Record<string, unknown>): HarvestedLabelFields {
  const { itemId, skuCode, grade, model } = fields
  if (!isNonEmptyString(itemId)) throw new Error('fields.itemId is required.')
  if (!isNonEmptyString(skuCode)) throw new Error('fields.skuCode is required.')
  if (!isNonEmptyString(grade)) throw new Error('fields.grade is required.')
  if (!isNonEmptyString(model)) throw new Error('fields.model is required.')
  return { itemId, skuCode, grade, model }
}

function parseBulkFields(fields: Record<string, unknown>): BulkLabelFields {
  const { skuCode, model, grade, partType } = fields
  if (!isNonEmptyString(skuCode)) throw new Error('fields.skuCode is required.')
  if (!isNonEmptyString(model)) throw new Error('fields.model is required.')
  if (!isNonEmptyString(grade)) throw new Error('fields.grade is required.')
  if (!isNonEmptyString(partType)) throw new Error('fields.partType is required.')
  return { skuCode, model, grade, partType }
}

interface PrintRequestBody {
  template?: unknown
  copies?: unknown
  fields?: unknown
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handlePrint(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req)
    const body = JSON.parse(raw || '{}') as PrintRequestBody

    const copies = body.copies == null ? 1 : Number(body.copies)
    if (!Number.isInteger(copies) || copies < 1) {
      throw new Error('copies must be a positive integer.')
    }
    if (!body.fields || typeof body.fields !== 'object') {
      throw new Error('fields is required.')
    }
    const fields = body.fields as Record<string, unknown>

    let zpl: string
    if (body.template === 'harvested') {
      zpl = harvestedLabelZpl(parseHarvestedFields(fields), copies)
    } else if (body.template === 'bulk') {
      zpl = bulkLabelZpl(parseBulkFields(fields), copies)
    } else {
      throw new Error(`template must be "harvested" or "bulk", got: ${JSON.stringify(body.template)}`)
    }

    await sendToPrinter(zpl)
    sendJson(res, 200, { ok: true })
  } catch (err) {
    sendJson(res, 400, { ok: false, error: (err as Error).message })
  }
}

const server = http.createServer((req, res) => {
  // This service only ever runs on a private bench machine and never
  // touches money/ledger data — it just turns a label job into bytes on a
  // USB printer — so a permissive CORS policy here doesn't widen anything
  // that matters. The browser client may be served from any localhost port
  // or the unit's LAN address, and that's the only thing this unblocks.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, ...printerConfig() })
    return
  }

  if (req.method === 'POST' && req.url === '/print') {
    void handlePrint(req, res)
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not found. POST /print or GET /health.' })
})

server.listen(PORT, () => {
  const { device, dryRun } = printerConfig()
  console.log(`MobiSource print service listening on http://localhost:${PORT}`)
  console.log(`Printer device: ${device}${dryRun ? ' (DRY RUN — logging labels instead of printing)' : ''}`)
})
