import { aquire } from "../src/aquire";
import { newInMemoryLockingProtocol } from "../src/inMemLocking";
import { defaultOptions, LOCK_ALREADY_AQUIRED, LOCK_AQUIRE_TIMEOUT, LOCK_RELEASED, LOCK_STOLEN_BY_HIGHER_PRIORITY, LOCK_TIMED_OUT, Obtain } from "../src/lockingProtocol";
import { LockHeldState } from "../src/release";
import { getNow, isLockError, promiseLastingFor } from '../src/util';
import { newSimulatedProtocol } from './netSimulatedProtocol';

describe('aquire', () => {
    it('should work with default values', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', defaultOptions)
            .then((lock) => {
                expect(lock.state()).toEqual(LockHeldState)
            })
    })
    it('should time out for expired aquire times', () => {
        const protocol = newInMemoryLockingProtocol()
        aquire(protocol)('a', 'l1', defaultOptions)
            .then(() => {
                return promiseLastingFor(1).then(() =>
                    aquire(protocol)('a', 'l2', { ...defaultOptions, aquireTimeout: 5 })
                        .then(() => {
                            throw new Error('Should not happen')
                        })
                        .catch((e) => {
                            expect([LOCK_AQUIRE_TIMEOUT, LOCK_ALREADY_AQUIRED]).toContain(e.code)
                        }),
                )
            })
    })
    it('should report a timeout if aquired but expired', () => {
        const protocol = newInMemoryLockingProtocol()
        aquire(protocol)('a', 'l1', { ...defaultOptions, aquireTimeout: 0 })
            .then(() => {
                throw new Error('Should not happen')
            })
            .catch((e) => {
                expect(e.code).toEqual(LOCK_AQUIRE_TIMEOUT)
            })
    })
    it('should block aquires of same priority', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', { ...defaultOptions, lockTtl: 30 })
            .then(() => {
                return aquire(protocol)('a', 'l2', { ...defaultOptions, aquireTimeout: 20 })
                    .then(() => {
                        throw new Error('Should not happen')
                    })
                    .catch((e) => {
                        expect([LOCK_ALREADY_AQUIRED, LOCK_AQUIRE_TIMEOUT]).toContain(e.code)
                    })
            })
    })
    it('should support re-entrance of higher priority', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', defaultOptions)
            .then((l1) => {
                return aquire(protocol)('a', 'l', { ...defaultOptions, aquireTimeout: 20, priority: 1 })
                    .then((l2) => {
                        expect(l1.state()).toEqual(LockHeldState)
                        expect(l2.state()).toEqual(LockHeldState)
                    })
                    .catch((e) => {
                        throw new Error('Should not happen')
                    })
            })
    })
    it('should not allow re-entrance to decrease priority', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', { ...defaultOptions, priority: 2 })
            .then((l1) => {
                return aquire(protocol)('a', 'l', { ...defaultOptions, aquireTimeout: 20, priority: 1 })
                    .then((l2) => {
                        return aquire(protocol)('a', 'other', { ...defaultOptions, aquireTimeout: 20, priority: 2 })
                            .then(() => {
                                throw new Error('Should not happen')
                            })
                            .catch((e) => {
                                expect(l1.state()).toEqual(LockHeldState)
                                expect(l2.state()).toEqual(LockHeldState)
                            })
                    })
            })
    })
    it('should aquire after previous locker manually releases', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', defaultOptions)
            .then((lock) => {
                promiseLastingFor(10).then(() => { lock.release() })
                return aquire(protocol)('a', 'l2', { ...defaultOptions, aquireTimeout: 50 })
                    .then(() => {
                        expect(lock.state()).toEqual(LOCK_RELEASED)
                    })
                    .catch((e) => {
                        throw new Error('Should not happen')
                    })
            })
    })
    it('should trigger onRelease when released', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', defaultOptions)
            .then((lock) => {
                let called = false
                lock.onRelease(() => {
                    called = true
                })
                lock.release().then(() => {
                    expect(called).toBe(true)

                    let called2 = false
                    lock.onRelease(() => {
                        called2 = true
                    })
                    expect(called2).toBe(true) // Should be called immediately
                    lock.release() // Should survive redundant releases
                })

            })
    })
    it('should aquire after previous locker automatically releases', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', { ...defaultOptions, lockTtl: 10 })
            .then((lock) => {
                return aquire(protocol)('a', 'l2', { ...defaultOptions, aquireTimeout: 50 })
                    .then(() => {
                        expect(lock.state()).toEqual(LOCK_TIMED_OUT)
                    })
                    .catch((e) => {
                        throw new Error('Should not happen')
                    })
            })
    })
    it('should retry obtain in ever-slower intervals', () => {
        const protocol = newSimulatedProtocol()

        // Set up obtain spy
        let lastObtainCallDelay = 0
        let lastObtainCall = 0
        let callCount = 0
        const obtain = protocol.obtain
        const obtainSpy: Obtain = (rGuid, holderId, aquId, options, timeout) => {
            const now = getNow()
            const callDelay = (now - lastObtainCall)
            if (lastObtainCall !== 0 && callDelay < lastObtainCallDelay) {
                throw new Error(`obtain call delay did not increment (${lastObtainCallDelay} >= ${callDelay}) on attempt ${callCount}`)
            }
            lastObtainCallDelay = lastObtainCall === 0 ? 0 : callDelay
            lastObtainCall = now
            callCount++
            return obtain(rGuid, holderId, aquId, options, timeout)
        }

        return aquire(protocol)('a', 'l', defaultOptions)
            .then((l) => {
                protocol.obtain = obtainSpy
                return aquire(protocol)('a', 'l2', { ...defaultOptions, aquireTimeout: 40 })
                    .then((l2) => {
                        throw new Error('Should not happen')
                    })
                    .catch((e) => {
                        if (!isLockError(e)) {
                            throw e
                        }
                        expect([LOCK_ALREADY_AQUIRED, LOCK_AQUIRE_TIMEOUT]).toContain(e.code)

                        // Assert some arbitrary minimally good behavior
                        expect(lastObtainCallDelay).toBeGreaterThan(6)
                        expect(callCount).toBeGreaterThan(3)
                    })
            })
    })
    it('should steal locks from lower priorities', () => {
        const protocol = newInMemoryLockingProtocol()
        return aquire(protocol)('a', 'l', defaultOptions)
            .then((lock) => {
                return aquire(protocol)('a', 'l2', { ...defaultOptions, priority: 1 })
                    .then((newLock) => {
                        expect(newLock.state()).toEqual(LockHeldState)
                        expect(lock.state()).toEqual(LOCK_STOLEN_BY_HIGHER_PRIORITY)
                    })
            })
    })
    it('should not acknowledge theft until receiving ack from original victim', () => {
        const protocol = newSimulatedProtocol()
        const theifAquireTimeout = 20
        return aquire(protocol)('a', 'l', defaultOptions)
            .then(() => {
                protocol.simulate({ victimAckDelay: (theifAquireTimeout * 3) })
                return Promise.all([
                    aquire(protocol)('a', 'l2', { ...defaultOptions, priority: 1, aquireTimeout: theifAquireTimeout })
                        .then(() => { throw new Error('Should not happen') })
                        .catch((e) => {
                            expect([LOCK_STOLEN_BY_HIGHER_PRIORITY, LOCK_AQUIRE_TIMEOUT]).toContain(e.code)
                            return true
                        }),
                    // 2nd thief attempts aquire after short delay
                    promiseLastingFor(1)
                        .then(() => {
                            protocol.simulate({ victimAckDelay: 0 })
                            return aquire(protocol)('a', 'l3', { ...defaultOptions, priority: 2, aquireTimeout: theifAquireTimeout })
                                .then(() => { throw new Error('Should not happen') })
                                .catch((e) => {
                                    expect(e.code).toEqual(LOCK_AQUIRE_TIMEOUT)
                                    return true
                                })
                        }),
                ])
            })
    })
    it('should acknowledge theft only after receiving ack from original victim', () => {
        const protocol = newSimulatedProtocol()
        return aquire(protocol)('a', 'l', defaultOptions)
            .then((firstLock) => promiseLastingFor(1).then(() => {
                protocol.simulate({ victimAckDelay: 30 })

                return Promise.all([
                    aquire(protocol)('a', 'l2', { ...defaultOptions, priority: 1, aquireTimeout: 4000 })
                        .then((l) => {
                            throw new Error('Should not happen')
                        })
                        .catch((e) => {
                            expect(firstLock.state()).toEqual(LOCK_STOLEN_BY_HIGHER_PRIORITY)
                            expect(e.code).toEqual(LOCK_ALREADY_AQUIRED)
                        }),
                    // 2nd thief attempts aquire after short delay
                    promiseLastingFor(5)
                        .then(() => {
                            protocol.simulate({ victimAckDelay: 0 })
                            return aquire(protocol)('a', 'l3', { ...defaultOptions, priority: 2 })
                                .catch((e) => {
                                    throw new Error('Should not happen')
                                })
                        }),
                ])
            }))
    })
})