import { useState, useCallback, useRef } from 'react';
import { api } from '../api.ts';
import { usePolling } from '../hooks/usePolling.ts';

/** Pairing-Interface: PIN generieren, anzeigen, PIN eingeben, Status pruefen */
export function PairingView() {
  const fetchStatus = useCallback(() => api.getPairingStatus(), []);
  const { data: pairingStatus, refresh } = usePolling(fetchStatus, 5_000);
  const [pin, setPin] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmingPin, setConfirmingPin] = useState(false);
  const [confirmResult, setConfirmResult] = useState<'success' | 'error' | null>(null);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '', '', '']);

  const handleStartPairing = async () => {
    setStarting(true);
    try {
      const result = await api.startPairing();
      setPin(result.pin);
      refresh();
    } catch {
      alert('Pairing konnte nicht gestartet werden');
    } finally {
      setStarting(false);
    }
  };

  const handlePinDigitChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return; // Nur Ziffern
    const newDigits = [...pinDigits];
    newDigits[index] = value;
    setPinDigits(newDigits);

    // Auto-Focus zum naechsten Feld
    if (value && index < 5) {
      pinInputRefs.current[index + 1]?.focus();
    }

    // Auto-Submit wenn alle 6 Ziffern eingegeben
    if (newDigits.every((d) => d.length === 1)) {
      void handleConfirmPin(newDigits.join(''));
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
    }
  };

  const handleConfirmPin = async (enteredPin: string) => {
    setConfirmingPin(true);
    setConfirmResult(null);
    try {
      await api.confirmPairing(enteredPin);
      setConfirmResult('success');
      refresh();
    } catch {
      setConfirmResult('error');
      setPinDigits(['', '', '', '', '', '']);
      pinInputRefs.current[0]?.focus();
    } finally {
      setConfirmingPin(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
        Peer-Pairing
      </h2>

      {/* PIN-Anzeige */}
      <div className="card" style={{ marginBottom: '1rem', textAlign: 'center' }}>
        {pin ? (
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
              PIN dem Benutzer des anderen Nodes mitteilen:
            </p>
            <div style={{
              fontSize: '3rem',
              fontWeight: 800,
              fontFamily: 'monospace',
              letterSpacing: '0.5rem',
              color: 'var(--accent)',
              padding: '1rem',
            }}>
              {pin}
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
              Die PIN ist 5 Minuten gueltig
            </p>
          </div>
        ) : (
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
              Starte das Pairing um eine PIN zu generieren.
              Der Benutzer des anderen Nodes gibt diese PIN ein.
            </p>
            <button
              onClick={handleStartPairing}
              disabled={starting}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                padding: '0.75rem 2rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: starting ? 'not-allowed' : 'pointer',
                opacity: starting ? 0.5 : 1,
              }}
            >
              {starting ? 'Starte...' : 'Pairing starten'}
            </button>
          </div>
        )}
      </div>

      {/* PIN-Eingabe (um PIN eines anderen Nodes einzugeben) */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          PIN eines anderen Nodes eingeben
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
          Der andere Node hat eine 6-stellige PIN generiert. Gib sie hier ein:
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '0.75rem' }}>
          {pinDigits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { pinInputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handlePinDigitChange(i, e.target.value)}
              onKeyDown={(e) => handlePinKeyDown(i, e)}
              disabled={confirmingPin}
              style={{
                width: '2.5rem',
                height: '3rem',
                fontSize: '1.5rem',
                fontWeight: 700,
                fontFamily: 'monospace',
                textAlign: 'center',
                border: `2px solid ${confirmResult === 'error' ? 'var(--danger)' : confirmResult === 'success' ? 'var(--success)' : 'var(--border)'}`,
                borderRadius: '0.5rem',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
              aria-label={`PIN Ziffer ${i + 1}`}
            />
          ))}
        </div>
        {confirmResult === 'success' && (
          <p style={{ color: 'var(--success)', fontSize: '0.8125rem', textAlign: 'center' }}>
            Pairing erfolgreich!
          </p>
        )}
        {confirmResult === 'error' && (
          <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', textAlign: 'center' }}>
            Ungueltige PIN. Bitte erneut versuchen.
          </p>
        )}
        {confirmingPin && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', textAlign: 'center' }}>
            Pruefe PIN...
          </p>
        )}
      </div>

      {/* Aktive Session */}
      {pairingStatus?.active_session && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Aktive Pairing-Session
          </h3>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            <p>Status: <span className={`badge badge-${pairingStatus.active_session.state === 'completed' ? 'online' : 'degraded'}`}>
              {pairingStatus.active_session.state}
            </span></p>
            {pairingStatus.active_session.peer && (
              <p style={{ marginTop: '0.25rem' }}>Peer: {pairingStatus.active_session.peer}</p>
            )}
            <p style={{ marginTop: '0.25rem' }}>Alter: {pairingStatus.active_session.age_seconds}s</p>
          </div>
        </div>
      )}

      {/* Gepaarte Peers */}
      <div className="card">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
          Gepaarte Peers ({pairingStatus?.paired_peers?.length ?? 0})
        </h3>
        {pairingStatus?.paired_peers && pairingStatus.paired_peers.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {pairingStatus.paired_peers.map((peer) => (
              <div key={peer.agent_id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0.75rem',
                background: 'var(--bg-primary)',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
              }}>
                <div>
                  <span style={{ fontWeight: 500 }}>{peer.hostname}</span>
                  <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                    {peer.agent_id.split('/').pop()}
                  </span>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  {new Date(peer.paired_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            Noch keine Peers gepaart
          </p>
        )}
      </div>
    </div>
  );
}
