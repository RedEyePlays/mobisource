import { useEffect, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import type { TeardownProfile } from '../types'

export default function TeardownProfileList({
  onCreate,
  onEdit,
}: {
  onCreate: () => void
  onEdit: (profile: TeardownProfile) => void
}) {
  const [profiles, setProfiles] = useState<TeardownProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const snap = await getDocs(query(collection(db, 'teardownProfiles'), orderBy('profileId')))
      if (!cancelled) {
        setProfiles(snap.docs.map((d) => d.data() as TeardownProfile))
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  async function handleDelete(profileId: string) {
    if (!window.confirm(`Delete ${profileId}? This can't be undone.`)) {
      return
    }
    setError('')
    setDeletingId(profileId)
    try {
      const deleteTeardownProfile = httpsCallable(functions, 'deleteTeardownProfile')
      await deleteTeardownProfile({ profileId })
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title">Teardown profiles</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn-secondary btn-sm">
            Refresh
          </button>
          <button onClick={onCreate} className="btn-primary btn-sm">
            New profile
          </button>
        </div>
      </div>

      {error && <p className="text-danger mb-2 text-sm">{error}</p>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="text-muted">No teardown profiles yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Model</th>
                <th>Donor grade</th>
                <th>Expected parts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.profileId}>
                  <td className="font-mono text-sm">{profile.model}</td>
                  <td>{profile.donorGrade}</td>
                  <td className="num-md">{profile.expectedParts.length}</td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => onEdit(profile)} className="btn-secondary btn-sm">
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(profile.profileId)}
                        disabled={deletingId === profile.profileId}
                        className="btn-secondary btn-sm"
                      >
                        {deletingId === profile.profileId ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
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
