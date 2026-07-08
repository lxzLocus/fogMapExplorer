import { useEffect, useRef, useState } from 'react'
import { MapController } from './lib/mapController.js'
import { register, login, logout, getUser } from './lib/auth.js'

// Fixed appearance/behaviour (product decision): 500 m reveal, blur fog, green.
const FIXED = { fogStyle: 'blur', revealRadius: 500, accent: '#7CFC9B' }
const accent = FIXED.accent
const accentGlow = accent + '55'

export default function App() {
  const mapRef = useRef(null)
  const ctrlRef = useRef(null)
  const toastTimer = useRef(null)

  const [tab, setTab] = useState('map')
  const [stats, setStats] = useState({
    exploredPct: '0.0',
    areaKm: '0.0',
    distKm: '0.0',
    level: 1,
    xpPct: 0,
    xpToNext: '',
    discoveryCount: 0,
    landmarkTotal: 12,
  })
  const [discoveries, setDiscoveries] = useState([])
  const [toast, setToast] = useState(null)
  const [status, setStatus] = useState('起動中…')

  // account
  const [user, setUser] = useState(getUser())
  const [showAccount, setShowAccount] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authPw, setAuthPw] = useState('')
  const [authErr, setAuthErr] = useState('')
  const [authBusy, setAuthBusy] = useState(false)

  // Create the controller once.
  useEffect(() => {
    if (ctrlRef.current) return
    const ctrl = new MapController(mapRef.current, FIXED, {
      onStats: setStats,
      onDiscoveries: setDiscoveries,
      onStatus: setStatus,
      onToast: (name) => {
        setToast(name)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 3500)
      },
    })
    ctrlRef.current = ctrl
    ctrl.init()
    return () => {
      clearTimeout(toastTimer.current)
      ctrl.destroy()
      ctrlRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep Leaflet sized to its container and redraw fog on viewport changes
  // (rotation, window resize, iOS PWA chrome/viewport settling after launch).
  useEffect(() => {
    const on = () => ctrlRef.current && ctrlRef.current.onViewportChange()
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    const vv = window.visualViewport
    if (vv) vv.addEventListener('resize', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
      if (vv) vv.removeEventListener('resize', on)
    }
  }, [])

  const recenter = () => ctrlRef.current && ctrlRef.current.recenter()

  const doAuth = async (kind) => {
    setAuthErr('')
    setAuthBusy(true)
    const res =
      kind === 'register' ? await register(authEmail, authPw) : await login(authEmail, authPw)
    setAuthBusy(false)
    if (!res.ok) {
      setAuthErr(res.error || '失敗しました')
      return
    }
    setUser(res.user)
    setAuthPw('')
    setShowAccount(false)
    // API owner is now the account: pull + union-merge + migrate current progress.
    if (ctrlRef.current) await ctrlRef.current.resync()
  }
  const doLogout = () => {
    logout()
    setUser(null)
    if (ctrlRef.current) ctrlRef.current.resync()
  }
  const openAccount = () => {
    setAuthErr('')
    setShowAccount(true)
  }

  const discoveriesDesc = [...discoveries].sort((a, b) => b.t - a.t)

  const tabBg = (t) => (tab === t ? 'rgba(255,255,255,.1)' : 'transparent')
  const tabColor = (t) => (tab === t ? accent : '#77839a')

  const SAFE_TOP = 'env(safe-area-inset-top, 0px)'
  const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0d12', overflow: 'hidden' }}>
      {/* MAP (the fog is drawn on a canvas inside a Leaflet pane) */}
      <div ref={mapRef} style={{ position: 'absolute', inset: 0 }} />

      {/* vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 401,
          boxShadow: 'inset 0 0 90px 30px rgba(0,0,0,.55)',
        }}
      />

      {/* HUD top */}
      <div
        style={{
          position: 'absolute',
          top: `calc(${SAFE_TOP} + 14px)`,
          left: 14,
          right: 14,
          zIndex: 500,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          pointerEvents: 'none',
        }}
      >
        <div style={hudCard}>
          <div style={hudLabel}>探索率</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ ...hudValue, color: accent }}>{stats.exploredPct}</span>
            <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 16, color: accent }}>%</span>
          </div>
        </div>
        <div style={{ ...hudCard, alignItems: 'flex-end' }}>
          <div style={hudLabel}>LEVEL</div>
          <div style={{ ...hudValue, color: '#e8ecf4' }}>{stats.level}</div>
        </div>
      </div>

      {/* discovery toast */}
      {toast && (
        <div
          style={{
            position: 'absolute',
            top: `calc(${SAFE_TOP} + 92px)`,
            left: 0,
            right: 0,
            zIndex: 600,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              animation: 'fx-toast 3.4s ease forwards',
              background: 'rgba(8,11,16,.92)',
              border: '1px solid ' + accent,
              borderRadius: 8,
              padding: '10px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              alignItems: 'center',
              boxShadow: '0 0 24px ' + accentGlow,
            }}
          >
            <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 10, letterSpacing: 3, color: accent }}>
              NEW AREA DISCOVERED
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>{toast}</div>
          </div>
        </div>
      )}

      {/* map controls: current-location button + GPS status */}
      {tab === 'map' && (
        <>
          <div
            style={{
              position: 'absolute',
              right: 14,
              bottom: `calc(${SAFE_BOTTOM} + 96px)`,
              zIndex: 500,
            }}
          >
            <button onClick={recenter} title="現在地へ" style={{ ...roundBtn, color: accent }}>
              ◎
            </button>
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `calc(${SAFE_BOTTOM} + 96px)`,
              zIndex: 490,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                background: 'rgba(8,11,16,.7)',
                borderRadius: 999,
                padding: '6px 14px',
                fontSize: 11,
                color: '#8a96aa',
                maxWidth: '80%',
                textAlign: 'center',
              }}
            >
              {status}
            </div>
          </div>
        </>
      )}

      {/* DISCOVERY LOG */}
      {tab === 'log' && (
        <div style={{ ...panel, paddingTop: `calc(${SAFE_TOP} + 74px)` }}>
          <div style={panelHeading}>DISCOVERY LOG — 発見の記録</div>
          {discoveriesDesc.length === 0 && (
            <div style={{ color: '#5a6578', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
              まだ発見はありません。
              <br />
              マップを歩いて霧を晴らしましょう。
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {discoveriesDesc.map((d, i) => (
              <div
                key={d.name + d.t}
                style={{ display: 'flex', gap: 14, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: accent,
                      boxShadow: '0 0 8px ' + accentGlow,
                      marginTop: 4,
                    }}
                  />
                  {i < discoveriesDesc.length - 1 && (
                    <div style={{ flex: 1, width: 1, background: 'rgba(255,255,255,.08)' }} />
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#eef2f8' }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: '#6b7788' }}>
                    {d.time} · {d.dist}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STATS */}
      {tab === 'stats' && (
        <div style={{ ...panel, paddingTop: `calc(${SAFE_TOP} + 74px)` }}>
          <div style={panelHeading}>EXPLORATION STATS — 統計</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <StatCard label="探索率(都心部)" value={stats.exploredPct} unit="%" big />
            <StatCard label="解放面積" value={stats.areaKm} unit=" km²" />
            <StatCard label="発見スポット" value={stats.discoveryCount} unit={' / ' + stats.landmarkTotal} />
            <StatCard label="総移動距離" value={stats.distKm} unit=" km" />
          </div>

          <div style={{ ...card, marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#c8d2e0', fontWeight: 700 }}>LEVEL {stats.level}</div>
              <div style={{ fontSize: 11, color: '#7e8ba0' }}>次のレベルまで {stats.xpToNext}</div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: stats.xpPct + '%',
                  background: accent,
                  borderRadius: 4,
                  boxShadow: '0 0 10px ' + accentGlow,
                  transition: 'width .3s ease',
                }}
              />
            </div>
          </div>

          {/* account button -> opens modal */}
          <button onClick={openAccount} style={accountBtn}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, textAlign: 'left' }}>
              <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: 12, letterSpacing: 2, color: '#c8d2e0' }}>
                アカウント
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: user ? '#eef2f8' : '#8a96aa',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user ? user.email : 'ログイン / 新規登録'}
              </span>
            </span>
            <span style={{ color: accent, fontSize: 22, lineHeight: 1 }}>›</span>
          </button>
        </div>
      )}

      {/* bottom tab bar */}
      <div
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: `calc(${SAFE_BOTTOM} + 14px)`,
          zIndex: 540,
          display: 'flex',
          gap: 6,
          background: 'rgba(8,11,16,.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 16,
          padding: 6,
        }}
      >
        <TabButton icon="◈" label="マップ" bg={tabBg('map')} color={tabColor('map')} onClick={() => setTab('map')} />
        <TabButton icon="◷" label="発見" bg={tabBg('log')} color={tabColor('log')} onClick={() => setTab('log')} />
        <TabButton icon="▦" label="統計" bg={tabBg('stats')} color={tabColor('stats')} onClick={() => setTab('stats')} />
      </div>

      {/* account modal */}
      {showAccount && (
        <div style={modalBackdrop} onClick={() => setShowAccount(false)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 14, letterSpacing: 2, color: '#e8ecf4' }}>
                アカウント
              </div>
              <button onClick={() => setShowAccount(false)} style={closeBtn} title="閉じる">
                ✕
              </button>
            </div>

            {user ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 14, color: '#eef2f8', wordBreak: 'break-all' }}>{user.email}</div>
                  <div style={{ fontSize: 11, color: '#7e8ba0', marginTop: 2 }}>ログイン中 · 複数端末で同期</div>
                </div>
                <button onClick={doLogout} style={{ ...secondaryBtn, flex: 'unset', width: '100%' }}>
                  ログアウト
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, color: '#7e8ba0', lineHeight: 1.5 }}>
                  登録すると現在の進捗をアカウントに保存し、他の端末でも同期できます。
                </div>
                <input
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="メールアドレス"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="password"
                  placeholder="パスワード（8文字以上）"
                  value={authPw}
                  onChange={(e) => setAuthPw(e.target.value)}
                  style={inputStyle}
                />
                {authErr && <div style={{ fontSize: 12, color: '#ff7a7a' }}>{authErr}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <button
                    disabled={authBusy}
                    onClick={() => doAuth('register')}
                    style={{ ...primaryBtn, background: accent, opacity: authBusy ? 0.6 : 1 }}
                  >
                    登録
                  </button>
                  <button
                    disabled={authBusy}
                    onClick={() => doAuth('login')}
                    style={{ ...secondaryBtn, opacity: authBusy ? 0.6 : 1 }}
                  >
                    ログイン
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, unit, big }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: '#7e8ba0', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 30, color: big ? accent : '#e8ecf4' }}>
        {value}
        <span style={{ fontSize: 14, color: '#7e8ba0' }}>{unit}</span>
      </div>
    </div>
  )
}

