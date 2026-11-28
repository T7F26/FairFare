import { useEffect, useRef, useState } from 'react'

function getInitialDiscountInput(currentDiscount) {
  if (
    currentDiscount === null ||
    currentDiscount === undefined ||
    currentDiscount === '-' ||
    currentDiscount === ''
  ) {
    return ''
  }
  return String(currentDiscount).replace('%', '').trim()
}

export default function EditDiscountModal({
  isOpen,
  categoryName,
  agencyLabel,
  currentDiscount,
  onClose,
  onSave,
}) {
  const [discountInput, setDiscountInput] = useState(() =>
    getInitialDiscountInput(currentDiscount)
  )
  const [statusMessage, setStatusMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const saveInFlight = useRef(false)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saveInFlight.current) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const formattedCurrentDiscount =
    currentDiscount === null ||
    currentDiscount === undefined ||
    currentDiscount === '' ||
    currentDiscount === '-'
      ? '-'
      : String(currentDiscount).includes('%')
        ? String(currentDiscount)
        : `${currentDiscount}%`

  function handleClose() {
    if (!saveInFlight.current) onClose()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saveInFlight.current) return

    const trimmed = String(discountInput ?? '').trim()
    const parsed = Number(trimmed)

    if (trimmed === '' || !Number.isFinite(parsed) || parsed > 100) {
      setStatusMessage('Please enter a valid discount (%) between 0 and 100.')
      return
    }
    if (parsed < 0) {
      setStatusMessage("Discount can't be negative")
      return
    }

    saveInFlight.current = true
    setSaving(true)
    setStatusMessage('')

    try {
      await onSave(parsed)
    } catch (error) {
      setStatusMessage(error.message)
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  return (
    <div
      className="edit-discount-backdrop"
      role="presentation"
      onClick={handleClose}
    >
      <div
        className="edit-discount-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-discount-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="edit-discount-header">
          <h2 id="edit-discount-title">Edit Discount</h2>
          <button
            type="button"
            className="edit-discount-close"
            onClick={handleClose}
            disabled={saving}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        <div className="edit-discount-meta">
          <p>
            <strong>Category:</strong> {categoryName}
          </p>
          <p>
            <strong>Agency:</strong> {agencyLabel}
          </p>
          <p>
            <strong>Current Discount (%):</strong> {formattedCurrentDiscount}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="edit-discount-form" aria-busy={saving} noValidate>
          <label htmlFor="discount-percent-input">Discount (%)</label>
          <input
            id="discount-percent-input"
            type="number"
            step="any"
            min="0"
            max="100"
            value={discountInput}
            disabled={saving}
            onChange={(event) => {
              setDiscountInput(event.target.value)
              setStatusMessage('')
            }}
            placeholder="0 - 100"
            autoFocus
          />

          {statusMessage && (
            <p className="edit-discount-feedback is-error" role="alert">
              {statusMessage}
            </p>
          )}

          <div className="edit-discount-actions">
            <button
              type="button"
              className="edit-discount-btn secondary"
              onClick={handleClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="edit-discount-btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
