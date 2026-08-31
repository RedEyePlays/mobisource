import { useMemo } from 'react'
import { donorRoiByModel } from './aggregations'
import type { Cents, Donor, StockItem } from '../types'

function formatCents(cents: Cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function formatRoi(roi: number | null) {
  return roi == null ? '—' : `${(roi * 100).toFixed(1)}%`
}

export default function DonorRoiReport({ donors, stockItems }: { donors: Donor[]; stockItems: StockItem[] }) {
  const report = useMemo(() => donorRoiByModel(donors, stockItems), [donors, stockItems])

  return (
    <div>
      <h3 className="font-medium mb-2">By model</h3>
      {report.byModel.length === 0 ? (
        <p className="text-gray-500 mb-4">No torn-down donors yet.</p>
      ) : (
        <table className="w-full text-left border-collapse mb-6">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Donors</th>
              <th className="py-2 pr-4">Parts sold / created</th>
              <th className="py-2 pr-4">Revenue so far</th>
              <th className="py-2 pr-4">Donor cost</th>
              <th className="py-2 pr-4">ROI</th>
            </tr>
          </thead>
          <tbody>
            {report.byModel.map((row) => (
              <tr key={row.model} className="border-b">
                <td className="py-2 pr-4">{row.model}</td>
                <td className="py-2 pr-4">{row.donorCount}</td>
                <td className="py-2 pr-4">
                  {row.soldParts} / {row.totalParts}
                </td>
                <td className="py-2 pr-4">{formatCents(row.totalSoldRevenue)}</td>
                <td className="py-2 pr-4">{formatCents(row.totalDonorCost)}</td>
                <td className="py-2 pr-4 font-medium">{formatRoi(row.roi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="font-medium mb-2">By donor</h3>
      {report.byDonor.length === 0 ? (
        <p className="text-gray-500">No torn-down donors yet.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">Donor</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Parts sold / created</th>
              <th className="py-2 pr-4">Revenue so far</th>
              <th className="py-2 pr-4">Donor cost</th>
              <th className="py-2 pr-4">ROI</th>
            </tr>
          </thead>
          <tbody>
            {report.byDonor.map((row) => (
              <tr key={row.donorId} className="border-b">
                <td className="py-2 pr-4 font-mono text-sm">{row.donorId}</td>
                <td className="py-2 pr-4">{row.model}</td>
                <td className="py-2 pr-4">
                  {row.soldParts} / {row.totalParts}
                </td>
                <td className="py-2 pr-4">{formatCents(row.soldRevenue)}</td>
                <td className="py-2 pr-4">{formatCents(row.donorCost)}</td>
                <td className="py-2 pr-4">{formatRoi(row.roi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
