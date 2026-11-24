// Review Updates screen
// Story A5 - See Changed Fares, task #22: table of changed fares for admins
// Story A6 - Approve Fare Change, task #27: Approve and Undo buttons
// Task #29: Confirmation message when a fare is approved
// Story A8 - Publish Approved Changes, task #32: Publish button

import { useCallback, useEffect, useRef, useState } from 'react'
import PublishFeedback from './PublishFeedback.jsx'
import './ReviewUpdates.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const CHANGES_URL = `${API_URL}/api/admin/fare-changes`

// Shows a price like $3.50, or a dash when there is no old price.
function formatPrice(price) {
  if (price === null || price === undefined || price === '') return '—'
  return `$${Number(price).toFixed(2)}`
}

// Saves the fare status using the backend from task #28.
async function saveStatus(fareId, status) {
  const response = await fetch(
    `${CHANGES_URL}/${encodeURIComponent(fareId)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  )

  if (!response.ok) {
    throw new Error('Saving the status failed')
  }
}

export default function ReviewUpdates() {
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState({})
  const [saveError, setSaveError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [savingIds, setSavingIds] = useState({})
  const [publishing, setPublishing] = useState(false)
  const [publishFeedback, setPublishFeedback] = useState(null)
  const publishInFlight = useRef(false)
  const latestLoad = useRef(0)

  const loadChanges = useCallback(() => {
    const loadVersion = ++latestLoad.current

    return fetch(CHANGES_URL)
      .then((response) => {
        if (!response.ok) throw new Error('Request failed')
        return response.json()
      })
      .then((data) => {
        // An older load must not restore fares after the publish refresh.
        if (loadVersion !== latestLoad.current) return

        const list = Array.isArray(data) ? data : data.changes || []
        const nextStatuses = Object.fromEntries(
          list.map((change) => [change.fare_id, change.status || 'waiting'])
        )

        setChanges(list)
        setStatuses(nextStatuses)
        setError('')
      })
      .catch(() => {
        if (loadVersion === latestLoad.current) {
          setError('Could not load fare changes. Try again.')
        }
      })
      .finally(() => {
        if (loadVersion === latestLoad.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadChanges()
  }, [loadChanges])

  // Approve or undo a fare.
  // Display confirmation only when the backend saves successfully.
  async function changeStatus(fareId, newStatus) {
    if (savingIds[fareId] || publishInFlight.current) return

    const oldStatus = statuses[fareId]

    setSaveError('')
    setConfirmation('')
    setSavingIds((current) => ({
      ...current,
      [fareId]: true,
    }))

    // Update the status label immediately.
    setStatuses((current) => ({
      ...current,
      [fareId]: newStatus,
    }))

    try {
      await saveStatus(fareId, newStatus)

      if (newStatus === 'approved') {
        setConfirmation('Fare approved')
      } else {
        setConfirmation('Approval undone')
      }
    } catch {
      // Restore the old status if saving fails.
      setStatuses((current) => ({
        ...current,
        [fareId]: oldStatus,
      }))

      setSaveError('Could not save the change. Try again.')
    } finally {
      setSavingIds((current) => ({
        ...current,
        [fareId]: false,
      }))
    }
  }

  const approvedCount = changes.filter(
    (change) => statuses[change.fare_id] === 'approved'
  ).length
  const savingStatus = Object.values(savingIds).some(Boolean)

  async function handlePublish() {
    if (publishInFlight.current || savingStatus) return

    setConfirmation('')
    if (approvedCount === 0) {
      setPublishFeedback({ outcome: 'no-approved' })
      return
    }

    publishInFlight.current = true
    setPublishing(true)
    setPublishFeedback(null)

    try {
      const response = await fetch(`${CHANGES_URL}/publish`, { method: 'POST' })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        setPublishFeedback({
          outcome: data?.code === 'NO_APPROVED_CHANGES' ? 'no-approved' : 'failed',
        })
        return
      }

      setPublishFeedback({ outcome: 'published', count: data?.published_count })
      // The list may have changed even if the response lacks a valid count.
      await loadChanges()
    } catch {
      setPublishFeedback({ outcome: 'failed' })
    } finally {
      publishInFlight.current = false
      setPublishing(false)
    }
  }

  return (
    <div className="review-updates">
      <h2>Review Updates</h2>

      {/* Task #29: Confirmation message */}
      {confirmation && (
        <p
          role="status"
          aria-live="polite"
          className="message success"
        >
          {confirmation}
        </p>
      )}

      {loading && <p>Loading fare changes…</p>}

      {error && (
        <p className="message error">✖ {error}</p>
      )}

      {!loading && !error && changes.length === 0 && (
        <p className="message">
          No fare changes in this import.
        </p>
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
                const approved =
                  statuses[change.fare_id] === 'approved'

                const saving = !!savingIds[change.fare_id]

                return (
                  <tr
                    key={`${change.agency_id}-${change.fare_id}`}
                  >
                    <td>{change.fare_id}</td>
                    <td>{change.agency_id}</td>

                    <td>
                      {formatPrice(change.old_price)}
                    </td>

                    <td className="new-price">
                      {formatPrice(change.new_price)}
                    </td>

                    <td
                      className={
                        approved ? 'status approved' : 'status'
                      }
                    >
                      {approved
                        ? 'Approved'
                        : 'Waiting for review'}
                    </td>

                    <td>
                      {approved ? (
                        <button
                          type="button"
                          disabled={saving || publishing}
                          onClick={() =>
                            changeStatus(
                              change.fare_id,
                              'waiting'
                            )
                          }
                        >
                          {saving ? 'Saving...' : 'Undo'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={saving || publishing}
                          onClick={() =>
                            changeStatus(
                              change.fare_id,
                              'approved'
                            )
                          }
                        >
                          {saving ? 'Saving...' : 'Approve'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {saveError && (
            <p role="alert" className="message error">
              ✖ {saveError}
            </p>
          )}

          <p className="note">
            Riders keep seeing the old fares until the changes
            are published.
          </p>

          {/* Task #32: Publish button */}
          <div className="publish-section">
            <button
              type="button"
              className="publish-button"
              disabled={publishing || savingStatus}
              onClick={handlePublish}
            >
              {publishing ? 'Publishing…' : 'Publish approved changes'}
            </button>
          </div>
        </>
      )}
      {publishFeedback && <PublishFeedback {...publishFeedback} />}
    </div>
  )
}
