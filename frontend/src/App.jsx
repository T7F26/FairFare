import { useState } from 'react'
import ImportData from './ImportData.jsx'
import ReviewUpdates from './ReviewUpdates.jsx'

function App() {
  const [screen, setScreen] = useState('import')

  return (
    <>
      <nav className="admin-nav">
        <button type="button" onClick={() => setScreen('import')} disabled={screen === 'import'}>
          Import Data
        </button>
        <button type="button" onClick={() => setScreen('review')} disabled={screen === 'review'}>
          Review Updates
        </button>
      </nav>

      {screen === 'import' ? <ImportData /> : <ReviewUpdates />}
    </>
  )
}

export default App
