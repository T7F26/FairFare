import { useEffect, useState } from 'react'
import EditDiscountModal from './EditDiscountModal.jsx'
import './RiderCategories.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

const AGENCIES = [
  { id: 'ttc', label: 'TTC' },
  { id: 'gotransit', label: 'GO Transit' },
  { id: 'miway', label: 'MiWay' },
  { id: 'brampton_transit', label: 'Brampton Transit' },
  { id: 'yrt', label: 'YRT' },
  { id: 'durham_region_transit', label: 'Durham Region Transit' },
]

function formatDiscount(value) {
  if (value === null || value === undefined || value === '') {
    return '-'
  }
  if (typeof value === 'number') {
    return `${value}%`
  }
  return String(value)
}

function getRowKey(item, index) {
  return item.category_id ?? item.category_name ?? index
}

export default function RiderCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeEdit, setActiveEdit] = useState(null)

  useEffect(() => {
    let isCurrent = true

    fetch(`${API_URL}/api/rider-categories`)
      .then((res) => {
        if (!res.ok) {
          throw new Error('Request failed')
        }
        return res.json()
      })
      .then((data) => {
        if (!isCurrent) return
        const rows = Array.isArray(data) ? data : data.categories
        setCategories(Array.isArray(rows) ? rows : [])
        setError('')
      })
      .catch(() => {
        if (!isCurrent) return
        setCategories([])
        setError('Could not load rider categories. Try again.')
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  function handleOpenEdit(item, rowIndex, agency, displayValue) {
    setActiveEdit({
      rowKey: getRowKey(item, rowIndex),
      categoryName: item.category_name || '-',
      agencyId: agency.id,
      agencyLabel: agency.label,
      currentDiscount: displayValue,
    })
  }

  function handleSaveDiscount(updatedDiscountValue) {
    if (!activeEdit) return

    const trimmed = String(updatedDiscountValue ?? '').trim()
    if (trimmed === '') return

    const numericDiscount = Number(trimmed)
    if (
      Number.isNaN(numericDiscount) ||
      numericDiscount < 0 ||
      numericDiscount > 100
    ) {
      return
    }

    const formattedNewValue = formatDiscount(numericDiscount)

    setCategories((prev) =>
      prev.map((row, idx) => {
        if (getRowKey(row, idx) !== activeEdit.rowKey) return row
        const existingDiscounts = row.discounts || {}
        const keyToUpdate = Object.prototype.hasOwnProperty.call(
          existingDiscounts,
          activeEdit.agencyLabel
        )
          ? activeEdit.agencyLabel
          : activeEdit.agencyId

        return {
          ...row,
          discounts: {
            ...existingDiscounts,
            [keyToUpdate]: numericDiscount,
          },
        }
      })
    )

    setActiveEdit((prev) =>
      prev ? { ...prev, currentDiscount: formattedNewValue } : null
    )
  }

  return (
    <section className="rider-categories">
      <h2>Rider Categories</h2>
      <p className="subtitle">
        Category discounts by transit agency and required proof for each category.
      </p>

      {loading && <p>Loading rider categories…</p>}

      {error && (
        <p role="alert" className="message error">
          ✖ {error}
        </p>
      )}

      {!loading && !error && categories.length === 0 && (
        <p className="message">No rider categories found.</p>
      )}

      {!loading && !error && categories.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Rider Category</th>
                {AGENCIES.map((agency) => (
                  <th key={agency.id} scope="col">
                    {agency.label}
                  </th>
                ))}
                <th scope="col">Proof Required</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item, index) => {
                const discountsMap = item.discounts || {}
                return (
                  <tr key={getRowKey(item, index)}>
                    <td className="category-col">
                      {item.category_name || '-'}
                    </td>
                    {AGENCIES.map((agency) => {
                      const rawDiscount =
                        discountsMap[agency.id] ?? discountsMap[agency.label]
                      const displayValue = formatDiscount(rawDiscount)
                      const hasNoDiscount = displayValue === '-'

                      return (
                        <td
                          key={agency.id}
                          className={hasNoDiscount ? 'no-discount' : 'discount'}
                        >
                          <button
                            type="button"
                            className="edit-cell-btn"
                            onClick={() =>
                              handleOpenEdit(item, index, agency, displayValue)
                            }
                            aria-label={`Edit discount for ${item.category_name || 'category'} at ${agency.label}`}
                          >
                            {displayValue}
                          </button>
                        </td>
                      )
                    })}
                    <td className="proof-col">
                      {item.proof_required || item.proof || '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="note">
        <strong>-</strong> indicates no discount is available for that category at that agency.
      </p>

      <EditDiscountModal
        key={
          activeEdit
            ? `${activeEdit.rowKey}-${activeEdit.agencyId}-${activeEdit.currentDiscount}`
            : 'closed'
        }
        isOpen={Boolean(activeEdit)}
        categoryName={activeEdit?.categoryName ?? ''}
        agencyLabel={activeEdit?.agencyLabel ?? ''}
        currentDiscount={activeEdit?.currentDiscount ?? ''}
        onClose={() => setActiveEdit(null)}
        onSave={handleSaveDiscount}
      />
    </section>
  )
}