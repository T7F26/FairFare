import { useEffect, useState } from 'react'

export default function EditDiscountModal({
  isOpen,
  categoryName,
  agencyLabel,
  currentFare,
  onClose,
  onSave,
}) {
  const [newFare, setNewFare] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setNewFare(
        currentFare !== null && currentFare !== undefined && currentFare !== '-'
          ? String(currentFare).replace('%', '')
          : ''
      )
      setStatusMessage('')
      setIsError(false)
    }
  }, [isOpen, currentFare])

  useEffect(() => {
    if (!isOpen || !onClose) return

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  function handleSubmit(e) {
    e.preventDefault()

    const trimmed = newFare.trim()
    const numericValue = Number(trimmed)
    if (trimmed === '' || Number.isNaN(numericValue)) {
      setIsError(true)
      setStatusMessage('Please enter a valid fare.')
      return
    }

    if (numericValue < 0) {
      setIsError(true)
      setStatusMessage("Fare can't be negative")
      return
    }

    setIsError(false)
    setStatusMessage(`${categoryName} updated`)

    if (onSave) {
      onSave(trimmed)
    }
  }

  return (
    <div
      className="edit-discount-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-discount-title"
    >
      <div className="edit-discount-modal">
        <div className="edit-discount-header">
          <h3 id="edit-discount-title">Edit Discount</h3>
          <button
            type="button"
            className="edit-discount-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <dl className="edit-discount-meta">
          <div className="edit-discount-row">
            <dt>Category:</dt>
            <dd>{categoryName || '-'}</dd>
          </div>
          <div className="edit-discount-row">
            <dt>Agency:</dt>
            <dd>{agencyLabel || '-'}</dd>
          </div>
          <div className="edit-discount-row">
            <dt>Current Fare:</dt>
            <dd>{currentFare ?? '-'}</dd>
          </div>
        </dl>

        <form onSubmit={handleSubmit}>
          <label htmlFor="new-fare-input" className="edit-discount-label">
            New Fare
          </label>
          <input
            id="new-fare-input"
            type="number"
            step="any"
            className="edit-discount-input"
            value={newFare}
            onChange={(e) => {
              setNewFare(e.target.value)
              if (statusMessage) {
                setStatusMessage('')
                setIsError(false)
              }
            }}
          />

          {statusMessage && (
            <p
              role={isError ? 'alert' : 'status'}
              className={`edit-discount-feedback ${isError ? 'is-error' : 'is-success'}`}
            >
              {statusMessage}
            </p>
          )}

          <div className="edit-discount-actions">
            <button
              type="button"
              className="edit-discount-btn cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="edit-discount-btn save">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}