import { DefinedAquireOptions, LockingProtocol, LOCK_ALREADY_AQUIRED, LOCK_AQUIRE_TIMEOUT, LOCK_STOLEN_BY_HIGHER_PRIORITY, ObtainedFromVictim } from './lockingProtocol';
import { Lock, newLock } from './release';
import { aquireWillBeExpired, exponentialBackoff, getNow, isAquiredFromPeer, isAquireExpired, isAquireSuccess, newLockError, promiseLastingFor, randomBytes, remainingAquireTime, remainingLockTime } from './util';

// Specifies internal, low-level interface details required for a resourceLock implementation,
// as well as an implemenetation of the aquire protocol layer that sits above LockingProtocol

const aquireFromVictim: (protocol: LockingProtocol) =>
    (resourceGuid: string, obtainResult: ObtainedFromVictim, initAquireTime: number, options: DefinedAquireOptions) => Promise<Lock> =
    (protocol) => (resourceGuid, obtainResult, initAquireTime, options) => {
        const lockTtl = remainingLockTime(obtainResult.obtainTimestamp, obtainResult.lockTtl)
        let lockIsBeingStolen = false // No one can steal till this function completes, but they can signal they will
        protocol.listenForTheif(() => {
            lockIsBeingStolen = true
        }, obtainResult.aquisitionId, resourceGuid, lockTtl)

        const remainingAquireTtl = remainingAquireTime(initAquireTime, options.aquireTimeout)
        return protocol.notifyVictim(obtainResult.exAquisitionId, obtainResult.aquisitionId, resourceGuid, remainingAquireTtl)
            .then(() => {
                if (lockIsBeingStolen) {
                    throw newLockError(LOCK_STOLEN_BY_HIGHER_PRIORITY)
                }
                if (isAquireExpired(initAquireTime, options.aquireTimeout)) {
                    throw newLockError(LOCK_AQUIRE_TIMEOUT)
                }
                return newLock(protocol)(resourceGuid, obtainResult)
            })
    }

const aquireLock: (protocol: LockingProtocol) =>
    (resourceGuid: string, lockerGuid: string, options: DefinedAquireOptions, initAquireTime: number, callCount: number) =>
        Promise<Lock> =
    (protocol) =>
        (resourceGuid, lockerGuid, options, initAquireTime, callCount) => {
            const curAquireTimeout = remainingAquireTime(initAquireTime, options.aquireTimeout)
            const proposedAquisitionId = randomBytes(16)
            return protocol.obtain(resourceGuid, lockerGuid, proposedAquisitionId, options, curAquireTimeout)
                .then((result) => {
                    if (isAquireSuccess(result)) {
                        if (isAquireExpired(initAquireTime, options.aquireTimeout)) {
                            throw newLockError(LOCK_AQUIRE_TIMEOUT)
                        }

                        // If stolen from peer, wait some time for their acknowledgement
                        if (isAquiredFromPeer(result)) {
                            return aquireFromVictim(protocol)(resourceGuid, result, initAquireTime, options)
                                .catch((e) => {
                                    throw e
                                })
                        }
                        return newLock(protocol)(resourceGuid, result)
                    }
                    // Lock is already taken by higher or same priority holder
                    else {
                        throw newLockError(LOCK_ALREADY_AQUIRED)
                    }
                })
                // Any number of errors could have occurred
                // In all cases, just retry an aquire if there's time left
                .catch((e: Error) => {
                    // Might not need to release EVERY time, but this layer will leave that question to the protocol impl
                    //if (!isStolenLockError(e)) {
                    const remainingLockTtl = remainingLockTime(getNow(), options.lockTtl)
                    protocol.release(proposedAquisitionId, 0, resourceGuid, remainingLockTtl)
                        .then(() => { }) // Succeeded? That's nice I guess
                        .catch((e) => { }) // Swallow release errors since there's nothing to do
                    //}

                    const nextAquireDelay = exponentialBackoff(callCount)
                    if (!aquireWillBeExpired(initAquireTime, nextAquireDelay, options)) {
                        return promiseLastingFor(nextAquireDelay)
                            .then(() => aquireLock(protocol)(resourceGuid, lockerGuid, options, initAquireTime, callCount + 1))
                            .catch((e) => {
                                throw e })
                    }
                    throw e
                })
        }

export type Aquire = (resourceGuid: string, lockerGuid: string, options: DefinedAquireOptions) => Promise<Lock>
export const aquire: (protocol: LockingProtocol) => Aquire =
    (protocol) =>
        (resourceGuid, lockerGuid, options) =>
            aquireLock(protocol)(resourceGuid, lockerGuid, options, getNow(), 0)