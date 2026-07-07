import { useState, useEffect } from 'react'
import Login from './components/Login'
import Drive from './components/Drive'
import { checkAuth, logout } from './lib/telegram'
import { Loader } from 'lucide-react'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth().then(isAuth => {
      setIsAuthenticated(isAuth)
      setLoading(false)
    })
  }, [])

  const handleLogout = async () => {
    setLoading(true)
    await logout()
    setIsAuthenticated(false)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex-center" style={{ height: '100vh', flexDirection: 'column' }}>
        <Loader className="animate-spin" size={48} color="var(--accent-primary)" style={{ marginBottom: '16px' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Đang kiểm tra kết nối Telegram...</p>
      </div>
    )
  }

  return (
    <div className="app-container">
      {!isAuthenticated ? (
        <Login onLogin={() => setIsAuthenticated(true)} />
      ) : (
        <Drive onLogout={handleLogout} />
      )}
    </div>
  )
}

export default App
