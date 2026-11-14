import { useState, useEffect } from 'react'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const [agencies, setAgencies] = useState([])
  const [selectedAgency, setSelectedAgency] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/agencies')
      .then((res) => res.json())
      .then((data) => setAgencies(data))
      .catch((err) => console.error('Failed to load agencies:', err))
  }, [])

  const handleUpload = () => {
    if (!selectedAgency) {
      setMessage('Please select an agency.')
      return
    }
    if (!selectedFile) {
      setMessage('Please choose a GTFS zip file to upload.')
      return
    }

    const formData = new FormData()
    formData.append('agency', selectedAgency)
    formData.append('gtfsFile', selectedFile)

    setMessage('Uploading...')

    fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })
      .then((res) => {
        if (res.ok) {
          setMessage('Data uploaded successfully!')
        } else {
          setMessage('Upload failed. Please try again.')
        }
      })
      .catch(() => {
        setMessage('An error occurred during upload.')
      })
  }

  return (
    <>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.jsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <button
          type="button"
          className="counter"
          onClick={() => setCount((count) => count + 1)}
        >
          Count is {count}
        </button>
      </section>

      <div className="ticks"></div>

      <div className="import-container">
        <h2>Import GTFS Data</h2>
        
        <div className="form-group">
          <label htmlFor="agency-select">Select Agency:</label>
          <select
            id="agency-select"
            name="agency"
            value={selectedAgency}
            onChange={(e) => setSelectedAgency(e.target.value)}
          >
            <option value="">-- Choose an agency --</option>
            {agencies.map((agency) => (
              <option key={agency.id || agency} value={agency.id || agency}>
                {agency.name || agency}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="gtfs-file">Upload GTFS Zip File:</label>
          <input
            type="file"
            id="gtfs-file"
            name="gtfsFile"
            accept=".zip"
            onChange={(e) => setSelectedFile(e.target.files[0])}
          />
        </div>

        <button id="upload-btn" type="button" onClick={handleUpload}>
          Upload Data
        </button>
        <div id="message-area" className="message-display">
          {message}
        </div>
      </div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App