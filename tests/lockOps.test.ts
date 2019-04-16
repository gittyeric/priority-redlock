import { aquire } from "../src/aquire";
import { newInMemoryLockingProtocol } from "../src/inMemLocking";
import { defaultOptions, LOCK_RELEASED } from "../src/lockingProtocol";
import { aquireAll } from "../src/lockOps";
import { LockHeldState, Lock } from "../src/release";
import { newSimulatedProtocol } from "./netSimulatedProtocol";
import { isLockError, promiseLastingFor, isLockHeld } from "../src/util";

describe('aquireAll', () => {
    it('should fail for no aquirers', () => {
        const protocol = newSimulatedProtocol()
        protocol.simulate({ obtainDelay: 30 })

        return aquireAll([], 40)
            .then(() => {
                throw new Error('should not happen')
            })
            .catch((e) => {
                expect(!isLockError(e)).toBeTruthy()
            })
    })
    it('should aquire dual lock', () => {
        const protocol = newInMemoryLockingProtocol()

        return aquireAll([
            () => aquire(protocol)('a', 'l', defaultOptions),
            () => aquire(protocol)('b', 'l2', defaultOptions),
        ], Number.POSITIVE_INFINITY)
            .then((dualLock) => {
                expect(dualLock.state()).toBe(LockHeldState)
                let called = false
                dualLock.onRelease(() => {
                    called = true
                })
                return dualLock.release().then(() => {
                    expect(called).toBeTruthy()
                    expect(dualLock.state()).toEqual(LOCK_RELEASED)
                })
            })
    })
    it('should fail if first aquire fails', () => {
        const protocol = newSimulatedProtocol()
        protocol.simulate({ obtainDelay: 30 })

        return aquireAll([
            () => aquire(protocol)('a', 'l', { ...defaultOptions, aquireTimeout: 20 }),
            () => aquire(protocol)('b', 'l2', { ...defaultOptions, aquireTimeout: 60 }),
        ], Number.POSITIVE_INFINITY)
            .then(() => {
                throw new Error('should not happen')
            })
            .catch((e) => {
                expect(isLockError(e)).toBeTruthy()
            })
    })
    it('should fail if last aquire fails', () => {
        const protocol = newSimulatedProtocol()
        protocol.simulate({ obtainDelay: 30 })

        return aquireAll([
            () => aquire(protocol)('a', 'l', { ...defaultOptions, aquireTimeout: 60 }),
            () => aquire(protocol)('b', 'l2', { ...defaultOptions, aquireTimeout: 20 }),
        ], Number.POSITIVE_INFINITY)
            .then(() => {
                throw new Error('should not happen')
            })
            .catch((e) => {
                expect(isLockError(e)).toBeTruthy()
            })
    })
    it('should fail if middle aquire releases', () => {
        const protocol = newSimulatedProtocol()
        protocol.simulate({ obtainDelay: 10 })

        return aquireAll([
            () => aquire(protocol)('a', 'l', { ...defaultOptions }),
            () => {
                return aquire(protocol)('b', 'l2', { ...defaultOptions })
                    .then((lock2) => {
                        promiseLastingFor(8).then(() => lock2.release())
                        return lock2
                    })
            },
            () => aquire(protocol)('c', 'l3', { ...defaultOptions }),
            () => aquire(protocol)('d', 'l4', { ...defaultOptions })
                .then(() => {
                    throw new Error('should not happen 1')
                }),
        ], Number.POSITIVE_INFINITY)
            .then(() => {
                throw new Error('should not happen 2')
            })
            .catch((e) => {
                expect(isLockError(e)).toBeTruthy()
            })
    })
    it('should fail if times out overall', () => {
        const protocol = newSimulatedProtocol()
        protocol.simulate({ obtainDelay: 30 })

        return aquireAll([
            () => aquire(protocol)('a', 'l', { ...defaultOptions, aquireTimeout: 40 }),
            () => aquire(protocol)('b', 'l2', { ...defaultOptions, aquireTimeout: 40 }),
        ], 40)
            .then(() => {
                throw new Error('should not happen')
            })
            .catch((e) => {
                expect(isLockError(e)).toBeTruthy()
            })
    })
})