/**
 * circuit-breaker.ts — Circuit Breaker fuer Skill-Execution (Phase D4)
 *
 * Prevents a faulty remote skill from taking down the daemon by
 * implementing the circuit breaker pattern:
 *
 * States:
 *   CLOSED  → Normal operation. Failures counted.
 *   OPEN    → Requests immediately rejected. After timeout, move to HALF_OPEN.
 *   HALF_OPEN → One probe request allowed. Success → CLOSED. Failure → OPEN.
 *
 * Configuration per skill:
 *   failureThreshold: Number of consecutive failures to open the circuit (default: 5)
 *   resetTimeoutMs: Time to wait before trying again (default: 60s)
 *   halfOpenMaxProbes: Max concurrent probes in HALF_OPEN (default: 1)
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Failures before opening circuit. Default: 5 */
  failureThreshold?: number;
  /** Time in ms before moving from OPEN to HALF_OPEN. Default: 60_000 */
  resetTimeoutMs?: number;
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  openedAt: number;
  successCount: number;
  totalCalls: number;
}

export interface CircuitStatus {
  skillId: string;
  state: CircuitState;
  failures: number;
  successCount: number;
  totalCalls: number;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
}

export class CircuitBreaker {
  private circuits = new Map<string, CircuitEntry>();
  private failureThreshold: number;
  private resetTimeoutMs: number;

  constructor(config?: CircuitBreakerConfig) {
    this.failureThreshold = config?.failureThreshold ?? 5;
    this.resetTimeoutMs = config?.resetTimeoutMs ?? 60_000;
  }

  /**
   * Check if a request to the given skill should be allowed.
   * Returns true if allowed, false if the circuit is open.
   */
  canExecute(skillId: string): boolean {
    const circuit = this.getOrCreate(skillId);

    switch (circuit.state) {
      case 'closed':
        return true;

      case 'open': {
        // Check if reset timeout has elapsed
        const elapsed = Date.now() - circuit.openedAt;
        if (elapsed >= this.resetTimeoutMs) {
          circuit.state = 'half_open';
          return true; // Allow one probe
        }
        return false; // Still open
      }

      case 'half_open':
        return true; // Allow probe request
    }
  }

  /**
   * Record a successful execution.
   */
  recordSuccess(skillId: string): void {
    const circuit = this.getOrCreate(skillId);
    circuit.successCount++;
    circuit.totalCalls++;

    if (circuit.state === 'half_open') {
      // Probe succeeded → close circuit
      circuit.state = 'closed';
      circuit.failures = 0;
    } else {
      // Reset failure counter on success
      circuit.failures = 0;
    }
  }

  /**
   * Record a failed execution.
   */
  recordFailure(skillId: string): void {
    const circuit = this.getOrCreate(skillId);
    circuit.failures++;
    circuit.totalCalls++;
    circuit.lastFailureAt = Date.now();

    if (circuit.state === 'half_open') {
      // Probe failed → reopen circuit
      circuit.state = 'open';
      circuit.openedAt = Date.now();
    } else if (circuit.failures >= this.failureThreshold) {
      // Threshold exceeded → open circuit
      circuit.state = 'open';
      circuit.openedAt = Date.now();
    }
  }

  /**
   * Get the status of all circuits.
   */
  getAll(): CircuitStatus[] {
    const results: CircuitStatus[] = [];
    for (const [skillId, circuit] of this.circuits) {
      results.push(this.toStatus(skillId, circuit));
    }
    return results;
  }

  /**
   * Get the status of a specific circuit.
   */
  getStatus(skillId: string): CircuitStatus {
    return this.toStatus(skillId, this.getOrCreate(skillId));
  }

  /**
   * Manually reset a circuit to closed state.
   */
  reset(skillId: string): void {
    const circuit = this.getOrCreate(skillId);
    circuit.state = 'closed';
    circuit.failures = 0;
  }

  /**
   * Clear all circuits.
   */
  clear(): void {
    this.circuits.clear();
  }

  private getOrCreate(skillId: string): CircuitEntry {
    let circuit = this.circuits.get(skillId);
    if (!circuit) {
      circuit = {
        state: 'closed',
        failures: 0,
        lastFailureAt: 0,
        openedAt: 0,
        successCount: 0,
        totalCalls: 0,
      };
      this.circuits.set(skillId, circuit);
    }
    return circuit;
  }

  private toStatus(skillId: string, circuit: CircuitEntry): CircuitStatus {
    let nextRetryAt: string | null = null;
    if (circuit.state === 'open') {
      const retryTime = circuit.openedAt + this.resetTimeoutMs;
      nextRetryAt = new Date(retryTime).toISOString();
    }

    return {
      skillId,
      state: circuit.state,
      failures: circuit.failures,
      successCount: circuit.successCount,
      totalCalls: circuit.totalCalls,
      lastFailureAt: circuit.lastFailureAt ? new Date(circuit.lastFailureAt).toISOString() : null,
      nextRetryAt,
    };
  }
}
