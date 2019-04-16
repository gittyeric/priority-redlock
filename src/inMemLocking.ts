import { newDispatcher } from './eventDispatcher';
import { DefinedAquireOptions, LockError, LockingProtocol, LOCK_ALREADY_AQUIRED, LOCK_RELEASED, LOCK_STOLEN_BY_HIGHER_PRIORITY, Obtain, ObtainedByReentrance, ObtainedFromVictim, ObtainSuccess, Release, ReleaseListener, ReleaseReason, TheifListener, LOCK_TIMED_OUT } from './lockingProtocol';
import { getNow, newLockError } from './util';


export type NotifyUnlock = (aquisitionId: string, unlockReason: LockError<any>) => Promise<void>
export interface InMemoryLockingProtocol extends LockingProtocol {
}

interface LockValue {
    aquisitionId: string,
    priority: number,
    lockerId: string,
    lockAquireTimestamp: number,
    lockTtl: number,
}

interface ResourceToLocker {
    [resourceGuid: string]: LockValue
}

interface AquisitionToOffs {
    [aquisitionId: string]: (() => void)[]
}

interface LockerToPendingAcks {
    [aquisitionId: string]: Promise<void>,
}

const addOff = (aquisitionId: string, listeners: AquisitionToOffs, off: () => void) => {
    const existing = listeners[aquisitionId] || []
    existing.push(off)
    listeners[aquisitionId] = existing
}

const removeOff = (aquisitionId: string, listeners: AquisitionToOffs, off: () => void) => {
    const existing = listeners[aquisitionId] || []
    const index = existing.indexOf(off)
    if (index >= 0) {
        existing[index]()
        existing.splice(index, 1)
    }
    if (existing.length === 0) {
        delete listeners[aquisitionId]
    }
}

