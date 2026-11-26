import { useState } from 'react'
import ImportData from './ImportData.jsx'
import ReviewUpdates from './ReviewUpdates.jsx'
import RiderCategories from './RiderCategories.jsx'

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
        <button
          type="button"
          onClick={() => setScreen('categories')}
          disabled={screen === 'categories'}
        >
          Rider Categories
        </button>
      </nav>

      {screen === 'import' && <ImportData />}
      {screen === 'review' && <ReviewUpdates />}
      {screen === 'categories' && <RiderCategories />}
    </>
  )
}

export default App