// Review Updates screen
// Story A5 - See Changed Fares, task #22: table of changed fares for admins
// Story A6 - Approve Fare Change, task #27: Approve and Undo buttons

import { useEffect, useState } from 'react'
import './ReviewUpdates.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const CHANGES_URL = `${API_URL}/api/admin/fare-changes`

// Shows a price like $3.50, or a dash when there is no old price (a new fare).
function formatPrice(price) {
  if (price === null || price === undefined || price === '') return '—'
  return `$${Number(price).toFixed(2)}`
}

// Saves a fare's status ("approved" or "waiting") using Ajani's backend (#28).
async function saveStatus(fareId, status) {
  const response = await fetch(`${CHANGES_URL}/${encodeURIComponent(fareId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!response.ok) throw new Error('Saving the status failed')
}

export default function ReviewUpdates() {
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState({}) // fare_id -> "approved" or "waiting"
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    async function loadChanges() {
      try {
        const response = await fetch(CHANGES_URL)
        if (!response.ok) throw new Error('Request failed')
        const data = await response.json()
        // Accept either a plain list or { changes: [...] }.
        const list = Array.isArray(data) ? data : data.changes || []
        setChanges(list)
        setStatuses(
          Object.fromEntries(list.map((change) => [change.fare_id, change.status || 'waiting']))
        )
      } catch {
        setError('Could not load fare changes. Try again.')
      } finally {
        setLoading(false)
      }
    }
    loadChanges()
  }, [])

  // Approve or undo one fare. The screen updates straight away, and goes back
  // to the old status if the backend could not save it.
  async function changeStatus(fareId, newStatus) {
    const oldStatus = statuses[fareId]
    setSaveError('')
    setStatuses((current) => ({ ...current, [fareId]: newStatus }))
    try {
      await saveStatus(fareId, newStatus)
    } catch {
      setStatuses((current) => ({ ...current, [fareId]: oldStatus }))
      setSaveError('Could not save the change. Try again.')
    }
  }

  const approvedCount = changes.filter((change) => statuses[change.fare_id] === 'approved').length

  return (
    <div className="review-updates">
      <h2>Review Updates</h2>

      {loading && <p>Loading fare changes…</p>}

      {error && <p className="message error">✖ {error}</p>}

      {!loading && !error && changes.length === 0 && (
        <p className="message">No fare changes in this import.</p>
      )}

      {!loading && !error && changes.length > 0 && (
        <>
          <p className="summary">
            {approvedCount} of {changes.length} changes approved
          </p>

          <table>
            <thead>
              <tr>
                <th>Fare</th>
                <th>Agency</th>
                <th>Old price</th>
                <th>New price</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => {
                const approved = statuses[change.fare_id] === 'approved'
                return (
                  <tr key={`${change.agency_id}-${change.fare_id}`}>
                    <td>{change.fare_id}</td>
                    <td>{change.agency_id}</td>
                    <td>{formatPrice(change.old_price)}</td>
                    <td className="new-price">{formatPrice(change.new_price)}</td>
                    <td className={approved ? 'status approved' : 'status'}>
                      {approved ? 'Approved' : 'Waiting for review'}
                    </td>
                    <td>
                      {approved ? (
                        <button type="button" onClick={() => changeStatus(change.fare_id, 'waiting')}>
                          Undo
                        </button>
                      ) : (
                        <button type="button" onClick={() => changeStatus(change.fare_id, 'approved')}>
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {saveError && <p className="message error">✖ {saveError}</p>}

          <p className="note">
            Riders keep seeing the old fares until the changes are published.
          </p>
        </>
      )}
    </div>
  )
}