export const newInMemoryLockingProtocol: (beforeVictimNotify?: (aquisitionId: string) => Promise<void>) => InMemoryLockingProtocol =
    (beforeVictimNotify) => {
        const resourceLockMap: ResourceToLocker = {}
        const aquisitionThiefAcks: LockerToPendingAcks = {}
        const theifListeners: AquisitionToOffs = {}

        const theftDispatcher = newDispatcher<void>()
        const releaseDispatcher = newDispatcher<ReleaseReason>()

        const getLockIfOwned = (aquisitionId: string, resourceGuid: string) => {
            const existing = resourceLockMap[resourceGuid]
            if (existing && existing.aquisitionId === aquisitionId) {
                return existing
            }
            return undefined
        }

        // Always call last since it destroys everything
        const deleteResourceLock: (aquisitionId: string, resourceGuid: string) => Promise<LockValue> =
            (aquisitionId, resourceGuid) => {
                const owned = getLockIfOwned(aquisitionId, resourceGuid)
                if (owned) {
                    delete resourceLockMap[resourceGuid]
                    return Promise.resolve(owned)
                }
                return Promise.reject(new Error('Attempted to release a lock not currently owned'))
            }

        const applyReleaseTtl = (lockAquireTimestamp: number, resourceGuid: string, aquisitionId: string, lockTtl: number) => {
            if (isFinite(lockTtl)) {
                setTimeout(() => {
                    deleteResourceLock(aquisitionId, resourceGuid)
                        .then(() => {
                            releaseDispatcher.dispatch(aquisitionId, LOCK_TIMED_OUT)
                        })
                        .catch(() => { })
                }, lockTtl - (getNow() - lockAquireTimestamp))
            }
        }

        const obtain: Obtain = (resourceGuid: string, lockerId: string, proposedAquisitionId: string, options: DefinedAquireOptions, timeout: number) => {
            const existing = resourceLockMap[resourceGuid]

            const now = getNow()
            const lockValue: LockValue = {
                aquisitionId: proposedAquisitionId,
                lockerId: lockerId,
                lockAquireTimestamp: now,
                lockTtl: options.lockTtl,
                priority: options.priority,
            }

            // Lock was not previously held
            if (!existing) {
                const result: ObtainSuccess = {
                    aquisitionId: proposedAquisitionId,
                    obtainTimestamp: (new Date()).getTime(),
                    lockTtl: options.lockTtl,
                }
                resourceLockMap[resourceGuid] = lockValue
                applyReleaseTtl(now, resourceGuid, proposedAquisitionId, options.lockTtl)
                return Promise.resolve(result)
            }
            // Re-entrant case of fetching old lock from same holder
            else if (existing.lockerId === lockerId) {
                const result: ObtainedByReentrance = {
                    oldPriority: existing.priority,
                    aquisitionId: existing.aquisitionId,
                    obtainTimestamp: existing.lockAquireTimestamp,
                    lockTtl: existing.lockTtl,
                }

                // Need to maintain existing LockValue TTLs to avoid hogging the lock,
                // but the lock needs to be slightly modified in case priority has increased
                resourceLockMap[resourceGuid] = {
                    ...existing,
                    priority: Math.max(options.priority, existing.priority),
                }
                return Promise.resolve(result)
            }
            // Higher priority lock steal
            else if (existing.priority < options.priority) {
                const result: ObtainedFromVictim = {
                    aquisitionId: proposedAquisitionId,
                    exAquisitionId: existing.aquisitionId,
                    exLockerGuid: existing.lockerId,
                    lockTtl: existing.lockTtl,
                    obtainTimestamp: existing.lockAquireTimestamp,
                }

                return deleteResourceLock(existing.aquisitionId, resourceGuid)
                    .then(() => {
                        resourceLockMap[resourceGuid] = lockValue
                        applyReleaseTtl(now, resourceGuid, proposedAquisitionId, options.lockTtl)
                        return result
                    })
            }
            // Otherwise, a higher priority holder trumps your request
            return Promise.reject(newLockError(LOCK_ALREADY_AQUIRED))
        }

        const release: Release = (aquisitionId: string, i: number, resourceGuid: string, timeout: number) => {
            return deleteResourceLock(aquisitionId, resourceGuid)
                .then(() => {
                    releaseDispatcher.dispatch(aquisitionId, LOCK_RELEASED)
                })
                .catch((e) => {
                    return e
                })
        }

        const applyListenerTtl = (listeners: AquisitionToOffs, aquisitionId: string, off: () => void, timeout: number) => {
            addOff(aquisitionId, theifListeners, off)
            if (isFinite(timeout)) {
                setTimeout(() => removeOff(aquisitionId, listeners, off), timeout)
            }
        }

        const listenForTheif: TheifListener = (listener: () => void, aquisitionId: string, resourceGuid: string, timeout: number) => {
            const owned = getLockIfOwned(aquisitionId, resourceGuid)
            if (owned) {
                const off = theftDispatcher.once(aquisitionId, () => {
                    listener()
                })
                // After either TTL or release, free the listener
                applyListenerTtl(theifListeners, aquisitionId, off, timeout)
                listenForUnlock(() =>
                    removeOff(aquisitionId, theifListeners, off),
                    aquisitionId, resourceGuid, timeout)
            }
            // Otherwise probably an upstream bug
            else {
                throw new Error(`Cannot listen for theif, ${aquisitionId} does not own ${resourceGuid}`)
            }
        }

        const listenForUnlock: ReleaseListener = (listener: (reason: ReleaseReason) => void, aquisitionId: string, resourceGuid: string, timeout: number) => {
            const owned = getLockIfOwned(aquisitionId, resourceGuid)
            if (owned) {
                const off = releaseDispatcher.once(aquisitionId, (reason) => {
                    listener(reason)
                })
                applyListenerTtl({}, aquisitionId, off, timeout)
            }
            // Otherwise probably an upstream bug
            else {
                throw new Error(`Cannot listen for unlock, ${aquisitionId} does not own ${resourceGuid}`)
            }
        }

        const notifyVictim = (victimAquisitionId: string, aquisitionId: string, resourceGuid: string, timeout: number) => {
            theftDispatcher.dispatch(victimAquisitionId)

            let originalVictimAck = aquisitionThiefAcks[victimAquisitionId]
            if (!originalVictimAck) {
                originalVictimAck = Promise.resolve()
            }

            // If currently waiting for an original victim's ack, wait on that first
            const victimAck = originalVictimAck.then(() =>
                beforeVictimNotify ?
                    beforeVictimNotify(victimAquisitionId).then(() =>
                        releaseDispatcher.dispatch(victimAquisitionId, LOCK_STOLEN_BY_HIGHER_PRIORITY)) :
                    Promise.resolve(
                        releaseDispatcher.dispatch(victimAquisitionId, LOCK_STOLEN_BY_HIGHER_PRIORITY)))

            aquisitionThiefAcks[aquisitionId] = victimAck
            const clear = () => { delete aquisitionThiefAcks[aquisitionId] }
            victimAck.then(clear)
            return victimAck
        }

        return {
            obtain,
            release,
            listenForTheif,
            listenForUnlock,
            notifyVictim,
        }
    }