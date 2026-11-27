import { useEffect, useState } from 'react'
import EditDiscountModal from './EditDiscountModal.jsx'
import './RiderCategories.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const DISCOUNT_SAVE_ERROR = 'Could not save the discount. Try again.'

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
  const [confirmation, setConfirmation] = useState('')

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

  function handleOpenEdit(item, agency, displayValue) {
    setConfirmation('')
    setActiveEdit({
      categoryId: item.category_id,
      categoryName: item.category_name || '-',
      agencyId: agency.id,
      agencyLabel: agency.label,
      currentDiscount: displayValue,
    })
  }

  async function handleSaveDiscount(percentage) {
    const { categoryId, agencyId } = activeEdit
    const path = `/api/admin/rider-categories/${encodeURIComponent(categoryId)}/discounts/${encodeURIComponent(agencyId)}`

    const response = await fetch(`${API_URL}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount_percentage: percentage }),
    }).catch(() => {
      throw new Error(DISCOUNT_SAVE_ERROR)
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message.trim() : ''
      throw new Error(message || DISCOUNT_SAVE_ERROR)
    }

    const storedPercentage = data?.discount_percentage
    if (
      data?.category_id !== categoryId ||
      data.agency_id !== agencyId ||
      typeof data.category_name !== 'string' ||
      !data.category_name.trim() ||
      !Number.isFinite(storedPercentage) ||
      storedPercentage < 0 ||
      storedPercentage > 100
    ) {
      throw new Error('Could not confirm the saved discount.')
    }

    setCategories((prev) =>
      prev.map((row) => {
        if (row.category_id !== categoryId) return row
        return {
          ...row,
          discounts: {
            ...row.discounts,
            [agencyId]: storedPercentage,
          },
        }
      })
    )

    setConfirmation(`${data.category_name} updated`)
    setActiveEdit(null)
  }

  return (
    <section className="rider-categories">
      <h2>Rider Categories</h2>
      <p className="subtitle">
        Category discounts by transit agency and required proof for each category.
      </p>

      {confirmation && <p className="message success" role="status">{confirmation}</p>}

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
                const hasCategoryId = Number.isInteger(item.category_id) && item.category_id > 0
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
                            disabled={!hasCategoryId || Boolean(activeEdit)}
                            onClick={() =>
                              handleOpenEdit(item, agency, displayValue)
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

      {activeEdit && (
        <EditDiscountModal
          isOpen
          categoryName={activeEdit.categoryName}
          agencyLabel={activeEdit.agencyLabel}
          currentDiscount={activeEdit.currentDiscount}
          onClose={() => setActiveEdit(null)}
          onSave={handleSaveDiscount}
        />
      )}
    </section>
  )
}
