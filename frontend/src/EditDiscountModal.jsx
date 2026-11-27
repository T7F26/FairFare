import { useEffect, useState } from 'react'

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
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
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

  const handleSubmit = (event) => {
    event.preventDefault()

    const trimmed = String(discountInput ?? '').trim()
    const parsed = Number(trimmed)

    if (trimmed === '' || Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      setIsError(true)
      setStatusMessage('Please enter a valid discount (%) between 0 and 100.')
      return
    }

    onSave?.(parsed)
    setIsError(false)
    setStatusMessage(
      'Not saved yet — changes will be saved once the backend task is connected.'
    )
  }

  return (
    <div
      className="edit-discount-backdrop"
      role="presentation"
      onClick={onClose}
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
            onClick={onClose}
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

        <form onSubmit={handleSubmit} className="edit-discount-form">
          <label htmlFor="discount-percent-input">Discount (%)</label>
          <input
            id="discount-percent-input"
            type="number"
            step="any"
            min="0"
            max="100"
            value={discountInput}
            onChange={(event) => {
              setDiscountInput(event.target.value)
              if (statusMessage) {
                setStatusMessage('')
                setIsError(false)
              }
            }}
            placeholder="0 - 100"
            autoFocus
          />

          {statusMessage && (
            <p
              className={`edit-discount-status ${
                isError ? 'is-error' : 'is-info'
              }`}
              role="alert"
            >
              {statusMessage}
            </p>
          )}

          <div className="edit-discount-actions">
            <button
              type="button"
              className="edit-discount-btn secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="edit-discount-btn primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}