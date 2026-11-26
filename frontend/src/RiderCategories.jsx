import { useEffect, useState } from 'react'
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

const INITIAL_CATEGORIES = [
  {
    category_id: 1,
    category_name: 'Adult',
    proof_required: 'None required',
    discounts: {
      ttc: null,
      gotransit: null,
      miway: null,
      brampton_transit: null,
      yrt: null,
      durham_region_transit: null,
    },
  },
  {
    category_id: 2,
    category_name: 'Youth',
    proof_required: 'Valid ID / Youth card or proof of age',
    discounts: {
      ttc: null,
      gotransit: null,
      miway: null,
      brampton_transit: null,
      yrt: null,
      durham_region_transit: null,
    },
  },
  {
    category_id: 3,
    category_name: 'Senior',
    proof_required: 'Government ID / Senior fare card',
    discounts: {
      ttc: null,
      gotransit: null,
      miway: null,
      brampton_transit: null,
      yrt: null,
      durham_region_transit: null,
    },
  },
  {
    category_id: 4,
    category_name: 'Post-Secondary Student',
    proof_required: 'Valid student ID / enrollment proof',
    discounts: {
      ttc: null,
      gotransit: null,
      miway: null,
      brampton_transit: null,
      yrt: null,
      durham_region_transit: null,
    },
  },
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

export default function RiderCategories() {
  const [categories, setCategories] = useState(INITIAL_CATEGORIES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let isCurrent = true
    setLoading(true)

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
        if (Array.isArray(rows) && rows.length > 0) {
          setCategories(rows)
        }
        setError('')
      })
      .catch(() => {
        if (!isCurrent) return
        setError('')
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

      {!loading && categories.length === 0 && (
        <p className="message">No rider categories found.</p>
      )}

      {!loading && categories.length > 0 && (
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
                  <tr key={item.category_id ?? item.category_name ?? index}>
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
                          {displayValue}
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
    </section>
  )
}