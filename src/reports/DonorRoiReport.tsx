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
      <h3 className="section-title mb-2">By model</h3>
      {report.byModel.length === 0 ? (
        <p className="empty-state mb-4">No torn-down donors yet.</p>
      ) : (
        <div className="table-wrap mb-6">
          <table className="table-base">
            <thead>
              <tr>
                <th>Model</th>
                <th>Donors</th>
                <th>Parts sold / created</th>
                <th>Revenue so far</th>
                <th>Donor cost</th>
                <th>ROI</th>
              </tr>
            </thead>
            <tbody>
              {report.byModel.map((row) => (
                <tr key={row.model}>
                  <td>{row.model}</td>
                  <td>{row.donorCount}</td>
                  <td>
                    {row.soldParts} / {row.totalParts}
                  </td>
                  <td>
                    <span className="num-md">{formatCents(row.totalSoldRevenue)}</span>
                  </td>
                  <td>
                    <span className="num-md">{formatCents(row.totalDonorCost)}</span>
                  </td>
                  <td>
                    <span className="num-md">{formatRoi(row.roi)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title mb-2">By donor</h3>
      {report.byDonor.length === 0 ? (
        <p className="empty-state">No torn-down donors yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Donor</th>
                <th>Model</th>
                <th>Parts sold / created</th>
                <th>Revenue so far</th>
                <th>Donor cost</th>
                <th>ROI</th>
              </tr>
            </thead>
            <tbody>
              {report.byDonor.map((row) => (
                <tr key={row.donorId}>
                  <td className="font-mono text-sm">{row.donorId}</td>
                  <td>{row.model}</td>
                  <td>
                    {row.soldParts} / {row.totalParts}
                  </td>
                  <td>
                    <span className="num-md">{formatCents(row.soldRevenue)}</span>
                  </td>
                  <td>
                    <span className="num-md">{formatCents(row.donorCost)}</span>
                  </td>
                  <td>
                    <span className="num-md">{formatRoi(row.roi)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