function TabButton({ icon, label, bg, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 0 8px',
        border: 'none',
        borderRadius: 11,
        background: bg,
        color,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span>
    </button>
  )
}

// ---- shared inline styles ----
const hudCard = {
  background: 'rgba(8,11,16,.78)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 10,
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  pointerEvents: 'auto',
}
const hudLabel = {
  fontFamily: 'Oswald, sans-serif',
  fontSize: 11,
  letterSpacing: 2.5,
  color: '#7e8ba0',
  textTransform: 'uppercase',
}
const hudValue = { fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 32, lineHeight: 1 }
const roundBtn = {
  width: 54,
  height: 54,
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(8,11,16,.85)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  fontSize: 20,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 16px rgba(0,0,0,.5)',
}
const panel = {
  position: 'absolute',
  inset: 0,
  zIndex: 520,
  background: 'rgba(7,10,14,.94)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  padding: '74px 20px calc(env(safe-area-inset-bottom, 0px) + 96px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
}
const panelHeading = {
  fontFamily: 'Oswald, sans-serif',
  fontSize: 13,
  letterSpacing: 3,
  color: '#7e8ba0',
  marginBottom: 18,
}
const card = {
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 12,
  padding: 16,
}
const accountBtn = {
  ...card,
  marginTop: 16,
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  cursor: 'pointer',
}
const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.12)',
  background: 'rgba(255,255,255,.04)',
  color: '#eef2f8',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}
const primaryBtn = {
  flex: 1,
  padding: '10px',
  borderRadius: 8,
  border: 'none',
  color: '#04140a',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}
const secondaryBtn = {
  flex: 1,
  padding: '10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.14)',
  background: 'transparent',
  color: '#c8d2e0',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}
const modalBackdrop = {
  position: 'fixed',
  inset: 0,
  zIndex: 700,
  background: 'rgba(0,0,0,.6)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
}
const modalCard = {
  width: 'min(360px, 100%)',
  background: '#11151c',
  border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 16,
  padding: 20,
  boxShadow: '0 20px 60px rgba(0,0,0,.6)',
}
const closeBtn = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,.14)',
  background: 'transparent',
  color: '#8a96aa',
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}
