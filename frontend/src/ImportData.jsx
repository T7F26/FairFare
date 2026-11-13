// Import Data screen (story A3 - Upload GTFS File)
// Task #12: agency dropdown, file picker and Upload button
// Task #11: upload error messages

import { useState } from 'react'
import './ImportData.css'

const AGENCIES = [
  'TTC',
  'GO Transit',
  'MiWay',
  'York Region Transit',
  'Brampton Transit',
  'Durham Region Transit',
]

// The backend upload route (built by whoever has the A3 back-end task).
const UPLOAD_URL = 'http://localhost:4000/api/admin/import'

// Error codes the backend sends back, and the message we show for each.
const ERROR_MESSAGES = {
  NOT_GTFS: 'File could not be read. The old data was kept.',
  WRONG_AGENCY: 'This file does not match the chosen agency.',
}

// Checks we can do before sending anything to the backend.
export function checkBeforeUpload(agency, file) {
  if (!agency) return 'Choose an agency.'
  if (!file) return 'Choose a GTFS file.'
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return 'File could not be read. The old data was kept.'
  }
  return ''
}

export default function ImportData() {
  const [agency, setAgency] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [recordsImported, setRecordsImported] = useState(null)
  const [uploading, setUploading] = useState(false)

  async function handleUpload(event) {
    event.preventDefault()
    setError('')
    setRecordsImported(null)

    const problem = checkBeforeUpload(agency, file)
    if (problem) {
      setError(problem)
      return
    }

    const form = new FormData()
    form.append('agency', agency)
    form.append('file', file)

    setUploading(true)
    try {
      const response = await fetch(UPLOAD_URL, { method: 'POST', body: form })
      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setRecordsImported(data.recordsImported)
      } else {
        setError(ERROR_MESSAGES[data.error] || 'File could not be read. The old data was kept.')
      }
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="import-data">
      <h2>Import Agency Data</h2>

      <form onSubmit={handleUpload}>
        <label>
          Agency
          <select value={agency} onChange={(e) => setAgency(e.target.value)}>
            <option value="">Choose an agency</option>
            {AGENCIES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label>
          GTFS file
          <input
            type="file"
            accept=".zip"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
        </label>

        <button type="submit" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {error && <p className="message error">✖ {error}</p>}

      {recordsImported !== null && (
        <p className="message success">
          ✔ {recordsImported} records imported. The changes are waiting in Review Updates.
        </p>
      )}
    </div>
  )
}
