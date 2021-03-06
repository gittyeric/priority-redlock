import { newInMemoryLockingProtocol } from '../src/inMemLocking';
import { promiseLastingFor as delay, promiseLastingFor } from '../src/util';
import { LockingProtocol } from '../src/lockingProtocol';

// Provides an in-memory instance of a LockingProtocol that acts like a distributed implementation
export interface NetworkSimulationOptions {
    victimAckDelay?: number,
    obtainDelay?: number,
    releaseDelay?: number,
}

interface NetworkSimulation {
    victimAckDelay: number,
    obtainDelay: number,
    releaseDelay: number,
}

export interface NetworkSimulatedLockingProtocol extends LockingProtocol {
    simulate(options: NetworkSimulationOptions): void
}

export const newSimulatedProtocol = () => {
    let simulation: NetworkSimulation = {
        victimAckDelay: 0,
        obtainDelay: 0,
        releaseDelay: 0,
    }
    const locking = newInMemoryLockingProtocol(() =>
        promiseLastingFor(simulation.victimAckDelay)
            .catch((e) => { throw e }))

    const protocol: NetworkSimulatedLockingProtocol = {
        ...locking,
        obtain: (...args) =>
            delay(simulation.obtainDelay).
                then(() => locking.obtain(...args))
                .catch((e) => Promise.reject(e)),
        release: (...args) =>
            delay(simulation.releaseDelay)
                .then(() => locking.release(...args))
                .catch((e) => Promise.reject(e)),
        simulate: (options: NetworkSimulationOptions) => {
            simulation = {
                ...simulation,
                ...options,
            }
        },
    }
    return protocol
}