// Review Updates screen (story A5 - See Changed Fares)
// Task #22: table of changed fares for admins

import { useEffect, useState } from 'react'
import './ReviewUpdates.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const CHANGES_URL = `${API_URL}/api/admin/fare-changes`

// Shows a price like $3.50, or a dash when there is no old price (a new fare).
function formatPrice(price) {
  if (price === null || price === undefined || price === '') return '—'
  return `$${Number(price).toFixed(2)}`
}

export default function ReviewUpdates() {
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadChanges() {
      try {
        const response = await fetch(CHANGES_URL)
        if (!response.ok) throw new Error('Request failed')
        const data = await response.json()
        // Accept either a plain list or { changes: [...] }.
        setChanges(Array.isArray(data) ? data : data.changes || [])
      } catch {
        setError('Could not load fare changes. Try again.')
      } finally {
        setLoading(false)
      }
    }
    loadChanges()
  }, [])

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
          <table>
            <thead>
              <tr>
                <th>Fare</th>
                <th>Agency</th>
                <th>Old price</th>
                <th>New price</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={`${change.agency_id}-${change.fare_id}`}>
                  <td>{change.fare_id}</td>
                  <td>{change.agency_id}</td>
                  <td>{formatPrice(change.old_price)}</td>
                  <td className="new-price">{formatPrice(change.new_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            Riders keep seeing the old fares until the changes are published.
          </p>
        </>
      )}
    </div>
  )
}
